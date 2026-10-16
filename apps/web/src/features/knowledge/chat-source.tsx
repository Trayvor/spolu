import type { KnowledgeChatSource } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { chatMessageLocation } from '@/features/chat/links';
import { SmallChatIcon } from './icons';

/** The link to a chat file's message: the group chat, the task's Chat tab or the ticket page. */
export const chatSourceLocation = (groupId: string, chat: KnowledgeChatSource) =>
  chatMessageLocation(groupId, {
    messageId: chat.messageId,
    channelId: chat.channelId,
    taskId: chat.taskId,
    ticketId: chat.ticketId,
    parentId: chat.parentId,
  });

/** Where a chat file came from: "Group chat", "Task: Budget" or "Ticket #12". */
export function ChatSourceLabel({ chat }: { chat: KnowledgeChatSource }) {
  const { t } = useTranslation();
  const label =
    chat.kind === 'task'
      ? t('knowledge.chat.task', { title: chat.taskTitle ?? '' })
      : chat.kind === 'ticket'
        ? t('knowledge.chat.ticket', { number: chat.ticketNumber ?? '' })
        : t('knowledge.chat.group');
  return (
    <span className="flex min-w-0 items-center gap-1">
      <SmallChatIcon />
      <span className="truncate">{label}</span>
    </span>
  );
}
