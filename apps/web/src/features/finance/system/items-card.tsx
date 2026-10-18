import { useTranslation } from 'react-i18next';
import { useRememberedState } from '@/lib/use-remembered-filters';
import type { FinanceView } from '../api';
import { DocumentsCard } from '../documents-card';
import { ORG_OWNER } from '../documents/api';
import type { MonthRange } from '../period';
import { SegmentedControl } from '../segmented-control';
import { ContractsCard } from './contracts-card';

const VIEWS = ['ledger', 'organisation'] as const;
type View = (typeof VIEWS)[number];

/**
 * `/finance`'s bottom-left card (Phase 32 E, decision E12), **Položky**: two views under one
 * title, the choice remembered per person. **Prehľad** is the ledger of every item of the chosen
 * clients (and, with every client, of the organisation) with its type filter; **Organizácia**
 * is the organisation's own items in its folders, like a client's Documents card. Both offer
 * "+ New" with expenses.
 */
export function ItemsCard({ view, range }: { view: FinanceView; range: MonthRange | null }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useRememberedState<View>('finance.items.view', VIEWS);
  const shown = saved ?? 'ledger';
  const switcher = (
    <SegmentedControl
      label={t('financeOrg.card.views')}
      options={VIEWS.map((value) => ({ value, label: t(`financeOrg.card.${value}`) }))}
      value={shown}
      onChange={(next) => setSaved(next === 'ledger' ? null : next)}
      className="w-[220px]"
    />
  );
  const title = t('financeOrg.card.title');
  return shown === 'ledger' ? (
    <ContractsCard view={view} range={range} title={title} headerStart={switcher} />
  ) : (
    <DocumentsCard owner={ORG_OWNER} title={title} headerStart={switcher} />
  );
}
