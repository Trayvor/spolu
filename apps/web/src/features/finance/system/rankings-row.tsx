/* eslint-disable @typescript-eslint/no-unused-vars -- the props part D will use */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinanceView } from '../api';
import { FinanceCard, FinanceCardEmpty } from '../finance-card';

/**
 * The rankings under the grid of `/finance` (spec §6.2): clients by money paid and by hours or
 * cost, 50/50 (stacked on phones, where the page shows them as the "Rankings" segment).
 * Part D owns this file; part A1 leaves placeholders.
 */
export function RankingsRow(_props: { view: FinanceView }) {
  const { t } = useTranslation();
  const paidId = useId();
  const hoursId = useId();
  return (
    <div className="grid gap-4 min-[641px]:grid-cols-2">
      <FinanceCard
        title={t('finance.cards.paidRanking')}
        titleId={paidId}
        className="min-h-[280px]"
      >
        <FinanceCardEmpty>{t('finance.cards.paidRankingSoon')}</FinanceCardEmpty>
      </FinanceCard>
      <FinanceCard
        title={t('finance.cards.hoursRanking')}
        titleId={hoursId}
        className="min-h-[280px]"
      >
        <FinanceCardEmpty>{t('finance.cards.hoursRankingSoon')}</FinanceCardEmpty>
      </FinanceCard>
    </div>
  );
}
