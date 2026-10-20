/**
 * `/finance`'s page filters in the URL (owner request 2026-10-18, so saved views cover them).
 * Spelled out without imports: the router (the entry chunk) imports this file.
 *
 * - `clients`: a comma list of client ids (the admin group's id when "eGrant tím" is ticked);
 *   absent for every client.
 * - `internal=0`: every client without the admin group (only without `clients`).
 * - `period`: the page period, absent for this year (the default); `custom` with `from` and `to`
 *   (`YYYY-MM`, both optional: the current month).
 * - `item`: the open organisation item (not a filter, never in a view).
 * - `salary`: the open salary (2026-10-21; not a filter, never in a view).
 */
export type FinanceSearch = {
  clients?: string;
  internal?: 0;
  period?: FinancePagePeriod;
  from?: string;
  to?: string;
  item?: string;
  salary?: string;
};

/** `PAGE_PERIODS` without the default (`thisYear`), which the URL leaves out. */
const URL_PERIODS = ['lastYear', 'thisMonth', 'lastMonth', 'next12', 'allTime', 'custom'] as const;
export type FinancePagePeriod = (typeof URL_PERIODS)[number];

/** The filter params: remembered for the next visit, kept by a saved view. */
export const FINANCE_FILTER_KEYS = ['clients', 'internal', 'period', 'from', 'to'] as const;

const text = (v: unknown) =>
  typeof v === 'number' ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : undefined;
const month = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? v : undefined);

/** Every key is set (an invalid one to undefined), so a raw value never slips through. */
export function validateFinanceSearch(search: Record<string, unknown>): FinanceSearch {
  const clients = text(search.clients)?.slice(0, 2000);
  const period = URL_PERIODS.includes(search.period as FinancePagePeriod)
    ? (search.period as FinancePagePeriod)
    : undefined;
  const custom = period === 'custom';
  return {
    clients,
    internal:
      clients === undefined && (search.internal === 0 || search.internal === '0') ? 0 : undefined,
    period,
    from: custom ? month(search.from) : undefined,
    to: custom ? month(search.to) : undefined,
    item: text(search.item)?.slice(0, 100),
    salary: text(search.salary)?.slice(0, 100),
  };
}
