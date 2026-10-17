import { lazy, Suspense, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { AdminTime, WorkLogEntry, WorkLogSummary } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { MoreIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ListSkeleton } from '@/components/ui/skeleton';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import type { FinanceView } from './api';
import { monthName } from './charts/scale';
import { FinanceCard, FinanceCardEmpty } from './finance-card';
import { useFinanceFormat } from './format';
import { fetchWorkLogPage, useDeleteEntry, useUpdateEntry, workLogKey } from './log-api';
import { WORK_LOG_PERIODS } from './period';
import { PeriodSelect, usePeriod } from './period-select';
import { chronology, type LogItem } from './work-log-groups';

const EntryDialog = lazy(() =>
  import('./manual-entry-dialog').then((m) => ({ default: m.EntryDialog })),
);
const RatesDialog = lazy(() => import('./rates-dialog').then((m) => ({ default: m.RatesDialog })));

/**
 * Work log (spec §6.1): the period's summary on top (hours, tasks, tickets, cost, per admin),
 * then the chronology oldest at the top and newest at the bottom, opening scrolled to the bottom
 * like a chat; "Show earlier" loads the older page and keeps the scroll position. Each month
 * starts with its full totals. "Add time" (a manual entry) and "Hourly rates" open their dialogs;
 * each entry has a menu to edit, reset to 0 or delete. One client (`group`) or many (`all`, D).
 */
export function WorkLogCard({ view }: { view: FinanceView }) {
  const { t } = useTranslation();
  const titleId = useId();
  const period = usePeriod('finance.workLog.period', WORK_LOG_PERIODS);
  const range = period.range;
  const query = useInfiniteQuery({
    queryKey: workLogKey(view, range),
    queryFn: ({ pageParam }) => fetchWorkLogPage(view, range, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.before,
  });
  const [dialog, setDialog] = useState<
    { kind: 'add' } | { kind: 'edit'; entry: WorkLogEntry } | { kind: 'rates' } | null
  >(null);
  const pages = query.data?.pages;
  const months = useMemo(() => chronology(pages ?? []), [pages]);
  const summary = pages?.[0]?.summary ?? null;

  // Opens at the newest entry (the bottom); "Show earlier" keeps what was in view in place.
  const scroller = useRef<HTMLDivElement>(null);
  const kept = useRef<{ height: number; top: number; page: number } | null>(null);
  const opened = useRef<string | null>(null);
  const rangeKey = JSON.stringify(range);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !pages) return;
    const inside = el.scrollHeight > el.clientHeight + 1;
    if (kept.current) {
      const { height, top, page } = kept.current;
      kept.current = null;
      if (inside) el.scrollTop = top + (el.scrollHeight - height);
      else window.scrollBy(0, document.documentElement.scrollHeight - page);
    } else if (opened.current !== rangeKey) {
      opened.current = rangeKey;
      if (inside) el.scrollTop = el.scrollHeight;
    }
  }, [pages, rangeKey]);
  const showEarlier = () => {
    const el = scroller.current;
    if (el) {
      kept.current = {
        height: el.scrollHeight,
        top: el.scrollTop,
        page: document.documentElement.scrollHeight,
      };
    }
    void query.fetchNextPage();
  };

  const groupId = view.kind === 'group' ? view.groupId : null;
  let body;
  if (query.isPending) {
    body = (
      <div aria-busy="true">
        <ListSkeleton rows={5} />
      </div>
    );
  } else if (query.isError) {
    body = (
      <div className="m-auto flex flex-col items-center gap-3 py-8 text-center">
        <p role="alert" className="text-button text-muted-foreground">
          {t('financeLog.loadFailed')}
        </p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          {t('financeLog.retry')}
        </Button>
      </div>
    );
  } else if (months.length === 0) {
    body = <FinanceCardEmpty>{t('financeLog.workLog.empty')}</FinanceCardEmpty>;
  } else {
    body = (
      <div className="flex flex-col gap-5 pb-1">
        {query.hasNextPage && (
          <Button
            variant="secondary"
            size="sm"
            className="self-center"
            disabled={query.isFetchingNextPage}
            onClick={showEarlier}
          >
            {t('financeLog.workLog.showEarlier')}
          </Button>
        )}
        {months.map((month) => (
          <section
            key={month.month}
            aria-labelledby={`${titleId}-${month.month}`}
            className="flex flex-col gap-3"
          >
            <MonthHeader
              id={`${titleId}-${month.month}`}
              month={month.month}
              totals={month.totals}
            />
            {month.days.map((day) => (
              <DayBlock
                key={day.day}
                day={day.day}
                items={day.items}
                onEdit={(entry) => setDialog({ kind: 'edit', entry })}
                view={view}
              />
            ))}
          </section>
        ))}
      </div>
    );
  }

  return (
    <FinanceCard
      title={t('finance.cards.workLog')}
      titleId={titleId}
      className="flex-1"
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'rates' })}>
            {t('financeLog.rates')}
          </Button>
          {groupId && (
            <Button size="sm" onClick={() => setDialog({ kind: 'add' })}>
              {t('financeLog.addTime')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 border-b-2 border-border pb-3">
        <PeriodSelect state={period} />
        {summary && <Summary summary={summary} />}
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 pt-4 min-[1024px]:overflow-y-auto"
        data-testid="work-log-scroll"
      >
        {body}
      </div>
      <Suspense fallback={null}>
        {dialog?.kind === 'rates' && <RatesDialog view={view} onClose={() => setDialog(null)} />}
        {dialog?.kind === 'add' && groupId && (
          <EntryDialog view={view} groupId={groupId} onClose={() => setDialog(null)} />
        )}
        {dialog?.kind === 'edit' && (
          <EntryDialog
            view={view}
            groupId={dialog.entry.groupId}
            entry={dialog.entry}
            onClose={() => setDialog(null)}
          />
        )}
      </Suspense>
    </FinanceCard>
  );
}

/** "34 h · 21 tasks · 1 700 €", with tickets and the minutes without a rate when there are. */
function TotalsLine({
  totals,
}: {
  totals: { minutes: number; taskCount: number; ticketCount: number; cost: number | null };
}) {
  const { t } = useTranslation();
  const f = useFinanceFormat();
  return (
    <>
      <span className="font-semibold">{f.duration(totals.minutes)}</span>
      {' · '}
      {t('financeLog.taskCount', { count: totals.taskCount })}
      {totals.ticketCount > 0 && ` · ${t('financeLog.ticketCount', { count: totals.ticketCount })}`}
      {totals.cost !== null && ` · ${f.money(totals.cost)}`}
    </>
  );
}

function AdminLines({ admins }: { admins: readonly AdminTime[] }) {
  const { t } = useTranslation();
  const f = useFinanceFormat();
  return (
    <ul className="flex flex-col gap-1 text-tiny">
      {admins.map((a) => (
        <li key={a.userId} className="flex items-baseline justify-between gap-3 tabular-nums">
          <span className="truncate font-semibold">{a.name}</span>
          <span className="shrink-0 text-muted-foreground">
            {f.duration(a.minutes)} · {t('financeLog.taskCount', { count: a.taskCount })}
            {a.cost !== null && ` · ${f.money(a.cost)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Summary({ summary }: { summary: WorkLogSummary }) {
  const { t } = useTranslation();
  const f = useFinanceFormat();
  const phone = useMediaQuery('(max-width: 640px)');
  const line = (
    <span className="text-button tabular-nums">
      <TotalsLine totals={summary} />
    </span>
  );
  return (
    <div className="flex flex-col gap-2" data-testid="work-log-summary">
      {phone ? (
        <details>
          <summary className="cursor-pointer">{line}</summary>
          <div className="pt-2">
            <AdminLines admins={summary.byAdmin} />
          </div>
        </details>
      ) : (
        <>
          {line}
          <AdminLines admins={summary.byAdmin} />
        </>
      )}
      {summary.missingRateMinutes > 0 && (
        <p className="text-tiny text-muted-foreground">
          {t('financeLog.missingRate', { hours: f.duration(summary.missingRateMinutes) })}
        </p>
      )}
    </div>
  );
}

function MonthHeader({
  id,
  month,
  totals,
}: {
  id: string;
  month: string;
  totals: ReturnType<typeof chronology>[number]['totals'];
}) {
  const { i18n } = useTranslation();
  return (
    <header className="flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2.5">
      <h3 id={id} className="text-button font-semibold">
        <span className="capitalize">{monthName(month, i18n.language)}</span>
        {totals && (
          <span className="font-medium text-muted-foreground tabular-nums">
            {' — '}
            <TotalsLine totals={totals} />
          </span>
        )}
      </h3>
      {totals && totals.byAdmin.length > 1 && <AdminLines admins={totals.byAdmin} />}
    </header>
  );
}

function DayBlock({
  day,
  items,
  onEdit,
  view,
}: {
  day: string;
  items: LogItem[];
  onEdit: (entry: WorkLogEntry) => void;
  view: FinanceView;
}) {
  const f = useFinanceFormat();
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-micro font-semibold text-muted-foreground">{f.day(day)}</h4>
      <ul className="flex flex-col">
        {items.map((item) =>
          item.kind === 'entry' ? (
            <EntryRow key={item.entry.id} entry={item.entry} onEdit={onEdit} view={view} />
          ) : (
            <li key={item.ticket.id} className="flex flex-col">
              <p className="flex items-baseline gap-2 py-1.5 text-tiny font-semibold">
                <Link
                  to="/tickets/$ticketId"
                  params={{ ticketId: item.ticket.id }}
                  className="hover:underline"
                >
                  #{item.ticket.number} {item.ticket.title}
                </Link>
              </p>
              <ul className="flex flex-col border-l-2 border-border pl-3">
                {[...item.own, ...item.tasks].map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    onEdit={onEdit}
                    view={view}
                    showDay={entry.workedOn !== day}
                  />
                ))}
              </ul>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function EntryRow({
  entry,
  onEdit,
  view,
  showDay = false,
}: {
  entry: WorkLogEntry;
  onEdit: (entry: WorkLogEntry) => void;
  view: FinanceView;
  showDay?: boolean;
}) {
  const { t } = useTranslation();
  const f = useFinanceFormat();
  const update = useUpdateEntry(view);
  const remove = useDeleteEntry(view);
  const requested = entry.minutes === null;
  const deletable = entry.source === 'manual' || requested;

  let subject;
  if (entry.source === 'manual') {
    subject = entry.note || t('financeLog.workLog.manual');
  } else if (entry.source === 'task' && entry.taskId && !entry.subjectDeleted) {
    subject = (
      <Link
        to="/groups/$groupId/tasks/$taskId"
        params={{ groupId: entry.groupId, taskId: entry.taskId }}
        className="hover:underline"
      >
        {entry.title}
      </Link>
    );
  } else if (entry.source === 'ticket' && entry.ticketId && !entry.subjectDeleted) {
    subject = t('financeLog.workLog.ticketTime');
  } else {
    subject = (
      <>
        {entry.title}{' '}
        <span className="text-muted-foreground">({t('financeLog.workLog.deleted')})</span>
      </>
    );
  }

  return (
    <li className="group flex items-center gap-2.5 py-1.5" data-testid="work-log-entry">
      <Avatar userId={entry.userId} name={entry.userName} size={24} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-tiny">
          <span className="font-semibold">{entry.userName}</span>
          {view.kind === 'all' && entry.groupName && (
            <span className="text-muted-foreground"> · {entry.groupName}</span>
          )}
          {showDay && <span className="text-muted-foreground"> · {f.day(entry.workedOn)}</span>}
        </p>
        <p className="truncate text-tiny text-muted-foreground">{subject}</p>
      </div>
      <p
        className={cn(
          'shrink-0 text-right text-tiny tabular-nums',
          requested && 'text-muted-foreground',
        )}
      >
        {requested
          ? t('financeLog.workLog.waiting')
          : entry.coveredByTasks
            ? t('financeLog.workLog.covered')
            : f.duration(entry.minutes!)}
        {entry.cost !== null && !requested && (
          <span className="block text-muted-foreground">
            {f.money(entry.cost, undefined, false)}
          </span>
        )}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('financeLog.workLog.menu')}
          >
            <MoreIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(entry)}>
            {requested ? t('financeLog.workLog.fill') : t('financeLog.workLog.edit')}
          </DropdownMenuItem>
          {!deletable && entry.minutes !== 0 && (
            <DropdownMenuItem
              onSelect={() => update.mutate({ id: entry.id, patch: { minutes: 0 } })}
            >
              {t('financeLog.workLog.reset')}
            </DropdownMenuItem>
          )}
          {deletable && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                if (window.confirm(t('financeLog.workLog.deleteConfirm'))) remove.mutate(entry.id);
              }}
            >
              {t('financeLog.workLog.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
