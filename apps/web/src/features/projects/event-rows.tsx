import { createContext, useContext } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TicketStatus, TimelineTaskRow, TimelineTicketRow } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatEventDate, formatShortDate } from './project-dot';

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

/** A small red dot before an urgent task's title; screen readers hear "Urgent". */
function UrgentDot() {
  const { t } = useTranslation();
  return (
    <>
      <span
        aria-hidden="true"
        className="mr-1.5 inline-block size-2 rounded-full bg-error-ink align-[0.05em]"
      />
      <span className="sr-only">{`${t('projects.cards.urgent')}: `}</span>
    </>
  );
}

/**
 * A task: opens the task panel over the overview (`?task=<id>`). `compact` (the timeline strip's
 * narrow column): at most three lines, the title (clipped) over a line with the short deadline
 * and the avatars, no circle, a red dot for urgent.
 */
export function TaskRow({
  groupId,
  task,
  today,
  compact = false,
}: {
  groupId: string;
  task: TimelineTaskRow;
  today: string;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const done = task.completedAt !== null;
  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const closeLayer = useContext(RowsInLayer);
  if (compact) {
    const due = done ? null : task.dueDate;
    const meta = due !== null || task.assignees.length > 0;
    return (
      <Link
        to="/groups/$groupId/overview"
        params={{ groupId }}
        replace={closeLayer !== null}
        onClick={() => closeLayer?.()}
        search={(prev: Record<string, unknown>) => ({ ...prev, task: task.id })}
        title={task.title}
        className="flex flex-col gap-0.5 rounded-md px-1 py-1 text-tiny hover:bg-muted focus-visible:bg-muted"
      >
        <span
          className={cn(
            'break-words',
            meta ? 'line-clamp-2' : 'line-clamp-3',
            done && 'text-muted-foreground line-through',
          )}
        >
          {task.urgent && !done && <UrgentDot />}
          {task.title}
        </span>
        {meta && (
          <span className="flex items-center gap-2">
            {due && (
              <time
                dateTime={due}
                className={cn(
                  'tabular-nums whitespace-nowrap',
                  overdue ? 'text-error-ink' : 'text-muted-foreground',
                )}
              >
                {formatShortDate(due, i18n.language, today)}
              </time>
            )}
            {task.assignees.length > 0 && (
              <span className="ml-auto flex shrink-0 -space-x-1">
                {task.assignees.slice(0, 3).map((person) => (
                  <Avatar key={person.id} userId={person.id} name={person.name} size={20} />
                ))}
                <span className="sr-only">{task.assignees.map((p) => p.name).join(', ')}</span>
              </span>
            )}
          </span>
        )}
      </Link>
    );
  }
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

/** A ticket: opens its page. `compact` (the timeline strip): the subject clipped to three lines. */
export function TicketRow({
  ticket,
  compact = false,
}: {
  ticket: TimelineTicketRow;
  compact?: boolean;
}) {
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
        className={cn(
          'min-w-0 flex-1 break-words',
          compact && 'line-clamp-3',
          done && 'text-muted-foreground line-through',
        )}
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
