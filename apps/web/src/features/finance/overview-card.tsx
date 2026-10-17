/* eslint-disable @typescript-eslint/no-unused-vars -- the props part C will use */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinanceView } from './api';
import { FinanceCard, FinanceCardEmpty } from './finance-card';

/**
 * Overview (spec §6.1): money paid and to be paid by contract, the cost of the work, hours per
 * admin; a Money · Hours switch and the period filter. One client (`group`) or many (`all`).
 * Part C owns this file; part A1 leaves a placeholder.
 */
export function OverviewCard(_props: { view: FinanceView }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <FinanceCard title={t('finance.cards.overview')} titleId={titleId} className="flex-1">
      <FinanceCardEmpty>{t('finance.cards.overviewSoon')}</FinanceCardEmpty>
    </FinanceCard>
  );
}
