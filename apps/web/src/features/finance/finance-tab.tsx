import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/use-session';
import { groupQuery } from '@/features/groups/api';
import { NotFoundPage } from '@/routes/not-found';
import { DocumentsCard } from './documents-card';
import { ORG_OWNER } from './documents/api';
import { FinanceGrid } from './finance-grid';
import { OverviewCard } from './overview-card';
import { useFinanceEvents } from './use-finance-events';
import { WorkLogCard } from './work-log-card';

/**
 * A group's Financie tab (`/groups/$groupId/finance`, Phase 32): the three cards for finance
 * admins only. The route answers not-found to anyone else; a right removed while the tab is
 * open (`me:changed`) turns it into the not-found screen too. The server refuses every finance
 * route anyway.
 *
 * The admin group "eGrant tím" (Phase 34 part E, reconciled with Phase 32 E) keeps no finance
 * store of its own: its tab is the organisation's. The Documents card is `/finance`'s
 * **Organizácia** view (the organisation's items and folders, expenses included), the Overview
 * adds the organisation's expenses to the internal time, the Work log is the time on its tasks.
 */
export function FinanceTab() {
  const { groupId } = useParams({ strict: false });
  const finance = useSession()?.finance === true;
  if (!groupId || !finance) return <NotFoundPage />;
  return <FinanceTabCards groupId={groupId} />;
}

function FinanceTabCards({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const kind = useQuery(groupQuery(groupId)).data?.kind;
  const view = { kind: 'group', groupId } as const;
  const admin = kind === 'admin';
  useFinanceEvents(view);
  // Until the group is known, nothing: a client's Documents card would ask the admin group's
  // own items, which the server refuses (`409 admin_group`).
  if (kind === undefined) return null;
  return (
    <FinanceGrid
      screen="tab"
      overview={<OverviewCard view={view} />}
      documents={
        admin ? (
          <DocumentsCard owner={ORG_OWNER} title={t('financeOrg.card.organisation')} />
        ) : (
          <DocumentsCard owner={view} />
        )
      }
      workLog={<WorkLogCard view={view} />}
    />
  );
}
