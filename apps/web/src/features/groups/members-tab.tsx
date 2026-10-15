import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupQuery } from './api';
import { InviteBox } from './invite-box';
import { MembersList } from './members-list';

/** The invite link (admins) and the members. */
export function MembersTab() {
  const { groupId } = useParams({ strict: false });
  const admin = isAdmin(useSession());
  const { data: group } = useQuery({ ...groupQuery(groupId ?? ''), enabled: !!groupId });
  if (!group) return null;
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      {admin && group.inviteUrl && <InviteBox groupId={group.id} inviteUrl={group.inviteUrl} />}
      <MembersList groupId={group.id} admin={admin} />
    </div>
  );
}
