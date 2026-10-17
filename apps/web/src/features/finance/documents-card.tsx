/* eslint-disable @typescript-eslint/no-unused-vars -- the props part B will use */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { FinanceCard, FinanceCardEmpty } from './finance-card';

/**
 * Documents (spec §6.1): one client's contracts, documents, notes and folders.
 * Part B owns this file; part A1 leaves a placeholder.
 */
export function DocumentsCard(_props: { groupId: string }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <FinanceCard title={t('finance.cards.documents')} titleId={titleId} className="flex-1">
      <FinanceCardEmpty>{t('finance.cards.documentsSoon')}</FinanceCardEmpty>
    </FinanceCard>
  );
}
