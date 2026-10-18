import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FinanceOverviewDtoSchema,
  RateSchema,
  RatesDtoSchema,
  WorkLogPageDtoSchema,
  type AddRateBody,
  type ManualEntryBody,
  type SystemManualEntryBody,
  type TimeEntryPatch,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';
import { clientsParam, financeKey, financeViewKey, type FinanceView } from './api';
import type { MonthRange } from './period';

/**
 * Part C's queries (overview, work log, rates) and writes (manual entries, corrections, rates).
 * Keys come from `financeKey`, so a `finance:changed` refetches them (`useFinanceEvents`). The
 * system-wide view (`all`) goes to `/api/finance/*` with its `clients=` filter (part D's routes).
 */

function base(view: FinanceView): string {
  return view.kind === 'group' ? `/groups/${view.groupId}/finance` : '/finance';
}

function params(view: FinanceView, entries: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(clientsParam(view))) search.set(key, value);
  for (const [key, value] of Object.entries(entries)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** `range` null: all time (the server answers the months its data spans). */
export const overviewQuery = (view: FinanceView, range: MonthRange | null) =>
  queryOptions({
    queryKey: financeKey(view, 'overview', range?.from ?? null, range?.to ?? null),
    queryFn: () =>
      apiGet(
        `${base(view)}/overview${params(view, { from: range?.from, to: range?.to })}`,
        FinanceOverviewDtoSchema,
      ),
  });

/** One page of the work log; `before` the older page's cursor. */
export const workLogKey = (view: FinanceView, range: MonthRange | null) =>
  financeKey(view, 'workLog', range?.from ?? null, range?.to ?? null);

export const fetchWorkLogPage = (
  view: FinanceView,
  range: MonthRange | null,
  before: string | null,
) =>
  apiGet(
    `${base(view)}/work-log${params(view, {
      from: range?.from,
      to: range?.to,
      before: before ?? undefined,
    })}`,
    WorkLogPageDtoSchema,
  );

/** Rates are one list for every client: a key of no client of its own under the view. */
export const ratesQuery = (view: FinanceView) =>
  queryOptions({
    queryKey: financeKey(view, 'rates'),
    queryFn: () => apiGet('/finance/rates', RatesDtoSchema),
  });

/** After a write, the view's finance queries refetch (the socket event follows for the others). */
function useRefetchView(view: FinanceView) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: financeViewKey(view) });
}

export function useAddManualEntry(view: FinanceView, groupId: string) {
  const refetch = useRefetchView(view);
  return useMutation({
    mutationFn: (body: ManualEntryBody) =>
      apiSend('POST', `/groups/${groupId}/finance/time-entries`, body),
    onSuccess: refetch,
  });
}

/** "Add time" on `/finance`: the chosen client, or none (`groupId` null, "Without client"). */
export function useAddSystemEntry(view: FinanceView) {
  const refetch = useRefetchView(view);
  return useMutation({
    mutationFn: (body: SystemManualEntryBody) => apiSend('POST', '/finance/time-entries', body),
    onSuccess: refetch,
  });
}

export function useUpdateEntry(view: FinanceView) {
  const refetch = useRefetchView(view);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TimeEntryPatch }) =>
      apiSend('PATCH', `/finance/time-entries/${id}`, patch),
    onSuccess: refetch,
  });
}

export function useDeleteEntry(view: FinanceView) {
  const refetch = useRefetchView(view);
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/finance/time-entries/${id}`),
    onSuccess: refetch,
  });
}

export function useAddRate(view: FinanceView) {
  const refetch = useRefetchView(view);
  return useMutation({
    mutationFn: (body: AddRateBody) => apiSend('POST', '/finance/rates', body, RateSchema),
    onSuccess: refetch,
  });
}

export function useDeleteRate(view: FinanceView) {
  const refetch = useRefetchView(view);
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/finance/rates/${id}`),
    onSuccess: refetch,
  });
}
