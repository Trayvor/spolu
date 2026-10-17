import { useQuery } from '@tanstack/react-query';
import { Outlet, useParams } from '@tanstack/react-router';
import { RouteFade } from '@/components/route-fade';
import { Skeleton } from '@/components/ui/skeleton';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { ChatTabBadge } from '@/features/chat/chat-tab-badge';
import { TasksTabBadge } from '@/features/tasks/tasks-tab-badge';
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

  if (!group) return <GroupFrameSkeleton />;
  return (
    <GroupRoomProvider joins={joins}>
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-col gap-2">
          <GroupHeader group={group} admin={admin} />
          <GroupTabs
            groupId={group.id}
            kind={group.kind}
            badges={{
              chat: <ChatTabBadge groupId={group.id} />,
              tasks: <TasksTabBadge groupId={group.id} />,
            }}
          />
        </div>
        {/* A tab switch fades the new tab in. */}
        <RouteFade level={3} className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </RouteFade>
      </div>
    </GroupRoomProvider>
  );
}

/** The group header and tab pills, grey, while the group loads (the loader usually has it). */
function GroupFrameSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <div className="flex h-11 items-center gap-3">
        <Skeleton className="size-8 rounded-lg bg-secondary" />
        <Skeleton className="h-6 w-48 bg-secondary" />
      </div>
      <div className="flex gap-2">
        {['w-16', 'w-[72px]', 'w-[76px]', 'w-[88px]', 'w-20'].map((width) => (
          <Skeleton key={width} className={`h-8 rounded-full bg-secondary ${width}`} />
        ))}
      </div>
    </div>
  );
}
