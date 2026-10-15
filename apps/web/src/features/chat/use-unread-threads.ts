import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatEvents, type ChatReadEvent, type ChatThreadReplyEvent } from '@spolu/shared';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { getSocket } from '@/lib/socket';
import {
  chatUnreadQuery,
  groupChatQuery,
  markThreadRead as postThreadRead,
  unreadThreadsQuery,
} from './api';

const NONE: ReadonlySet<string> = new Set();

/**
 * The channel's threads with replies the reader has not read (their roots), for the dot on
 * "N replies". `chat:thread-reply` adds a thread; `chat:read` for one of the channel's threads
 * (another device read it) and every rejoin of the group room ask the server again; `chat:read`
 * with `all` (the whole chat was read) clears every dot at once, then asks again.
 *
 * `readingId` is the thread the reader has in front of them (open and the page visible). It is
 * marked read when it is in the set, and again for every reply announced in it, also while an
 * earlier request is on its way (that request's mark may predate the new reply, and the set alone
 * would not change). After each mark the dot goes at once, and the set and the unread counts are
 * asked for again, so the badge drops.
 */
export function useUnreadThreads(channelId: string, groupId: string, readingId?: string) {
  const queryClient = useQueryClient();
  const joins = useGroupRoomJoins();
  const { data } = useQuery(unreadThreadsQuery(channelId));
  const unread = useMemo(() => (data ? new Set(data) : NONE), [data]);

  const markRead = useCallback(
    async (rootId: string) => {
      await postThreadRead(rootId);
      const { queryKey } = unreadThreadsQuery(channelId);
      queryClient.setQueryData(queryKey, (old) => old?.filter((id) => id !== rootId));
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: groupChatQuery(groupId).queryKey });
      void queryClient.invalidateQueries({ queryKey: chatUnreadQuery.queryKey });
    },
    [channelId, groupId, queryClient],
  );
  /** A failure is left alone: the dot stays and reopening the thread tries again. */
  const read = useCallback(
    (rootId: string) => void markRead(rootId).catch(() => undefined),
    [markRead],
  );

  const readingRef = useRef(readingId);
  useEffect(() => {
    readingRef.current = readingId;
  });

  const readingUnread = readingId !== undefined && unread.has(readingId);
  useEffect(() => {
    if (readingUnread && readingId !== undefined) read(readingId);
  }, [readingUnread, readingId, read]);

  useEffect(() => {
    const { queryKey } = unreadThreadsQuery(channelId);
    const socket = getSocket();
    const onReply = (event: ChatThreadReplyEvent) => {
      if (event.channelId !== channelId) return;
      if (event.rootId === readingRef.current) {
        read(event.rootId);
        return;
      }
      queryClient.setQueryData(queryKey, (old) =>
        old?.includes(event.rootId) ? old : [...(old ?? []), event.rootId],
      );
      // The answer being fetched may predate this reply: ask again.
      if (queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') {
        void queryClient.invalidateQueries({ queryKey });
      }
    };
    const onRead = (event: ChatReadEvent) => {
      if (event.channelId !== channelId) return;
      // The whole chat was read (a task's Chat tab opened): every dot goes at once.
      if (event.all) queryClient.setQueryData(queryKey, []);
      else if (event.rootId === undefined) return;
      void queryClient.invalidateQueries({ queryKey });
    };
    socket.on(ChatEvents.threadReply, onReply);
    socket.on(ChatEvents.read, onRead);
    return () => {
      socket.off(ChatEvents.threadReply, onReply);
      socket.off(ChatEvents.read, onRead);
    };
  }, [channelId, queryClient, read]);

  // After a reconnect (not the first join: the set was just loaded) replies may have been missed.
  useEffect(() => {
    if (joins > 1)
      void queryClient.invalidateQueries({ queryKey: unreadThreadsQuery(channelId).queryKey });
  }, [joins, channelId, queryClient]);

  return { unread };
}
