import { useEffect, useRef } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  KnowledgeEvents,
  type KnowledgeItemDeletedEvent,
  type KnowledgeItemDto,
  type KnowledgeItemEvent,
  type KnowledgePage,
} from '@spolu/shared';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { getSocket } from '@/lib/socket';
import { groupKnowledgeQuery, knowledgeItemQuery, type KnowledgeFilter } from './api';
import { removeSummary, upsertSummary } from './knowledge-cache';

type Data = InfiniteData<KnowledgePage>;

/**
 * Applies the knowledge events of the open group to the tab's cached list, like
 * `useBoardEvents`. Without a search an item of the filtered type is upserted (a known item that
 * changed to another type leaves the list) and other types are dropped; with a search the list
 * refetches, since only the server knows what matches. A deleted item is removed, and
 * `onOpenGone` fires when it is the one open. A viewer who cannot see admins-only items
 * (`canSeeAdmins` false, a client) removes such an item instead of showing it; the server never
 * sends one to the group room, this is defence in depth. After every later (re)join the first page is
 * refetched, since events sent while the socket was out of the room are lost.
 */
export function useKnowledgeEvents(
  groupId: string,
  filter: KnowledgeFilter,
  openId: string | undefined,
  onOpenGone: () => void,
  canSeeAdmins: boolean,
): void {
  const queryClient = useQueryClient();
  const joins = useGroupRoomJoins();
  const seenJoins = useRef(joins);
  const { type, q } = filter;
  // The latest values, read by the listeners without resubscribing.
  const latest = useRef({ openId, onOpenGone });
  useEffect(() => {
    latest.current = { openId, onOpenGone };
  });

  useEffect(() => {
    const socket = getSocket();
    const key = groupKnowledgeQuery(groupId, { type, q }).queryKey;
    const update = (apply: (data: Data) => Data) =>
      queryClient.setQueryData<Data>(key, (data) => data && apply(data));

    const onItem = ({ item }: KnowledgeItemEvent) => {
      if (item.groupId !== groupId) return;
      // A cached detail (the open dialog or one closed a moment ago) is now out of date.
      const detailKey = knowledgeItemQuery(item.id).queryKey;
      const detail = queryClient.getQueryData<KnowledgeItemDto>(detailKey);
      if (detail && detail.updatedAt !== item.updatedAt)
        void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
      if (!canSeeAdmins && item.visibility === 'admins') {
        update((data) => removeSummary(data, item.id));
        return;
      }
      if (q) {
        void queryClient.invalidateQueries({ queryKey: key, exact: true });
        return;
      }
      if (type && item.type !== type) update((data) => removeSummary(data, item.id));
      else update((data) => upsertSummary(data, item));
    };
    const onDeleted = (event: KnowledgeItemDeletedEvent) => {
      if (event.groupId !== groupId) return;
      update((data) => removeSummary(data, event.id));
      if (latest.current.openId === event.id) latest.current.onOpenGone();
    };

    socket.on(KnowledgeEvents.item, onItem);
    socket.on(KnowledgeEvents.itemDeleted, onDeleted);
    return () => {
      socket.off(KnowledgeEvents.item, onItem);
      socket.off(KnowledgeEvents.itemDeleted, onDeleted);
    };
  }, [groupId, type, q, canSeeAdmins, queryClient]);

  useEffect(() => {
    if (seenJoins.current === joins) return;
    seenJoins.current = joins;
    const key = groupKnowledgeQuery(groupId, { type, q }).queryKey;
    // Only the first page refetches: later pages are dropped, "Load more" fetches them again.
    queryClient.setQueryData<Data>(
      key,
      (data) => data && { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
    );
    void queryClient.invalidateQueries({ queryKey: key, exact: true });
  }, [joins, groupId, type, q, queryClient]);
}
