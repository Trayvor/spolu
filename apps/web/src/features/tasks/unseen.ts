import { useEffect } from 'react';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import {
  BoardEvents,
  BoardUnseenSchema,
  ChatEvents,
  SeenEvents,
  type BoardTaskEvent,
  type ChatMessageEvent,
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
 * of its task chats, or the viewer opened a task or ticket (here or on another device) asks the
 * server again, coalesced over 2 s.
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
    socket.on(SeenEvents.changed, schedule);
    return () => {
      clearTimeout(timer);
      socket.off(BoardEvents.task, onTask);
      socket.off(ChatEvents.message, onMessage);
      socket.off(SeenEvents.changed, schedule);
    };
  }, [groupId, queryClient]);
}
