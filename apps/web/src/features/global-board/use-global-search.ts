import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import type { GlobalBoardSearch } from '@/router';
import { useUpdateSearch } from '@/lib/use-update-search';
import type { GlobalFilters } from './api';

/** The last explicit client choice, restored on a visit without `clients`. */
export const BOARD_CLIENTS_KEY = 'spolu.globalBoard.clients';

function readStored(): string | null {
  try {
    return localStorage.getItem(BOARD_CLIENTS_KEY);
  } catch {
    return null;
  }
}

function writeStored(clients: string | null) {
  try {
    if (clients === null) localStorage.removeItem(BOARD_CLIENTS_KEY);
    else localStorage.setItem(BOARD_CLIENTS_KEY, clients);
  } catch {
    // Blocked storage: the URL still holds the choice.
  }
}

/** The filter keys the board writes; "Clear filters" removes them all. */
const FILTER_KEYS = ['clients', 'assignee', 'urgent', 'due', 'q', 'completed'] as const;

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The global board's filters, all in the URL (`/tasks?clients&assignee&urgent&due&q&completed`)
 * plus the open task (`task`). A visit without `clients` restores the last explicit choice from
 * `localStorage`; `null` clients is the default scope (the managed clients, or all).
 */
export function useGlobalSearch() {
  const search = useSearch({ strict: false }) as GlobalBoardSearch;
  const update = useUpdateSearch();

  const [stored] = useState(() => (search.clients === undefined ? readStored() : null));
  const [restoring, setRestoring] = useState(stored !== null);
  useEffect(() => {
    if (stored !== null) update((s) => void (s.clients = stored), { replace: true });
  }, [stored, update]);
  if (restoring && search.clients !== undefined) setRestoring(false);
  const clientsParam = restoring ? (stored ?? undefined) : search.clients;

  const filters = useMemo<GlobalFilters>(
    () => ({
      clients: clientsParam,
      assignee: search.assignee,
      urgent: search.urgent === 1 || undefined,
      due: search.due,
      q: search.q && search.q.trim().length >= 2 ? search.q.trim() : undefined,
      completed: search.completed === 1 || undefined,
    }),
    [clientsParam, search.assignee, search.urgent, search.due, search.q, search.completed],
  );
  const clients = clientsParam === undefined ? null : clientsParam.split(',').filter(Boolean);

  const set = (change: (next: Record<string, unknown>) => void) =>
    update(change, { replace: true });

  const setClients = (next: string[] | null) => {
    const value = next === null ? null : next.join(',');
    writeStored(value);
    set((s) => {
      if (value === null) delete s.clients;
      else s.clients = value;
    });
  };

  // The search field applies after 300 ms; a `q` changed in the URL (Back, Clear) is copied in.
  const [text, setText] = useState(search.q ?? '');
  const [seenQ, setSeenQ] = useState(search.q);
  if (search.q !== seenQ) {
    setSeenQ(search.q);
    setText(search.q ?? '');
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const changeText = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        set((s) => {
          const q = next.trim();
          if (q) s.q = q;
          else delete s.q;
        }),
      SEARCH_DEBOUNCE_MS,
    );
  };

  /** How many filters differ from the defaults (for "Filters (n)" and "Clear filters"). */
  const changed = FILTER_KEYS.filter((key) =>
    key === 'clients' ? clientsParam !== undefined : search[key] !== undefined,
  ).length;

  const clear = () => {
    writeStored(null);
    clearTimeout(timer.current);
    set((s) => {
      for (const key of FILTER_KEYS) delete s[key];
    });
  };

  /** Back to the defaults after the server refused a filter (400 `invalid_filter`). */
  const reset = () => {
    writeStored(null);
    update(
      (s) => {
        for (const key of [...FILTER_KEYS, 'column', 'after']) delete s[key];
      },
      { replace: true },
    );
  };

  return {
    search,
    filters,
    clients,
    set,
    setClients,
    text,
    changeText,
    changed,
    clear,
    reset,
  };
}
