import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { MessageDto, MessageTaskLink } from '@spolu/shared';
import { cn } from '@/lib/utils';

/**
 * The footer under a message that was turned into tasks: "Turned into tasks:" and a link per
 * task (the task panel route). A completed task is struck through and muted, with a screen-reader
 * "Completed". Nothing for a message without tasks.
 */
export function MessageTasks({ groupId, tasks }: { groupId: string; tasks: MessageTaskLink[] }) {
  const { t } = useTranslation();
  if (tasks.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-micro text-muted-foreground">
      <span>{t('chat.turnedIntoTasks')}</span>
      {tasks.map((task) => (
        <Link
          key={task.id}
          to="/groups/$groupId/tasks/$taskId"
          params={{ groupId, taskId: task.id }}
          className="max-w-full truncate font-semibold underline underline-offset-4 hover:text-neutral"
        >
          <span className={cn(task.completed && 'line-through text-muted-foreground')}>
            {task.title}
          </span>
          {task.completed && <span className="sr-only"> {t('tasks.card.completed')}</span>}
        </Link>
      ))}
    </p>
  );
}

/** `renderMessageFooter` for a group's chat. Memoise it per `groupId` so the prop stays stable. */
export function renderMessageTasks(groupId: string): (message: MessageDto) => ReactNode {
  return (message) => <MessageTasks groupId={groupId} tasks={message.tasks} />;
}
