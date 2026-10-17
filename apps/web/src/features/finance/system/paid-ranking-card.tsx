import { useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ENABLED_CURRENCIES, type Currency } from '@spolu/shared';
import { Select } from '@/components/ui/select';
import type { FinanceView } from '../api';
import { FinanceCard } from '../finance-card';
import { useFinanceFormat } from '../format';
import { currentMonth } from '../period';
import { SegmentedControl } from '../segmented-control';
import { RankingList } from './ranking-list';
import { logoUrl, paidRankingQuery } from './system-api';

/** The years the select offers: next year back to six years ago. */
export function paidYears(now: Date = new Date()): number[] {
  const year = Number(currentMonth(now).slice(0, 4));
  return Array.from({ length: 8 }, (_, i) => year + 1 - i);
}

/**
 * Clients by money paid (spec §6.2): a year (default this year) and an optional month; the
 * currency switch shows only once a second currency is enabled (owner decision 11: one currency
 * at a time, never summed). Rows: rank, client, amount paid, a bar, the share of the total.
 */
export function PaidRankingCard({ view }: { view: FinanceView }) {
  const { t, i18n } = useTranslation();
  const f = useFinanceFormat();
  const titleId = useId();
  const yearId = useId();
  const monthId = useId();
  const [year, setYear] = useState(() => Number(currentMonth().slice(0, 4)));
  const [month, setMonth] = useState<number | null>(null);
  const [currency, setCurrency] = useState<Currency>(ENABLED_CURRENCIES[0]!);
  const query = useInfiniteQuery(paidRankingQuery(view, { year, month, currency }));
  const pages = query.data?.pages ?? [];
  const total = pages[0]?.total ?? 0;
  const max = pages[0]?.max ?? 0;
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, i, 1)),
    ),
  );
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1,
  });

  return (
    <FinanceCard
      title={t('finance.cards.paidRanking')}
      titleId={titleId}
      className="min-h-[280px]"
      actions={
        <>
          {ENABLED_CURRENCIES.length > 1 && (
            <SegmentedControl
              label={t('financeSystem.paid.currency')}
              value={currency}
              onChange={setCurrency}
              options={ENABLED_CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          )}
          <label htmlFor={yearId} className="sr-only">
            {t('financeSystem.paid.year')}
          </label>
          <Select
            id={yearId}
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 py-0 pr-9 pl-3 text-tiny"
          >
            {paidYears().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <label htmlFor={monthId} className="sr-only">
            {t('financeSystem.paid.month')}
          </label>
          <Select
            id={monthId}
            value={month === null ? '' : String(month)}
            onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : null)}
            className="h-9 py-0 pr-9 pl-3 text-tiny"
          >
            <option value="">{t('financeSystem.paid.wholeYear')}</option>
            {monthNames.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </Select>
        </>
      }
    >
      {query.isSuccess && total > 0 && (
        <p className="pb-2 text-tiny text-muted-foreground tabular-nums">
          {t('financeSystem.paid.total', { amount: f.money(total, currency) })}
        </p>
      )}
      <RankingList
        state={query.status}
        tone="solid"
        max={max}
        empty={t('financeSystem.paid.empty')}
        hasMore={query.hasNextPage}
        loadingMore={query.isFetchingNextPage}
        onMore={() => void query.fetchNextPage()}
        onRetry={() => void query.refetch()}
        items={pages.flatMap((page) =>
          page.rows.map((row) => ({
            key: row.groupId,
            rank: row.rank,
            name: row.groupName,
            logoUrl: logoUrl(row),
            value: row.amountMinor,
            primary: f.money(row.amountMinor, currency),
            secondary: total > 0 ? percent.format(row.amountMinor / total) : undefined,
          })),
        )}
      />
    </FinanceCard>
  );
}
