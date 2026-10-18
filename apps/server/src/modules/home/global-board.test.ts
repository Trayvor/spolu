import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { HOME_LIMITS, type GlobalBoard } from '@spolu/shared';
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
import { ensureAdminGroup } from '../groups/admin-group.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const TODAY = '2026-10-20';

const query = (
  over: Partial<GlobalBoardQuery> & { clientIds: string[] | null; viewerId: string },
) =>
  ({
    assignee: 'anyone',
    urgent: false,
    mine: false,
    completed: false,
    today: TODAY,
    ...over,
  }) as GlobalBoardQuery;

const column = (board: GlobalBoard, id: string) => board.columns.find((c) => c.id === id);
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
  it('default scope is the managed groups plus the admin group (Phase 34)', async () => {
    const g1 = await newGroup(db, 'One');
    await newGroup(db, 'Two');
    const admin = await newAdmin(db, 'Ada', [g1.id]);
    expect(await resolveClientIds(db, admin.id, undefined)).toEqual([
      g1.id,
      await ensureAdminGroup(db),
    ]);
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
    expect(await resolveClientIds(db, admin.id, 'all')).toBeNull();
  });
});

describe('getGlobalBoard', () => {
  it('columns by kind, each custom bucket in its own column', async () => {
    const { g, admin, task } = await oneGroup('Kinds');
    await task('todo');
    await task('custom', { bucketId: await bucketOf(db, g.id, 'custom', 'In translation') });
    await task('egrant', { bucketId: await bucketOf(db, g.id, 'egrant_review') });
    await task('client', { bucketId: await bucketOf(db, g.id, 'client_review') });
    const board = await getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id }));
    expect(board.columns.map((c) => [c.id, c.kind, c.name, c.total])).toEqual([
      ['todo', 'todo', null, 1],
      ['custom:in translation', 'custom', 'In translation', 1],
      ['egrant_review', 'egrant_review', null, 1],
      ['client_review', 'client_review', null, 1],
    ]);
    expect(column(board, 'custom:in translation')!.items[0]).toMatchObject({
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

  it("cards carry the task's link and its upcoming custom reminder count", async () => {
    const { g, admin, task } = await oneGroup('Card fields');
    const id = await task('with link');
    await db.execute(sql`update tasks set link = 'https://egrant.sk/ziadost/1' where id = ${id}`);
    const setId = randomUUID();
    await db.execute(sql`insert into reminder_sets (id, group_id, task_id, created_by)
      values (${setId}, ${g.id}, ${id}, ${admin.id})`);
    await db.execute(sql`insert into reminder_times (id, set_id, at, fired_at) values
      (${randomUUID()}, ${setId}, now() + interval '1 day', null),
      (${randomUUID()}, ${setId}, now() + interval '2 days', null),
      (${randomUUID()}, ${setId}, now() - interval '1 day', now())`);
    await task('plain');
    const board = await getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id }));
    const items = column(board, 'todo')!.items;
    expect(items.find((t) => t.title === 'with link')).toMatchObject({
      link: 'https://egrant.sk/ziadost/1',
      upcomingReminders: 2,
    });
    expect(items.find((t) => t.title === 'plain')).toMatchObject({
      link: null,
      upcomingReminders: 0,
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
      'egrant_review',
      'client_review',
      'done',
    ]);
    expect(titles(shown, 'done')).toEqual(['recent']);
  });

  describe('custom bucket columns', () => {
    /** Moves a bucket to `position` (fixed ones are a0..a3, see FIXED_POSITIONS). */
    const place = (bucketId: string, position: string) =>
      db.execute(sql`update buckets set position = ${position} where id = ${bucketId}`);

    it('no custom buckets: no extra column and no Other steps', async () => {
      const { g, admin, task } = await oneGroup('Plain');
      await task('one');
      const board = await getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id }));
      expect(board.columns.map((c) => c.id)).toEqual(['todo', 'egrant_review', 'client_review']);
    });

    it('same names merge across clients (trimmed, case and diacritics ignored), most common spelling', async () => {
      const a = await oneGroup('Alfa');
      const b = await newGroup(db, 'Beta');
      const c = await newGroup(db, 'Gama');
      const inA = await bucketOf(db, a.g.id, 'custom', 'Preklad');
      const inB = await bucketOf(db, b.id, 'custom', '  preklád ');
      const inC = await bucketOf(db, c.id, 'custom', 'Preklad');
      const t = (groupId: string, bucketId: string, title: string) =>
        newTask(db, { groupId, bucketId, createdBy: a.admin.id, title });
      await t(a.g.id, inA, 'a');
      await t(b.id, inB, 'b');
      await t(c.id, inC, 'c');
      const board = await getGlobalBoard(
        db,
        query({ clientIds: [a.g.id, b.id, c.id], viewerId: a.admin.id }),
      );
      expect(board.columns.map((col) => [col.id, col.name, col.total])).toEqual([
        ['todo', null, 0],
        ['custom:preklad', 'Preklad', 3],
        ['egrant_review', null, 0],
        ['client_review', null, 0],
      ]);
      const items = column(board, 'custom:preklad')!.items;
      expect(items.map((i) => [i.title, i.groupName, i.bucketName])).toEqual([
        ['a', 'Alfa', 'Preklad'],
        ['b', 'Beta', '  preklád '],
        ['c', 'Gama', 'Preklad'],
      ]);
    });

    it('unique names get their own column, empty buckets too, ordered by typical position then name', async () => {
      const a = await oneGroup('Alfa');
      const b = await newGroup(db, 'Beta');
      // Alfa: To do, Rozpočet, Preklad, Zmluvy, eGrant review…
      // Beta: To do, Preklad, eGrant review, Archív, Client review…
      const budget = await bucketOf(db, a.g.id, 'custom', 'Rozpočet');
      await place(budget, 'a1');
      await place(await bucketOf(db, a.g.id, 'custom', 'Preklad'), 'a2');
      await place(await bucketOf(db, a.g.id, 'custom', 'Zmluvy'), 'a25');
      await place(await bucketOf(db, b.id, 'custom', 'Preklad'), 'a1');
      await place(await bucketOf(db, b.id, 'custom', 'Archív'), 'a4');
      await a.task('budget', { bucketId: budget });
      const board = await getGlobalBoard(
        db,
        query({ clientIds: [a.g.id, b.id], viewerId: a.admin.id }),
      );
      // Rozpočet: rank 2; Preklad: ranks 3 and 2 (2.5); Archív and Zmluvy: rank 4, so by name.
      expect(board.columns.map((c) => c.name ?? c.id)).toEqual([
        'todo',
        'Rozpočet',
        'Preklad',
        'Archív',
        'Zmluvy',
        'egrant_review',
        'client_review',
      ]);
      expect(board.columns.find((c) => c.name === 'Zmluvy')!.total).toBe(0);
    });

    it('buckets of clients outside the filter make no column', async () => {
      const a = await oneGroup('Alfa');
      const b = await newGroup(db, 'Beta');
      await bucketOf(db, b.id, 'custom', 'Only in Beta');
      const board = await getGlobalBoard(db, query({ clientIds: [a.g.id], viewerId: a.admin.id }));
      expect(board.columns.map((c) => c.id)).toEqual(['todo', 'egrant_review', 'client_review']);
    });

    it('the columns do not change with the other filters', async () => {
      const { g, admin } = await oneGroup('Stable');
      await bucketOf(db, g.id, 'custom', 'Preklad');
      const board = await getGlobalBoard(
        db,
        query({ clientIds: [g.id], viewerId: admin.id, assignee: 'me', q: 'nothing like it' }),
      );
      expect(board.columns.map((c) => [c.id, c.total])).toEqual([
        ['todo', 0],
        ['custom:preklad', 0],
        ['egrant_review', 0],
        ['client_review', 0],
      ]);
    });

    it(`more than ${HOME_LIMITS.customColumns} names: the largest keep a column, the rest fold into Other steps`, async () => {
      const { g, admin } = await oneGroup('Many');
      const extra = HOME_LIMITS.customColumns + 2;
      for (let i = 0; i < extra; i++) {
        const bucketId = await bucketOf(db, g.id, 'custom', `Step ${String(i).padStart(2, '0')}`);
        // Step 00 and Step 01 are empty, every other step has one task, Step 13 has two.
        for (let n = 0; n < (i < 2 ? 0 : i === extra - 1 ? 2 : 1); n++) {
          await newTask(db, { groupId: g.id, bucketId, createdBy: admin.id, title: `in ${i}` });
        }
      }
      const board = await getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id }));
      const ids = board.columns.map((c) => c.id);
      expect(ids).toHaveLength(3 + HOME_LIMITS.customColumns + 1);
      expect(ids.slice(0, 2)).toEqual(['todo', 'custom:step 02']);
      expect(ids.slice(-4)).toEqual(['custom:step 13', 'other', 'egrant_review', 'client_review']);
      const other = column(board, 'other')!;
      expect([other.kind, other.name, other.total]).toEqual(['other', null, 0]);
      expect(ids).not.toContain('custom:step 00');
    });

    it('folded buckets show their tasks in Other steps with the bucket name', async () => {
      const { g, admin } = await oneGroup('Folded');
      for (let i = 0; i < HOME_LIMITS.customColumns; i++) {
        const bucketId = await bucketOf(db, g.id, 'custom', `Big ${i}`);
        await newTask(db, { groupId: g.id, bucketId, createdBy: admin.id, title: `big ${i}` });
      }
      const small = await bucketOf(db, g.id, 'custom', 'Small');
      await newTask(db, { groupId: g.id, bucketId: small, createdBy: admin.id, title: 'small' });
      await newTask(db, {
        groupId: g.id,
        bucketId: await bucketOf(db, g.id, 'custom', 'Big 0'),
        createdBy: admin.id,
        title: 'big 0 again',
      });
      const board = await getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id }));
      // Big 0 exists twice in one client: merged too, with two tasks.
      expect(column(board, 'custom:big 0')!.total).toBe(2);
      // Ties on size: the earlier position wins, so the last created ("Small") folds.
      expect(column(board, 'other')!.items.map((t) => [t.title, t.bucketName])).toEqual([
        ['small', 'Small'],
      ]);
    });

    it('paging inside a merged column', async () => {
      const a = await oneGroup('Alfa');
      const b = await newGroup(db, 'Beta');
      const inA = await bucketOf(db, a.g.id, 'custom', 'Preklad');
      const inB = await bucketOf(db, b.id, 'custom', 'PREKLAD');
      const ids: string[] = [];
      for (let i = 0; i < 70; i++) {
        ids.push(
          await newTask(db, {
            groupId: i < 35 ? a.g.id : b.id,
            bucketId: i < 35 ? inA : inB,
            createdBy: a.admin.id,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)),
          }),
        );
      }
      const base = query({ clientIds: [a.g.id, b.id], viewerId: a.admin.id });
      const first = column(await getGlobalBoard(db, base), 'custom:preklad')!;
      expect([first.total, first.items.length]).toEqual([70, 50]);
      const page = await getGlobalBoard(db, {
        ...base,
        column: 'custom:preklad',
        after: first.next!,
      });
      expect(page.columns.map((c) => [c.id, c.kind])).toEqual([['custom:preklad', 'custom']]);
      const second = page.columns[0]!;
      expect(second.next).toBeNull();
      expect([...first.items, ...second.items].map((t) => t.id)).toEqual(ids);
    });
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

    it('mine: tasks the viewer created or is an assignee of', async () => {
      const { g, admin, task } = await oneGroup('Mine');
      const other = await newClient(db, g.id, 'Olga');
      const byOther = (title: string, extra: Partial<Parameters<typeof newTask>[1]> = {}) =>
        newTask(db, { groupId: g.id, createdBy: other.id, title, ...extra });
      await task('created by me');
      await task('created by me for her', { assigneeIds: [other.id] });
      await byOther('hers, assigned to me', { assigneeIds: [admin.id] });
      await byOther('hers, assigned to us both', { assigneeIds: [admin.id, other.id] });
      await byOther('hers alone', { assigneeIds: [other.id] });
      await byOther('hers, unassigned');
      const run = (over: Partial<GlobalBoardQuery>) =>
        getGlobalBoard(db, query({ clientIds: [g.id], viewerId: admin.id, ...over }));

      expect(titles(await run({ mine: true })).sort()).toEqual([
        'created by me',
        'created by me for her',
        'hers, assigned to me',
        'hers, assigned to us both',
      ]);
      // It narrows the assignee filter; the people menu stays the scope's assignees.
      const herTasks = await run({ mine: true, assignee: other.id });
      expect(titles(herTasks).sort()).toEqual([
        'created by me for her',
        'hers, assigned to us both',
      ]);
      expect(herTasks.people.map((p) => p.name)).toEqual(['Ada', 'Olga']);
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

  // 120 tasks inserted one by one (each through newTask): under load (load average 27, a
  // parallel ci.sh) this passed the 15 s default; the work is fixed, so the timeout is raised.
  it('per-column paging with keyset', { timeout: 60_000 }, async () => {
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
