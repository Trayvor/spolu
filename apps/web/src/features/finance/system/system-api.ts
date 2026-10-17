import { infiniteQueryOptions } from '@tanstack/react-query';
import {
  ContractsPageSchema,
  HoursRankingPageSchema,
  PaidRankingPageSchema,
  type Currency,
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

export const contractsQuery = (view: FinanceView, order: ContractOrder, q: string) =>
  infiniteQueryOptions({
    queryKey: financeKey(view, 'contracts', order, q),
    queryFn: ({ pageParam }) =>
      apiGet(
        `/finance/contracts${query({
          ...clientsParam(view),
          ...CONTRACT_ORDERS[order],
          q: q.length >= 2 ? q : undefined,
          after: pageParam ?? undefined,
        })}`,
        ContractsPageSchema,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });

export type PaidFilter = { year: number; month: number | null; currency: Currency };

export const paidRankingQuery = (view: FinanceView, filter: PaidFilter) =>
  infiniteQueryOptions({
    queryKey: financeKey(view, 'paidRanking', filter.year, filter.month, filter.currency),
    queryFn: ({ pageParam }) =>
      apiGet(
        `/finance/rankings/paid${query({
          ...clientsParam(view),
          year: filter.year,
          month: filter.month ?? undefined,
          currency: filter.currency,
          after: pageParam ?? undefined,
        })}`,
        PaidRankingPageSchema,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });

export type HoursFilter = { range: MonthRange; admin: string | null; sort: 'hours' | 'cost' };

export const hoursRankingQuery = (view: FinanceView, filter: HoursFilter) =>
  infiniteQueryOptions({
    queryKey: financeKey(
      view,
      'hoursRanking',
      filter.range.from,
      filter.range.to,
      filter.admin,
      filter.sort,
    ),
    queryFn: ({ pageParam }) =>
      apiGet(
        `/finance/rankings/hours${query({
          ...clientsParam(view),
          from: filter.range.from,
          to: filter.range.to,
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
