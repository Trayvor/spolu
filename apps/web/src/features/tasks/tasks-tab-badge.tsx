import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/use-session';
import { UnreadPill } from '@/features/chat/unread';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { useTaskChatEvents } from './task-chats';
import { boardUnseenQuery, useBoardUnseenEvents } from './unseen';

// Imported eagerly by the group layout: keep it tiny.

/**
 * The Tasks tab's one black badge, live: the group's tasks with a change I have not seen
 * (2026-10-17 owner rule: bubbles show what notified me, never the plain total of my tasks).
 * The same per-viewer ids mark the cards on the board; its events keep both current.
 * Also keeps the task chat summaries current for the cards (`useTaskChatEvents`).
 */
export function TasksTabBadge({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const meId = useSession()?.id;
  const joins = useGroupRoomJoins();
  useTaskChatEvents(groupId, meId);
  useBoardUnseenEvents(groupId);

  // After a reconnect (not the first join) events may have been missed.
  useEffect(() => {
    if (joins > 1) {
      void queryClient.invalidateQueries({ queryKey: boardUnseenQuery(groupId).queryKey });
    }
  }, [joins, groupId, queryClient]);

  const count = useQuery(boardUnseenQuery(groupId)).data?.size ?? 0;
  return <UnreadPill count={count} label={t('tasks.unseenTasks', { count })} />;
}
