import { SAVED_VIEW_PATHS, type SavedViewPage } from '@spolu/shared';

/**
 * A view's URL from the page's current search: the page's path and only its filter `keys`
 * (an open task, item or cursor is no part of a view), in a fixed order so two URLs of the same
 * filters compare equal. Null when no filter is set.
 */
export function viewUrl(
  page: SavedViewPage,
  searchStr: string,
  keys: readonly string[],
): string | null {
  const params = new URLSearchParams(searchStr);
  const kept = new URLSearchParams();
  for (const key of [...keys].sort()) {
    const value = params.get(key);
    if (value !== null && value !== '') kept.set(key, value);
  }
  const query = kept.toString();
  return query === '' ? null : `${SAVED_VIEW_PATHS[page]}?${query}`;
}

/** `url` with its params in the same fixed order as `viewUrl` (for comparing a saved one). */
export function normalizeViewUrl(url: string, keys: readonly string[]): string {
  const at = url.indexOf('?');
  if (at < 0) return url;
  const path = url.slice(0, at);
  const page = (Object.keys(SAVED_VIEW_PATHS) as SavedViewPage[]).find(
    (p) => SAVED_VIEW_PATHS[p] === path,
  );
  return page ? (viewUrl(page, url.slice(at), keys) ?? url) : url;
}

/** The starter views (review F5): built in, not removable, shown before the person's own. */
export const STARTER_VIEWS: Readonly<
  Partial<Record<SavedViewPage, readonly { key: string; url: string }[]>>
> = {
  board: [
    { key: 'myOverdue', url: '/tasks?due=overdue&mine=1' },
    { key: 'thisWeek', url: '/tasks?due=week' },
  ],
  tickets: [{ key: 'unassigned', url: '/tickets?assignee=none' }],
};
