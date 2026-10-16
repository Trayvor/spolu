import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { BulkEvents, type SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import {
  BulkSendError,
  createFakeBulkSender,
  type BulkEmailSender,
} from '../../infra/email/bulk.js';
import { testConfig, testDatabaseUrl } from '../../../test/test-config.js';
import {
  campaignRow,
  createRecordingJobs,
  newBulkAdmin,
  newBulkPerson,
  newReadyCampaign,
} from '../../../test/bulk-sending.js';
import { user } from '../users/schema.js';
import { BATCH_SIZE, BULK_BATCH_JOB, nextDelaySeconds, runBatch, sweepStuck } from './batch.js';
import { bulkRecipients, bulkSubscriptions } from './schema.js';
import { cancelSending, startSending } from './send.js';
import { signUnsubscribeToken } from './token.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const config = testConfig();

// One admin per file: every active admin slows the ticket tests that notify all admins.
let shared: Promise<SessionUser> | undefined;
const sharedAdmin = () => (shared ??= newBulkAdmin(db));

/** A fake Socket.IO server that records `to(room).emit(event, payload)`. */
function fakeIo() {
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => void emitted.push({ room, event, payload }),
    }),
  } as unknown as SocketIOServer;
  return { io, emitted };
}

/** A sending campaign to `count` new people, plus the deps of its batch runs. */
async function sendingCampaign(count: number) {
  const admin = await sharedAdmin();
  const people = [];
  for (let i = 0; i < count; i++) people.push(await newBulkPerson(db, { name: `P${i}` }));
  const id = await newReadyCampaign(
    db,
    admin,
    people.map((p) => p.id),
  );
  await startSending({ db, config, jobs: createRecordingJobs() }, admin, id);
  const bulkEmail = createFakeBulkSender();
  const jobs = createRecordingJobs();
  const { io, emitted } = fakeIo();
  return { id, people, bulkEmail, jobs, emitted, deps: { db, config, bulkEmail, jobs, io } };
}

const rowOf = async (campaignId: string, userId: string) =>
  (
    await db
      .select()
      .from(bulkRecipients)
      .where(and(eq(bulkRecipients.campaignId, campaignId), eq(bulkRecipients.userId, userId)))
  )[0]!;

const statusesOf = async (campaignId: string) =>
  (
    await db
      .select({ status: bulkRecipients.status })
      .from(bulkRecipients)
      .where(eq(bulkRecipients.campaignId, campaignId))
  ).map((r) => r.status);

describe('nextDelaySeconds', () => {
  it('spreads a batch over the per-minute limit', () => {
    expect(BATCH_SIZE).toBe(20);
    expect(nextDelaySeconds(120)).toBe(10);
    expect(nextDelaySeconds(60)).toBe(20);
    expect(nextDelaySeconds(7)).toBe(172);
  });
});

describe('runBatch', () => {
  it('sends 20, queues the next run with the delay, then finishes with status sent', async () => {
    const c = await sendingCampaign(25);

    expect(await runBatch(c.deps, c.id)).toBe('more');
    expect(c.bulkEmail.sent).toHaveLength(20);
    expect(c.jobs.sent).toEqual([
      { name: BULK_BATCH_JOB, data: { campaignId: c.id }, options: { startAfter: 10 } },
    ]);
    expect((await campaignRow(db, c.id)).status).toBe('sending');

    expect(await runBatch(c.deps, c.id)).toBe('done');
    expect(c.bulkEmail.sent).toHaveLength(25);
    expect(c.jobs.sent).toHaveLength(1);
    const campaign = await campaignRow(db, c.id);
    expect(campaign.status).toBe('sent');
    expect(campaign.finishedAt).not.toBeNull();
    expect(new Set(await statusesOf(c.id))).toEqual(new Set(['sent']));
  });

  it('each email is rendered for its person and links their signed unsubscribe token', async () => {
    const c = await sendingCampaign(1);
    await runBatch(c.deps, c.id);
    const person = c.people[0]!;
    const msg = c.bulkEmail.sent[0]!;
    const token = signUnsubscribeToken(config.appSecret, person.id, c.id);
    expect(msg.to).toEqual([person.email]);
    expect(msg.subject).toBe('News');
    expect(msg.html).toContain(`Hello ${person.name}`);
    expect(msg.unsubscribeUrl).toBe(`${config.publicUrl}/unsubscribe/${token}`);
    expect(msg.oneClickUrl).toBe(
      `${config.publicUrl}/api/bulk-email/unsubscribe/${token}/one-click`,
    );
    expect(msg.html).toContain(`/unsubscribe/${token}`);
  });

  it('Postback and Idempotency-Key are campaignId:userId and provider ids are stored', async () => {
    const c = await sendingCampaign(1);
    await runBatch(c.deps, c.id);
    const person = c.people[0]!;
    const msg = c.bulkEmail.sent[0]!;
    expect(msg.postback).toBe(`${c.id}:${person.id}`);
    expect(msg.idempotencyKey).toBe(`${c.id}:${person.id}`);
    const row = await rowOf(c.id, person.id);
    expect(row).toMatchObject({
      status: 'sent',
      attempts: 1,
      error: null,
      providerTransactionId: 'fake-tx-1',
      providerMessageId: 'fake-msg-1',
    });
    expect(row.sentAt).not.toBeNull();
  });

  it('a person unsubscribed after the send started is skipped, never sent', async () => {
    const c = await sendingCampaign(2);
    const [stays, leaves] = c.people as [(typeof c.people)[0], (typeof c.people)[0]];
    await db.insert(bulkSubscriptions).values({
      userId: leaves.id,
      subscribed: false,
      email: leaves.email,
      source: 'link',
      changedAt: new Date(),
    });
    expect(await runBatch(c.deps, c.id)).toBe('done');
    expect(c.bulkEmail.sent.map((m) => m.to[0])).toEqual([stays.email]);
    expect(await rowOf(c.id, leaves.id)).toMatchObject({
      status: 'skipped',
      error: 'unsubscribed',
      attempts: 0,
    });
  });

  it('a disabled person is skipped with error disabled', async () => {
    const c = await sendingCampaign(1);
    const person = c.people[0]!;
    await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, person.id));
    await runBatch(c.deps, c.id);
    expect(c.bulkEmail.sent).toEqual([]);
    expect(await rowOf(c.id, person.id)).toMatchObject({ status: 'skipped', error: 'disabled' });
  });

  it('a retryable failure goes back to queued; the third failure is failed', async () => {
    const c = await sendingCampaign(1);
    const person = c.people[0]!;
    c.bulkEmail.failNext(503);
    expect(await runBatch(c.deps, c.id)).toBe('more');
    expect(await rowOf(c.id, person.id)).toMatchObject({ status: 'queued', attempts: 1 });
    c.bulkEmail.failNext('network');
    await runBatch(c.deps, c.id);
    expect(await rowOf(c.id, person.id)).toMatchObject({ status: 'queued', attempts: 2 });
    c.bulkEmail.failNext(429);
    expect(await runBatch(c.deps, c.id)).toBe('done');
    const row = await rowOf(c.id, person.id);
    expect(row).toMatchObject({ status: 'failed', attempts: 3 });
    expect(row.error).toContain('429');
    expect((await campaignRow(db, c.id)).status).toBe('sent');
  });

  it('a 400 is failed at once with the provider message', async () => {
    const c = await sendingCampaign(1);
    c.bulkEmail.failNext(400);
    expect(await runBatch(c.deps, c.id)).toBe('done');
    const row = await rowOf(c.id, c.people[0]!.id);
    expect(row).toMatchObject({ status: 'failed', attempts: 1, error: 'fake 400' });
  });

  it('a row left in sending is sent again with the same key and delivered once', async () => {
    const c = await sendingCampaign(1);
    const person = c.people[0]!;
    // A crash after Elastic accepted the email but before the row became sent.
    await runBatch(c.deps, c.id);
    await db
      .update(bulkRecipients)
      .set({ status: 'sending', sentAt: null, providerTransactionId: null })
      .where(eq(bulkRecipients.campaignId, c.id));
    await db.execute(sql`update bulk_campaigns set status = 'sending' where id = ${c.id}`);

    expect(await runBatch(c.deps, c.id)).toBe('done');
    const key = `${c.id}:${person.id}`;
    expect(c.bulkEmail.callsByKey.get(key)).toBe(2);
    expect(c.bulkEmail.sent.filter((m) => m.idempotencyKey === key)).toHaveLength(1);
    expect(await rowOf(c.id, person.id)).toMatchObject({
      status: 'sent',
      attempts: 2,
      providerTransactionId: 'fake-tx-1',
    });
  });

  it('a cancelled campaign stops and sends nothing', async () => {
    const c = await sendingCampaign(2);
    await cancelSending({ db }, c.id);
    expect(await runBatch(c.deps, c.id)).toBe('stopped');
    expect(c.bulkEmail.sent).toEqual([]);
    expect(c.jobs.sent).toEqual([]);
  });

  it('a retryable failure after a cancel leaves the row cancelled, not queued', async () => {
    const c = await sendingCampaign(1);
    const person = c.people[0]!;
    // The row was taken just before the cancel; its send fails retryably afterwards.
    const failing: BulkEmailSender = {
      unsubscribeHref: (u) => u,
      async send() {
        await cancelSending({ db }, c.id);
        throw new BulkSendError('busy', true, 503);
      },
    };
    await runBatch({ ...c.deps, bulkEmail: failing }, c.id);
    expect((await rowOf(c.id, person.id)).status).toBe('cancelled');
    expect((await campaignRow(db, c.id)).status).toBe('cancelled');
  });

  it('emits bulk:updated to the admins room after a run and when it finishes', async () => {
    const c = await sendingCampaign(1);
    await runBatch(c.deps, c.id);
    expect(c.emitted.length).toBeGreaterThanOrEqual(1);
    expect(c.emitted).toContainEqual({
      room: 'admins',
      event: BulkEvents.updated,
      payload: { campaignId: c.id },
    });
  });
});

describe('sweepStuck', () => {
  it('fails rows stuck in sending for 21 h and leaves 19 h rows', async () => {
    const c = await sendingCampaign(2);
    const [old, recent] = c.people as [(typeof c.people)[0], (typeof c.people)[0]];
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    await db
      .update(bulkRecipients)
      .set({ status: 'sending', updatedAt: hoursAgo(21) })
      .where(and(eq(bulkRecipients.campaignId, c.id), eq(bulkRecipients.userId, old.id)));
    await db
      .update(bulkRecipients)
      .set({ status: 'sending', updatedAt: hoursAgo(19) })
      .where(and(eq(bulkRecipients.campaignId, c.id), eq(bulkRecipients.userId, recent.id)));

    await sweepStuck({ db, config, jobs: c.jobs }, now);

    expect(await rowOf(c.id, old.id)).toMatchObject({ status: 'failed', error: 'unknown' });
    expect((await rowOf(c.id, recent.id)).status).toBe('sending');
  });

  it('re-queues a sending campaign without progress, not one that just moved', async () => {
    const stale = await sendingCampaign(1);
    const fresh = await sendingCampaign(1);
    const now = new Date();
    await db
      .update(bulkRecipients)
      .set({ updatedAt: new Date(now.getTime() - 3_600_000) })
      .where(eq(bulkRecipients.campaignId, stale.id));
    const jobs = createRecordingJobs();

    await sweepStuck({ db, config, jobs }, now);

    const queued = jobs.sent.map((j) => (j.data as { campaignId: string }).campaignId);
    expect(queued).toContain(stale.id);
    expect(queued).not.toContain(fresh.id);
    expect(jobs.sent.every((j) => j.name === BULK_BATCH_JOB)).toBe(true);
  });
});
