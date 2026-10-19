import type { TaskDto } from '@spolu/shared';
import type { BoardSearch } from './board-search';

/**
 * The board filter each group's board shows now (Phase 33 part P2; the Assignee filter from
 * 2026-10-19). The board writes it while it renders (`setActiveBoardFilter`), so every reader of
 * `boardQuery(groupId)` (the panels, drops, live events) addresses the board entry on screen.
 * Unfiltered is `{}`. `viewerId` is who `assignee=me` means, for matching live edits.
 */
type ActiveFilter = { filter: BoardSearch; viewerId: string | null };
const active = new Map<string, ActiveFilter>();

/** Whether any of the board's filters is set. */
export function isBoardFiltered(filter: BoardSearch): boolean {
  return filter.project !== undefined || filter.assignee !== undefined;
}

export function setActiveBoardFilter(
  groupId: string,
  filter: BoardSearch,
  viewerId: string | null = null,
): void {
  if (!isBoardFiltered(filter)) active.delete(groupId);
  else
    active.set(groupId, {
      filter: { project: filter.project, event: filter.event, assignee: filter.assignee },
      viewerId,
    });
}

export function activeBoardFilter(groupId: string): BoardSearch {
  return active.get(groupId)?.filter ?? {};
}

/** Who `assignee=me` is on the group's active filter (null when unknown). */
export function activeBoardViewer(groupId: string): string | null {
  return active.get(groupId)?.viewerId ?? null;
}

/** The filter as query params (`project`, `event`, `assignee`); empty when unfiltered. */
export function boardFilterParams(filter: BoardSearch): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.project) params.set('project', filter.project);
  if (filter.event) params.set('event', filter.event);
  if (filter.assignee) params.set('assignee', filter.assignee);
  return params;
}

/**
 * Whether a task belongs on a board with this filter (a live edit may move it out).
 * `viewerId` is who `assignee=me` means; unknown, a `me` filter keeps every task.
 */
export function matchesBoardFilter(
  task: Pick<TaskDto, 'project' | 'event' | 'assignees'>,
  filter: BoardSearch,
  viewerId: string | null = null,
): boolean {
  const projectId = task.project?.id ?? null;
  const eventId = task.event?.id ?? null;
  if (filter.project === 'none' && projectId !== null) return false;
  if (filter.project && filter.project !== 'none' && projectId !== filter.project) return false;
  if (filter.event === 'none' && eventId !== null) return false;
  if (filter.event && filter.event !== 'none' && eventId !== filter.event) return false;
  const assignee = filter.assignee === 'me' ? viewerId : filter.assignee;
  if (assignee === 'none' && task.assignees.length > 0) return false;
  if (assignee && assignee !== 'none' && !task.assignees.some((p) => p.id === assignee))
    return false;
  return true;
}
