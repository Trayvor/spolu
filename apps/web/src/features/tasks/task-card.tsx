import type { HTMLAttributes, Ref } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { BucketKind, TaskDto } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDue, isOverdue } from './dates';
import { DoneCircle } from './done-circle';
import { PaperclipIcon } from './icons';

const MAX_AVATARS = 3;

/**
 * One card on the board: a link to the task panel. Presentational only (no hooks besides i18n):
 * the board's drag layer passes its handle props and ref in, the card itself knows no dnd-kit.
 */
export function TaskCard({
  task,
  bucketKind,
  today,
  ref,
  handleProps,
  lifted,
  onToggleDone,
}: {
  task: TaskDto;
  bucketKind: BucketKind;
  /** Today's date in Bratislava (`YYYY-MM-DD`), passed down so a board renders one clock. */
  today: string;
  ref?: Ref<HTMLAnchorElement>;
  /** Drag listeners and `aria-describedby` (the drag instructions); the card stays a link. */
  handleProps?: HTMLAttributes<HTMLAnchorElement>;
  /** Set on the copy that follows the pointer or the arrow keys while the card is dragged. */
  lifted?: 'pointer' | 'keyboard';
  /** The done circle was pressed. */
  onToggleDone?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const shown = task.assignees.slice(0, MAX_AVATARS);
  const extra = task.assignees.length - shown.length;
  const overdue = isOverdue(task.dueDate, bucketKind, today);
  const done = bucketKind === 'done';
  const titleId = `task-title-${task.id}`;
  const hasMeta = task.assignees.length > 0 || task.dueDate !== null || task.fileCount > 0;

  // The circle is a sibling of the link (no button inside a link), laid over its left padding
  // on the title's line: 12 px padding, plus the Urgent pill (24 px) and the 8 px gap above it.
  return (
    <div className="relative">
      <Link
        to="/groups/$groupId/tasks/$taskId"
        params={{ groupId: task.groupId, taskId: task.id }}
        ref={ref}
        {...handleProps}
        // The lifted copy is only a picture of the card: out of the tab order.
        tabIndex={lifted ? -1 : undefined}
        className={cn(
          // No callout, text selection or double-tap zoom on a long press: on touch it drags.
          'flex touch-manipulation select-none flex-col items-start gap-2 rounded-lg bg-card p-3 pl-10 text-left [-webkit-touch-callout:none]',
          lifted && 'cursor-grabbing shadow-lift',
          // A card picked up with the keyboard keeps the focus ring on its lifted copy.
          lifted === 'keyboard' && 'outline-2 outline-offset-3 outline-ring',
        )}
      >
        {task.urgent && <Badge variant="destructive">{t('tasks.card.urgent')}</Badge>}
        <span
          id={lifted ? undefined : titleId}
          className={cn(
            'line-clamp-3 break-words text-button font-semibold',
            done && 'text-muted-foreground line-through',
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
      <DoneCircle
        done={done}
        onToggle={onToggleDone}
        inert={lifted !== undefined}
        describedBy={titleId}
        className={cn('absolute left-3', task.urgent ? 'top-11' : 'top-3')}
      />
    </div>
  );
}
