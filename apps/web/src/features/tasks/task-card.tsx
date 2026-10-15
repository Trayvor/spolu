import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { BucketKind, TaskDto } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDue, isOverdue } from './dates';
import { PaperclipIcon } from './icons';

const MAX_AVATARS = 3;

/**
 * One card on the board: a link to the task panel. Presentational only (no hooks besides i18n),
 * so the drag layer can wrap it without changing it.
 */
export function TaskCard({
  task,
  bucketKind,
  today,
}: {
  task: TaskDto;
  bucketKind: BucketKind;
  /** Today's date in Bratislava (`YYYY-MM-DD`), passed down so a board renders one clock. */
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const shown = task.assignees.slice(0, MAX_AVATARS);
  const extra = task.assignees.length - shown.length;
  const overdue = isOverdue(task.dueDate, bucketKind, today);
  const hasMeta = task.assignees.length > 0 || task.dueDate !== null || task.fileCount > 0;

  return (
    <Link
      // The task panel route is registered by the panel task; the cast goes away with it.
      to={'/groups/$groupId/tasks/$taskId' as never}
      params={{ groupId: task.groupId, taskId: task.id } as never}
      className="flex flex-col items-start gap-2 rounded-lg bg-card p-3 text-left"
    >
      {task.urgent && <Badge variant="destructive">{t('tasks.card.urgent')}</Badge>}
      <span
        className={cn(
          'line-clamp-3 break-words text-button font-semibold',
          bucketKind === 'done' && 'text-muted-foreground',
        )}
      >
        {task.title}
      </span>
      {hasMeta && (
        <span className="flex w-full items-center gap-3 text-micro text-muted-foreground">
          {shown.length > 0 && (
            <span className="flex items-center">
              {shown.map((person) => (
                <Avatar
                  key={person.id}
                  userId={person.id}
                  name={person.name}
                  size={24}
                  className="-ml-1.5 border-2 border-card first:ml-0"
                />
              ))}
              {extra > 0 && (
                <span className="ml-1 font-semibold">
                  {t('tasks.card.moreAssignees', { count: extra })}
                </span>
              )}
              <span className="sr-only">{task.assignees.map((p) => p.name).join(', ')}</span>
            </span>
          )}
          {task.dueDate && (
            <time
              dateTime={task.dueDate}
              className={cn(overdue && 'font-semibold text-error-ink')}
              title={t('tasks.card.due', { date: formatDue(task.dueDate, i18n.language) })}
            >
              {formatDue(task.dueDate, i18n.language)}
              {overdue && <span className="sr-only"> ({t('tasks.card.overdue')})</span>}
            </time>
          )}
          {task.fileCount > 0 && (
            <span className="ml-auto flex items-center gap-1">
              <PaperclipIcon />
              <span aria-hidden="true">{task.fileCount}</span>
              <span className="sr-only">{t('tasks.card.files', { count: task.fileCount })}</span>
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
