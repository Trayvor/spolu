import { useMemo, useState, type ReactNode } from 'react';
import { UnseenMarker } from '@/features/unseen/marker';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TicketListItem } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListSkeleton } from '@/components/ui/skeleton';
import { formatDue, todayInBratislava } from '@/features/tasks/dates';
import { ProjectChip } from '@/features/projects/project-chip';
import { cn } from '@/lib/utils';
import { ticketsQuery, type TicketFilter, type TicketSource } from './api';
import { isTicketOverdue, StatusBadge } from './status-badge';
import { TicketFilters, type ProjectScope } from './ticket-filters';
import { useTicketEvents } from './use-ticket-events';

/**
 * One ticket list for the group's Tickets tab, My tickets and the admins' global view: the
 * filters, then the rows in one card (newest first, 50 per page, "Load more"). Rows are links to
 * the ticket page. My tickets and the global view name each row's client. Live through
 * `useTicketEvents`. `filterExtras` go first in the filter bar; `disabled` holds the list (the
 * global view while its client choice loads); `empty` replaces the default empty line.
 */
export function TicketList({
  source,
  filter,
  onFilterChange,
  filterExtras,
  disabled = false,
  empty,
  projectScope,
}: {
  source: TicketSource;
  filter: TicketFilter;
  onFilterChange: (next: TicketFilter) => void;
  filterExtras?: ReactNode;
  disabled?: boolean;
  empty?: ReactNode;
  /** Where the Project (and Event) filter pills apply; absent: none (see `TicketFilters`). */
  projectScope?: ProjectScope;
}) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({ ...ticketsQuery(source, filter), enabled: !disabled });
  useTicketEvents(source);
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const areas = useSeenAreas(items);
  const showClient = source.kind !== 'group';
  const filtered =
    filter.status !== 'open' || !!filter.area || !!filter.assignee || !!filter.project;

  let body: ReactNode;
  if (disabled || query.isPending) {
    body = (
      <div role="status" aria-busy="true" aria-label={t('tickets.list.loading')}>
        <ListSkeleton rows={4} />
      </div>
    );
  } else if (query.isError) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-button text-muted-foreground">{t('tickets.list.error')}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {t('errors.retry')}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = empty ?? (
      <p className="py-8 text-center text-button text-muted-foreground">
        {t(filtered ? 'tickets.list.noMatch' : 'tickets.list.empty')}
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col items-center gap-4">
        <Card className="w-full gap-0 overflow-hidden py-0">
          <ul role="list" className="divide-y divide-border">
            {items.map((item) => (
              <TicketRow key={item.id} item={item} showClient={showClient} />
            ))}
          </ul>
        </Card>
        {query.hasNextPage && (
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? t('tickets.list.loading') : t('tickets.list.loadMore')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TicketFilters
        filter={filter}
        onChange={onFilterChange}
        areas={areas}
        projectScope={projectScope}
      >
        {filterExtras}
      </TicketFilters>
      {body}
    </div>
  );
}

/**
 * The question areas seen in this list so far, by name: the area menu offers the free values the
 * tickets carry, and keeps the ones of earlier pages and filters while the list changes.
 */
function useSeenAreas(items: TicketListItem[]): string[] {
  const [seen, setSeen] = useState<string[]>([]);
  const known = new Set(seen.map((a) => a.toLowerCase()));
  const fresh = new Map<string, string>();
  for (const item of items) {
    const area = item.area?.trim();
    if (area && !known.has(area.toLowerCase())) fresh.set(area.toLowerCase(), area);
  }
  // Adjusting state while rendering (React's documented pattern): only when a new area shows up.
  if (fresh.size > 0) setSeen([...seen, ...fresh.values()].sort((a, b) => a.localeCompare(b)));
  return seen;
}

export function ticketTitle(item: { subject: string | null; excerpt?: string | null }): string {
  return item.subject ?? item.excerpt?.split(/\s+/).slice(0, 12).join(' ') ?? '';
}

function TicketRow({ item, showClient }: { item: TicketListItem; showClient: boolean }) {
  const { t, i18n } = useTranslation();
  const overdue = isTicketOverdue(item.dueDate, item.status, todayInBratislava());
  const title = ticketTitle(item);
  const due = item.dueDate && (
    <span
      className={cn(
        'tabular-nums',
        overdue ? 'font-semibold text-error-ink' : 'text-muted-foreground',
      )}
    >
      <span className="sr-only">{t(overdue ? 'tickets.row.overdue' : 'tickets.row.due')} </span>
      {formatDue(item.dueDate, i18n.language)}
    </span>
  );
  return (
    <li className="relative">
      <Link
        to="/tickets/$ticketId"
        params={{ ticketId: item.id }}
        // A gutter on the left for the unseen marker (2026-10-18), a sibling of the link, so
        // the numbers stay aligned whether a row has one or not.
        className="flex items-start gap-3 py-3 pr-4 pl-10 hover:text-ink-hover min-[641px]:items-center min-[641px]:pr-5 min-[641px]:pl-11"
      >
        <span className="w-12 shrink-0 pt-px text-button font-semibold text-muted-foreground tabular-nums min-[641px]:pt-0">
          #{item.number}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              'truncate text-button font-semibold',
              item.subject === null && 'font-medium text-muted-foreground',
              item.unseen && 'font-bold',
            )}
          >
            {title || t('tickets.row.noSubject')}
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-micro text-muted-foreground">
            {item.requesterName && (
              <span className="max-w-full truncate">{item.requesterName}</span>
            )}
            {item.area && <span className="max-w-full truncate">{item.area}</span>}
            {item.project && <ProjectChip project={item.project} event={item.event} />}
            {showClient && (
              <span className="max-w-full truncate font-semibold">
                {item.groupName ?? t('tickets.row.noClient')}
              </span>
            )}
            {due && <span className="text-micro min-[641px]:hidden">{due}</span>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {due && <span className="hidden text-micro min-[641px]:inline">{due}</span>}
          <RowAssignees people={item.assignees} />
          <StatusBadge status={item.status} />
        </span>
      </Link>
      <UnseenMarker
        mark={item.unseen}
        target={{ kind: 'ticket', id: item.id }}
        className="absolute top-2.5 left-2 min-[641px]:top-1/2 min-[641px]:left-3 min-[641px]:-translate-y-1/2"
      />
    </li>
  );
}

const MAX_AVATARS = 3;

/** Up to three overlapping avatars of the riešitelia with "+n", like a task card. */
function RowAssignees({ people }: { people: TicketListItem['assignees'] }) {
  const { t } = useTranslation();
  if (people.length === 0) return null;
  const shown = people.slice(0, MAX_AVATARS);
  const extra = people.length - shown.length;
  return (
    <span className="flex items-center" title={people.map((p) => p.name).join(', ')}>
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
        <span className="ml-1 text-micro font-semibold text-muted-foreground">+{extra}</span>
      )}
      <span className="sr-only">
        {t('tickets.row.assignees', { names: people.map((p) => p.name).join(', ') })}
      </span>
    </span>
  );
}
