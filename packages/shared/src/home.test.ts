import { describe, expect, it } from 'vitest';
import { GlobalBoardFilterSchema, HomeReminderSchema, HomeRemindersSchema } from './home.js';

describe('GlobalBoardFilterSchema', () => {
  it('filter: an empty query parses to the defaults', () => {
    expect(GlobalBoardFilterSchema.parse({})).toEqual({ assignee: 'anyone' });
  });

  it('filter: every field parses', () => {
    expect(
      GlobalBoardFilterSchema.parse({
        clients: 'a1,b-2',
        assignee: 'me',
        urgent: '1',
        mine: '1',
        due: 'week',
        q: '  budget ',
        completed: '1',
        column: 'todo',
        after: 'abc',
      }),
    ).toEqual({
      clients: ['a1', 'b-2'],
      assignee: 'me',
      urgent: true,
      mine: true,
      due: 'week',
      q: 'budget',
      completed: true,
      column: 'todo',
      after: 'abc',
    });
  });

  it('filter: unknown due fails', () => {
    expect(GlobalBoardFilterSchema.safeParse({ due: 'tomorrow' }).success).toBe(false);
  });

  it('filter: 201 clients fails', () => {
    const ids = Array.from({ length: 201 }, (_, i) => `g${i}`).join(',');
    expect(GlobalBoardFilterSchema.safeParse({ clients: ids }).success).toBe(false);
    const ok = Array.from({ length: 200 }, (_, i) => `g${i}`).join(',');
    expect(GlobalBoardFilterSchema.safeParse({ clients: ok }).success).toBe(true);
  });

  it('filter: clients=all is every client', () => {
    expect(GlobalBoardFilterSchema.parse({ clients: 'all' }).clients).toBe('all');
  });

  it('filter: a cursor up to 1000 characters passes', () => {
    const after = 'x'.repeat(1000);
    expect(GlobalBoardFilterSchema.safeParse({ column: 'todo', after }).success).toBe(true);
  });

  it('filter: a malformed client id fails', () => {
    expect(GlobalBoardFilterSchema.safeParse({ clients: 'ok,bad id' }).success).toBe(false);
    expect(GlobalBoardFilterSchema.safeParse({ clients: 'ok,,x' }).success).toBe(false);
    expect(GlobalBoardFilterSchema.safeParse({ assignee: "x' or 1=1" }).success).toBe(false);
  });

  it('filter: column without after fails, and after without column', () => {
    expect(GlobalBoardFilterSchema.safeParse({ column: 'todo' }).success).toBe(false);
    expect(GlobalBoardFilterSchema.safeParse({ after: 'abc' }).success).toBe(false);
    expect(GlobalBoardFilterSchema.safeParse({ column: 'nope', after: 'abc' }).success).toBe(false);
  });

  it('filter: column takes a custom column id', () => {
    const page = (column: string) =>
      GlobalBoardFilterSchema.safeParse({ column, after: 'abc' }).success;
    expect(page('custom:preklad')).toBe(true);
    expect(page('custom:v preklade a korektúre')).toBe(true);
    expect(page('other')).toBe(true);
    expect(page('custom:')).toBe(false);
    expect(page(`custom:${'x'.repeat(80)}`)).toBe(false);
  });

  it('filter: q of one character is dropped', () => {
    expect(GlobalBoardFilterSchema.parse({ q: ' a ' }).q).toBeUndefined();
    expect(GlobalBoardFilterSchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });

  it('filter: urgent and completed accept only 1', () => {
    expect(GlobalBoardFilterSchema.safeParse({ urgent: 'yes' }).success).toBe(false);
    expect(GlobalBoardFilterSchema.safeParse({ completed: '0' }).success).toBe(false);
  });
});

describe('HomeReminderSchema', () => {
  const base = {
    id: 'r1',
    at: '2026-10-21T07:00:00.000Z',
    title: 'Call',
    groupId: 'g',
    groupName: 'G',
  };

  it('HomeReminderSchema accepts a knowledge and a task target', () => {
    expect(
      HomeReminderSchema.safeParse({ ...base, target: { kind: 'knowledge', itemId: 'k' } }).success,
    ).toBe(true);
    expect(
      HomeReminderSchema.safeParse({ ...base, target: { kind: 'task', taskId: 't' } }).success,
    ).toBe(true);
    expect(HomeReminderSchema.safeParse({ ...base, target: { kind: 'task' } }).success).toBe(false);
  });

  it('HomeRemindersSchema accepts unavailable and available answers', () => {
    expect(HomeRemindersSchema.parse({ available: false })).toEqual({ available: false });
    expect(
      HomeRemindersSchema.parse({ available: true, nextWeek: 0, items: [], error: true }),
    ).toEqual({ available: true, nextWeek: 0, items: [], error: true });
  });
});
