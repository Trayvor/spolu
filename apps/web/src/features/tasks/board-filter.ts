import type { TaskDto } from '@spolu/shared';
import type { BoardSearch } from './board-search';

/**
 * The board filter each group's board shows now (Phase 33 part P2). The board writes it while it
 * renders (`setActiveBoardFilter`), so every reader of `boardQuery(groupId)` (the panels, drops,
 * live events) addresses the board entry on screen. Unfiltered is `{}`.
 */
const active = new Map<string, BoardSearch>();

export function setActiveBoardFilter(groupId: string, filter: BoardSearch): void {
  if (filter.project === undefined) active.delete(groupId);
  else active.set(groupId, { project: filter.project, event: filter.event });
}

export function activeBoardFilter(groupId: string): BoardSearch {
  return active.get(groupId) ?? {};
}

/** The filter as query params (`project`, `event`); empty when unfiltered. */
export function boardFilterParams(filter: BoardSearch): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.project) params.set('project', filter.project);
  if (filter.event) params.set('event', filter.event);
  return params;
}

/** Whether a task belongs on a board with this filter (a live edit may move it out). */
export function matchesBoardFilter(
  task: Pick<TaskDto, 'project' | 'event'>,
  filter: BoardSearch,
): boolean {
  const projectId = task.project?.id ?? null;
  const eventId = task.event?.id ?? null;
  if (filter.project === 'none' && projectId !== null) return false;
  if (filter.project && filter.project !== 'none' && projectId !== filter.project) return false;
  if (filter.event === 'none' && eventId !== null) return false;
  if (filter.event && filter.event !== 'none' && eventId !== filter.event) return false;
  return true;
}
