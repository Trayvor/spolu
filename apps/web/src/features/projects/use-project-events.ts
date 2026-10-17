import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ProjectEvents, type ProjectChangedEvent } from '@spolu/shared';
import { getSocket } from '@/lib/socket';
import { projectsKey } from './api';

export const PROJECTS_REFETCH_DEBOUNCE_MS = 2000;

/**
 * Keeps the client's projects live (Phase 33, spec §8): `project:changed` in the group's room
 * refetches every `['projects', groupId, …]` query, 2 s after the last event of a burst.
 */
export function useProjectEvents(groupId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = (event: ProjectChangedEvent) => {
      if (event.groupId !== groupId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: projectsKey(groupId) });
      }, PROJECTS_REFETCH_DEBOUNCE_MS);
    };
    socket.on(ProjectEvents.changed, onChanged);
    return () => {
      clearTimeout(timer);
      socket.off(ProjectEvents.changed, onChanged);
    };
  }, [groupId, queryClient]);
}
