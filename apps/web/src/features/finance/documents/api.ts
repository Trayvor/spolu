import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  FinanceFolderListSchema,
  FinanceFolderSchema,
  FinanceItemDetailSchema,
  FinanceItemPageSchema,
  FinancePeopleSchema,
  type FinanceFolder,
  type FinanceFolderPatch,
  type FinanceItemBody,
  type FinanceItemDetail,
  type FinanceItemPatch,
  type FinanceItemType,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';
import { financeKey } from '../api';

/**
 * The Documents card's API (Phase 32 part B). Every key starts with `['finance', groupId, …]`
 * (`financeKey`), so a `finance:changed` of the client refetches them all.
 */

const enc = encodeURIComponent;
const view = (groupId: string) => ({ kind: 'group', groupId }) as const;

/** The card's list: a folder (null: the top level), or flat with a type or a search. */
export type ItemsFilter = { folder: string | null; type?: FinanceItemType; q?: string };

export const financeItemsQuery = (groupId: string, filter: ItemsFilter) =>
  infiniteQueryOptions({
    queryKey: financeKey(view(groupId), 'items', filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filter.folder) params.set('folder', filter.folder);
      if (filter.type) params.set('type', filter.type);
      if (filter.q) params.set('q', filter.q);
      if (pageParam) params.set('after', pageParam);
      const query = params.size > 0 ? `?${params}` : '';
      return apiGet(`/groups/${enc(groupId)}/finance/items${query}`, FinanceItemPageSchema);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const financeFoldersQuery = (groupId: string) =>
  queryOptions({
    queryKey: financeKey(view(groupId), 'folders'),
    queryFn: () => apiGet(`/groups/${enc(groupId)}/finance/folders`, FinanceFolderListSchema),
  });

export const financeItemQuery = (groupId: string, id: string) =>
  queryOptions({
    queryKey: financeKey(view(groupId), 'item', id),
    queryFn: () => apiGet(`/finance/items/${enc(id)}`, FinanceItemDetailSchema),
  });

/** The finance admins a reminder may notify. */
export const financePeopleQuery = queryOptions({
  queryKey: ['finance', 'people'],
  queryFn: () => apiGet('/finance/recipients', FinancePeopleSchema),
  staleTime: 5 * 60_000,
});

/** Where a finance file is uploaded (finance-only from its first answer). */
export const financeUploadPath = (groupId: string) => `/groups/${enc(groupId)}/finance/files`;

export function createFinanceItem(
  groupId: string,
  body: FinanceItemBody,
): Promise<FinanceItemDetail> {
  return apiSend('POST', `/groups/${enc(groupId)}/finance/items`, body, FinanceItemDetailSchema);
}

export function updateFinanceItem(id: string, patch: FinanceItemPatch): Promise<FinanceItemDetail> {
  return apiSend('PATCH', `/finance/items/${enc(id)}`, patch, FinanceItemDetailSchema);
}

export async function deleteFinanceItem(id: string): Promise<void> {
  await apiSend('DELETE', `/finance/items/${enc(id)}`);
}

export function createFinanceFolder(
  groupId: string,
  body: { name: string; parentId: string | null },
): Promise<FinanceFolder> {
  return apiSend('POST', `/groups/${enc(groupId)}/finance/folders`, body, FinanceFolderSchema);
}

export function updateFinanceFolder(id: string, patch: FinanceFolderPatch): Promise<FinanceFolder> {
  return apiSend('PATCH', `/finance/folders/${enc(id)}`, patch, FinanceFolderSchema);
}

export async function deleteFinanceFolder(id: string): Promise<void> {
  await apiSend('DELETE', `/finance/folders/${enc(id)}`);
}
