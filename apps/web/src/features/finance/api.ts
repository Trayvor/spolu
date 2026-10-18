import type { QueryKey } from '@tanstack/react-query';

/**
 * Finance (Phase 32) on the web. Every finance query key starts with
 * `['finance', groupId | 'all', kind, …]`, so `useFinanceEvents` refreshes one client's tab (or
 * the system-wide page, `'all'`) with one invalidation. Parts B, C and D add their queries in
 * their own files with keys from `financeKey`.
 */

/**
 * Which clients a finance card shows: one client's tab, or `/finance` with its client filter.
 * `internal` (Phase 34 part E): the admin group "eGrant tím (internal)" is chosen too; without
 * it `/finance` leaves the admin group out.
 */
export type FinanceView =
  | { kind: 'group'; groupId: string }
  | { kind: 'all'; clients: readonly string[]; internal?: boolean };

/** The key segment of a view: the client's id, or `'all'` for the system-wide page. */
export function viewKey(view: FinanceView): string {
  return view.kind === 'group' ? view.groupId : 'all';
}

/**
 * `['finance', groupId | 'all', kind, ...rest]`; the system-wide view adds its client filter at
 * the end, so another choice of clients is another cache entry.
 */
export function financeKey(view: FinanceView, kind: string, ...rest: unknown[]): QueryKey {
  const clients =
    view.kind === 'all' ? [view.clients.join(','), ...(view.internal ? ['internal'] : [])] : [];
  return ['finance', viewKey(view), kind, ...rest, ...clients];
}

/** The `clients=` (and `internal=1`) query of the system-wide view (empty: every client). */
export function clientsParam(view: FinanceView): Record<string, string> {
  if (view.kind !== 'all') return {};
  return {
    ...(view.clients.length > 0 ? { clients: view.clients.join(',') } : {}),
    ...(view.internal ? { internal: '1' } : {}),
  };
}

/** The prefix of every query of a view (what a `finance:changed` invalidates). */
export function financeViewKey(view: FinanceView | null): QueryKey {
  return view === null ? ['finance'] : ['finance', viewKey(view)];
}
