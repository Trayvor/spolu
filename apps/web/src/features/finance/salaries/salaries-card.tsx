import { useId, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatMoney, type Salary, type SalaryTotals } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ListSkeleton } from '@/components/ui/skeleton';
import { useRememberedState } from '@/lib/use-remembered-filters';
import { financePayeesQuery } from '../documents/api';
import { FinanceCard, FinanceCardEmpty } from '../finance-card';
import type { MonthRange } from '../period';
import { formatMonth, salariesQuery } from './api';

/**
 * `/finance`'s **Mzdy** view (2026-10-21): the admins' salaries of the page period (its months;
 * all time: every month), one admin or all (the choice remembered per person, not in the URL,
 * so saved views stay as they are). Above the list the totals: the whole, a line per admin and
 * per month; then the salaries newest month first, 50 a page with "Show more". A row opens the
 * salary's sheet (`?salary=`), **+ Nová mzda** a new one; the sheet lives in the Položky card.
 */
export function SalariesCard({
  range,
  title,
  headerStart,
  onOpen,
  onCreate,
}: {
  range: MonthRange | null;
  title: string;
  headerStart?: ReactNode;
  onOpen: (id: string) => void;
  /** A new salary, of the chosen admin when one is chosen. */
  onCreate: (admin: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const adminId = useId();
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`financeOrg.salaries.${key}`, options);
  const payees = useQuery(financePayeesQuery).data ?? [];
  const [admin, setAdmin] = useRememberedState<string>('finance.salaries.admin', null);
  const query = useInfiniteQuery(salariesQuery(admin, range));
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = query.data?.pages[0]?.totals ?? null;
  // A chosen admin who is no longer active still shows as a choice.
  const adminOptions =
    admin && !payees.some((p) => p.id === admin)
      ? [...payees, { id: admin, name: rows[0]?.payeeName ?? admin }]
      : payees;

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
          {t('financeSystem.loadFailed')}
        </p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          {t('financeSystem.retry')}
        </Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = <FinanceCardEmpty>{range ? s('empty') : s('emptyAll')}</FinanceCardEmpty>;
  } else {
    body = (
      <>
        {totals && <Totals totals={totals} language={i18n.language} oneAdmin={admin !== null} />}
        <ul className="flex flex-col" data-testid="salary-list">
          {rows.map((row) => (
            <Row key={row.id} row={row} language={i18n.language} onOpen={onOpen} />
          ))}
        </ul>
        {query.hasNextPage && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 self-center"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {s('showMore')}
          </Button>
        )}
      </>
    );
  }

  return (
    <FinanceCard
      title={title}
      titleId={titleId}
      className="flex-1"
      actions={
        <>
          {headerStart}
          <label htmlFor={adminId} className="sr-only">
            {s('admin')}
          </label>
          <Select
            id={adminId}
            value={admin ?? ''}
            onChange={(e) => setAdmin(e.target.value || null)}
            className="h-9 py-0 pr-9 pl-3 text-tiny"
          >
            <option value="">{s('allAdmins')}</option>
            {adminOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => onCreate(admin)}>
            {s('newButton')}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </FinanceCard>
  );
}

/** The totals: the whole per currency, then a line per admin and per month. */
function Totals({
  totals,
  language,
  oneAdmin,
}: {
  totals: SalaryTotals;
  language: string;
  oneAdmin: boolean;
}) {
  const { t } = useTranslation();
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`financeOrg.salaries.${key}`, options);
  const money = (m: { amountMinor: number; currency: 'EUR' | 'UAH' }) =>
    formatMoney(m, language, { whole: true });
  return (
    <div
      className="mb-3 flex flex-col gap-2 rounded-lg bg-muted p-3 text-tiny"
      data-testid="salary-totals"
    >
      {totals.total.map((x) => (
        <p key={x.currency} className="flex items-baseline justify-between gap-3 text-button">
          <span className="font-semibold">
            {s('total')} · {s('count', { count: x.count })}
          </span>
          <span className="font-semibold tabular-nums">{money(x)}</span>
        </p>
      ))}
      {!oneAdmin && totals.byAdmin.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-micro text-muted-foreground">{s('byAdmin')}</span>
          {totals.byAdmin.map((a) => (
            <p
              key={`${a.payeeId}:${a.amount.currency}`}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="truncate">
                {a.payeeName} · {s('count', { count: a.count })}
              </span>
              <span className="tabular-nums">{money(a.amount)}</span>
            </p>
          ))}
        </div>
      )}
      {totals.byMonth.length > 1 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-micro text-muted-foreground">{s('byMonth')}</span>
          {totals.byMonth.map((m) => (
            <p
              key={`${m.month}:${m.amount.currency}`}
              className="flex items-baseline justify-between gap-3"
            >
              <span>{formatMonth(m.month, language)}</span>
              <span className="tabular-nums">{money(m.amount)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  language,
  onOpen,
}: {
  row: Salary;
  language: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`financeOrg.salaries.${key}`, options);
  const extras = [
    row.fileCount > 0 ? s('filesCount', { count: row.fileCount }) : null,
    row.documentCount > 0 ? s('documentsCount', { count: row.documentCount }) : null,
  ].filter(Boolean);
  return (
    <li className="border-b border-border last:border-b-0" data-testid="salary-row">
      <button
        type="button"
        onClick={() => onOpen(row.id)}
        className="flex w-full items-start gap-3 py-2.5 text-left text-tiny hover:underline"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-button font-semibold">{row.payeeName}</span>
          <span className="text-muted-foreground">
            {formatMonth(row.month, language)}
            {extras.length > 0 && ` · ${extras.join(' · ')}`}
          </span>
          {row.note && <span className="truncate text-muted-foreground">{row.note}</span>}
        </span>
        <span className="font-semibold whitespace-nowrap tabular-nums">
          −{formatMoney(row.amount, language, { whole: true })}
        </span>
      </button>
    </li>
  );
}
