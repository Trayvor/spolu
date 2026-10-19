import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ticketChatQuery } from '@/features/chat/api';
import { ChatLoadError } from '@/features/chat/chat-load-error';
import { Conversation, type ComposerDraft } from '@/features/chat/conversation';
import { GroupRoomProvider, useGroupRoom } from '@/features/groups/use-group-room';
import { TicketDraft } from '@/features/ticket-draft';
import { useMessageTaskTools } from '@/features/task-split/use-message-task-tools';
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
 * own connection instead. Admins and clients also get "Turn into tasks" on its messages and the
 * "Turned into tasks:" links under them (the cards link the ticket too, part 21.5); a requester
 * gets neither. Threads open over the list: the column is narrower than a page.
 */
export function TicketChat({
  ticketId,
  groupId,
  readsGroup,
  requesterName = null,
  draftLabel = null,
}: {
  ticketId: string;
  groupId: string;
  readsGroup: boolean;
  /** The initiator: an admin's canned reply fills `{{name}}` with it (F7). */
  requesterName?: string | null;
  /** The ticket's number and client: "Navrhnúť odpoveď" (admins) needs them for its title. */
  draftLabel?: { number: number; client: string } | null;
}) {
  const { data, isError, refetch } = useQuery(ticketChatQuery(ticketId));
  const groupJoins = useGroupRoom(readsGroup ? groupId : null);
  const connects = useConnects(!readsGroup);
  const tools = useMessageTaskTools(groupId);
  const channelId = data?.id;
  const scope = useMemo(
    () => ({
      peopleChannelId: channelId,
      uploadPath: `/tickets/${encodeURIComponent(ticketId)}/files`,
      // Phase 28: a requester reads attached knowledge items only through their messages.
      knowledgeViaMessage: !readsGroup,
      ...(requesterName ? { replyName: requesterName } : {}),
    }),
    [channelId, ticketId, readsGroup, requesterName],
  );

  if (data) {
    return (
      <GroupRoomProvider joins={readsGroup ? groupJoins : connects}>
        <Conversation
          channelId={data.id}
          groupId={groupId}
          threadMode="over"
          scope={scope}
          {...(readsGroup
            ? {
                messageActions: tools.messageActions,
                renderMessageFooter: tools.renderMessageFooter,
              }
            : {})}
          {...(draftLabel
            ? {
                composerActions: (draft: ComposerDraft) => (
                  <TicketDraft ticketId={ticketId} {...draftLabel} draft={draft} />
                ),
              }
            : {})}
        />
        {readsGroup && tools.element}
      </GroupRoomProvider>
    );
  }
  if (isError) return <ChatLoadError onRetry={() => void refetch()} />;
  return <div className="h-full rounded-xl bg-card" aria-busy="true" />;
}
