import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { NotificationCategories, NotificationKinds } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { createUnverifiedClient } from '../users/service.js';
import {
  NOTIFICATION_GROUP_OF,
  notificationAudience,
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
  ] as const)('%s %j -> %s', (kind, payload, group) => {
    expect(notificationGroupOf(kind, payload)).toBe(group);
  });

  it('an unknown kind has no group and does not throw', () => {
    expect(notificationGroupOf('ticket.created', {})).toBeNull();
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
    return { ...c, role: 'client' as const };
  };

  it('a requester-only person sees only the ticket board group; a client sees all four', async () => {
    const [a, b] = [await newGroup(), await newGroup()];
    const requester = await named();
    await addMembership(db, requester.id, a.id, 'ziadatel');
    expect(await visibleCategoriesFor(db, requester)).toEqual(['tickets']);
    await addMembership(db, requester.id, b.id, 'client');
    expect(await visibleCategoriesFor(db, requester)).toEqual([...NotificationCategories]);
  });

  it('a ziadatel member is in the audience of the tickets group only', async () => {
    const g = await newGroup();
    const [client, z] = [await named(), await named()];
    await addMembership(db, client.id, g.id, 'client');
    await addMembership(db, z.id, g.id, 'ziadatel');
    const tickets = await notificationAudience(db, g.id, 'tickets');
    expect([tickets.has(client.id), tickets.has(z.id)]).toEqual([true, true]);
    const chat = await notificationAudience(db, g.id, 'chat');
    expect([chat.has(client.id), chat.has(z.id)]).toEqual([true, false]);
  });
});
