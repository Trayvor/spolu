import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { groupsQuery } from '@/features/groups/api';
import { NotFoundPage } from '@/routes/not-found';
import type { FinanceView } from './api';
import { FinanceGrid } from './finance-grid';
import { OverviewCard } from './overview-card';
import { PAGE_PERIODS } from './period';
import { PeriodSelect, usePeriod } from './period-select';
import { FinanceClientFilter, useFinanceClients } from './system/client-filter';
import { ItemsCard } from './system/items-card';
import { RankingsRow } from './system/rankings-row';
import { useFinanceEvents } from './use-finance-events';
import { WorkLogCard } from './work-log-card';

const RatesDialog = lazy(() => import('./rates-dialog').then((m) => ({ default: m.RatesDialog })));

/**
 * The system-wide page `/finance` (Phase 32, spec §6.2): the client filter (every client by
 * default, remembered), one page period (this year by default, remembered) that drives every
 * card, and the Hourly rates button; then the same grid across the chosen clients (Overview,
 * Items — the ledger and the organisation's own items, Phase 32 E —, Work log with "Add time"
 * and its client picker) and the rankings under it.
 */
export function FinancePage() {
  const finance = useSession()?.finance === true;
  if (!finance) return <NotFoundPage />;
  return <FinancePageCards />;
}

function FinancePageCards() {
  const { t } = useTranslation();
  const [stored, setClients] = useFinanceClients();
  const groups = useQuery(groupsQuery).data;
  // Clients deleted since they were chosen drop out; none left means every client.
  const clients = useMemo(() => {
    if (!groups) return stored;
    const known = new Set(groups.map((g) => g.id));
    return stored.filter((id) => known.has(id));
  }, [groups, stored]);
  const view: FinanceView = useMemo(() => ({ kind: 'all', clients }), [clients]);
  const period = usePeriod('finance.page.period', PAGE_PERIODS);
  const [rates, setRates] = useState(false);
  useFinanceEvents(view);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-medium leading-tight font-semibold min-[641px]:text-large">
          {t('finance.pageTitle')}
        </h1>
        <Button variant="secondary" size="sm" onClick={() => setRates(true)}>
          {t('financeSystem.rates')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="finance-filters">
        <FinanceClientFilter clients={clients} onChange={setClients} />
        <PeriodSelect state={period} label={t('financeSystem.period')} />
      </div>
      <FinanceGrid
        screen="page"
        overview={<OverviewCard view={view} period={period} />}
        documents={<ItemsCard view={view} range={period.range} />}
        workLog={<WorkLogCard view={view} period={period} />}
        rankings={<RankingsRow view={view} range={period.range} />}
        labels={{ documents: t('financeOrg.card.title') }}
      />
      <Suspense fallback={null}>
        {rates && <RatesDialog view={view} onClose={() => setRates(false)} />}
      </Suspense>
    </div>
  );
}
