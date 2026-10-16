import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { GlobalBoard } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { tasks } from '../tasks/schema.js';
import {
  bratislavaToday,
  getGlobalBoard,
  InvalidCursorError,
  resolveClientIds,
  type GlobalBoardQuery,
} from './global-board.js';
import { bucketOf, newAdmin, newClient, newGroup, newTask } from './test-fixtures.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const TODAY = '2026-10-20';

const query = (
  over: Partial<GlobalBoardQuery> & { clientIds: string[] | null; viewerId: string },
) =>
  ({
    assignee: 'anyone',
    urgent: false,
    completed: false,
    today: TODAY,
    ...over,
  }) as GlobalBoardQuery;

const column = (board: GlobalBoard, kind: string) => board.columns.find((c) => c.kind === kind);
const titles = (board: GlobalBoard, kind = 'todo') =>
  column(board, kind)!.items.map((t) => t.title);

async function oneGroup(name = 'Board') {
  const g = await newGroup(db, name);
  const admin = await newAdmin(db, 'Ada', [g.id]);
  const task = (title: string, extra: Partial<Parameters<typeof newTask>[1]> = {}) =>
    newTask(db, { groupId: g.id, createdBy: admin.id, title, ...extra });
  return { g, admin, task };
}

describe('resolveClientIds', () => {
  it('default scope is the managed groups', async () => {
    const g1 = await newGroup(db, 'One');
    await newGroup(db, 'Two');
    const admin = await newAdmin(db, 'Ada', [g1.id]);
    expect(await resolveClientIds(db, admin.id, undefined)).toEqual([g1.id]);
  });

  it('default scope is all groups for an admin who manages none', async () => {
    const admin = await newAdmin(db, 'Ada');
    expect(await resolveClientIds(db, admin.id, undefined)).toBeNull();
    const g = await newGroup(db, 'Visible');
    const title = `Seen ${randomUUID()}`;
    const id = await newTask(db, { groupId: g.id, createdBy: admin.id, title });
    const board = await getGlobalBoard(
      db,
      query({ clientIds: null, viewerId: admin.id, q: title }),
    );
    expect(column(board, 'todo')!.items.map((t) => t.id)).toEqual([id]);
  });

  it('explicit clients win', async () => {
    const admin = await newAdmin(db, 'Ada');
    expect(await resolveClientIds(db, admin.id, ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('getGlobalBoard', () => {
  it('columns by kind: custom buckets land in other with bucketName', async () => {
    const { g, admin, task } = await oneGroup('Kinds');
    await task('todo');
    await task('custom', { bucketId: await bucketOf(db, g.id, 'custom', 'In translation') });
    await task('egrant', { bucketId: await bucketOf(db, g.id, 'egrant_review') });
    await task('client', { bucketId: await bucketOf(db, g.id, 'client_review') });
    const board = await getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id }));
    expect(board.columns.map((c) => [c.kind, c.total])).toEqual([
      ['todo', 1],
      ['other', 1],
      ['egrant_review', 1],
      ['client_review', 1],
    ]);
    expect(column(board, 'other')!.items[0]).toMatchObject({
      title: 'custom',
      bucketKind: 'custom',
      bucketName: 'In translation',
      groupName: 'Kinds',
      groupHasLogo: false,
      groupId: g.id,
      createdBy: { id: admin.id, name: 'Ada' },
      assignees: [],
      fileCount: 0,
    });
  });

  it('Completed only with completed=1 and within 30 days', async () => {
    const { g, admin, task } = await oneGroup('Done');
    const done = await bucketOf(db, g.id, 'done');
    await task('recent', { bucketId: done, completedAt: new Date(Date.now() - 2 * 86_400_000) });
    await task('old', { bucketId: done, completedAt: new Date(Date.now() - 31 * 86_400_000) });
    const hidden = await getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id }));
    expect(column(hidden, 'done')).toBeUndefined();
    const shown = await getGlobalBoard(
      db,
      query({ clientIds: [g.id], viewerId: admin.id, completed: true }),
    );
    expect(shown.columns.map((c) => c.kind)).toEqual([
      'todo',
      'other',
      'egrant_review',
      'client_review',
      'done',
    ]);
    expect(titles(shown, 'done')).toEqual(['recent']);
  });

  describe('filters', () => {
    async function filtered() {
      const { g, admin, task } = await oneGroup('Filters');
      const other = await newClient(db, g.id, 'Olga');
      await task('mine', { assigneeIds: [admin.id] });
      await task('hers', { assigneeIds: [other.id] });
      await task('nobody');
      await task('urgent', { urgent: true });
      await task('overdue', { dueDate: '2026-10-19' });
      await task('today', { dueDate: TODAY });
      await task('in six days', { dueDate: '2026-10-26' });
      await task('in seven days', { dueDate: '2026-10-27' });
      await task('100% sure_thing');
      await task('Budget TABLE');
      const run = (over: Partial<GlobalBoardQuery>) =>
        getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id, ...over }));
      return { g, admin, other, run };
    }

    it('assignee me', async () => {
      const f = await filtered();
      expect(titles(await f.run({ assignee: 'me' }))).toEqual(['mine']);
    });

    it('assignee none', async () => {
      const f = await filtered();
      const got = titles(await f.run({ assignee: 'none' }));
      expect(got).not.toContain('mine');
      expect(got).not.toContain('hers');
      expect(got).toContain('nobody');
    });

    it('assignee by id', async () => {
      const f = await filtered();
      expect(titles(await f.run({ assignee: f.other.id }))).toEqual(['hers']);
    });

    it('urgent', async () => {
      const f = await filtered();
      expect(titles(await f.run({ urgent: true }))).toEqual(['urgent']);
    });

    it('due overdue', async () => {
      const f = await filtered();
      expect(titles(await f.run({ due: 'overdue' }))).toEqual(['overdue']);
    });

    it('due week', async () => {
      const f = await filtered();
      expect(titles(await f.run({ due: 'week' }))).toEqual(['today', 'in six days']);
    });

    it('due none', async () => {
      const f = await filtered();
      const got = titles(await f.run({ due: 'none' }));
      expect(got).toContain('nobody');
      expect(got).not.toContain('overdue');
    });

    it('q is case-insensitive and escapes %', async () => {
      const f = await filtered();
      expect(titles(await f.run({ q: 'budget table' }))).toEqual(['Budget TABLE']);
      expect(titles(await f.run({ q: '0%' }))).toEqual(['100% sure_thing']);
      expect(titles(await f.run({ q: 'e_t' }))).toEqual(['100% sure_thing']);
      expect(titles(await f.run({ q: '%%' }))).toEqual([]);
    });

    it('people lists the distinct assignees of the scope', async () => {
      const f = await filtered();
      const board = await f.run({ assignee: 'me' });
      expect(board.people).toEqual([
        { id: f.admin.id, name: 'Ada' },
        { id: f.other.id, name: 'Olga' },
      ]);
    });
  });

  it('filters combine', async () => {
    const { g, admin, task } = await oneGroup('Combine');
    await task('match', { assigneeIds: [admin.id], urgent: true, dueDate: '2026-10-22' });
    await task('not urgent', { assigneeIds: [admin.id], dueDate: '2026-10-22' });
    await task('not mine', { urgent: true, dueDate: '2026-10-22' });
    await task('later', { assigneeIds: [admin.id], urgent: true, dueDate: '2026-11-22' });
    const board = await getGlobalBoard(
      db,
      query({
        clientIds: [g.id],
        viewerId: admin.id,
        assignee: 'me',
        urgent: true,
        due: 'week',
      }),
    );
    expect(titles(board)).toEqual(['match']);
  });

  it('cards sort urgent, deadline, no deadline, then client name', async () => {
    const a = await oneGroup('Beta');
    const b = await newGroup(db, 'Alfa');
    const t = (groupId: string, title: string, extra: Partial<Parameters<typeof newTask>[1]>) =>
      newTask(db, { groupId, createdBy: a.admin.id, title, ...extra });
    await t(a.g.id, 'no date beta', {});
    await t(b.id, 'no date alfa', {});
    await t(a.g.id, 'late', { dueDate: '2026-11-01' });
    await t(a.g.id, 'urgent no date', { urgent: true });
    await t(a.g.id, 'early', { dueDate: '2026-10-21' });
    await t(a.g.id, 'urgent dated', { urgent: true, dueDate: '2026-10-30' });
    const board = await getGlobalBoard(
      db,
      query({ clientIds: [a.g.id, b.id], viewerId: a.admin.id }),
    );
    expect(titles(board)).toEqual([
      'urgent dated',
      'urgent no date',
      'early',
      'late',
      'no date alfa',
      'no date beta',
    ]);
  });

  it('per-column paging with keyset', async () => {
    const { g, admin } = await oneGroup('Paging');
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      ids.push(
        await newTask(db, {
          groupId: g.id,
          createdBy: admin.id,
          title: `t${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)),
        }),
      );
    }
    const base = query({ clientIds: [g.id], viewerId: admin.id });
    const first = await getGlobalBoard(db, base);
    const todo1 = column(first, 'todo')!;
    expect([todo1.total, todo1.items.length]).toEqual([120, 50]);
    const second = await getGlobalBoard(db, { ...base, column: 'todo', after: todo1.next! });
    expect(second.columns.map((c) => c.kind)).toEqual(['todo']);
    const todo2 = column(second, 'todo')!;
    expect([todo2.total, todo2.items.length]).toEqual([120, 50]);
    const third = await getGlobalBoard(db, { ...base, column: 'todo', after: todo2.next! });
    const todo3 = column(third, 'todo')!;
    expect(todo3.items).toHaveLength(20);
    expect(todo3.next).toBeNull();
    const seen = [todo1, todo2, todo3].flatMap((c) => c.items.map((t) => t.id));
    expect(seen).toEqual(ids);
  });

  it('keyset pages never skip or repeat tasks with equal sort keys across same-named groups', async () => {
    const one = await oneGroup('Obec');
    const two = await newGroup(db, 'Obec');
    const at = new Date('2026-10-01T10:00:00.000Z');
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      ids.push(
        await newTask(db, {
          groupId: i % 2 === 0 ? one.g.id : two.id,
          createdBy: one.admin.id,
          dueDate: '2026-10-25',
          createdAt: at,
        }),
      );
    }
    const base = query({ clientIds: [one.g.id, two.id], viewerId: one.admin.id });
    const first = column(await getGlobalBoard(db, base), 'todo')!;
    const second = column(
      await getGlobalBoard(db, { ...base, column: 'todo', after: first.next! }),
      'todo',
    )!;
    const seen = [...first.items, ...second.items].map((t) => t.id);
    expect(seen).toHaveLength(60);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(second.next).toBeNull();
  });

  it('a malformed cursor throws InvalidCursorError', async () => {
    const admin = await newAdmin(db, 'Ada');
    for (const after of ['nope', Buffer.from('[1,2]').toString('base64url')]) {
      await expect(
        getGlobalBoard(db, query({ clientIds: [], viewerId: admin.id, column: 'todo', after })),
      ).rejects.toBeInstanceOf(InvalidCursorError);
    }
  });

  it('due filters use the Bratislava date at 00:30 local time', async () => {
    const today = bratislavaToday(new Date('2026-10-20T22:30:00Z'));
    expect(today).toBe('2026-10-21');
    const { g, admin, task } = await oneGroup('Night');
    await task('due 20th', { dueDate: '2026-10-20' });
    await task('due 21st', { dueDate: '2026-10-21' });
    const board = await getGlobalBoard(
      db,
      query({ clientIds: [g.id], viewerId: admin.id, due: 'overdue', today }),
    );
    expect(titles(board)).toEqual(['due 20th']);
  });

  it('one statement', async () => {
    const { g, admin, task } = await oneGroup('Count');
    await task('one', { assigneeIds: [admin.id] });
    const client = postgres(testDatabaseUrl, { max: 1 });
    let statements = 0;
    const counted = drizzle(client, { logger: { logQuery: () => void statements++ } });
    try {
      const board = await getGlobalBoard(counted, query({ clientIds: [g.id], viewerId: admin.id }));
      expect(titles(board)).toEqual(['one']);
      expect(statements).toBe(1);
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it('timestamps are ISO strings like the board', async () => {
    const { g, admin, task } = await oneGroup('Iso');
    const id = await task('iso', { createdAt: new Date('2026-10-01T10:00:00.123Z') });
    await db
      .update(tasks)
      .set({ updatedAt: sql`created_at` })
      .where(eq(tasks.id, id));
    const [item] = column(
      await getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id })),
      'todo',
    )!.items;
    expect(item).toMatchObject({
      createdAt: '2026-10-01T10:00:00.123Z',
      updatedAt: '2026-10-01T10:00:00.123Z',
      completedAt: null,
      dueDate: null,
    });
    expect(item!.groupUpdatedAt).toMatch(/Z$/);
  });
});
