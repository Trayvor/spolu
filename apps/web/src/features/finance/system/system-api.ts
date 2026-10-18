import { infiniteQueryOptions } from '@tanstack/react-query';
import {
  ContractsPageSchema,
  HoursRankingPageSchema,
  PaidRankingPageSchema,
  type Currency,
  type LedgerType,
} from '@spolu/shared';
import { apiGet } from '@/lib/api';
import { clientsParam, financeKey, type FinanceView } from '../api';
import type { MonthRange } from '../period';

/**
 * Part D's queries of the system-wide page: the contracts table and the two rankings, each paged
 * by its cursor. Keys come from `financeKey`, so a `finance:changed` refetches them and another
 * client filter is another cache entry.
 */

function query(entries: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** The table's sorts: newest start, soonest end, largest amount. */
export const CONTRACT_ORDERS = {
  start: { sort: 'start', dir: 'desc' },
  end: { sort: 'end', dir: 'asc' },
  amount: { sort: 'amount', dir: 'desc' },
} as const;
export type ContractOrder = keyof typeof CONTRACT_ORDERS;

/**
 * `range` (the page period) keeps the contracts running in it and the expenses dated in it; a
 * search ignores it. `type` (Phase 32 E): which kinds, contracts by default.
 */
export const contractsQuery = (
  view: FinanceView,
  order: ContractOrder,
  q: string,
  range: MonthRange | null,
  type: LedgerType = 'contract',
) =>
  infiniteQueryOptions({
    queryKey: financeKey(view, 'contracts', type, order, q, range?.from ?? null, range?.to ?? null),
    queryFn: ({ pageParam }) =>
      apiGet(
        `/finance/contracts${query({
          ...clientsParam(view),
          type: type === 'contract' ? undefined : type,
          ...CONTRACT_ORDERS[order],
          q: q.length >= 2 ? q : undefined,
          from: range?.from,
          to: range?.to,
          after: pageParam ?? undefined,
        })}`,
        ContractsPageSchema,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });

/** `range` null: all time. */
export type PaidFilter = { range: MonthRange | null; currency: Currency };

export const paidRankingQuery = (view: FinanceView, filter: PaidFilter) =>
  infiniteQueryOptions({
    queryKey: financeKey(
      view,
      'paidRanking',
      filter.range?.from ?? null,
      filter.range?.to ?? null,
      filter.currency,
    ),
    queryFn: ({ pageParam }) =>
      apiGet(
        `/finance/rankings/paid${query({
          ...clientsParam(view),
          from: filter.range?.from,
          to: filter.range?.to,
          currency: filter.currency,
          after: pageParam ?? undefined,
        })}`,
        PaidRankingPageSchema,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });

/** `range` null: all time. */
export type HoursFilter = {
  range: MonthRange | null;
  admin: string | null;
  sort: 'hours' | 'cost';
};

export const hoursRankingQuery = (view: FinanceView, filter: HoursFilter) =>
  infiniteQueryOptions({
    queryKey: financeKey(
      view,
      'hoursRanking',
      filter.range?.from ?? null,
      filter.range?.to ?? null,
      filter.admin,
      filter.sort,
    ),
    queryFn: ({ pageParam }) =>
      apiGet(
        `/finance/rankings/hours${query({
          ...clientsParam(view),
          from: filter.range?.from,
          to: filter.range?.to,
          admin: filter.admin ?? undefined,
          sort: filter.sort,
          after: pageParam ?? undefined,
        })}`,
        HoursRankingPageSchema,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });

/** A client's logo URL (the groups route), or null without one. */
export function logoUrl(row: { groupId: string | null; hasLogo: boolean; groupUpdatedAt: string }) {
  return row.groupId && row.hasLogo
    ? `/api/groups/${encodeURIComponent(row.groupId)}/logo?v=${encodeURIComponent(row.groupUpdatedAt)}`
    : null;
}
