import { lazy, Suspense, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { COST_CURRENCY, type Currency, type FinanceOverviewDto, type Month } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRememberedState } from '@/lib/use-remembered-filters';
import { cn } from '@/lib/utils';
import type { FinanceView } from './api';
import { ChartTable } from './charts/chart-table';
import { MonthBars, Swatch, type BarGroup } from './charts/month-bars';
import { SmallMultiples } from './charts/small-multiples';
import { FinanceCard, FinanceCardEmpty } from './finance-card';
import { useFinanceFormat } from './format';
import { overviewQuery } from './log-api';
import { OVERVIEW_PERIODS } from './period';
import { PeriodSelect, usePeriod, type PeriodState } from './period-select';
import { FinanceProjectPills, useFinanceProjectFilter } from './project-filter';
import { SegmentedControl } from './segmented-control';

const RatesDialog = lazy(() => import('./rates-dialog').then((m) => ({ default: m.RatesDialog })));

/**
 * Overview (spec §6.1): Money — the contracts paid and to be paid by start month against the
 * cost of the work, with the totals and the balance per currency; Hours — one small chart per
 * admin on one scale. A Money · Hours switch and the period filter, both remembered. One client
 * (`group`) or many (`all`, part D). On `/finance` with every client (Phase 32 E, decisions O3,
 * O4, E17) the organisation's expenses join as money out: a coral bar a month, the paid-out and
 * planned totals with the salaries named, and the balance is paid − expenses paid out (the cost
 * of work stays as information: the salaries already pay for that work).
 */
const VIEWS = ['money', 'hours'] as const;
type View = (typeof VIEWS)[number];

const toMap = (rows: readonly { month: Month; value: number }[]) =>
  new Map(rows.map((r) => [r.month, r.value]));

export function OverviewCard({
  view,
  period: pagePeriod,
}: {
  view: FinanceView;
  /** `/finance`'s page period, which replaces the card's own filter. */
  period?: PeriodState;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [savedView, setView] = useRememberedState<View>('finance.overview.view', VIEWS);
  const mode = savedView ?? 'money';
  const ownPeriod = usePeriod('finance.overview.period', OVERVIEW_PERIODS);
  const period = pagePeriod ?? ownPeriod;
  const project = useFinanceProjectFilter('overview', view);
  const query = useQuery(overviewQuery(view, period.range, project.value));
  const [rates, setRates] = useState(false);

  let body;
  if (query.isPending) {
    body = (
      <div className="flex flex-col gap-3 py-2" aria-busy="true">
        <Skeleton className="h-[200px] w-full" />
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
  } else if (mode === 'money') {
    body = (
      <MoneyView
        data={query.data}
        onRates={() => setRates(true)}
        byEvent={project.value.event !== undefined}
      />
    );
  } else {
    body = <HoursView data={query.data} onRates={() => setRates(true)} />;
  }

  return (
    <FinanceCard
      title={t('finance.cards.overview')}
      titleId={titleId}
      className="flex-1"
      actions={
        <>
          <SegmentedControl
            label={t('financeLog.overview.view')}
            options={VIEWS.map((v) => ({ value: v, label: t(`financeLog.overview.${v}`) }))}
            value={mode}
            onChange={(next) => setView(next === 'money' ? null : next)}
            className="w-[200px]"
          />
          {!pagePeriod && <PeriodSelect state={period} />}
        </>
      }
    >
      {project.groupId !== null && (
        <div className="pb-3">
          <FinanceProjectPills state={project} />
        </div>
      )}
      <div className="@container flex min-h-0 flex-1 flex-col">{body}</div>
      {rates && (
        <Suspense fallback={null}>
          <RatesDialog view={view} onClose={() => setRates(false)} />
        </Suspense>
      )}
    </FinanceCard>
  );
}

/** "Show as table" for a chart: the same numbers, accessible. */
function useTableToggle() {
  const { t } = useTranslation();
  const [table, setTable] = useState(false);
  const toggle = (
    <Button
      variant="link"
      size="sm"
      className="h-auto px-0"
      aria-pressed={table}
      onClick={() => setTable(!table)}
    >
      {table ? t('financeLog.charts.showChart') : t('financeLog.charts.showTable')}
    </Button>
  );
  return [table, toggle] as const;
}

function MissingRate({ minutes, onRates }: { minutes: number; onRates: () => void }) {
  const { t } = useTranslation();
  const f = useFinanceFormat();
  if (minutes === 0) return null;
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto justify-start px-0 text-tiny text-muted-foreground"
      onClick={onRates}
    >
      {t('financeLog.missingRate', { hours: f.duration(minutes) })}
    </Button>
  );
}

function MoneyView({
  data,
  onRates,
  byEvent,
}: {
  data: FinanceOverviewDto;
  onRates: () => void;
  /** An Event filter is on (Phase 33 P6): contracts have no event, only the cost shows. */
  byEvent: boolean;
}) {
  const { t } = useTranslation();
  const f = useFinanceFormat();
  const [table, toggle] = useTableToggle();
  const currencies = data.money.map((m) => m.currency);
  const [picked, setPicked] = useRememberedState<Currency>('finance.overview.currency', null);
  const currency =
    picked && currencies.includes(picked) ? picked : (currencies[0] ?? COST_CURRENCY);
  const money = data.money.find((m) => m.currency === currency);
  const paid = toMap((money?.byMonth ?? []).map((m) => ({ month: m.month, value: m.paid })));
  const toBePaid = toMap(
    (money?.byMonth ?? []).map((m) => ({ month: m.month, value: m.toBePaid })),
  );
  const cost = toMap(data.cost.byMonth.map((m) => ({ month: m.month, value: m.amount })));
  const showCost = currency === COST_CURRENCY;
  const out = data.expenses.find((x) => x.currency === currency);
  const outByMonth = toMap(
    (out?.byMonth ?? []).map((m) => ({ month: m.month, value: m.paidOut + m.planned })),
  );
  const groups: BarGroup[] = [
    {
      series: [
        { key: 'paid', label: t('financeLog.overview.paid'), tone: 'solid', values: paid },
        {
          key: 'toBePaid',
          label: t('financeLog.overview.toBePaid'),
          tone: 'light',
          values: toBePaid,
        },
      ],
    },
    ...(showCost
      ? [
          {
            thin: true,
            series: [
              {
                key: 'cost',
                label: t('financeLog.overview.spent'),
                tone: 'cost' as const,
                values: cost,
              },
            ],
          },
        ]
      : []),
    ...(data.organisation && out
      ? [
          {
            thin: true,
            series: [
              {
                key: 'out',
                label: t('financeOrg.overview.out'),
                tone: 'out' as const,
                values: outByMonth,
              },
            ],
          },
        ]
      : []),
  ];
  const format = (v: number) => f.money(v, currency);
  const empty =
    data.money.length === 0 &&
    data.expenses.length === 0 &&
    data.cost.total === 0 &&
    data.hours.minutes === 0;
  if (empty) return <FinanceCardEmpty>{t('financeLog.overview.empty')}</FinanceCardEmpty>;
  const eventNote = byEvent && (
    <p className="text-tiny text-muted-foreground" data-testid="finance-no-event-money">
      {t('financeLog.projects.contractsNoEvent')}
    </p>
  );

  const eur = data.money.find((m) => m.currency === COST_CURRENCY);
  // Every client on `/finance`: paid − expenses paid out (O3); otherwise paid − cost of work.
  const eurOut = data.expenses.find((x) => x.currency === COST_CURRENCY);
  const balance = data.organisation
    ? (eur?.paid ?? 0) - (eurOut?.paidOut ?? 0)
    : (eur?.paid ?? 0) - data.cost.total;
  return (
    <div className="flex flex-col gap-5 @min-[640px]:flex-row">
      <div className="flex min-w-0 flex-col gap-2 @min-[640px]:basis-[65%]">
        {eventNote}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-tiny text-muted-foreground">
          {groups
            .flatMap((g) => g.series)
            .map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <Swatch tone={s.tone} />
                {s.label}
              </span>
            ))}
          {currencies.length > 1 && (
            <SegmentedControl
              label={t('financeLog.overview.currency')}
              options={currencies.map((c) => ({ value: c, label: c }))}
              value={currency}
              onChange={setPicked}
              className="ml-auto w-[120px]"
            />
          )}
        </div>
        {table ? (
          <ChartTable
            caption={t('financeLog.overview.money')}
            months={data.months}
            columns={groups
              .flatMap((g) => g.series)
              .map((s) => ({ key: s.key, label: s.label, values: s.values, format }))}
          />
        ) : (
          <MonthBars
            months={data.months}
            groups={groups}
            format={format}
            label={t('financeLog.overview.moneyChart')}
          />
        )}
        <div>{toggle}</div>
      </div>
      <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3 @min-[640px]:basis-[35%] @min-[640px]:grid-cols-1">
        {data.money.map((m) => (
          <Total
            key={`paid-${m.currency}`}
            label={t('financeLog.overview.paidIn', { currency: m.currency })}
            value={f.money(m.paid, m.currency)}
          />
        ))}
        {data.money.map((m) => (
          <Total
            key={`tbp-${m.currency}`}
            label={t('financeLog.overview.toBePaidIn', { currency: m.currency })}
            value={f.money(m.toBePaid, m.currency)}
          />
        ))}
        {data.expenses.map((x) => (
          <Total
            key={`out-${x.currency}`}
            label={t('financeOrg.overview.paidOut', { currency: x.currency })}
            value={f.money(x.paidOut, x.currency)}
            note={
              x.salaryPaidOut > 0
                ? t('financeOrg.overview.salaries', {
                    amount: f.money(x.salaryPaidOut, x.currency),
                  })
                : undefined
            }
          />
        ))}
        {data.expenses
          .filter((x) => x.planned > 0)
          .map((x) => (
            <Total
              key={`planned-${x.currency}`}
              label={t('financeOrg.overview.planned', { currency: x.currency })}
              value={f.money(x.planned, x.currency)}
            />
          ))}
        <Total label={t('financeLog.overview.spent')} value={f.money(data.cost.total)} />
        <Total
          label={
            data.organisation ? t('financeOrg.overview.balance') : t('financeLog.overview.balance')
          }
          note={data.organisation ? t('financeOrg.overview.balanceNote') : undefined}
          value={f.money(Math.abs(balance))}
          sign={balance < 0 ? '−' : ''}
          tone={balance < 0 ? 'bad' : balance > 0 ? 'good' : undefined}
        />
        <div className="col-span-full">
          <MissingRate minutes={data.hours.missingRateMinutes} onRates={onRates} />
        </div>
      </dl>
    </div>
  );
}

function Total({
  label,
  value,
  sign = '',
  tone,
  note,
}: {
  label: string;
  value: string;
  sign?: string;
  tone?: 'good' | 'bad';
  /** A quiet line under the value (the salaries' part, the balance's rule). */
  note?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-micro text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-medium leading-tight font-semibold tabular-nums',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-error-ink',
        )}
      >
        {sign}
        {value}
      </dd>
      {note && <dd className="text-micro text-muted-foreground">{note}</dd>}
    </div>
  );
}

function HoursView({ data, onRates }: { data: FinanceOverviewDto; onRates: () => void }) {
  const { t } = useTranslation();
  const f = useFinanceFormat();
  const [table, toggle] = useTableToggle();
  const { hours } = data;
  if (hours.byAdmin.length === 0) {
    return <FinanceCardEmpty>{t('financeLog.overview.noHours')}</FinanceCardEmpty>;
  }
  const items = hours.byAdmin.map((a) => ({
    key: a.userId,
    label: t('financeLog.overview.hoursOf', { name: a.name }),
    values: toMap(a.byMonth.map((m) => ({ month: m.month, value: m.minutes }))),
    title: (
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-tiny">
        <span className="truncate font-semibold">{a.name}</span>
        <span className="text-muted-foreground tabular-nums">
          {f.duration(a.minutes)}
          {a.cost !== null && ` · ${f.money(a.cost)}`}
        </span>
      </p>
    ),
  }));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-button tabular-nums">
        <span className="font-semibold">{f.duration(hours.minutes)}</span>
        {' · '}
        {t('financeLog.taskCount', { count: hours.taskCount })}
        {hours.ticketCount > 0 && ` · ${t('financeLog.ticketCount', { count: hours.ticketCount })}`}
        {' · '}
        {f.money(data.cost.total)}
      </p>
      <MissingRate minutes={hours.missingRateMinutes} onRates={onRates} />
      {table ? (
        <ChartTable
          caption={t('financeLog.overview.hours')}
          months={data.months}
          columns={items.map((i) => ({
            key: i.key,
            label: hours.byAdmin.find((a) => a.userId === i.key)!.name,
            values: i.values,
            format: f.hours,
          }))}
        />
      ) : (
        <SmallMultiples months={data.months} items={items} format={f.hours} />
      )}
      <div>{toggle}</div>
    </div>
  );
}
