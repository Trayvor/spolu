import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TicketEvents, type TicketEventPayload } from '@spolu/shared';
import { ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import {
  patchTicketInLists,
  removeTicketFromLists,
  ticketListPrefix,
  ticketListSourcePrefix,
  ticketQuery,
  type TicketSource,
} from './api';

/**
 * Keeps the ticket lists and an open ticket live (Phase 21). Events carry only
 * `{ ticketId, groupId }`, so:
 * - `ticket:updated`: the ticket is fetched once and its row replaced in every cached list that
 *   shows it (or dropped when it no longer matches the list's filter), without refetching the
 *   pages; a ticket no list shows refreshes the lists of this source (it may match now);
 * - `ticket:created`: the lists of this source refetch (a new row's place is the server's call);
 * - `ticket:moved` (it left `groupId`): the row leaves that group's lists; other lists refetch.
 * A ticket that answers 404 (moved out of reach) leaves every list. After a reconnect the lists
 * refetch, since events sent while the socket was down are lost. `source` null listens for the
 * open ticket only.
 */
export function useTicketEvents(source: TicketSource | null): void {
  const queryClient = useQueryClient();
  const sourceId =
    source === null ? null : source.kind === 'group' ? `group:${source.groupId}` : source.kind;

  useEffect(() => {
    const socket = getSocket();
    const parsed: TicketSource | null =
      sourceId === null
        ? null
        : sourceId.startsWith('group:')
          ? { kind: 'group', groupId: sourceId.slice(6) }
          : { kind: sourceId as 'mine' | 'global' };
    const prefix = parsed ? ticketListSourcePrefix(parsed) : null;
    const concerns = (payload: TicketEventPayload) =>
      parsed?.kind !== 'group' || payload.groupId === parsed.groupId;
    const refetchLists = () => {
      if (prefix) void queryClient.invalidateQueries({ queryKey: prefix });
    };

    async function refresh(ticketId: string) {
      try {
        const ticket = await queryClient.fetchQuery({ ...ticketQuery(ticketId), staleTime: 0 });
        if (!patchTicketInLists(queryClient, ticket)) refetchLists();
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          removeTicketFromLists(queryClient, ticketId);
          queryClient.removeQueries({ queryKey: ticketQuery(ticketId).queryKey, exact: true });
        }
      }
    }

    const onCreated = (payload: TicketEventPayload) => {
      if (concerns(payload)) refetchLists();
    };
    const onUpdated = (payload: TicketEventPayload) => {
      const open = queryClient.getQueryData(ticketQuery(payload.ticketId).queryKey) !== undefined;
      if (open || concerns(payload)) void refresh(payload.ticketId);
    };
    const onMoved = (payload: TicketEventPayload) => {
      if (parsed?.kind === 'group' && payload.groupId === parsed.groupId) {
        removeTicketFromLists(queryClient, payload.ticketId, prefix ?? ticketListPrefix);
      } else {
        refetchLists();
      }
      void queryClient.invalidateQueries({ queryKey: ticketQuery(payload.ticketId).queryKey });
    };
    const onConnect = () => refetchLists();

    socket.on(TicketEvents.created, onCreated);
    socket.on(TicketEvents.updated, onUpdated);
    socket.on(TicketEvents.moved, onMoved);
    socket.on('connect', onConnect);
    return () => {
      socket.off(TicketEvents.created, onCreated);
      socket.off(TicketEvents.updated, onUpdated);
      socket.off(TicketEvents.moved, onMoved);
      socket.off('connect', onConnect);
    };
  }, [sourceId, queryClient]);
}
