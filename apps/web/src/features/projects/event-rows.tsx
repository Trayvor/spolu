import { createContext, useContext } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TicketStatus, TimelineTaskRow, TimelineTicketRow } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatEventDate } from './project-dot';

/** The rows of tasks and tickets under an event: on the strip, in the pile and in its sheet. */

/**
 * Set by a layer (the event sheet) that lists rows: a row's link then replaces the layer's history
 * entry and closes the layer (`useBackCloses`: links inside a layer replace).
 */
export const RowsInLayer = createContext<(() => void) | null>(null);

export const STATUS_VARIANT: Record<TicketStatus, 'default' | 'secondary' | 'outline'> = {
  new: 'default',
  in_progress: 'outline',
  resolved: 'secondary',
};

/** An open circle for an open task, a filled check for a done one (decorative). */
function DoneCircle({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-2',
        done ? 'border-foreground bg-foreground text-card' : 'border-input',
      )}
    >
      {done && (
        <svg
          viewBox="0 0 12 12"
          width="8"
          height="8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m2.5 6.2 2.2 2.2 4.8-4.8" />
        </svg>
      )}
    </span>
  );
}

/** A task: opens the task panel over the overview (`?task=<id>`). */
export function TaskRow({
  groupId,
  task,
  today,
}: {
  groupId: string;
  task: TimelineTaskRow;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const done = task.completedAt !== null;
  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const closeLayer = useContext(RowsInLayer);
  return (
    <Link
      to="/groups/$groupId/overview"
      params={{ groupId }}
      replace={closeLayer !== null}
      onClick={() => closeLayer?.()}
      search={(prev: Record<string, unknown>) => ({ ...prev, task: task.id })}
      className="flex items-start gap-2 rounded-md px-1 py-1 text-tiny hover:bg-muted focus-visible:bg-muted"
    >
      <DoneCircle done={done} />
      <span
        className={cn('min-w-0 flex-1 break-words', done && 'text-muted-foreground line-through')}
      >
        {task.urgent && !done && (
          <span className="mr-1 font-semibold text-error-ink">{t('projects.cards.urgent')}</span>
        )}
        {task.title}
      </span>
      {task.dueDate && !done && (
        <time
          dateTime={task.dueDate}
          className={cn(
            'shrink-0 tabular-nums',
            overdue ? 'text-error-ink' : 'text-muted-foreground',
          )}
        >
          {formatEventDate(task.dueDate, i18n.language)}
        </time>
      )}
      {task.assignees.length > 0 && (
        <span className="flex shrink-0 -space-x-1">
          {task.assignees.slice(0, 3).map((person) => (
            <Avatar key={person.id} userId={person.id} name={person.name} size={20} />
          ))}
          <span className="sr-only">{task.assignees.map((p) => p.name).join(', ')}</span>
        </span>
      )}
    </Link>
  );
}

/** A ticket: opens its page. */
export function TicketRow({ ticket }: { ticket: TimelineTicketRow }) {
  const { t } = useTranslation();
  const done = ticket.status === 'resolved';
  const closeLayer = useContext(RowsInLayer);
  return (
    <Link
      to="/tickets/$ticketId"
      params={{ ticketId: ticket.id }}
      replace={closeLayer !== null}
      className="flex items-start gap-2 rounded-md px-1 py-1 text-tiny hover:bg-muted focus-visible:bg-muted"
    >
      <span className="shrink-0 font-semibold tabular-nums">#{ticket.number}</span>
      <span
        className={cn('min-w-0 flex-1 break-words', done && 'text-muted-foreground line-through')}
      >
        {ticket.subject ?? t('projects.cards.noSubject')}
      </span>
      {!done && (
        <Badge variant={STATUS_VARIANT[ticket.status]} className="shrink-0">
          {t(`projects.cards.status.${ticket.status}`)}
        </Badge>
      )}
    </Link>
  );
}
