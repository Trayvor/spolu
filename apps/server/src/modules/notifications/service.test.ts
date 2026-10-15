import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { createUnverifiedClient } from '../users/service.js';
import { NOTIFICATIONS_PURGE_JOB, notificationsJobHandlers } from './jobs.js';
import { notificationEvents } from './schema.js';
import { deleteOldNotificationEvents, recordNotifications } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(close);

async function setup() {
  const group = await createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
  const a = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
  const b = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
  return { group, a, b };
}

const rowsFor = (userIds: string[]) =>
  db.select().from(notificationEvents).where(inArray(notificationEvents.userId, userIds));

describe('recordNotifications', () => {
  it('inserts one row per unique recipient', async () => {
    const { group, a, b } = await setup();
    await recordNotifications(db, {
      kind: 'chat.message',
      groupId: group.id,
      recipients: [a.id, b.id, a.id],
      payload: { messageId: 'm1' },
    });
    const rows = await rowsFor([a.id, b.id]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([a.id, b.id].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: 'chat.message',
        groupId: group.id,
        payload: { messageId: 'm1' },
        deliveredAt: null,
      });
    }
  });

  it("rolls back with the caller's transaction", async () => {
    const { group, a, b } = await setup();
    await expect(
      db.transaction(async (tx) => {
        await recordNotifications(tx, {
          kind: 'task.moved',
          groupId: group.id,
          recipients: [a.id, b.id],
          payload: {},
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await rowsFor([a.id, b.id])).toHaveLength(0);
  });

  it('with no recipients does nothing', async () => {
    await expect(
      recordNotifications(db, { kind: 'chat.mention', groupId: null, recipients: [], payload: {} }),
    ).resolves.toBeUndefined();
  });
});

describe('deleteOldNotificationEvents', () => {
  async function seedOldAndFresh() {
    const { group, a, b } = await setup();
    for (const user of [a, b]) {
      await recordNotifications(db, {
        kind: 'task.assigned',
        groupId: group.id,
        recipients: [user.id],
        payload: {},
      });
    }
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db
      .update(notificationEvents)
      .set({ createdAt: old })
      .where(eq(notificationEvents.userId, a.id));
    return { a, b };
  }

  it('deletes only rows older than the cutoff', async () => {
    const { a, b } = await seedOldAndFresh();
    await deleteOldNotificationEvents(db, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    expect(await rowsFor([a.id])).toHaveLength(0);
    expect(await rowsFor([b.id])).toHaveLength(1);
  });

  it('the purge job removes a 31 day old event and keeps a fresh one', async () => {
    const { a, b } = await seedOldAndFresh();
    await notificationsJobHandlers(db)[NOTIFICATIONS_PURGE_JOB]!({});
    expect(await rowsFor([a.id])).toHaveLength(0);
    expect(await rowsFor([b.id])).toHaveLength(1);
  });
});
