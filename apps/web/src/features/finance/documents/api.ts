import { infiniteQueryOptions, queryOptions, type QueryKey } from '@tanstack/react-query';
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
  type FinanceOrgItemBody,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';
import { financeKey } from '../api';

/**
 * The Documents card's API (Phase 32 part B). Every key starts with `['finance', groupId, …]`
 * (`financeKey`), so a `finance:changed` of the client refetches them all. Since part E the card
 * also shows the organisation's own items on `/finance` (owner `org`): its keys start with
 * `['finance', 'all', 'org', …]`, so the page's events refetch them.
 */

const enc = encodeURIComponent;

/** Whose documents a card shows: one client's, or the organisation's (Phase 32 E). */
export type FinanceOwner = { kind: 'group'; groupId: string } | { kind: 'org' };

export const ORG_OWNER: FinanceOwner = { kind: 'org' };

/** The owner's key prefix: the client's view, or the organisation's under `'all'`. */
function ownerKey(owner: FinanceOwner, kind: string, ...rest: unknown[]): QueryKey {
  return owner.kind === 'group'
    ? financeKey({ kind: 'group', groupId: owner.groupId }, kind, ...rest)
    : ['finance', 'all', 'org', kind, ...rest];
}

/** The prefix a write refreshes: the owner's every query (and, for the organisation, `/finance`). */
export const ownerViewKey = (owner: FinanceOwner): QueryKey =>
  owner.kind === 'group' ? ['finance', owner.groupId] : ['finance', 'all'];

/** The owner's path under `/api`: `/groups/<id>/finance` or `/finance/org`. */
const base = (owner: FinanceOwner) =>
  owner.kind === 'group' ? `/groups/${enc(owner.groupId)}/finance` : '/finance/org';

/** The card's list: a folder (null: the top level), or flat with a type or a search. */
export type ItemsFilter = { folder: string | null; type?: FinanceItemType; q?: string };

export const financeItemsQuery = (owner: FinanceOwner, filter: ItemsFilter) =>
  infiniteQueryOptions({
    queryKey: ownerKey(owner, 'items', filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filter.folder) params.set('folder', filter.folder);
      if (filter.type) params.set('type', filter.type);
      if (filter.q) params.set('q', filter.q);
      if (pageParam) params.set('after', pageParam);
      const query = params.size > 0 ? `?${params}` : '';
      return apiGet(`${base(owner)}/items${query}`, FinanceItemPageSchema);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const financeFoldersQuery = (owner: FinanceOwner) =>
  queryOptions({
    queryKey: ownerKey(owner, 'folders'),
    queryFn: () => apiGet(`${base(owner)}/folders`, FinanceFolderListSchema),
  });

/**
 * One item. In a client's tab (`group`) the server answers as that client sees it: a contract
 * of several clients with that client's share only (Phase 32 E, decision E10).
 */
export const financeItemQuery = (owner: FinanceOwner, id: string) =>
  queryOptions({
    queryKey: ownerKey(owner, 'item', id),
    queryFn: () =>
      apiGet(
        owner.kind === 'group'
          ? `/finance/items/${enc(id)}?group=${enc(owner.groupId)}`
          : `/finance/items/${enc(id)}`,
        FinanceItemDetailSchema,
      ),
  });

/** The finance admins a reminder may notify. */
export const financePeopleQuery = queryOptions({
  queryKey: ['finance', 'people'],
  queryFn: () => apiGet('/finance/recipients', FinancePeopleSchema),
  staleTime: 5 * 60_000,
});

/** The admins a salary may pay (salaries, 2026-10-21). */
export const financePayeesQuery = queryOptions({
  queryKey: ['finance', 'payees'],
  queryFn: () => apiGet('/finance/payees', FinancePeopleSchema),
  staleTime: 5 * 60_000,
});

/** Where a finance file is uploaded (finance-only from its first answer). */
export const financeUploadPath = (owner: FinanceOwner) => `${base(owner)}/files`;

export function createFinanceItem(
  groupId: string,
  body: FinanceItemBody,
): Promise<FinanceItemDetail> {
  return apiSend('POST', `/groups/${enc(groupId)}/finance/items`, body, FinanceItemDetailSchema);
}

/** An item of the organisation (Phase 32 E): an expense, a shared contract, a document, a note. */
export function createOrgItem(body: FinanceOrgItemBody): Promise<FinanceItemDetail> {
  return apiSend('POST', '/finance/org/items', body, FinanceItemDetailSchema);
}

export function updateFinanceItem(id: string, patch: FinanceItemPatch): Promise<FinanceItemDetail> {
  return apiSend('PATCH', `/finance/items/${enc(id)}`, patch, FinanceItemDetailSchema);
}

export async function deleteFinanceItem(id: string): Promise<void> {
  await apiSend('DELETE', `/finance/items/${enc(id)}`);
}

export function createFinanceFolder(
  owner: FinanceOwner,
  body: { name: string; parentId: string | null },
): Promise<FinanceFolder> {
  return apiSend('POST', `${base(owner)}/folders`, body, FinanceFolderSchema);
}

export function updateFinanceFolder(id: string, patch: FinanceFolderPatch): Promise<FinanceFolder> {
  return apiSend('PATCH', `/finance/folders/${enc(id)}`, patch, FinanceFolderSchema);
}

export async function deleteFinanceFolder(id: string): Promise<void> {
  await apiSend('DELETE', `/finance/folders/${enc(id)}`);
}
