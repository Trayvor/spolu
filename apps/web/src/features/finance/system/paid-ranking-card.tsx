import { useId } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ENABLED_CURRENCIES, type Currency } from '@spolu/shared';
import type { FinanceView } from '../api';
import { FinanceCard } from '../finance-card';
import { useFinanceFormat } from '../format';
import type { MonthRange } from '../period';
import { SegmentedControl } from '../segmented-control';
import { RankingList } from './ranking-list';
import { logoUrl, paidRankingQuery } from './system-api';
import { useRememberedState } from '@/lib/use-remembered-filters';

/**
 * Clients by money paid (spec §6.2): the page period (null: all time, up to today); the
 * currency switch shows only once a second currency is enabled (owner decision 11: one currency
 * at a time, never summed). Rows: rank, client, amount paid, a bar, the share of the total.
 */
export function PaidRankingCard({ view, range }: { view: FinanceView; range: MonthRange | null }) {
  const { t, i18n } = useTranslation();
  const f = useFinanceFormat();
  const titleId = useId();
  const [saved, setSaved] = useRememberedState<Currency>(
    'finance.paidRanking.currency',
    ENABLED_CURRENCIES,
  );
  const currency = saved ?? ENABLED_CURRENCIES[0]!;
  const setCurrency = (next: Currency) => setSaved(next === ENABLED_CURRENCIES[0] ? null : next);
  const query = useInfiniteQuery(paidRankingQuery(view, { range, currency }));
  const pages = query.data?.pages ?? [];
  const total = pages[0]?.total ?? 0;
  const max = pages[0]?.max ?? 0;
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
