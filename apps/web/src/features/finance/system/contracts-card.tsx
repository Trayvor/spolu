/* eslint-disable @typescript-eslint/no-unused-vars -- the props part D will use */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinanceView } from '../api';
import { FinanceCard, FinanceCardEmpty } from '../finance-card';

/**
 * Contracts across clients (spec §6.2, decision 16): the table with its search over every
 * finance document and note of the chosen clients.
 * Part D owns this file; part A1 leaves a placeholder.
 */
export function ContractsCard(_props: { view: FinanceView }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <FinanceCard title={t('finance.cards.contracts')} titleId={titleId} className="flex-1">
      <FinanceCardEmpty>{t('finance.cards.contractsSoon')}</FinanceCardEmpty>
    </FinanceCard>
  );
}
