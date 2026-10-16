import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/use-session';
import { UnreadPill } from '@/features/chat/unread';
import { taskChatsQuery, useTaskChatEvents } from './task-chats';

// Imported eagerly by the group layout: keep it tiny.

/** The Tasks tab's pill: how many tasks of the group have an unread chat, live. */
export function TasksTabBadge({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const meId = useSession()?.id;
  useTaskChatEvents(groupId, meId);
  const { data } = useQuery(taskChatsQuery(groupId));
  const unread = data ? Object.values(data).filter((chat) => chat.unread).length : 0;
  return <UnreadPill count={unread} label={t('tasks.unreadTasks', { count: unread })} />;
}
