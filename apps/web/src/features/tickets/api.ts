import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import {
  TicketDtoSchema,
  TicketFollowerListSchema,
  TicketListResponseSchema,
  type TicketCreateBody,
  type TicketDto,
  type TicketListItem,
  type TicketListResponse,
  type TicketPatchBody,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

const enc = encodeURIComponent;

/** Which list: a group's Tickets tab, the initiator's own tickets, or the admins' global view. */
export type TicketSource =
  { kind: 'group'; groupId: string } | { kind: 'mine' } | { kind: 'global' };

/**
 * The list filters. `clients` (global view only): null = the default scope (the clients I
 * manage), `'all'` = every client, else the chosen ids; `noClient` = only tickets without a
 * client (wins over `clients`).
 */
export type TicketFilter = {
  status: 'open' | 'resolved' | 'all';
  area?: string;
  following?: boolean;
  clients?: string[] | 'all' | null;
  noClient?: boolean;
};

export const DEFAULT_FILTER: TicketFilter = { status: 'open' };

const sourceKey = (source: TicketSource) =>
  source.kind === 'group' ? ['group', source.groupId] : [source.kind];

function listPath(source: TicketSource): string {
  if (source.kind === 'group') return `/groups/${enc(source.groupId)}/tickets`;
  return source.kind === 'mine' ? '/tickets/mine' : '/tickets/global';
}

function listSearch(source: TicketSource, filter: TicketFilter, cursor?: string): string {
  const qs = new URLSearchParams();
  if (filter.status !== 'open') qs.set('status', filter.status);
  if (filter.area) qs.set('area', filter.area);
  if (filter.following) qs.set('following', 'true');
  if (source.kind === 'global') {
    if (filter.noClient) qs.set('scope', 'none');
    else if (filter.clients === 'all') qs.set('scope', 'all');
    else if (filter.clients) qs.set('clients', filter.clients.join(','));
  }
  if (cursor) qs.set('cursor', cursor);
  const text = qs.toString();
  return text ? `?${text}` : '';
}

/** Every list query starts with `['tickets', 'list']`; one invalidation refreshes them all. */
export const ticketListPrefix = ['tickets', 'list'] as const;
export const ticketListSourcePrefix = (source: TicketSource) =>
  [...ticketListPrefix, ...sourceKey(source)] as const;

/** One list, 50 per page, newest first; the page param is the server's cursor. */
export const ticketsQuery = (source: TicketSource, filter: TicketFilter) =>
  infiniteQueryOptions({
    queryKey: [...ticketListSourcePrefix(source), filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet(
        `${listPath(source)}${listSearch(source, filter, pageParam)}`,
        TicketListResponseSchema,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const ticketQuery = (id: string) =>
  queryOptions({
    queryKey: ['tickets', 'item', id],
    queryFn: () => apiGet(`/tickets/${enc(id)}`, TicketDtoSchema),
  });

export const followersQuery = (id: string) =>
  queryOptions({
    queryKey: ['tickets', 'followers', id],
    queryFn: () => apiGet(`/tickets/${enc(id)}/followers`, TicketFollowerListSchema),
  });

/** The list row of a ticket, as the server builds it, from the full ticket. */
export function toListItem(ticket: TicketDto): TicketListItem {
  return {
    id: ticket.id,
    number: ticket.number,
    groupId: ticket.groupId,
    groupName: ticket.groupName,
    status: ticket.status,
    area: ticket.area,
    subject: ticket.subject,
    dueDate: ticket.dueDate,
    createdAt: ticket.createdAt,
    following: ticket.following,
    requesterName: ticket.requester.name,
    excerpt: ticket.body === null ? null : ticket.body.slice(0, 140),
  };
}

/** Whether a row still belongs in a list with this filter (the parts the web can tell). */
export function matchesFilter(item: TicketListItem, filter: TicketFilter): boolean {
  if (filter.status === 'open' && item.status === 'resolved') return false;
  if (filter.status === 'resolved' && item.status !== 'resolved') return false;
  if (filter.following && !item.following) return false;
  if (filter.area && (item.area ?? '').toLowerCase() !== filter.area.toLowerCase()) return false;
  return true;
}

type ListData = InfiniteData<TicketListResponse>;

/**
 * Puts a changed ticket into every cached list that shows it: the row is replaced in place, or
 * dropped when it no longer matches that list's filter. Answers whether any list had it.
 */
export function patchTicketInLists(queryClient: QueryClient, ticket: TicketDto): boolean {
  const item = toListItem(ticket);
  let found = false;
  for (const [key, data] of queryClient.getQueriesData<ListData>({ queryKey: ticketListPrefix })) {
    if (!data?.pages.some((p) => p.items.some((i) => i.id === ticket.id))) continue;
    found = true;
    const filter = key[key.length - 1] as TicketFilter;
    const keep = matchesFilter(item, filter);
    queryClient.setQueryData<ListData>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: keep
          ? page.items.map((i) => (i.id === ticket.id ? item : i))
          : page.items.filter((i) => i.id !== ticket.id),
      })),
    });
  }
  return found;
}

/** Drops a ticket from the cached lists (it moved away or can no longer be read). */
export function removeTicketFromLists(
  queryClient: QueryClient,
  ticketId: string,
  prefix: readonly unknown[] = ticketListPrefix,
): void {
  for (const [key, data] of queryClient.getQueriesData<ListData>({ queryKey: prefix })) {
    if (!data?.pages.some((p) => p.items.some((i) => i.id === ticketId))) continue;
    queryClient.setQueryData<ListData>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((i) => i.id !== ticketId),
      })),
    });
  }
}

/** A saved ticket: the page's cache and every list that shows it. */
function useStoreTicket() {
  const queryClient = useQueryClient();
  return (ticket: TicketDto) => {
    queryClient.setQueryData(ticketQuery(ticket.id).queryKey, ticket);
    patchTicketInLists(queryClient, ticket);
  };
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TicketCreateBody) => apiSend('POST', '/tickets', body, TicketDtoSchema),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketQuery(ticket.id).queryKey, ticket);
      void queryClient.invalidateQueries({ queryKey: ticketListPrefix });
    },
  });
}

export function usePatchTicket(id: string) {
  const store = useStoreTicket();
  return useMutation({
    mutationFn: (patch: TicketPatchBody) =>
      apiSend('PATCH', `/tickets/${enc(id)}`, patch, TicketDtoSchema),
    onSuccess: store,
  });
}

export function useAssignGroup(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) =>
      apiSend('PUT', `/tickets/${enc(id)}/group`, { groupId }, TicketDtoSchema),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketQuery(ticket.id).queryKey, ticket);
      // The client changed: group lists gain or lose it, followers may have been dropped.
      void queryClient.invalidateQueries({ queryKey: ticketListPrefix });
      void queryClient.invalidateQueries({ queryKey: followersQuery(id).queryKey });
    },
  });
}

/** Follow (`true`) or stop following (`false`) as the signed-in user. */
export function useFollow(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (follow: boolean) =>
      apiSend(follow ? 'PUT' : 'DELETE', `/tickets/${enc(id)}/follow`),
    onSuccess: (_answer, follow) => {
      const key = ticketQuery(id).queryKey;
      const ticket = queryClient.getQueryData<TicketDto>(key);
      if (ticket) {
        const next = { ...ticket, following: follow };
        queryClient.setQueryData(key, next);
        patchTicketInLists(queryClient, next);
      }
      void queryClient.invalidateQueries({ queryKey: followersQuery(id).queryKey });
    },
  });
}
