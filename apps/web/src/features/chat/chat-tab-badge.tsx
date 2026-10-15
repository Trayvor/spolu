import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatEvents, type ChatMessageEvent, type ChatReadEvent } from '@spolu/shared';
import { useSession } from '@/features/auth/use-session';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { getSocket } from '@/lib/socket';
import { groupChatQuery } from './api';
import { UnreadPill } from './unread';

// Imported eagerly by the group layout: keep it to `api.ts`, `unread.tsx` and tiny hooks.

/**
 * The Chat tab's unread count. A new top-level message by someone else in this group's channel
 * adds one to the cached count; `chat:read` (this or another device read the chat) and every
 * rejoin of the group room (messages may have been missed) ask the server again.
 */
export function ChatTabBadge({ groupId }: { groupId: string }) {
  const queryClient = useQueryClient();
  const meId = useSession()?.id;
  const joins = useGroupRoomJoins();
  const { data } = useQuery(groupChatQuery(groupId));
  const channelId = data?.id;

  useEffect(() => {
    if (channelId === undefined) return;
    const { queryKey } = groupChatQuery(groupId);
    const socket = getSocket();
    const onMessage = (event: ChatMessageEvent) => {
      // A socket can briefly sit in two group rooms while navigating.
      if (event.groupId !== groupId || event.channelId !== channelId) return;
      const { message } = event;
      if (!event.isNew || message.parentId !== null || message.author.id === meId) return;
      queryClient.setQueryData(queryKey, (old) => old && { ...old, unread: old.unread + 1 });
    };
    const onRead = (event: ChatReadEvent) => {
      if (event.groupId !== groupId || event.channelId !== channelId) return;
      void queryClient.invalidateQueries({ queryKey });
    };
    socket.on(ChatEvents.message, onMessage);
    socket.on(ChatEvents.read, onRead);
    return () => {
      socket.off(ChatEvents.message, onMessage);
      socket.off(ChatEvents.read, onRead);
    };
  }, [groupId, channelId, meId, queryClient]);

  // After a reconnect (not the first join: the count was just loaded) the count may be stale.
  useEffect(() => {
    if (joins > 1)
      void queryClient.invalidateQueries({ queryKey: groupChatQuery(groupId).queryKey });
  }, [joins, groupId, queryClient]);

  return <UnreadPill count={data?.unread ?? 0} />;
}
