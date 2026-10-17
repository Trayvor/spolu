import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import type { NotificationCategory, NotificationChannel, NotificationKind } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testConfig, testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { createUnverifiedClient, setNotificationChannel } from '../users/service.js';
import { saveSubscription } from './push-subscriptions.js';
import { NOTIFICATIONS_PURGE_JOB, notificationsJobHandlers } from './jobs.js';
import { notificationEvents } from './schema.js';
import {
  DELIVER_JOB,
  deleteOldNotificationEvents,
  recordManyNotifications,
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

  it('returns the ids of the events recorded; a repeated dedupeKey records nothing', async () => {
    const { group, a, b } = await setup();
    const input = {
      kind: 'task.deadline' as const,
      groupId: group.id,
      payload: { taskId: 't1' },
      dedupeKey: `deadline:${randomUUID()}`,
    };
    const first = await recordNotifications(db, { ...input, recipients: [a.id] });
    const second = await recordNotifications(db, { ...input, recipients: [a.id, b.id] });
    const idOf = async (userId: string) => (await rowsFor([userId])).map((r) => r.id);
    expect(first).toEqual(await idOf(a.id));
    expect(second).toEqual(await idOf(b.id));
    expect(await rowsFor([a.id, b.id])).toHaveLength(2);
  });
});

describe('recordNotifications pending state', () => {
  const device = (userId: string) =>
    saveSubscription(db, userId, {
      endpoint: `https://push.example.test/${randomUUID()}`,
      p256dh: 'pk',
      auth: 'au',
      userAgent: null,
    });
  const pending = async (
    kind: string,
    payload: Record<string, unknown>,
    channels: Partial<Record<NotificationCategory, NotificationChannel>>,
    opts: { device?: boolean; disabled?: boolean } = {},
  ) => {
    const { group, a } = await setup();
    if (opts.device ?? true) await device(a.id);
    for (const [category, channel] of Object.entries(channels)) {
      await setNotificationChannel(db, a.id, category as NotificationCategory, channel);
    }
    if (opts.disabled)
      await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, a.id));
    const recorded = await recordNotifications(db, {
      kind: kind as NotificationKind,
      groupId: group.id,
      recipients: [a.id],
      payload,
    });
    const rows = await rowsFor([a.id]);
    expect(recorded).toEqual(rows.map((r) => r.id));
    // Phase 27 S5: no row at all for someone the event never notifies.
    if (rows.length === 0) return 'skipped';
    return rows[0]!.deliveredAt === null;
  };

  it('the default push with a device waits; without a device it is delivered at once', async () => {
    expect(await pending('chat.message', { messageId: 'm' }, {})).toBe(true);
    expect(await pending('chat.message', { messageId: 'm' }, {}, { device: false })).toBe(false);
  });

  it('follows the channel of the event group', async () => {
    expect(await pending('task.moved', {}, { chat: 'none' })).toBe(true);
    expect(await pending('task.moved', {}, { tasks: 'email' }, { device: false })).toBe(true);
    expect(await pending('task.moved', {}, { tasks: 'both' }, { device: false })).toBe(true);
    expect(await pending('task.moved', {}, { tasks: 'push' }, { device: false })).toBe(false);
    // A task chat message belongs to the task board.
    expect(await pending('chat.message', { taskId: 't1' }, { chat: 'none' })).toBe(true);
  });

  it('records nothing for a recipient whose channel for the event group is none (S5)', async () => {
    expect(await pending('chat.message', {}, { chat: 'none' })).toBe('skipped');
    expect(await pending('chat.mention', {}, { chat: 'none' })).toBe('skipped');
    expect(await pending('task.moved', {}, { tasks: 'none' })).toBe('skipped');
    expect(await pending('chat.message', { taskId: 't1' }, { tasks: 'none' })).toBe('skipped');
    expect(await pending('chat.mention', { ticketId: 'k1' }, { tickets: 'none' })).toBe('skipped');
    expect(await pending('reminder.due', { subjectKind: 'knowledge' }, { knowledge: 'none' })).toBe(
      'skipped',
    );
  });

  it('records nothing for a disabled user; an unknown kind is delivered at once', async () => {
    expect(await pending('chat.message', {}, { chat: 'both' }, { disabled: true })).toBe('skipped');
    expect(await pending('ticket.bogus', {}, {})).toBe(false);
  });

  it('in one call, records the notified recipients only, and returns their ids', async () => {
    const { group, a, b } = await setup();
    await setNotificationChannel(db, a.id, 'chat', 'none');
    await setNotificationChannel(db, b.id, 'chat', 'email');
    const recorded = await recordManyNotifications(db, [
      { kind: 'chat.message', groupId: group.id, recipients: [a.id, b.id], payload: {} },
      { kind: 'task.moved', groupId: group.id, recipients: [a.id, b.id], payload: {} },
    ]);
    const rows = await rowsFor([a.id, b.id]);
    expect(rows.map((r) => `${r.userId === a.id ? 'a' : 'b'}:${r.kind}`).sort()).toEqual([
      'a:task.moved',
      'b:chat.message',
      'b:task.moved',
    ]);
    expect(recorded.sort()).toEqual(rows.map((r) => r.id).sort());
  });
});

describe('requestDelivery', () => {
  it('sends one deliver job with the unique event ids, nothing for none, and never throws', async () => {
    const sent: { name: string; data: object }[] = [];
    const jobs = { send: async (name: string, data: object) => void sent.push({ name, data }) };
    await requestDelivery(jobs, []);
    await requestDelivery(jobs, ['u1', 'u2', 'u1']); // event ids
    expect(sent).toEqual([{ name: DELIVER_JOB, data: { eventIds: ['u1', 'u2'] } }]);
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
