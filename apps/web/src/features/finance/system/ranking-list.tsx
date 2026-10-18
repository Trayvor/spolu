import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/skeleton';
import { RankBar } from '../charts/rank-bar';
import { FinanceCardEmpty } from '../finance-card';
import { ClientMark } from './client-mark';

export type RankingItem = {
  key: string;
  rank: number;
  name: string;
  logoUrl: string | null;
  /** The bar's value against `max`. */
  value: number;
  /** The number on the right (formatted). */
  primary: string;
  /** A quieter line under it (share, cost, minutes without a rate). */
  secondary?: ReactNode;
};

/**
 * One ranking's rows (spec §6.2): an ordered list — the rank is a real order, so it is the list's
 * number — with the client's logo and name, a proportional bar (decorative, ADR 0028) and the
 * value in tabular figures. Equal values share a rank. "Show 20 more" loads the next page.
 */
export function RankingList({
  state,
  items,
  max,
  tone,
  empty,
  hasMore,
  loadingMore,
  onMore,
  onRetry,
}: {
  state: 'pending' | 'error' | 'success';
  items: RankingItem[];
  max: number;
  tone: 'solid' | 'cost';
  empty: string;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (state === 'pending') {
    return (
      <div aria-busy="true">
        <ListSkeleton rows={5} />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="m-auto flex flex-col items-center gap-3 py-8 text-center">
        <p role="alert" className="text-button text-muted-foreground">
          {t('financeSystem.loadFailed')}
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('financeSystem.retry')}
        </Button>
      </div>
    );
  }
  if (items.length === 0) return <FinanceCardEmpty>{empty}</FinanceCardEmpty>;
  return (
    <div className="flex flex-col gap-3">
      <ol role="list" className="flex flex-col">
        {items.map((item) => (
          <li
            key={item.key}
            className="grid grid-cols-[2rem_1fr_auto] items-center gap-x-3 gap-y-1.5 py-2"
            data-testid="ranking-row"
          >
            <span className="text-right text-button font-semibold text-muted-foreground tabular-nums">
              {item.rank}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <ClientMark name={item.name} logoUrl={item.logoUrl} />
              <span className="truncate text-button font-semibold">{item.name}</span>
            </span>
            <span className="text-right text-button font-semibold whitespace-nowrap tabular-nums">
              {item.primary}
            </span>
            <span className="col-start-2">
              <RankBar value={item.value} max={max} tone={tone} />
            </span>
            <span className="text-right text-tiny whitespace-nowrap text-muted-foreground tabular-nums">
              {item.secondary}
            </span>
          </li>
        ))}
      </ol>
      {hasMore && (
        <Button
          variant="secondary"
          size="sm"
          className="self-center"
          disabled={loadingMore}
          onClick={onMore}
        >
          {t('financeSystem.showMore')}
        </Button>
      )}
    </div>
  );
}
