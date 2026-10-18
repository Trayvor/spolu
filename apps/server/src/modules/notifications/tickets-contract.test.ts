import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../../deps.js';
import type { FakePushSender } from '../../infra/push/index.js';
import { buildTestApp } from '../../../test/test-app.js';
import { latestEmail } from '../../../test/mail.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, setNotificationChannel } from '../users/service.js';
import { deliverPending } from './deliver.js';
import { sendDueDigests } from './digest.js';
import { saveSubscription } from './push-subscriptions.js';
import { notificationEvents } from './schema.js';

/*
 * Item B's contract, before any ticket kind exists: `test.ticket` stands for a ticket kind by
 * mapping it to the `tickets` group and giving it a digest entry, as item B will.
 */
vi.mock('./categories.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./categories.js')>();
  return {
    ...real,
    notificationGroupOf: (kind: string, payload: Record<string, unknown>) =>
      kind === 'test.ticket' ? 'tickets' : real.notificationGroupOf(kind, payload),
  };
});
vi.mock('./digest-entries.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./digest-entries.js')>();
  return {
    ...real,
    digestEntry: (
      row: { kind: string; payload: Record<string, unknown> },
      ctx: Parameters<typeof real.digestEntry>[1],
    ) =>
      row.kind === 'test.ticket'
        ? {
            line: '#1 Login: Jana: help',
            url: `${ctx.publicUrl}/tickets/1`,
            button: 'Open ticket',
            topic: 'Ticket #1',
          }
        : real.digestEntry(row, ctx),
  };
});

let deps: AppDeps;
let push: FakePushSender;
let close: () => Promise<void>;
const admins: string[] = [];
beforeAll(async () => {
  ({ deps, push, close } = await buildTestApp());
});
afterAll(async () => {
  for (const id of admins) await deactivateUser(deps.db, id);
  await close();
});

async function subscribedAdmin() {
  const row = await addAdmin(deps.db, { email: `${randomUUID()}@example.com`, name: 'Admin' });
  admins.push(row.id);
  const endpoint = `https://push.example.test/${randomUUID()}`;
  await saveSubscription(deps.db, row.id, { endpoint, p256dh: 'pk', auth: 'au', userAgent: null });
  return { id: row.id, email: row.email, endpoint };
}

/**
 * Inserts one pending event and returns its id. Tests deliver by that id: the users here are
 * admins, who are people of every group, so other test files record events for them too.
 */
async function event(userId: string, kind: string, groupId: string | null): Promise<string> {
  const id = randomUUID();
  await deps.db.insert(notificationEvents).values({
    id,
    userId,
    groupId,
    kind,
    // A chat event with `ticketId` is a ticket chat's (Phase 21.6): this one is a group chat's.
    payload: kind === 'test.ticket' ? { ticketId: 't1' } : { channelId: 'c1' },
  });
  return id;
}
const sentTo = (endpoint: string) => push.sent.filter((s) => s.endpoint === endpoint);

describe('ticket events (item B contract)', () => {
  it('a ticket event without a client group reaches its recipient', async () => {
    const a = await subscribedAdmin();
    const eventId = await event(a.id, 'test.ticket', null);
    await deliverPending(deps, { eventIds: [eventId] });
    expect(sentTo(a.endpoint)).toHaveLength(1);
  });

  it('with a client group, the audience still applies', async () => {
    const group = await createGroup(deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const other = await createGroup(deps.db, {
      name: 'Iná',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const id = randomUUID();
    await deps.db.insert(user).values({
      id,
      email: `${randomUUID()}@example.com`,
      name: 'C',
      role: 'client',
      emailVerified: true,
    });
    await addMember(deps.db, other.id, id);
    const endpoint = `https://push.example.test/${randomUUID()}`;
    await saveSubscription(deps.db, id, { endpoint, p256dh: 'pk', auth: 'au', userAgent: null });
    const eventId = await event(id, 'test.ticket', group.id);
    await deliverPending(deps, { eventIds: [eventId] });
    expect(sentTo(endpoint)).toHaveLength(0);
  });

  it('an event of another group without a client group is still dropped', async () => {
    const a = await subscribedAdmin();
    const eventId = await event(a.id, 'chat.message', null);
    await deliverPending(deps, { eventIds: [eventId] });
    expect(sentTo(a.endpoint)).toHaveLength(0);
    const [row] = await deps.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.id, eventId));
    expect(row!.deliveredAt).toBeInstanceOf(Date);
  });

  it('a ticket event without a client group gets its own digest email', async () => {
    const a = await subscribedAdmin();
    await setNotificationChannel(deps.db, a.id, 'tickets', 'email');
    await deps.db.update(user).set({ language: 'en' }).where(eq(user.id, a.id));
    const eventId = await event(a.id, 'test.ticket', null);
    await deliverPending(deps, { eventIds: [eventId] });
    const later = new Date(Date.now() + deps.config.emailBatchDelayMs + 1000);
    expect(await sendDueDigests(deps, { now: later, userIds: [a.id] })).toBe(1);
    const mail = await latestEmail(a.email);
    // 2026-10-18: one change is its own subject.
    expect(mail.subject).toBe('#1 Login: Jana: help');
    expect(mail.text).toContain('#1 Login: Jana: help');
    expect(mail.text).toContain(`${deps.config.publicUrl}/tickets/1`);
  });
});
