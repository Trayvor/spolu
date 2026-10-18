import { useParams } from '@tanstack/react-router';
import { useSession } from '@/features/auth/use-session';
import { NotFoundPage } from '@/routes/not-found';
import { DocumentsCard } from './documents-card';
import { FinanceGrid } from './finance-grid';
import { OverviewCard } from './overview-card';
import { useFinanceEvents } from './use-finance-events';
import { WorkLogCard } from './work-log-card';

/**
 * A client's Financie tab (`/groups/$groupId/finance`, Phase 32): the three cards for finance
 * admins only. The route answers not-found to anyone else; a right removed while the tab is
 * open (`me:changed`) turns it into the not-found screen too. The server refuses every finance
 * route anyway.
 */
export function FinanceTab() {
  const { groupId } = useParams({ strict: false });
  const finance = useSession()?.finance === true;
  if (!groupId || !finance) return <NotFoundPage />;
  return <FinanceTabCards groupId={groupId} />;
}

function FinanceTabCards({ groupId }: { groupId: string }) {
  const view = { kind: 'group', groupId } as const;
  useFinanceEvents(view);
  return (
    <FinanceGrid
      screen="tab"
      overview={<OverviewCard view={view} />}
      documents={<DocumentsCard owner={view} />}
      workLog={<WorkLogCard view={view} />}
    />
  );
}
