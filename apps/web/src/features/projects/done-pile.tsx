import { useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskRow, TicketRow } from './event-rows';
import { eventItemsQuery } from './timeline-api';

/** A stack of three bars: the done pile (decorative). */
function StackIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2.5" y="2.5" width="11" height="3" rx="1" />
      <rect x="2.5" y="6.5" width="11" height="3" rx="1" />
      <rect x="2.5" y="10.5" width="11" height="3" rx="1" />
    </svg>
  );
}

/**
 * The done pile under an event (decision 16): one muted line "7 done" that expands in place to
 * the completed tasks (struck through) and resolved tickets, newest first, a page at a time.
 * `open`: the list only, always expanded (the event sheet, under its own heading). `compact`: the
 * rows' narrow form (the timeline strip).
 */
export function DonePile({
  groupId,
  eventId,
  count,
  today,
  open: initiallyOpen = false,
  compact = false,
}: {
  groupId: string;
  eventId: string;
  count: number;
  today: string;
  open?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const listId = useId();
  if (initiallyOpen)
    return <DoneList id={listId} groupId={groupId} eventId={eventId} today={today} />;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-tiny text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <StackIcon />
        {t('projects.timeline.done', { count })}
      </button>
      {open && (
        <DoneList id={listId} groupId={groupId} eventId={eventId} today={today} compact={compact} />
      )}
    </div>
  );
}

function DoneList({
  id,
  groupId,
  eventId,
  today,
  compact = false,
}: {
  id: string;
  groupId: string;
  eventId: string;
  today: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(eventItemsQuery(groupId, eventId, 'done'));
  if (query.isPending) {
    return (
      <div id={id} aria-busy="true">
        <Skeleton className="h-16 rounded-md bg-secondary" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p id={id} role="alert" className="text-tiny text-error-ink">
        {t('projects.timeline.loadError')}
      </p>
    );
  }
  const pages = query.data.pages;
  return (
    <div id={id} className="flex flex-col">
      <ul className="flex flex-col">
        {pages.flatMap((page) => [
          ...page.tasks.map((task) => (
            <li key={task.id}>
              <TaskRow groupId={groupId} task={task} today={today} compact={compact} />
            </li>
          )),
          ...page.tickets.map((ticket) => (
            <li key={ticket.id}>
              <TicketRow ticket={ticket} compact={compact} />
            </li>
          )),
        ])}
      </ul>
      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t('projects.timeline.more')}
        </Button>
      )}
    </div>
  );
}
