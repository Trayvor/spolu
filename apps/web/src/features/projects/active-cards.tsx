import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ActiveTaskRow, ActiveTicketRow, ProjectRefDto } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { todayInBratislava } from '@/features/tasks/dates';
import { cn } from '@/lib/utils';
import { STATUS_VARIANT } from './event-rows';
import { formatEventDate, ProjectDot } from './project-dot';
import { activeCardsQuery } from './timeline-api';

/** Phones show 5 rows of the 8 (spec §7.1). */
const PHONE_ROWS = 5;
const phoneHidden = (index: number) => (index >= PHONE_ROWS ? 'max-[640px]:hidden' : undefined);

/**
 * The Tickets and Tasks cards of the Prehľad tab (spec §7.4, decision 18): the client's active
 * tickets and open tasks, the viewer's own first, 8 rows each, with "Open all" to the tab. One
 * request for both; task and ticket events refetch it (`useWorkEvents`).
 */
export function ActiveCards({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const query = useQuery(activeCardsQuery(groupId));
  const k = (key: string, options?: Record<string, unknown>) => t(`projects.cards.${key}`, options);
  const data = query.data;
  const today = todayInBratislava();
  const body = (rows: ReactNode, empty: boolean, emptyText: string) =>
    query.isPending ? (
      <div aria-busy="true" className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 rounded-md bg-secondary" />
        ))}
      </div>
    ) : query.isError ? (
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <p className="text-button text-error-ink">{k('loadError')}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {t('projects.card.retry')}
        </Button>
      </div>
    ) : empty ? (
      <p className="py-3 text-button text-muted-foreground">{emptyText}</p>
    ) : (
      rows
    );

  return (
    <>
      <Card
        id="active-tickets"
        title={k('tickets')}
        summary={
          data &&
          [
            k('ticketsActive', { count: data.tickets.total }),
            data.tickets.mine > 0 && k('mine', { count: data.tickets.mine }),
          ]
            .filter(Boolean)
            .join(', ')
        }
        openAll={
          <Link
            to="/groups/$groupId/tickets"
            params={{ groupId }}
            className="text-tiny font-semibold underline-offset-2 hover:underline"
          >
            {k('openAll')}
          </Link>
        }
      >
        {body(
          <ul role="list" className="-mx-2 flex flex-col">
            {data?.tickets.rows.map((row, index) => (
              <li key={row.id} className={phoneHidden(index)}>
                <TicketLine row={row} />
              </li>
            ))}
          </ul>,
          data?.tickets.rows.length === 0,
          k('noTickets'),
        )}
      </Card>
      <Card
        id="active-tasks"
        title={k('tasks')}
        summary={
          data &&
          [
            k('tasksOpen', { count: data.tasks.total }),
            data.tasks.mine > 0 && k('mine', { count: data.tasks.mine }),
            data.tasks.urgent > 0 && k('urgentCount', { count: data.tasks.urgent }),
          ]
            .filter(Boolean)
            .join(', ')
        }
        openAll={
          <Link
            to="/groups/$groupId/tasks"
            params={{ groupId }}
            className="text-tiny font-semibold underline-offset-2 hover:underline"
          >
            {k('openAll')}
          </Link>
        }
      >
        {body(
          <ul role="list" className="-mx-2 flex flex-col">
            {data?.tasks.rows.map((row, index) => (
              <li key={row.id} className={phoneHidden(index)}>
                <TaskLine groupId={groupId} row={row} today={today} />
              </li>
            ))}
          </ul>,
          data?.tasks.rows.length === 0,
          k('noTasks'),
        )}
      </Card>
    </>
  );
}

function Card({
  id,
  title,
  summary,
  openAll,
  children,
}: {
  id: string;
  title: string;
  summary: string | undefined;
  openAll: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col rounded-xl bg-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4 pb-2">
        <h2 id={`${id}-title`} className="text-medium leading-tight font-semibold">
          {title}
        </h2>
        {summary && <span className="mr-auto text-tiny text-muted-foreground">{summary}</span>}
        <span className="ml-auto">{openAll}</span>
      </div>
      <div className="px-5 pb-4">{children}</div>
    </section>
  );
}

/** The row's project (and event), small, after its title. */
function ProjectChip({ project, event }: { project: ProjectRefDto | null; event?: string }) {
  if (!project) return null;
  return (
    <span className="flex min-w-0 items-center gap-1 text-micro text-muted-foreground">
      <ProjectDot color={project.color ?? 'purple'} className="size-2" />
      <span className="truncate">{event ? `${project.name}, ${event}` : project.name}</span>
    </span>
  );
}

const ROW =
  'flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted focus-visible:bg-muted';

function TicketLine({ row }: { row: ActiveTicketRow }) {
  const { t } = useTranslation();
  return (
    <Link to="/tickets/$ticketId" params={{ ticketId: row.id }} className={ROW}>
      <span className="shrink-0 text-tiny font-semibold tabular-nums">#{row.number}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-button">{row.subject ?? t('projects.cards.noSubject')}</span>
        <ProjectChip project={row.project} event={row.event?.name} />
      </span>
      {row.mine && <span className="sr-only">{t('projects.cards.mineMark')}</span>}
      <Badge variant={STATUS_VARIANT[row.status]} className="shrink-0">
        {t(`projects.cards.status.${row.status}`)}
      </Badge>
    </Link>
  );
}

function TaskLine({ groupId, row, today }: { groupId: string; row: ActiveTaskRow; today: string }) {
  const { t, i18n } = useTranslation();
  const overdue = row.dueDate !== null && row.dueDate < today;
  return (
    <Link
      to="/groups/$groupId/overview"
      params={{ groupId }}
      search={(prev: Record<string, unknown>) => ({ ...prev, task: row.id })}
      className={ROW}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-button">
          {row.urgent && (
            <span className="mr-1 font-semibold text-error-ink">{t('projects.cards.urgent')}</span>
          )}
          {row.title}
        </span>
        <ProjectChip project={row.project} event={row.event?.name} />
      </span>
      {row.dueDate && (
        <time
          dateTime={row.dueDate}
          className={cn(
            'shrink-0 text-tiny tabular-nums',
            overdue ? 'text-error-ink' : 'text-muted-foreground',
          )}
        >
          {formatEventDate(row.dueDate, i18n.language)}
        </time>
      )}
      {row.assignees.length > 0 && (
        <span className="flex shrink-0 -space-x-1">
          {row.assignees.slice(0, 3).map((person) => (
            <Avatar key={person.id} userId={person.id} name={person.name} size={24} />
          ))}
          <span className="sr-only">{row.assignees.map((p) => p.name).join(', ')}</span>
        </span>
      )}
    </Link>
  );
}
