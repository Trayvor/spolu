import { useCallback, useEffect, useMemo } from 'react';
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
 * (another device read it) and every rejoin of the group room ask the server again.
 * `markRead` reads a thread: the dot goes at once and the unread counts are asked for again.
 */
export function useUnreadThreads(channelId: string, groupId: string) {
  const queryClient = useQueryClient();
  const joins = useGroupRoomJoins();
  const { data } = useQuery(unreadThreadsQuery(channelId));
  const unread = useMemo(() => (data ? new Set(data) : NONE), [data]);

  useEffect(() => {
    const { queryKey } = unreadThreadsQuery(channelId);
    const socket = getSocket();
    const onReply = (event: ChatThreadReplyEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.setQueryData(queryKey, (old) =>
        old?.includes(event.rootId) ? old : [...(old ?? []), event.rootId],
      );
      // The answer being fetched may predate this reply: ask again.
      if (queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') {
        void queryClient.invalidateQueries({ queryKey });
      }
    };
    const onRead = (event: ChatReadEvent) => {
      if (event.channelId !== channelId || event.rootId === undefined) return;
      void queryClient.invalidateQueries({ queryKey });
    };
    socket.on(ChatEvents.threadReply, onReply);
    socket.on(ChatEvents.read, onRead);
    return () => {
      socket.off(ChatEvents.threadReply, onReply);
      socket.off(ChatEvents.read, onRead);
    };
  }, [channelId, queryClient]);

  // After a reconnect (not the first join: the set was just loaded) replies may have been missed.
  useEffect(() => {
    if (joins > 1)
      void queryClient.invalidateQueries({ queryKey: unreadThreadsQuery(channelId).queryKey });
  }, [joins, channelId, queryClient]);

  const markRead = useCallback(
    async (rootId: string) => {
      await postThreadRead(rootId);
      queryClient.setQueryData(unreadThreadsQuery(channelId).queryKey, (old) =>
        old?.filter((id) => id !== rootId),
      );
      void queryClient.invalidateQueries({ queryKey: groupChatQuery(groupId).queryKey });
      void queryClient.invalidateQueries({ queryKey: chatUnreadQuery.queryKey });
    },
    [channelId, groupId, queryClient],
  );

  return { unread, markRead };
}
