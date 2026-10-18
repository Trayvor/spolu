import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDuration, type WorkloadAdmin, type WorkloadCounts } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { useNamespaces } from '@/i18n/namespaces';
import { cn } from '@/lib/utils';
import { workloadQuery } from './api';
import { TargetLink, type CardTarget } from './count-card';
import { taskLink, ticketLink } from './workload-links';

/** A 12 px chevron pointing right; turned down (no animation) while the row is open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={open ? 'rotate-90' : undefined}
    >
      <path d="m4.5 3 3 3-3 3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const numberCell = 'w-24 px-2 text-right tabular-nums';

/** A count, as a link when it has a target; 0 stays muted only in the overdue column. */
function Count({
  value,
  target,
  label,
  overdue = false,
}: {
  value: number;
  target?: CardTarget | null;
  label?: string;
  overdue?: boolean;
}) {
  const ink = overdue ? (value > 0 ? 'font-semibold text-error-ink' : 'text-muted-foreground') : '';
  if (!target) return <td className={cn(numberCell, ink)}>{value}</td>;
  return (
    <td className={cn(numberCell, ink)}>
      <TargetLink target={target} className="rounded-sm underline-offset-4 hover:underline">
        <span aria-label={label}>{value}</span>
      </TargetLink>
    </td>
  );
}

type RowRef = { userId: string; self: boolean; groupId: string | null | 'all' };

/** The four counts of an admin's or a client's row, with the row's links. */
function Counts({
  counts,
  row,
  name,
  client,
  linked,
}: {
  counts: WorkloadCounts;
  row: RowRef;
  name: string;
  client: string;
  linked: boolean;
}) {
  const { t } = useTranslation();
  const at = (target: CardTarget | null) => (linked ? target : null);
  return (
    <>
      <Count
        value={counts.openTasks}
        target={at(taskLink(row, false))}
        label={t('adminWorkload.links.tasks', { name, client })}
      />
      <Count
        value={counts.overdueTasks}
        overdue
        target={at(taskLink(row, true))}
        label={t('adminWorkload.links.overdue', { name, client })}
      />
      <Count
        value={counts.openTickets}
        target={at(ticketLink(row))}
        label={t('adminWorkload.links.tickets', { client })}
      />
      {/* Not a link: the unseen marks are the other admin's, not the viewer's. */}
      <Count value={counts.unseen} />
    </>
  );
}

function AdminRows({ admin, timed }: { admin: WorkloadAdmin; timed: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const clientsId = useId();
  const units = {
    hours: t('adminWorkload.units.hours'),
    minutes: t('adminWorkload.units.minutes'),
  };
  const minutes = admin.minutesThisWeek ?? 0;
  const ref = { userId: admin.userId, self: admin.self };
  const name = admin.name;
  const hasClients = admin.clients.length > 0 || admin.moreClients !== null;
  return (
    <>
      <tbody>
        <tr className="h-11 border-b border-border">
          <th scope="row" className="pr-2 text-left font-normal">
            <span className="flex items-center gap-2">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={clientsId}
                aria-label={t(open ? 'adminWorkload.collapse' : 'adminWorkload.expand', { name })}
                disabled={!hasClients}
                onClick={() => setOpen((v) => !v)}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:invisible"
              >
                <Chevron open={open} />
              </button>
              <span className="truncate">
                {name}
                {admin.self && (
                  <span className="text-muted-foreground"> {t('adminWorkload.self')}</span>
                )}
              </span>
            </span>
          </th>
          <Counts
            counts={admin}
            row={{ ...ref, groupId: 'all' }}
            name={name}
            client={t('adminWorkload.allClients')}
            linked
          />
          {timed && (
            <td className={cn(numberCell, 'w-32')}>
              {minutes > 0 ? formatDuration(minutes, units) : '–'}
            </td>
          )}
        </tr>
      </tbody>
      <tbody id={clientsId} hidden={!open} className="text-muted-foreground">
        {admin.clients.map((c) => {
          const client = c.name ?? t('adminWorkload.noClient');
          return (
            <tr key={c.groupId ?? 'none'} className="h-9 border-b border-border">
              <th scope="row" className="truncate pr-2 pl-8 text-left font-normal">
                {client}
              </th>
              <Counts
                counts={c}
                row={{ ...ref, groupId: c.groupId }}
                name={name}
                client={client}
                linked={c.groupId !== null}
              />
              {timed && <td />}
            </tr>
          );
        })}
        {admin.moreClients && (
          <tr className="h-9 border-b border-border">
            <th scope="row" className="pr-2 pl-8 text-left font-normal">
              {t('adminWorkload.more', { count: admin.moreClients.count })}
            </th>
            <Counts
              counts={admin.moreClients}
              row={{ ...ref, groupId: null }}
              name={name}
              client=""
              linked={false}
            />
            {timed && <td />}
          </tr>
        )}
      </tbody>
    </>
  );
}

function Placeholder() {
  return (
    <div aria-hidden="true" data-testid="card-placeholder" className="flex flex-col">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex h-11 items-center border-b border-border last:border-b-0">
          <span className="h-3 w-2/3 animate-skeleton rounded-full bg-secondary" />
        </div>
      ))}
    </div>
  );
}

/**
 * The admin dashboard's lowest card, "Team workload" (2026-10-19, from 1024 px): one row per
 * active admin with their open tasks, overdue tasks, active tickets as riešiteľ and unseen items
 * (and this week's time for a finance holder, when the answer has a `week`), in the server's
 * order; each row opens its breakdown by client in place (no request). Numbers link to the
 * global board for that admin and client; Tikety only on the viewer's own rows. Loaded lazily,
 * with its own namespace; refetched on focus, never by sockets.
 */
export function WorkloadCard() {
  useNamespaces(['adminWorkload', 'adminHome']);
  const { t } = useTranslation();
  const query = useQuery(workloadQuery);
  const titleId = useId();
  const timed = query.data?.week != null;

  let body: ReactNode;
  if (query.isPending) body = <Placeholder />;
  else if (query.isError) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2 py-2">
        <p className="text-button text-muted-foreground">{t('adminHome.shell.loadError')}</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          {t('adminHome.shell.retry')}
        </Button>
      </div>
    );
  } else if (query.data.admins.length === 0) {
    body = <p className="py-2 text-button text-muted-foreground">{t('adminWorkload.empty')}</p>;
  } else {
    const head = (key: string, extra?: string) => (
      <th scope="col" className={cn(numberCell, 'font-normal', extra)}>
        {t(`adminWorkload.columns.${key}`)}
      </th>
    );
    body = (
      <>
        <table className="w-full table-fixed border-collapse text-button">
          <caption className="sr-only">{t('adminWorkload.title')}</caption>
          <thead className="text-micro text-muted-foreground">
            <tr className="h-9 border-b border-border">
              <th scope="col" className="pr-2 pl-8 text-left font-normal">
                {t('adminWorkload.columns.admin')}
              </th>
              {head('tasks')}
              {head('overdue')}
              {head('tickets')}
              {head('unseen')}
              {timed && head('week', 'w-32')}
            </tr>
          </thead>
          {query.data.admins.map((admin) => (
            <AdminRows key={admin.userId} admin={admin} timed={timed} />
          ))}
        </table>
        <p className="text-micro text-muted-foreground">
          {t(timed ? 'adminWorkload.footnoteTime' : 'adminWorkload.footnote')}
        </p>
      </>
    );
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-xl bg-card p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={titleId} className="text-body font-semibold">
          {t('adminWorkload.title')}
        </h2>
        <p className="text-micro text-muted-foreground">{t('adminWorkload.caption')}</p>
      </div>
      {body}
    </section>
  );
}
