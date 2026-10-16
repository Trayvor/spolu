import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BoardEvents, type BoardTaskDeletedEvent, type BoardTaskEvent } from '@spolu/shared';
import { AssignedPill } from '@/components/assigned-pill';
import { useSession } from '@/features/auth/use-session';
import { UnreadPill } from '@/features/chat/unread';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { getSocket } from '@/lib/socket';
import { mineCountQuery } from './mine-count';
import { taskChatsQuery, useTaskChatEvents } from './task-chats';

// Imported eagerly by the group layout: keep it tiny.

const MINE_DEBOUNCE_MS = 500;

/**
 * Keeps "assigned to me" current: any task change in the group (`board:task`,
 * `board:task_deleted`) refetches the count once, 500 ms after the last one; so does every
 * rejoin of the group room after the first.
 */
function useMineCountRefetch(groupId: string): void {
  const queryClient = useQueryClient();
  const joins = useGroupRoomJoins();

  useEffect(() => {
    const socket = getSocket();
    const { queryKey } = mineCountQuery(groupId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (eventGroupId: string) => {
      if (eventGroupId !== groupId) return;
      clearTimeout(timer);
      timer = setTimeout(
        () => void queryClient.invalidateQueries({ queryKey, exact: true }),
        MINE_DEBOUNCE_MS,
      );
    };
    const onTask = (e: BoardTaskEvent) => schedule(e.task.groupId);
    const onDeleted = (e: BoardTaskDeletedEvent) => schedule(e.groupId);
    socket.on(BoardEvents.task, onTask);
    socket.on(BoardEvents.taskDeleted, onDeleted);
    return () => {
      clearTimeout(timer);
      socket.off(BoardEvents.task, onTask);
      socket.off(BoardEvents.taskDeleted, onDeleted);
    };
  }, [groupId, queryClient]);

  useEffect(() => {
    if (joins > 1) {
      void queryClient.invalidateQueries({ queryKey: mineCountQuery(groupId).queryKey });
    }
  }, [joins, groupId, queryClient]);
}

/**
 * The Tasks tab's pills, live: black = tasks of the group with an unread chat, yellow = my open
 * tasks there (not in Completed).
 */
export function TasksTabBadge({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const meId = useSession()?.id;
  useTaskChatEvents(groupId, meId);
  useMineCountRefetch(groupId);
  const { data } = useQuery(taskChatsQuery(groupId));
  const unread = data ? Object.values(data).filter((chat) => chat.unread).length : 0;
  const mine = useQuery(mineCountQuery(groupId)).data?.open ?? 0;
  return (
    <>
      <UnreadPill count={unread} label={t('tasks.unreadTasks', { count: unread })} />
      <AssignedPill count={mine} label={t('tasks.assignedToYou', { count: mine })} />
    </>
  );
}
