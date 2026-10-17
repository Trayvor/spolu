import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { NotificationCategories, NotificationKinds } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { addMembership, removeMembership } from '../groups/memberships.js';
import { createGroup, listGroupPeople } from '../groups/service.js';
import { user } from '../users/schema.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  setFinanceAccess,
} from '../users/service.js';
import {
  NOTIFICATION_GROUP_OF,
  audienceAmong,
  notificationGroupOf,
  visibleCategoriesFor,
} from './categories.js';

describe('notificationGroupOf', () => {
  it.each([
    ['chat.message', {}, 'chat'],
    ['chat.mention', {}, 'chat'],
    ['chat.thread_reply', {}, 'chat'],
    ['chat.message', { taskId: 't1' }, 'tasks'],
    ['chat.mention', { taskId: 't1' }, 'tasks'],
    ['chat.thread_reply', { taskId: 't1' }, 'tasks'],
    ['chat.mention', { taskId: '' }, 'chat'],
    ['chat.mention', { taskId: null }, 'chat'],
    ['task.moved', {}, 'tasks'],
    ['task.assigned', {}, 'tasks'],
    ['task.deadline', {}, 'tasks'],
    ['task.urgent', {}, 'tasks'],
    ['reminder.due', { subjectKind: 'task', taskId: 't1' }, 'tasks'],
    ['reminder.due', { subjectKind: 'knowledge' }, 'knowledge'],
    ['ticket.created', { ticketId: 'k1' }, 'tickets'],
    ['ticket.unassigned', { ticketId: 'k1' }, 'tickets'],
    ['ticket.message', { ticketId: 'k1' }, 'tickets'],
    ['ticket.status', { ticketId: 'k1' }, 'tickets'],
    ['ticket.updated', { ticketId: 'k1' }, 'tickets'],
    ['ticket.tasks', { ticketId: 'k1' }, 'tickets'],
    // A mention in a ticket chat (Phase 21.6) belongs to the ticket board.
    ['chat.mention', { ticketId: 'k1' }, 'tickets'],
    ['chat.mention', { ticketId: '' }, 'chat'],
    // 2026-10-17: meetings, and a meeting's own reminder.
    ['meeting.scheduled', { itemId: 'k1' }, 'meetings'],
    ['meeting.rescheduled', { itemId: 'k1' }, 'meetings'],
    ['meeting.summary_ready', { itemId: 'k1' }, 'meetings'],
    ['meeting.summary_failed', { itemId: 'k1' }, 'meetings'],
    ['reminder.due', { subjectKind: 'knowledge', meeting: true }, 'meetings'],
    ['reminder.due', { subjectKind: 'task', taskId: 't1', meeting: true }, 'tasks'],
  ] as const)('%s %j -> %s', (kind, payload, group) => {
    expect(notificationGroupOf(kind, payload)).toBe(group);
  });

  it('an unknown kind has no group and does not throw', () => {
    expect(notificationGroupOf('ticket.bogus', {})).toBeNull();
    expect(notificationGroupOf('', {})).toBeNull();
    expect(notificationGroupOf('toString', {})).toBeNull();
  });

  it('the map covers every kind', () => {
    expect(Object.keys(NOTIFICATION_GROUP_OF).sort()).toEqual([...NotificationKinds].sort());
  });
});

describe('requesters (Phase 21.1)', () => {
  const { db, close } = createDb(testDatabaseUrl);
  afterAll(() => close());
  const newGroup = () =>
    createGroup(db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
  const named = async () => {
    const c = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
    await db.update(user).set({ name: 'Jana', emailVerified: true }).where(eq(user.id, c.id));
    return { ...c, role: 'client' as const, finance: false };
  };

  it('a requester-only person sees only the ticket board group; a client all but Finance', async () => {
    const [a, b] = [await newGroup(), await newGroup()];
    const requester = await named();
    await addMembership(db, requester.id, a.id, 'ziadatel');
    expect(await visibleCategoriesFor(db, requester)).toEqual(['tickets']);
    await addMembership(db, requester.id, b.id, 'client');
    expect(await visibleCategoriesFor(db, requester)).toEqual(
      NotificationCategories.filter((c) => c !== 'finance'),
    );
  });

  it('a ziadatel member is in the audience of the tickets group only', async () => {
    const g = await newGroup();
    const [client, z] = [await named(), await named()];
    await addMembership(db, client.id, g.id, 'client');
    await addMembership(db, z.id, g.id, 'ziadatel');
    const items = [client.id, z.id].flatMap((userId) =>
      (['tickets', 'chat'] as const).map((group) => ({ userId, groupId: g.id, group })),
    );
    const inAudience = await audienceAmong(db, items);
    expect(items.map((i) => inAudience(i.userId, i.groupId, i.group))).toEqual([
      true, // client, tickets
      true, // client, chat
      true, // ziadatel, tickets
      false, // ziadatel, chat
    ]);
  });

  it("matches the group's people (listGroupPeople) for every kind of user, in one query", async () => {
    const [g, other] = [await newGroup(), await newGroup()];
    const client = await named();
    await addMembership(db, client.id, g.id, 'client');
    const removed = await named();
    await addMembership(db, removed.id, g.id, 'client');
    await removeMembership(db, g.id, removed.id);
    const unnamed = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, unnamed.id));
    await addMembership(db, unnamed.id, g.id, 'client');
    const elsewhere = await named();
    await addMembership(db, elsewhere.id, other.id, 'client');
    const admin = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
    const disabled = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Dis' });
    await deactivateUser(db, disabled.id);
    const ids = [client, removed, unnamed, elsewhere, admin, disabled].map((u) => u.id);

    const people = new Set((await listGroupPeople(db, g.id)).map((p) => p.id));
    const counting = createCountingDb();
    try {
      const items = ids.map((userId) => ({ userId, groupId: g.id, group: 'chat' as const }));
      // The first run of a statement shape adds a describe round trip; count the second.
      await audienceAmong(counting.db, items);
      counting.reset();
      const inAudience = await audienceAmong(counting.db, items);
      expect(counting.count()).toBe(1);
      expect(ids.map((id) => inAudience(id, g.id, 'chat'))).toEqual(
        ids.map((id) => people.has(id)),
      );
      expect(ids.map((id) => people.has(id))).toEqual([true, false, false, false, true, false]);
    } finally {
      await counting.close();
      await deactivateUser(db, admin.id);
    }
  });
});

describe('the Finance group (Phase 32)', () => {
  const { db, close } = createDb(testDatabaseUrl);
  afterAll(() => close());
  const newGroup = () =>
    createGroup(db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
  const newAdmin = () => addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
  const session = (
    a: { id: string; email: string; name: string },
    role: 'admin' | 'superadmin',
    finance: boolean,
  ) => ({
    ...a,
    role,
    finance,
  });

  it('only finance admins see it in Settings', async () => {
    const admin = await newAdmin();
    expect(await visibleCategoriesFor(db, session(admin, 'admin', false))).not.toContain('finance');
    expect(await visibleCategoriesFor(db, session(admin, 'admin', true))).toEqual([
      ...NotificationCategories,
    ]);
    expect(await visibleCategoriesFor(db, session(admin, 'superadmin', true))).toContain('finance');
  });

  it('the audience re-checks the right at send time: a revoked admin or a client gets nothing', async () => {
    const g = await newGroup();
    const [granted, revoked, plain] = [await newAdmin(), await newAdmin(), await newAdmin()];
    const superadmin = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Sup' });
    await db.update(user).set({ role: 'superadmin' }).where(eq(user.id, superadmin.id));
    await setFinanceAccess(db, granted.id, superadmin.id);
    await setFinanceAccess(db, revoked.id, superadmin.id);
    await setFinanceAccess(db, revoked.id, null);
    const client = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
    await db.update(user).set({ name: 'C', emailVerified: true }).where(eq(user.id, client.id));
    await addMembership(db, client.id, g.id, 'client');
    try {
      const ids = [granted.id, revoked.id, plain.id, superadmin.id, client.id];
      const inAudience = await audienceAmong(
        db,
        ids.flatMap((userId) =>
          (['finance', 'chat'] as const).map((group) => ({ userId, groupId: g.id, group })),
        ),
      );
      expect(ids.map((id) => inAudience(id, g.id, 'finance'))).toEqual([
        true,
        false,
        false,
        true,
        false,
      ]);
      // Other groups are untouched: every admin and the client are group people.
      expect(ids.map((id) => inAudience(id, g.id, 'chat'))).toEqual([true, true, true, true, true]);
    } finally {
      for (const id of [granted.id, revoked.id, plain.id]) await deactivateUser(db, id);
      await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, superadmin.id));
    }
  });
});
