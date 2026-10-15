import { useQuery } from '@tanstack/react-query';
import { Outlet, useParams } from '@tanstack/react-router';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupQuery } from './api';
import { GroupHeader } from './group-header';
import { GroupTabs } from './group-tabs';
import { GroupRoomProvider, useGroupRoom } from './use-group-room';

export function GroupLayout() {
  const { groupId } = useParams({ strict: false });
  return groupId ? <GroupFrame groupId={groupId} /> : null;
}

/** Header and tabs of one group; keeps the socket in the group's room for every tab. */
function GroupFrame({ groupId }: { groupId: string }) {
  const admin = isAdmin(useSession());
  const { data: group } = useQuery(groupQuery(groupId));
  const joins = useGroupRoom(groupId);

  if (!group) return null;
  return (
    <GroupRoomProvider joins={joins}>
      <div className="flex flex-col gap-4">
        <GroupHeader group={group} admin={admin} />
        <GroupTabs groupId={group.id} />
        <Outlet />
      </div>
    </GroupRoomProvider>
  );
}
