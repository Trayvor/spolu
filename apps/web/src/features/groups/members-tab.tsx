import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AuditHistoryLink } from '@/features/audit/history-item';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { Skeleton } from '@/components/ui/skeleton';
import { groupQuery } from './api';
import { InviteBox } from './invite-box';
import { ManagersSection } from './managers-section';
import { MembersList } from './members-list';
import { RequestersList } from './requesters-list';

/** The invite link (admins), the group's eGrant managers, the members and the requesters. */
export function MembersTab() {
  const { groupId } = useParams({ strict: false });
  const { t } = useTranslation();
  const admin = isAdmin(useSession());
  const { data: group } = useQuery({ ...groupQuery(groupId ?? ''), enabled: !!groupId });
  if (!group) return <Skeleton className="h-40 rounded-xl bg-card" />;
  return (
    <div className="flex flex-col gap-6">
      {admin && (
        <div className="flex justify-end">
          <AuditHistoryLink search={{ group: group.id }} text={t('group.members.history')} />
        </div>
      )}
      {admin && group.inviteUrl && <InviteBox groupId={group.id} inviteUrl={group.inviteUrl} />}
      <ManagersSection groupId={group.id} />
      <MembersList groupId={group.id} admin={admin} />
      <RequestersList groupId={group.id} admin={admin} />
    </div>
  );
}
