import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testConfig, testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { createUnverifiedClient, updateNotificationPrefs } from '../users/service.js';
import { saveSubscription } from './push-subscriptions.js';
import { NOTIFICATIONS_PURGE_JOB, notificationsJobHandlers } from './jobs.js';
import { notificationEvents } from './schema.js';
import {
  DELIVER_JOB,
  deleteOldNotificationEvents,
  recordNotifications,
  requestDelivery,
} from './service.js';

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
      });
      // Neither can get a push or an email: recorded as delivered (see the pending-state test).
      expect(row.deliveredAt).toBeInstanceOf(Date);
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
    ).resolves.toEqual([]);
  });

  it('returns the recipients recorded; a repeated dedupeKey records nothing', async () => {
    const { group, a, b } = await setup();
    const input = {
      kind: 'task.deadline' as const,
      groupId: group.id,
      payload: { taskId: 't1' },
      dedupeKey: `deadline:${randomUUID()}`,
    };
    expect((await recordNotifications(db, { ...input, recipients: [a.id] })).sort()).toEqual([
      a.id,
    ]);
    expect((await recordNotifications(db, { ...input, recipients: [a.id, b.id] })).sort()).toEqual([
      b.id,
    ]);
    expect(await rowsFor([a.id, b.id])).toHaveLength(2);
  });
});

describe('recordNotifications pending state', () => {
  it('only a recipient who could get a push or an email waits for delivery', async () => {
    const { group, a, b } = await setup();
    const c = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
    await saveSubscription(db, a.id, {
      endpoint: `https://push.example.test/${randomUUID()}`,
      p256dh: 'pk',
      auth: 'au',
      userAgent: null,
    });
    await updateNotificationPrefs(db, b.id, { emailEnabled: true });
    const recorded = await recordNotifications(db, {
      kind: 'chat.message',
      groupId: group.id,
      recipients: [a.id, b.id, c.id],
      payload: { messageId: 'm1' },
    });
    expect(recorded.sort()).toEqual([a.id, b.id, c.id].sort());
    const rows = await rowsFor([a.id, b.id, c.id]);
    const delivered = (id: string) => rows.find((r) => r.userId === id)!.deliveredAt !== null;
    expect([delivered(a.id), delivered(b.id), delivered(c.id)]).toEqual([false, false, true]);
  });
});

describe('requestDelivery', () => {
  it('sends one deliver job with the unique users, nothing for none, and never throws', async () => {
    const sent: { name: string; data: object }[] = [];
    const jobs = { send: async (name: string, data: object) => void sent.push({ name, data }) };
    await requestDelivery(jobs, []);
    await requestDelivery(jobs, ['u1', 'u2', 'u1']);
    expect(sent).toEqual([{ name: DELIVER_JOB, data: { userIds: ['u1', 'u2'] } }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = { send: async () => Promise.reject(new Error('queue down')) };
    await expect(requestDelivery(failing, ['u1'])).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
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
    const deps = { db, config: testConfig(), push: null, jobs: { send: async () => {} } };
    await notificationsJobHandlers(deps)[NOTIFICATIONS_PURGE_JOB]!({});
    expect(await rowsFor([a.id])).toHaveLength(0);
    expect(await rowsFor([b.id])).toHaveLength(1);
  });
});

describe('migration 0010 backfill', () => {
  const migration = readFileSync(
    new URL('../../infra/db/migrations/0010_notifications_delivery.sql', import.meta.url),
    'utf8',
  );
  const backfill = migration.split('--> statement-breakpoint').at(-1)!.trim();

  it('the migration ends with the hand-written backfill of existing events', () => {
    expect(migration.split('\n')).toContain(
      'UPDATE "notification_events" SET "delivered_at" = now(), "emailed_at" = now() WHERE "delivered_at" IS NULL;',
    );
    expect(backfill).toMatch(/^-- Before this release nothing set delivered_at/);
  });

  it('existing events count as delivered and emailed, so the worker never sends the backlog', async () => {
    const { group, a } = await setup();
    const id = randomUUID();
    await db.insert(notificationEvents).values({
      id,
      userId: a.id,
      groupId: group.id,
      kind: 'chat.message',
      payload: {},
    });
    // The test database is shared: run the migration's own UPDATE limited to this row, so it
    // never locks or changes other files' events, and roll it back anyway.
    expect(backfill).toMatch(/WHERE "delivered_at" IS NULL;$/);
    const ownRowOnly = sql`${sql.raw(backfill.slice(0, -1))} AND "id" = ${id}`;
    class Rollback extends Error {}
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(ownRowOnly);
        const [row] = await tx
          .select()
          .from(notificationEvents)
          .where(eq(notificationEvents.id, id));
        expect(row?.deliveredAt).toBeInstanceOf(Date);
        expect(row?.emailedAt).toBeInstanceOf(Date);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
