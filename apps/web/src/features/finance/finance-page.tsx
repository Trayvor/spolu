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
import { FinanceClientFilter, useFinanceClients } from './system/client-filter';
import { ContractsCard } from './system/contracts-card';
import { RankingsRow } from './system/rankings-row';
import { useFinanceEvents } from './use-finance-events';
import { WorkLogCard } from './work-log-card';

const RatesDialog = lazy(() => import('./rates-dialog').then((m) => ({ default: m.RatesDialog })));

/**
 * The system-wide page `/finance` (Phase 32, spec §6.2): the client filter (every client by
 * default, remembered) and the Hourly rates button, then the same grid across the chosen clients
 * (Overview, Contracts, Work log) and the rankings under it. Each card keeps its own period, as
 * on a client's tab; the hours ranking has its own (this year by default).
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
      </div>
      <FinanceGrid
        screen="page"
        overview={<OverviewCard view={view} />}
        documents={<ContractsCard view={view} />}
        workLog={<WorkLogCard view={view} />}
        rankings={<RankingsRow view={view} />}
        labels={{ documents: t('finance.segments.contracts') }}
      />
      <Suspense fallback={null}>
        {rates && <RatesDialog view={view} onClose={() => setRates(false)} />}
      </Suspense>
    </div>
  );
}
