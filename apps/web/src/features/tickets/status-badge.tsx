import { useTranslation } from 'react-i18next';
import type { TicketStatus } from '@spolu/shared';
import { cn } from '@/lib/utils';

/**
 * The board's column marks, reused for the three ticket statuses so a person reads them the same
 * way: New is the outlined square of To do, In progress eGrant's purple, Resolved Completed's
 * green. The text carries the meaning; the square is only a cue.
 */
const MARK: Record<TicketStatus, string> = {
  new: 'border-[1.5px] border-foreground',
  in_progress: 'bg-brand-purple',
  resolved: 'bg-success',
};

export function StatusMark({ status }: { status: TicketStatus }) {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-xs', MARK[status])} />;
}

/**
 * A `secondary` pill with the status mark and its name; `awaiting` (an admin marked it solved and
 * the author has not answered, 2026-11-04) reads "Awaiting confirmation" instead, with the yellow
 * of what waits for someone.
 */
export function StatusBadge({
  status,
  awaiting = false,
  className,
}: {
  status: TicketStatus;
  awaiting?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-micro font-semibold text-secondary-foreground',
        className,
      )}
    >
      {awaiting ? (
        <span aria-hidden="true" className="size-2 shrink-0 rounded-xs bg-attention" />
      ) : (
        <StatusMark status={status} />
      )}
      {t(awaiting ? 'tickets.status.awaitingConfirmation' : `tickets.status.${status}`)}
    </span>
  );
}

/** Past the due date and not resolved (dates are Bratislava calendar days). */
export function isTicketOverdue(
  dueDate: string | null,
  status: TicketStatus,
  today: string,
): boolean {
  return dueDate !== null && status !== 'resolved' && dueDate < today;
}
