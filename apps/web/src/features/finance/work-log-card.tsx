/* eslint-disable @typescript-eslint/no-unused-vars -- the props part C will use */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinanceView } from './api';
import { FinanceCard, FinanceCardEmpty } from './finance-card';

/**
 * Work log (spec §6.1): the hours by month and day, oldest at the top, with the period summary,
 * cost per admin and "+ Add time". One client (`group`) or many (`all`).
 * Part C owns this file; part A1 leaves a placeholder.
 */
export function WorkLogCard(_props: { view: FinanceView }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <FinanceCard title={t('finance.cards.workLog')} titleId={titleId} className="flex-1">
      <FinanceCardEmpty>{t('finance.cards.workLogSoon')}</FinanceCardEmpty>
    </FinanceCard>
  );
}
