import { describe, expect, it } from 'vitest';
import {
  BoardDoneQuerySchema,
  BoardQuerySchema,
  GlobalBoardFilterSchema,
  isValidGlobalProjectFilter,
  isValidProjectFilter,
  TicketListQuerySchema,
  TicketProjectBodySchema,
} from '../index.js';

describe('project filters', () => {
  it('the board, its done page and the ticket list take project and event', () => {
    expect(BoardQuerySchema.parse({ project: 'p1', event: 'none' })).toMatchObject({
      project: 'p1',
      event: 'none',
    });
    expect(BoardDoneQuerySchema.parse({ after: 'a', project: 'none' }).project).toBe('none');
    expect(TicketListQuerySchema.parse({ project: 'p1', event: 'e1' })).toMatchObject({
      project: 'p1',
      event: 'e1',
    });
    expect(GlobalBoardFilterSchema.parse({ clients: 'g1', project: 'p1' }).project).toBe('p1');
  });

  it('an event needs a chosen project', () => {
    expect(isValidProjectFilter({})).toBe(true);
    expect(isValidProjectFilter({ project: 'none' })).toBe(true);
    expect(isValidProjectFilter({ project: 'p1', event: 'e1' })).toBe(true);
    expect(isValidProjectFilter({ event: 'e1' })).toBe(false);
    expect(isValidProjectFilter({ project: 'none', event: 'none' })).toBe(false);
  });

  it('the cross-client lists take a project only with exactly one client', () => {
    expect(isValidGlobalProjectFilter({}, undefined)).toBe(true);
    expect(isValidGlobalProjectFilter({ project: 'p1' }, ['g1'])).toBe(true);
    expect(isValidGlobalProjectFilter({ project: 'none' }, ['g1'])).toBe(true);
    expect(isValidGlobalProjectFilter({ project: 'p1' }, ['g1', 'g2'])).toBe(false);
    expect(isValidGlobalProjectFilter({ project: 'p1' }, 'all')).toBe(false);
    expect(isValidGlobalProjectFilter({ project: 'p1' }, undefined)).toBe(false);
    expect(isValidGlobalProjectFilter({ project: 'p1', event: 'e1' }, ['g1'])).toBe(false);
  });

  it('the ticket project body: null clears, the event defaults to none', () => {
    expect(TicketProjectBodySchema.parse({ projectId: null })).toEqual({
      projectId: null,
      eventId: null,
    });
    expect(TicketProjectBodySchema.parse({ projectId: 'p', eventId: 'e' })).toEqual({
      projectId: 'p',
      eventId: 'e',
    });
    expect(TicketProjectBodySchema.safeParse({}).success).toBe(false);
  });
});
