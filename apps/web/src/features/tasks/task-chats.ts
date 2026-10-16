import { useEffect } from 'react';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import {
  BoardEvents,
  ChatEvents,
  TaskChatSummariesSchema,
  type BoardTaskDeletedEvent,
  type ChatMessageEvent,
  type ChatReadEvent,
  type ChatThreadReplyEvent,
  type TaskChatSummaries,
} from '@spolu/shared';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { apiGet } from '@/lib/api';
import { getSocket } from '@/lib/socket';

// Imported eagerly by the group layout (through the Tasks tab badge): keep it to `@/lib/api`,
// `@/lib/socket`, shared types and the group-room hook.

/** Every task chat of the group with its message count and the reader's unread flag. */
export const taskChatsQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['tasks', groupId, 'chats'],
    queryFn: () =>
      apiGet(`/groups/${encodeURIComponent(groupId)}/task-chats`, TaskChatSummariesSchema),
  });

/**
 * Keeps the cached summaries current from chat events of this group's task chats (events with
 * a `taskId`; the group channel's own are the Chat tab's business). Mount once per group.
 * A new message counts, and marks the task unread when someone else wrote it at top level; a
 * reply in one of the reader's threads marks it unread; a deleted message or a read asks the
 * server again, as does every rejoin of the group room after the first.
 */
export function useTaskChatEvents(groupId: string, meId: string | undefined): void {
  const queryClient = useQueryClient();
  const joins = useGroupRoomJoins();

  useEffect(() => {
    const socket = getSocket();
    const { queryKey } = taskChatsQuery(groupId);
    const update = (
      taskId: string,
      apply: (old: TaskChatSummaries[string]) => TaskChatSummaries[string],
    ) => {
      // Not cached yet (the first fetch is in flight): its answer may predate the event, so drop
      // it and ask again. (invalidateQueries alone would join the request already in flight.)
      if (!queryClient.getQueryData(queryKey)) {
        void queryClient
          .cancelQueries({ queryKey, exact: true })
          .then(() => queryClient.invalidateQueries({ queryKey, exact: true }));
        return;
      }
      queryClient.setQueryData<TaskChatSummaries>(
        queryKey,
        (all) => all && { ...all, [taskId]: apply(all[taskId] ?? { count: 0, unread: false }) },
      );
    };
    const refetch = () => void queryClient.invalidateQueries({ queryKey, exact: true });

    const onMessage = (event: ChatMessageEvent) => {
      if (event.groupId !== groupId || event.taskId === null) return;
      const { message } = event;
      if (!event.isNew) {
        if (message.deletedAt) refetch();
        return;
      }
      const theirs = message.parentId === null && message.author.id !== meId;
      update(event.taskId, (s) => ({ count: s.count + 1, unread: s.unread || theirs }));
    };
    const onThreadReply = (event: ChatThreadReplyEvent) => {
      if (event.groupId !== groupId || event.taskId === null) return;
      update(event.taskId, (s) => ({ ...s, unread: true }));
    };
    const onRead = (event: ChatReadEvent) => {
      if (event.groupId === groupId && event.taskId !== null) refetch();
    };
    const onTaskDeleted = (event: BoardTaskDeletedEvent) => {
      if (event.groupId !== groupId) return;
      queryClient.setQueryData<TaskChatSummaries>(queryKey, (all) => {
        if (!all || !(event.taskId in all)) return all;
        return Object.fromEntries(Object.entries(all).filter(([id]) => id !== event.taskId));
      });
    };
    socket.on(BoardEvents.taskDeleted, onTaskDeleted);
    socket.on(ChatEvents.message, onMessage);
    socket.on(ChatEvents.threadReply, onThreadReply);
    socket.on(ChatEvents.read, onRead);
    return () => {
      socket.off(BoardEvents.taskDeleted, onTaskDeleted);
      socket.off(ChatEvents.message, onMessage);
      socket.off(ChatEvents.threadReply, onThreadReply);
      socket.off(ChatEvents.read, onRead);
    };
  }, [groupId, meId, queryClient]);

  // After a reconnect (not the first join: the summaries were just loaded) events may be missed.
  useEffect(() => {
    if (joins > 1)
      void queryClient.invalidateQueries({
        queryKey: taskChatsQuery(groupId).queryKey,
        exact: true,
      });
  }, [joins, groupId, queryClient]);
}
