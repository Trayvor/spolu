import { useEffect, useState } from 'react';
import { useSession } from '@/features/auth/use-session';
import { useUpdateSearch, type SearchRecord } from './use-update-search';

/**
 * Remembered list filters (Phase 27, owner request): every list with filters keeps the
 * person's last choice per signed-in user, in `localStorage` under
 * `spolu.filters.<userId>.<list>` (the list key names the group where filters are per group).
 *
 * The URL stays the source of truth: when it has any of the list's filter params, they are what
 * the list shows, and they are saved. When the list opens with none of them, the saved ones are
 * written into the URL (`replace`), and the returned search already has them, so the first
 * request is the right one. Clearing the filters empties the URL and so forgets the saved value.
 * Free text search is never a filter key here. Blocked storage degrades silently: no memory.
 */

const PREFIX = 'spolu.filters.';

export function rememberedFiltersKey(userId: string, list: string): string {
  return `${PREFIX}${userId}.${list}`;
}

export function readRemembered(key: string): SearchRecord | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as SearchRecord)
      : null;
  } catch {
    return null;
  }
}

export function writeRemembered(key: string, value: SearchRecord | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: the URL still holds the choice.
  }
}

/** The defined filter params of `search`, or null when there are none. */
function pickFilters(search: SearchRecord, keys: readonly string[]): SearchRecord | null {
  const picked: SearchRecord = {};
  for (const key of keys) {
    const value = search[key];
    if (value !== undefined && value !== null && value !== '') picked[key] = value;
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

/**
 * Restores and saves one list's filters. `search` is the route's validated search; `keys` are
 * its filter params. Returns the search to use: the URL's, or, while the restore is on its way
 * into the URL, the URL's with the saved filters.
 */
export function useRememberedFilters<S extends object>(
  list: string,
  keys: readonly string[],
  search: S,
): S {
  const userId = useSession()?.id ?? null;
  const update = useUpdateSearch();
  const storageKey = userId === null ? null : rememberedFiltersKey(userId, list);
  const current = pickFilters(search as SearchRecord, keys);

  // Decided once per list (a group switch is another list): restore only into an empty URL.
  const [restore, setRestore] = useState<{ key: string | null; saved: SearchRecord | null }>(
    () => ({ key: storageKey, saved: current || !storageKey ? null : readRemembered(storageKey) }),
  );
  let saved = restore.saved;
  if (restore.key !== storageKey) {
    saved = current || !storageKey ? null : readRemembered(storageKey);
    setRestore({ key: storageKey, saved });
  }
  // The restore is done once the URL has a filter (the restored ones, or the person's own).
  const restoring = saved !== null && current === null;
  if (saved !== null && current !== null) setRestore({ key: storageKey, saved: null });

  useEffect(() => {
    if (!restoring || !saved) return;
    update((next) => Object.assign(next, saved), { replace: true });
  }, [restoring, saved, update]);

  const json = current === null ? null : JSON.stringify(current);
  useEffect(() => {
    if (restoring || !storageKey) return;
    writeRemembered(storageKey, json === null ? null : (JSON.parse(json) as SearchRecord));
  }, [restoring, storageKey, json]);

  return restoring ? ({ ...search, ...saved } as S) : search;
}

/**
 * The same memory for a filter kept in component state (no URL), such as a report's status
 * select: starts from the saved value when `valid` accepts it, saves every change, and forgets
 * it when set back to null (the default). `valid` null: any saved string (an id the caller checks
 * against its loaded data, such as an admin or a currency).
 */
export function useRememberedState<T extends string>(
  list: string,
  valid: readonly T[] | null,
): [T | null, (next: T | null) => void] {
  const userId = useSession()?.id ?? null;
  const key = userId === null ? null : rememberedFiltersKey(userId, list);
  const [value, setValue] = useState<T | null>(() => {
    const saved = key ? readRemembered(key)?.value : undefined;
    if (typeof saved !== 'string') return null;
    return valid === null || valid.includes(saved as T) ? (saved as T) : null;
  });
  const set = (next: T | null) => {
    setValue(next);
    if (key) writeRemembered(key, next === null ? null : { value: next });
  };
  return [value, set];
}
