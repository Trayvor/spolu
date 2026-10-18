import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type {
  BucketKind,
  MessageAttachedTask,
  MessageAttachedTicket,
  MessageDto,
  TicketStatus,
} from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { formatDue, isOverdue, todayInBratislava } from '@/features/tasks/dates';
import { StatusMark } from '@/features/tickets/status-badge';
import { cn } from '@/lib/utils';
import { ClientTag, useClientDirectory } from './client-tag';

type TaskCard = Extract<MessageAttachedTask, { available: true }>;
type TicketCard = Extract<MessageAttachedTicket, { available: true }>;

const cardClass =
  'flex w-full max-w-sm min-w-0 items-center gap-3 rounded-lg border-2 px-3 py-2 text-left touch:min-h-11';
const openClass = `${cardClass} border-border bg-card hover:border-foreground focus-visible:border-foreground`;

/** The done ring of a task card: empty, or a green circle with a check. A picture, not a control. */
function DoneMark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-[18px] shrink-0 items-center justify-center rounded-full border-2',
        done ? 'border-success bg-success text-white' : 'border-foreground',
      )}
    >
      {done && (
        <svg
          viewBox="0 0 12 12"
          className="size-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M2.5 6.2 5 8.6l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function People({ people }: { people: { id: string; name: string }[] }) {
  if (people.length === 0) return null;
  return (
    <span className="flex items-center">
      {people.map((p) => (
        <Avatar
          key={p.id}
          userId={p.id}
          name={p.name}
          size={20}
          className="-ml-1.5 border-2 border-card first:ml-0"
        />
      ))}
      <span className="sr-only">{people.map((p) => p.name).join(', ')}</span>
    </span>
  );
}

/** The name of the task's bucket: a custom bucket's own name, else the fixed bucket's word. */
function useBucketName() {
  const { t } = useTranslation();
  return (task: TaskCard): string =>
    task.bucketKind === 'custom'
      ? (task.bucketName ?? '')
      : t(`chat.work.bucket.${task.bucketKind}`);
}

/**
 * A task's look in a card or a picker row: the done mark, the title (struck through when done),
 * and under it the bucket, the assignees, the deadline (error ink when overdue) and an urgent mark;
 * `client` (the admin group, Phase 34 part D) is a last line naming the task's client.
 */
export function TaskSummary({ task, client }: { task: TaskCard; client?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const bucketName = useBucketName();
  const overdue = isOverdue(task.dueDate, task.bucketKind as BucketKind, todayInBratislava());
  return (
    <>
      <DoneMark done={task.completed} />
      <span className="flex min-w-0 flex-col">
        <span
          className={cn('truncate text-button font-semibold', task.completed && 'line-through')}
        >
          {task.title}
          {task.completed && <span className="sr-only"> ({t('chat.work.completed')})</span>}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-micro text-muted-foreground">
          <span className="truncate">{bucketName(task)}</span>
          <People people={task.assignees} />
          {task.dueDate && (
            <time dateTime={task.dueDate} className={cn(overdue && 'font-semibold text-error-ink')}>
              {formatDue(task.dueDate, i18n.language)}
              {overdue && <span className="sr-only"> ({t('chat.work.overdue')})</span>}
            </time>
          )}
          {task.urgent && (
            <span className="font-semibold text-error-ink">{t('chat.work.urgent')}</span>
          )}
        </span>
        {client}
      </span>
    </>
  );
}

/**
 * A ticket's look: `#number`, the subject, and under it the status and the riešitelia; `client`
 * (the admin group) is a last line naming its client or "Without client".
 */
export function TicketSummary({ ticket, client }: { ticket: TicketCard; client?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="shrink-0 text-button font-semibold text-brand-purple-ink">
        #{ticket.number}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-button font-semibold">
          {ticket.subject ?? t('chat.work.noSubject')}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-micro text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <StatusMark status={ticket.status as TicketStatus} />
            {t(`chat.work.status.${ticket.status}`)}
          </span>
          <People people={ticket.assignees} />
        </span>
        {client}
      </span>
    </>
  );
}

function Unavailable({ label }: { label: string }) {
  return (
    <p className={`${cardClass} border-dashed border-border text-micro text-muted-foreground`}>
      {label}
    </p>
  );
}

/**
 * The tasks and tickets attached to a message (Phase 34), in the order they were picked: a card
 * each, or "unavailable" for one that is gone or no longer in this group. A task card opens the
 * task panel of its group, a ticket card the ticket page; both do their own permission checks.
 * In the admin group (Phase 34 part D) a card of another group also names its client.
 */
export function WorkCards({ message, groupId }: { message: MessageDto; groupId: string }) {
  const { t } = useTranslation();
  const foreign = (card: { available: boolean; groupId?: string | null }) =>
    card.available && card.groupId !== groupId;
  const crossClient = message.attachedTasks.some(foreign) || message.attachedTickets.some(foreign);
  const directory = useClientDirectory(crossClient);
  if (message.attachedTasks.length === 0 && message.attachedTickets.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col items-start gap-1.5">
      {message.attachedTasks.map((task) =>
        task.available ? (
          <Link
            key={task.id}
            to="/groups/$groupId/tasks/$taskId"
            params={{ groupId: task.groupId, taskId: task.id }}
            className={openClass}
          >
            <TaskSummary
              task={task}
              client={
                task.groupId !== groupId ? (
                  <ClientTag groupId={task.groupId} directory={directory} />
                ) : undefined
              }
            />
          </Link>
        ) : (
          <Unavailable key={task.id} label={t('chat.work.taskUnavailable')} />
        ),
      )}
      {message.attachedTickets.map((ticket) =>
        ticket.available ? (
          <Link
            key={ticket.id}
            to="/tickets/$ticketId"
            params={{ ticketId: ticket.id }}
            className={openClass}
          >
            <TicketSummary
              ticket={ticket}
              client={
                ticket.groupId !== groupId ? (
                  <ClientTag groupId={ticket.groupId} directory={directory} />
                ) : undefined
              }
            />
          </Link>
        ) : (
          <Unavailable key={ticket.id} label={t('chat.work.ticketUnavailable')} />
        ),
      )}
    </div>
  );
}
