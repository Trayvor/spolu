import { describe, expect, it } from 'vitest';
import { activeBoardFilter, matchesBoardFilter, setActiveBoardFilter } from './board-filter';
import { validateBoardSearch } from './board-search';

const ref = (projectId: string | null, eventId: string | null = null) => ({
  project: projectId ? { id: projectId, name: projectId, color: 'blue' as const } : null,
  event: eventId ? { id: eventId, name: eventId, occursOn: '2026-11-04' } : null,
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

  it('the active filter is per group; unfiltered forgets it', () => {
    setActiveBoardFilter('g1', { project: 'p1' });
    expect(activeBoardFilter('g1')).toEqual({ project: 'p1', event: undefined });
    expect(activeBoardFilter('g2')).toEqual({});
    setActiveBoardFilter('g1', {});
    expect(activeBoardFilter('g1')).toEqual({});
  });
});
