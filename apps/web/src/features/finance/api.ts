import type { QueryKey } from '@tanstack/react-query';

/**
 * Finance (Phase 32) on the web. Every finance query key starts with
 * `['finance', groupId | 'all', kind, …]`, so `useFinanceEvents` refreshes one client's tab (or
 * the system-wide page, `'all'`) with one invalidation. Parts B, C and D add their queries in
 * their own files with keys from `financeKey`.
 */

/** Which clients a finance card shows: one client's tab, or `/finance` with its client filter. */
export type FinanceView =
  { kind: 'group'; groupId: string } | { kind: 'all'; clients: readonly string[] };

/** The key segment of a view: the client's id, or `'all'` for the system-wide page. */
export function viewKey(view: FinanceView): string {
  return view.kind === 'group' ? view.groupId : 'all';
}

/** `['finance', groupId | 'all', kind, ...rest]`. */
export function financeKey(view: FinanceView, kind: string, ...rest: unknown[]): QueryKey {
  return ['finance', viewKey(view), kind, ...rest];
}

/** The prefix of every query of a view (what a `finance:changed` invalidates). */
export function financeViewKey(view: FinanceView | null): QueryKey {
  return view === null ? ['finance'] : ['finance', viewKey(view)];
}
