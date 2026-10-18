import { useEffect } from 'react';
import { useQueryClient, type InfiniteData, type Query } from '@tanstack/react-query';
import {
  SeenEvents,
  TicketEvents,
  type SeenChangedEvent,
  type TicketDto,
  type TicketEventPayload,
  type TicketListResponse,
} from '@spolu/shared';
import { useSession } from '@/features/auth/use-session';
import { channelPeopleQuery } from '@/features/chat/chat-scope';
import { ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { firstJoinCheck } from '@/lib/socket-history';
import {
  markTicketSeenInLists,
  patchTicketInLists,
  removeTicketFromLists,
  ticketListPrefix,
  ticketListSourcePrefix,
  ticketQuery,
  type TicketSource,
} from './api';

/** After a change: its notification events are recorded by the time the list asks again. */
export const TICKET_UNSEEN_DEBOUNCE_MS = 2000;
/** A burst of events (a bulk change, a busy global list) refetches the lists once, 2 s after the last. */
export const TICKET_LIST_DEBOUNCE_MS = 2000;

/**
 * Keeps the ticket lists and an open ticket live (Phase 21). Events carry only
 * `{ ticketId, groupId }`, so:
 * - `ticket:updated`: the ticket is fetched once and its row replaced in every cached list that
 *   shows it (or dropped when it no longer matches the list's filter), without refetching the
 *   pages; a ticket no list shows refreshes the lists of this source (it may match now);
 * - `ticket:created`: the lists of this source refetch (a new row's place is the server's call);
 * - `ticket:moved` (it left `groupId`): the row leaves that group's lists; other lists refetch.
 * My tickets cares only about the viewer's own tickets: a client also gets every event of their
 * groups, so there the lists refetch only for a ticket the viewer reported, and a move touches
 * only an open or listed ticket.
 * A ticket that answers 404 (moved out of reach) leaves every list and an open ticket page shows
 * not found. A ticket whose client changed refreshes its chat's people. After a reconnect the
 * lists refetch, since events sent while the socket was down are lost; the first `connect` after
 * the mount refetches only the lists `firstJoinCheck` says may have missed events, not the ones
 * the mount just loaded. `source` null listens for the open ticket only. Opening a ticket (here or
 * on another device, `seen:changed`, 2026-10-17) clears its rows' unseen mark; a patched row keeps
 * its mark, and a ticket that changed while nobody has its page open makes the lists that show it
 * refetch once, 2 s after the last such change (the server decides who is notified).
 * Cost (2026-10-18): list refetches caused by events wait 2 s after the last event and go out
 * once; a ticket that is neither open nor listed is not fetched (outside My tickets its lists
 * just refetch); events for one ticket while its GET is out cause one more GET after it, not
 * one each.
 */
export function useTicketEvents(source: TicketSource | null): void {
  const queryClient = useQueryClient();
  const meId = useSession()?.id ?? null;
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
    const mine = parsed?.kind === 'mine';
    const concerns = (payload: TicketEventPayload) =>
      parsed !== null && (parsed.kind !== 'group' || payload.groupId === parsed.groupId);
    const refetchLists = (predicate?: (query: Query) => boolean) => {
      if (prefix) void queryClient.invalidateQueries({ queryKey: prefix, predicate });
    };
    let listTimer: ReturnType<typeof setTimeout> | undefined;
    const refetchListsSoon = () => {
      if (!prefix) return;
      clearTimeout(listTimer);
      listTimer = setTimeout(() => refetchLists(), TICKET_LIST_DEBOUNCE_MS);
    };
    const isOpen = (ticketId: string) =>
      queryClient.getQueryData(ticketQuery(ticketId).queryKey) !== undefined;
    const isListed = (ticketId: string) =>
      queryClient
        .getQueriesData<InfiniteData<TicketListResponse>>({ queryKey: ticketListPrefix })
        .some(([, data]) => data?.pages.some((p) => p.items.some((i) => i.id === ticketId)));
    const ownedByMe = (ticket: TicketDto) => ticket.requester.userId === meId;

    /** The ticket now, put into the caches; null when it is out of reach (404) or failed. */
    async function load(ticketId: string): Promise<TicketDto | null> {
      const before = queryClient.getQueryData<TicketDto>(ticketQuery(ticketId).queryKey);
      try {
        const ticket = await queryClient.fetchQuery({ ...ticketQuery(ticketId), staleTime: 0 });
        // Another client now: the chat's mention list is that client's people.
        if (before && before.groupId !== ticket.groupId && ticket.channelId) {
          void queryClient.invalidateQueries({
            queryKey: channelPeopleQuery(ticket.channelId).queryKey,
          });
        }
        return ticket;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          removeTicketFromLists(queryClient, ticketId);
          // The open ticket page refetches, gets the 404 and shows not found.
          void queryClient.invalidateQueries({ queryKey: ticketQuery(ticketId).queryKey });
        }
        return null;
      }
    }

    const unseenPending = new Set<string>();
    let unseenTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleUnseen = (ticketId: string) => {
      unseenPending.add(ticketId);
      clearTimeout(unseenTimer);
      unseenTimer = setTimeout(() => {
        const ids = [...unseenPending];
        unseenPending.clear();
        void queryClient.invalidateQueries({
          queryKey: ticketListPrefix,
          predicate: (query) =>
            (query.state.data as InfiniteData<TicketListResponse> | undefined)?.pages.some((p) =>
              p.items.some((i) => ids.includes(i.id)),
            ) ?? false,
        });
      }, TICKET_UNSEEN_DEBOUNCE_MS);
    };
    /** Whether a ticket page is mounted for it: the viewer sees the change as it happens. */
    const isViewed = (ticketId: string) =>
      (queryClient
        .getQueryCache()
        .find({ queryKey: ticketQuery(ticketId).queryKey })
        ?.getObserversCount() ?? 0) > 0;

    async function refresh(ticketId: string) {
      const viewed = isViewed(ticketId);
      const ticket = await load(ticketId);
      if (
        ticket &&
        !patchTicketInLists(queryClient, ticket, meId) &&
        (!mine || ownedByMe(ticket))
      ) {
        refetchListsSoon();
      } else if (ticket && !viewed) {
        scheduleUnseen(ticketId);
      }
    }

    // One GET per ticket at a time: an event while it is out asks for one more after it.
    let disposed = false;
    const inFlight = new Map<string, boolean>();
    const refreshOnce = (ticketId: string) => {
      if (inFlight.has(ticketId)) {
        inFlight.set(ticketId, true);
        return;
      }
      inFlight.set(ticketId, false);
      void refresh(ticketId).finally(() => {
        const again = inFlight.get(ticketId);
        inFlight.delete(ticketId);
        if (again && !disposed) refreshOnce(ticketId);
      });
    };

    const onCreated = (payload: TicketEventPayload) => {
      if (!concerns(payload)) return;
      if (!mine) {
        refetchListsSoon();
        return;
      }
      void load(payload.ticketId).then((ticket) => {
        if (ticket && ownedByMe(ticket)) refetchListsSoon();
      });
    };
    const onUpdated = (payload: TicketEventPayload) => {
      const id = payload.ticketId;
      if (isOpen(id) || isListed(id) || (mine && concerns(payload))) refreshOnce(id);
      // Not shown anywhere: no GET of the ticket, the lists may now include it.
      else if (concerns(payload)) refetchListsSoon();
    };
    const onMoved = (payload: TicketEventPayload) => {
      if (parsed?.kind === 'group' && payload.groupId === parsed.groupId) {
        removeTicketFromLists(queryClient, payload.ticketId, prefix ?? ticketListPrefix);
        if (isOpen(payload.ticketId)) void load(payload.ticketId);
      } else if (isOpen(payload.ticketId) || (mine && isListed(payload.ticketId))) {
        refreshOnce(payload.ticketId);
      } else if (parsed !== null && !mine) {
        refetchListsSoon();
      }
    };
    const onSeen = (event: SeenChangedEvent) => {
      if (event.kind === 'ticket') markTicketSeenInLists(queryClient, event.id);
    };
    let firstConnect: ReturnType<typeof firstJoinCheck> | null = firstJoinCheck(socket);
    const onConnect = () => {
      const stale = firstConnect;
      firstConnect = null;
      refetchLists(stale ? (query) => stale(query.state) : undefined);
    };

    socket.on(TicketEvents.created, onCreated);
    socket.on(TicketEvents.updated, onUpdated);
    socket.on(TicketEvents.moved, onMoved);
    socket.on(SeenEvents.changed, onSeen);
    socket.on('connect', onConnect);
    return () => {
      disposed = true;
      clearTimeout(unseenTimer);
      clearTimeout(listTimer);
      socket.off(TicketEvents.created, onCreated);
      socket.off(TicketEvents.updated, onUpdated);
      socket.off(TicketEvents.moved, onMoved);
      socket.off(SeenEvents.changed, onSeen);
      socket.off('connect', onConnect);
    };
  }, [sourceId, queryClient, meId]);
}
