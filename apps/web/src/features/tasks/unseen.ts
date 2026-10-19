import { useEffect } from 'react';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import {
  BoardEvents,
  BoardUnseenSchema,
  ChatEvents,
  NotificationEvents,
  SeenEvents,
  type BoardTaskEvent,
  type ChatMessageEvent,
  type NotificationReadEvent,
  type UnseenMark,
} from '@spolu/shared';
import { apiGet } from '@/lib/api';
import { getSocket } from '@/lib/socket';

/** After a change: its notification events are recorded by the time the board asks again. */
export const BOARD_UNSEEN_DEBOUNCE_MS = 2000;

/**
 * The group's cards with a change the viewer has not seen yet (2026-10-17), as a map from id to
 * how each is marked (2026-10-18: `message` when the changes include a chat message).
 */
export const boardUnseenQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['tasks', groupId, 'unseen'],
    queryFn: () => apiGet(`/groups/${encodeURIComponent(groupId)}/board/unseen`, BoardUnseenSchema),
    select: (data): ReadonlyMap<string, UnseenMark> => {
      const messages = new Set(data.messageTaskIds);
      return new Map(data.taskIds.map((id) => [id, messages.has(id) ? 'message' : 'change']));
    },
    refetchOnWindowFocus: true,
  });

/**
 * Keeps the board's unseen marks current: a task of the group changed, a message arrived in one
 * of its task chats, the viewer opened a task or ticket (here or on another device), or read
 * notification centre items (`notifications:read`, 2026-10-19: an unread item marks its task too)
 * asks the server again, coalesced over 2 s. A task's own read (`subject`) of another group is
 * ignored.
 */
export function useBoardUnseenEvents(groupId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    const { queryKey } = boardUnseenQuery(groupId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => void queryClient.invalidateQueries({ queryKey, exact: true }),
        BOARD_UNSEEN_DEBOUNCE_MS,
      );
    };
    const onTask = (event: BoardTaskEvent) => {
      if (event.task.groupId === groupId) schedule();
    };
    const onMessage = (event: ChatMessageEvent) => {
      if (event.groupId === groupId && event.taskId !== null && event.isNew) schedule();
    };
    socket.on(BoardEvents.task, onTask);
    socket.on(ChatEvents.message, onMessage);
    const onRead = (event: NotificationReadEvent) => {
      // Not a task (a ticket, a chat...): no card of the board changes. The task may be of
      // another group, which only the server knows: ask.
      if (!event.subject || event.subject.kind === 'task') schedule();
    };
    socket.on(SeenEvents.changed, schedule);
    socket.on(NotificationEvents.read, onRead);
    return () => {
      clearTimeout(timer);
      socket.off(BoardEvents.task, onTask);
      socket.off(ChatEvents.message, onMessage);
      socket.off(SeenEvents.changed, schedule);
      socket.off(NotificationEvents.read, onRead);
    };
  }, [groupId, queryClient]);
}
