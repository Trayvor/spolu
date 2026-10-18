import { describe, expect, it } from 'vitest';
import { summarizeUnseen, type UnseenEventRow } from './unseen-summary.js';

let clock = 1_000;
/** An event row; each later call is newer, and rows are given newest first like the query. */
const row = (kind: string, payload: Record<string, unknown> = {}, day = '2026-10-18') =>
  ({ kind, payload, createdAt: new Date(++clock), day }) as UnseenEventRow;
const newestFirst = (...rows: UnseenEventRow[]) =>
  [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

const todo = { kind: 'todo', name: null };
const review = { kind: 'egrant_review', name: null };
const done = { kind: 'done', name: null };

describe('summarizeUnseen (2026-10-18)', () => {
  it('nothing unseen: no lines', () => {
    expect(summarizeUnseen([])).toEqual({ lines: [], more: 0 });
  });

  it('a task: one line per kind of change, newest change first', () => {
    const assigned = row('task.assigned', { actorName: 'Bob' });
    const message = row('chat.message', { authorName: 'Jana' });
    expect(summarizeUnseen(newestFirst(assigned, message))).toEqual({
      lines: [{ kind: 'messages', count: 1, authors: ['Jana'] }, { kind: 'assigned' }],
      more: 0,
    });
  });

  it('moves collapse into one line: from the first move to the last', () => {
    const first = row('task.moved', { fromBucket: todo, toBucket: review });
    const second = row('task.moved', { fromBucket: review, toBucket: done });
    expect(summarizeUnseen(newestFirst(first, second)).lines).toEqual([
      { kind: 'moved', from: todo, to: done },
    ]);
  });

  it('a move without readable columns still says it moved', () => {
    expect(summarizeUnseen([row('task.moved', { toBucket: 'junk' })]).lines).toEqual([
      { kind: 'moved', from: null, to: null },
    ]);
  });

  it('messages and thread replies count together, authors once each, newest first', () => {
    const rows = newestFirst(
      row('chat.message', { authorName: 'Jana' }),
      row('chat.thread_reply', { authorName: 'Peter' }),
      row('chat.message', { authorName: 'Jana' }),
    );
    expect(summarizeUnseen(rows).lines).toEqual([
      { kind: 'messages', count: 3, authors: ['Jana', 'Peter'] },
    ]);
  });

  it('a mention is its own line', () => {
    expect(summarizeUnseen([row('chat.mention', { authorName: 'Eva' })]).lines).toEqual([
      { kind: 'mentions', count: 1, authors: ['Eva'] },
    ]);
  });

  it('a deadline names the due day: the day of the reminder plus its days left', () => {
    const rows = [row('task.deadline', { daysLeft: 1 }, '2026-10-31')];
    expect(summarizeUnseen(rows).lines).toEqual([{ kind: 'deadline', dueDate: '2026-11-01' }]);
  });

  it('a ticket: created, the latest status, details, tasks, assigned, messages, time', () => {
    const rows = newestFirst(
      row('ticket.created'),
      row('ticket.status', { status: 'in_progress' }),
      row('ticket.status', { status: 'resolved' }),
      row('ticket.updated'),
      row('ticket.tasks', { count: 2 }),
      row('ticket.tasks', { count: 1 }),
      row('ticket.assigned'),
      row('ticket.message', { authorName: 'Jana' }),
      row('ticket.time_missing'),
    );
    expect(summarizeUnseen(rows)).toEqual({
      lines: [
        { kind: 'timeMissing' },
        { kind: 'messages', count: 1, authors: ['Jana'] },
        { kind: 'assigned' },
        { kind: 'tasks', count: 3 },
        { kind: 'updated' },
      ],
      more: 2,
    });
  });

  it('a ticket without a client is new too; an unknown status is left out', () => {
    expect(summarizeUnseen([row('ticket.unassigned')]).lines).toEqual([{ kind: 'created' }]);
    expect(summarizeUnseen([row('ticket.status', { status: 'nope' })]).lines).toEqual([]);
  });

  it('kinds that are not changes are ignored', () => {
    expect(summarizeUnseen([row('task.urgent'), row('reminder.due')]).lines).toEqual([]);
  });

  it('authors are capped at three', () => {
    const rows = newestFirst(
      ...['A', 'B', 'C', 'D'].map((name) => row('chat.message', { authorName: name })),
    );
    expect(summarizeUnseen(rows).lines).toEqual([
      { kind: 'messages', count: 4, authors: ['D', 'C', 'B'] },
    ]);
  });
});
