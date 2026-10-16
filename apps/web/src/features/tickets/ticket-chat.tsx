import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ticketChatQuery } from '@/features/chat/api';
import { ChatLoadError } from '@/features/chat/chat-load-error';
import { Conversation } from '@/features/chat/conversation';
import { GroupRoomProvider, useGroupRoom } from '@/features/groups/use-group-room';
import { getSocket } from '@/lib/socket';

/**
 * Counts the socket's connections (1 when it is already connected). A requester's sockets get
 * their ticket chat's messages through their own user room, which the server joins before the
 * connection opens, so every `connect` is a (re)join for them: the chat catches up on it.
 */
function useConnects(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const onConnect = () => setCount((n) => n + 1);
    if (socket.connected) onConnect();
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [enabled]);
  return enabled ? count : 0;
}

/**
 * The ticket's chat (Phase 21): the shared `<Conversation>` for the ticket's channel, its people
 * from the channel (the initiator included; a requester cannot read the group's people) and its
 * uploads through the ticket (`POST /api/tickets/:id/files`). Admins and the group's clients
 * follow the group room, as on the group's pages; a requester (`readsGroup` false) follows their
 * own connection instead. Threads open over the list: the column is narrower than a page.
 */
export function TicketChat({
  ticketId,
  groupId,
  readsGroup,
}: {
  ticketId: string;
  groupId: string;
  readsGroup: boolean;
}) {
  const { data, isError, refetch } = useQuery(ticketChatQuery(ticketId));
  const groupJoins = useGroupRoom(readsGroup ? groupId : null);
  const connects = useConnects(!readsGroup);
  const channelId = data?.id;
  const scope = useMemo(
    () => ({
      peopleChannelId: channelId,
      uploadPath: `/tickets/${encodeURIComponent(ticketId)}/files`,
    }),
    [channelId, ticketId],
  );

  if (data) {
    return (
      <GroupRoomProvider joins={readsGroup ? groupJoins : connects}>
        <Conversation channelId={data.id} groupId={groupId} threadMode="over" scope={scope} />
      </GroupRoomProvider>
    );
  }
  if (isError) return <ChatLoadError onRetry={() => void refetch()} />;
  return <div className="h-full rounded-xl bg-card" aria-busy="true" />;
}
