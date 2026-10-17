import { useId, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/select';
import { useRememberedState } from '@/lib/use-remembered-filters';
import type { FinanceView } from '../api';
import { FinanceCard } from '../finance-card';
import { useFinanceFormat } from '../format';
import { ratesQuery } from '../log-api';
import type { Period } from '../period';
import { PeriodSelect, usePeriod } from '../period-select';
import { SegmentedControl } from '../segmented-control';
import { RankingList } from './ranking-list';
import { hoursRankingQuery, logoUrl } from './system-api';

/** The ranking's periods (decision 18: this year first); a ranking needs a bounded range. */
export const RANKING_PERIODS: readonly Period[] = [
  'thisYear',
  'lastYear',
  'thisMonth',
  'lastMonth',
  'custom',
];

const SORTS = ['hours', 'cost'] as const;

/**
 * Clients by hours (spec §6.2): a period, an admin filter (all admins or one) and a Hours ·
 * Money switch that ranks by the hours or by their cost (hours × rates; minutes without a rate
 * count nothing and are named). On the all-clients view the time without a client ranks as one
 * row, "Without client" (owner decision 24).
 */
export function HoursRankingCard({ view }: { view: FinanceView }) {
  const { t } = useTranslation();
  const f = useFinanceFormat();
  const titleId = useId();
  const adminId = useId();
  const period = usePeriod('finance.hoursRanking.period', RANKING_PERIODS);
  const [savedSort, setSort] = useRememberedState('finance.hoursRanking.sort', SORTS);
  const sort = savedSort ?? 'hours';
  const [chosenAdmin, setAdmin] = useState<string | null>(null);
  const admins = useQuery(ratesQuery(view)).data?.admins ?? [];
  const admin = admins.some((a) => a.userId === chosenAdmin) ? chosenAdmin : null;
  const range = period.range;
  const query = useInfiniteQuery({
    ...hoursRankingQuery(view, {
      range: range ?? { from: '2000-01', to: '2000-01' },
      admin,
      sort,
    }),
    enabled: range !== null,
  });
  const pages = query.data?.pages ?? [];
  const noClient = t('financeSystem.noClient');

  return (
    <FinanceCard
      title={t('finance.cards.hoursRanking')}
      titleId={titleId}
      className="min-h-[280px]"
      actions={
        <SegmentedControl
          label={t('financeSystem.hours.rankBy')}
          value={sort}
          onChange={(next) => setSort(next === 'hours' ? null : next)}
          options={SORTS.map((s) => ({ value: s, label: t(`financeSystem.hours.${s}`) }))}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <PeriodSelect state={period} />
        <label htmlFor={adminId} className="sr-only">
          {t('financeSystem.hours.admin')}
        </label>
        <Select
          id={adminId}
          value={admin ?? ''}
          onChange={(e) => setAdmin(e.target.value || null)}
          className="h-9 py-0 pr-9 pl-3 text-tiny"
        >
          <option value="">{t('financeSystem.hours.allAdmins')}</option>
          {admins.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>
      <RankingList
        state={range === null ? 'success' : query.status}
        tone={sort === 'cost' ? 'cost' : 'solid'}
        max={pages[0]?.max ?? 0}
        empty={t('financeSystem.hours.empty')}
        hasMore={query.hasNextPage}
        loadingMore={query.isFetchingNextPage}
        onMore={() => void query.fetchNextPage()}
        onRetry={() => void query.refetch()}
        items={pages.flatMap((page) =>
          page.rows.map((row) => {
            const cost = row.cost === null ? null : f.money(row.cost);
            const hours = f.duration(row.minutes);
            return {
              key: row.groupId ?? '',
              rank: row.rank,
              name: row.groupId === null ? noClient : row.groupName,
              logoUrl: logoUrl(row),
              value: sort === 'cost' ? (row.cost ?? 0) : row.minutes,
              primary: sort === 'cost' ? (cost ?? '–') : hours,
              secondary: (
                <>
                  {sort === 'cost' ? hours : cost}
                  {row.missingRateMinutes > 0 && (
                    <span className="block">
                      {t('financeSystem.hours.missingRate', {
                        hours: f.duration(row.missingRateMinutes),
                      })}
                    </span>
                  )}
                </>
              ),
            };
          }),
        )}
      />
    </FinanceCard>
  );
}
