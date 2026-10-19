import { describe, expect, it } from 'vitest';
import { activeBoardFilter, matchesBoardFilter, setActiveBoardFilter } from './board-filter';
import { validateBoardSearch } from './board-search';

const ref = (
  projectId: string | null,
  eventId: string | null = null,
  assignees: string[] = [],
) => ({
  project: projectId ? { id: projectId, name: projectId, color: 'blue' as const } : null,
  event: eventId ? { id: eventId, name: eventId, occursOn: '2026-11-04' } : null,
  assignees: assignees.map((id) => ({ id, name: id })),
});

describe('board filter (Phase 33)', () => {
  it('the URL keeps short ids, and an event only under a chosen project', () => {
    expect(validateBoardSearch({ project: 'p1', event: 'e1' })).toEqual({
      project: 'p1',
      event: 'e1',
    });
    expect(validateBoardSearch({ event: 'e1' })).toEqual({ project: undefined, event: undefined });
    expect(validateBoardSearch({ project: 'none', event: 'none' })).toEqual({
      project: 'none',
      event: undefined,
    });
    expect(validateBoardSearch({ project: 'x'.repeat(101) }).project).toBeUndefined();
    expect(validateBoardSearch({ project: 5 }).project).toBeUndefined();
  });

  it('matches tasks by project, event and none', () => {
    expect(matchesBoardFilter(ref('p1', 'e1'), { project: 'p1' })).toBe(true);
    expect(matchesBoardFilter(ref('p2'), { project: 'p1' })).toBe(false);
    expect(matchesBoardFilter(ref(null), { project: 'none' })).toBe(true);
    expect(matchesBoardFilter(ref('p1'), { project: 'none' })).toBe(false);
    expect(matchesBoardFilter(ref('p1', 'e1'), { project: 'p1', event: 'e1' })).toBe(true);
    expect(matchesBoardFilter(ref('p1', 'e2'), { project: 'p1', event: 'e1' })).toBe(false);
    expect(matchesBoardFilter(ref('p1'), { project: 'p1', event: 'none' })).toBe(true);
    expect(matchesBoardFilter(ref('p1', 'e1'), { project: 'p1', event: 'none' })).toBe(false);
    expect(matchesBoardFilter(ref('p1', 'e1'), {})).toBe(true);
  });

  it('matches tasks by assignee: a person, me (the viewer) and none', () => {
    expect(validateBoardSearch({ assignee: 'u1' }).assignee).toBe('u1');
    expect(validateBoardSearch({ assignee: '' }).assignee).toBeUndefined();
    expect(matchesBoardFilter(ref(null, null, ['u1', 'u2']), { assignee: 'u2' })).toBe(true);
    expect(matchesBoardFilter(ref(null, null, ['u1']), { assignee: 'u2' })).toBe(false);
    expect(matchesBoardFilter(ref(null, null, ['u1']), { assignee: 'me' }, 'u1')).toBe(true);
    expect(matchesBoardFilter(ref(null, null, ['u2']), { assignee: 'me' }, 'u1')).toBe(false);
    expect(matchesBoardFilter(ref(null), { assignee: 'none' })).toBe(true);
    expect(matchesBoardFilter(ref(null, null, ['u1']), { assignee: 'none' })).toBe(false);
    expect(matchesBoardFilter(ref('p1', null, ['u1']), { project: 'p2', assignee: 'u1' })).toBe(
      false,
    );
  });

  it('an assignee alone is a filter too', () => {
    setActiveBoardFilter('g3', { assignee: 'none' });
    expect(activeBoardFilter('g3')).toEqual({ assignee: 'none' });
    setActiveBoardFilter('g3', {});
    expect(activeBoardFilter('g3')).toEqual({});
  });

  it('the active filter is per group; unfiltered forgets it', () => {
    setActiveBoardFilter('g1', { project: 'p1' });
    expect(activeBoardFilter('g1')).toEqual({ project: 'p1', event: undefined });
    expect(activeBoardFilter('g2')).toEqual({});
    setActiveBoardFilter('g1', {});
    expect(activeBoardFilter('g1')).toEqual({});
  });
});
