import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/use-session';
import { NotFoundPage } from '@/routes/not-found';
import type { FinanceView } from './api';
import { FinanceGrid } from './finance-grid';
import { OverviewCard } from './overview-card';
import { ContractsCard } from './system/contracts-card';
import { RankingsRow } from './system/rankings-row';
import { useFinanceEvents } from './use-finance-events';
import { WorkLogCard } from './work-log-card';

/**
 * The system-wide page `/finance` (Phase 32, spec §6.2): the same grid across clients (Overview,
 * Contracts, Work log) and the rankings under it. Part D adds the client and period filters
 * (in `system/`) and the rates button; part A1 lays out the page.
 */
export function FinancePage() {
  const finance = useSession()?.finance === true;
  if (!finance) return <NotFoundPage />;
  return <FinancePageCards />;
}

function FinancePageCards() {
  const { t } = useTranslation();
  // Part D replaces the empty client filter (all clients, remembered per person).
  const view: FinanceView = { kind: 'all', clients: [] };
  useFinanceEvents(view);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-medium leading-tight font-semibold min-[641px]:text-large">
        {t('finance.pageTitle')}
      </h1>
      <FinanceGrid
        screen="page"
        overview={<OverviewCard view={view} />}
        documents={<ContractsCard view={view} />}
        workLog={<WorkLogCard view={view} />}
        rankings={<RankingsRow view={view} />}
        labels={{ documents: t('finance.segments.contracts') }}
      />
    </div>
  );
}
