import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BoardEvents,
  TicketEvents,
  type BoardTaskDeletedEvent,
  type BoardTaskEvent,
  type TicketEventPayload,
} from '@spolu/shared';
import { getSocket } from '@/lib/socket';
import { projectsKey } from './api';
import { PROJECTS_REFETCH_DEBOUNCE_MS } from './use-project-events';

/**
 * Keeps the timeline's rows and the active cards live (spec §7.4): a task or ticket event of the
 * group (its room is joined by the group layout) refetches them, 2 s after the last event of a
 * burst. The projects card and the sheets follow `project:changed` (`useProjectEvents`).
 */
export function useWorkEvents(groupId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (eventGroupId: string | null) => {
      if (eventGroupId !== groupId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const kind of ['timeline', 'items', 'active']) {
          void queryClient.invalidateQueries({ queryKey: projectsKey(groupId, kind) });
        }
      }, PROJECTS_REFETCH_DEBOUNCE_MS);
    };
    const onTask = (event: BoardTaskEvent) => schedule(event.task.groupId);
    const onTaskDeleted = (event: BoardTaskDeletedEvent) => schedule(event.groupId);
    const onTicket = (event: TicketEventPayload) => schedule(event.groupId);
    socket.on(BoardEvents.task, onTask);
    socket.on(BoardEvents.taskDeleted, onTaskDeleted);
    for (const name of Object.values(TicketEvents)) socket.on(name, onTicket);
    return () => {
      clearTimeout(timer);
      socket.off(BoardEvents.task, onTask);
      socket.off(BoardEvents.taskDeleted, onTaskDeleted);
      for (const name of Object.values(TicketEvents)) socket.off(name, onTicket);
    };
  }, [groupId, queryClient]);
}
