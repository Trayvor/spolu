import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GroupEvents, type GroupManagersEvent, type GroupSummary, type Me } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { notificationModesQuery } from '@/features/notifications/api';
import { getSocket } from '@/lib/socket';
import { groupsQuery } from './api';

/**
 * Listens for `group:managers` (sent to the admins room and the group's room) for the whole
 * signed-in session; mounted once in the authed layout. Refreshes the group's people (the
 * pickers), patches the groups list if it is loaded (`managers`, and `managedByMe` from the
 * session id), and refetches the notification modes when the signed-in user was added or
 * removed (becoming a manager can change their mode there).
 */
export function useManagerEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    function onManagers({ groupId, managers }: GroupManagersEvent) {
      void queryClient.invalidateQueries({ queryKey: ['groups', groupId, 'people'] });
      const me = queryClient.getQueryData<Me | null>(sessionQuery.queryKey);
      if (!me) return;
      const managedByMe = managers.some((m) => m.id === me.id);
      const groups = queryClient.getQueryData<GroupSummary[]>(groupsQuery.queryKey);
      const entry = groups?.find((g) => g.id === groupId);
      if (groups && entry) {
        queryClient.setQueryData<GroupSummary[]>(
          groupsQuery.queryKey,
          groups.map((g) => (g.id === groupId ? { ...g, managers, managedByMe } : g)),
        );
      }
      // Without the list we cannot tell whether I changed: refetch to be safe (admins only).
      const meChanged = entry ? entry.managedByMe !== managedByMe : me.role !== 'client';
      if (meChanged)
        void queryClient.invalidateQueries({ queryKey: notificationModesQuery.queryKey });
    }
    socket.on(GroupEvents.managers, onManagers);
    return () => {
      socket.off(GroupEvents.managers, onManagers);
    };
  }, [queryClient]);
}
