import { useEffect, useRef } from 'react';
import {
  BoardEvents,
  ChatEvents,
  TicketEvents,
  type BoardTaskEvent,
  type ChatMessageEvent,
  type ChatThreadReplyEvent,
  type TicketEventPayload,
} from '@spolu/shared';
import { useDocumentVisible } from '@/features/chat/use-document-visible';
import { apiSend } from '@/lib/api';
import { getSocket } from '@/lib/socket';

/** After a change of the open task or ticket: its notification events are recorded by then. */
export const MARK_SEEN_DELAY_MS = 1500;

export type SeenTarget = {
  kind: 'task' | 'ticket';
  id: string;
  /** A ticket's chat: its messages are changes of the ticket too. */
  channelId?: string | null;
};

/**
 * Marks the open task (its panel, either tab) or ticket (its page) seen (2026-10-17): on open and
 * whenever the page becomes visible again, and, while it stays open and visible, shortly after
 * every change of it that arrives live, so what the viewer is looking at never counts as unseen.
 * The server tells the viewer's other devices (`seen:changed`). A failed request is ignored: the
 * next open marks it.
 */
export function useMarkSeen(target: SeenTarget | null): void {
  const visible = useDocumentVisible();
  const visibleRef = useRef(visible);
  const kind = target?.kind;
  const id = target?.id;
  const channelId = target?.channelId ?? null;

  useEffect(() => {
    visibleRef.current = visible;
    if (!kind || !id || !visible) return;
    void markSeen(kind, id);
  }, [kind, id, visible]);

  useEffect(() => {
    if (!kind || !id) return;
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Hidden now: the visibility effect marks it once the page shows again.
        if (visibleRef.current) void markSeen(kind, id);
      }, MARK_SEEN_DELAY_MS);
    };
    const ours = (taskId: string | null, eventChannelId?: string) =>
      kind === 'task' ? taskId === id : channelId !== null && eventChannelId === channelId;
    const onTask = (event: BoardTaskEvent) => {
      if (kind === 'task' && event.task.id === id) later();
    };
    const onMessage = (event: ChatMessageEvent) => {
      if (event.isNew && ours(event.taskId, event.channelId)) later();
    };
    const onReply = (event: ChatThreadReplyEvent) => {
      if (ours(event.taskId, event.channelId)) later();
    };
    const onTicket = (event: TicketEventPayload) => {
      if (kind === 'ticket' && event.ticketId === id) later();
    };
    socket.on(BoardEvents.task, onTask);
    socket.on(ChatEvents.message, onMessage);
    socket.on(ChatEvents.threadReply, onReply);
    socket.on(TicketEvents.updated, onTicket);
    return () => {
      clearTimeout(timer);
      socket.off(BoardEvents.task, onTask);
      socket.off(ChatEvents.message, onMessage);
      socket.off(ChatEvents.threadReply, onReply);
      socket.off(TicketEvents.updated, onTicket);
    };
  }, [kind, id, channelId]);
}

async function markSeen(kind: SeenTarget['kind'], id: string): Promise<void> {
  try {
    await apiSend(
      'POST',
      `/${kind === 'task' ? 'tasks' : 'tickets'}/${encodeURIComponent(id)}/seen`,
    );
  } catch {
    // The next open marks it.
  }
}
