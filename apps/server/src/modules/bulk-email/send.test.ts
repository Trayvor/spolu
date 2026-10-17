import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BulkBlock, SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { createFakeBulkSender } from '../../infra/email/bulk.js';
import { testConfig, testDatabaseUrl } from '../../../test/test-config.js';
import {
  campaignRow,
  createRecordingJobs,
  newBulkAdmin,
  newBulkPerson,
  newReadyCampaign,
} from '../../../test/bulk-sending.js';
import { user } from '../users/schema.js';
import { BULK_BATCH_JOB } from './batch.js';
import {
  CampaignNotFoundError,
  EmptyAudienceError,
  NotDraftError,
  NotReadyError,
  NotSendingError,
} from './errors.js';
import { bulkRecipients, bulkSubscriptions } from './schema.js';
import {
  BULK_TEST_JOB,
  cancelSending,
  queueTestSend,
  runTestSend,
  startSending,
  validateForSend,
} from './send.js';
import { signUnsubscribeToken, TEST_CAMPAIGN_ID } from './token.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const config = testConfig();

// One admin per file: every active admin slows the ticket tests that notify all admins.
let shared: Promise<SessionUser> | undefined;
const sharedAdmin = () => (shared ??= newBulkAdmin(db));

const recipientsOf = (campaignId: string) =>
  db.select().from(bulkRecipients).where(eq(bulkRecipients.campaignId, campaignId));

describe('validateForSend', () => {
  const image: BulkBlock = { id: 'i1', type: 'image', imageId: 'img-1', alt: 'Photo' };

  it('a ready campaign has no problems', () => {
    expect(validateForSend({ subject: 'Hi', blocks: [image] }, new Set(['img-1']))).toEqual([]);
  });

  it('a blank subject is subject_missing', () => {
    expect(validateForSend({ subject: '  ', blocks: [image] }, new Set(['img-1']))).toEqual([
      { problem: 'subject_missing' },
    ]);
  });

  it('no blocks is no_blocks', () => {
    expect(validateForSend({ subject: 'Hi', blocks: [] }, new Set())).toEqual([
      { problem: 'no_blocks' },
    ]);
  });

  it('an image that does not exist is image_missing at its block', () => {
    expect(validateForSend({ subject: 'Hi', blocks: [image] }, new Set())).toEqual([
      { blockId: 'i1', problem: 'image_missing' },
    ]);
  });

  it('a bad button URL or image link is invalid_url at its block', () => {
    const blocks = [
      { id: 'k1', type: 'button', label: 'Go', url: 'javascript:alert(1)', align: 'left' },
      { ...image, id: 'i2', href: 'ftp://x' },
    ] as BulkBlock[];
    expect(validateForSend({ subject: 'Hi', blocks }, new Set(['img-1']))).toEqual([
      { blockId: 'k1', problem: 'invalid_url' },
      { blockId: 'i2', problem: 'invalid_url' },
    ]);
  });
});

describe('startSending', () => {
  it('freezes recipients and sets sending, sender, recipient_count, then queues the batch', async () => {
    const admin = await sharedAdmin();
    const a = await newBulkPerson(db, { name: 'Anna', language: 'en' });
    const b = await newBulkPerson(db, { name: 'Boris' });
    const id = await newReadyCampaign(db, admin, [a.id, b.id]);
    const jobs = createRecordingJobs();

    const dto = await startSending({ db, config, jobs }, admin, id);

    expect(dto).toMatchObject({
      status: 'sending',
      sender: config.bulkEmail.from,
      recipientCount: 2,
      sentBy: admin.id,
      sentByName: admin.name,
    });
    expect(dto.sendStartedAt).not.toBeNull();
    expect(dto.counts.queued).toBe(2);
    const rows = await recipientsOf(id);
    expect(rows.map((r) => [r.userId, r.email, r.name, r.language, r.status]).sort()).toEqual(
      [
        [a.id, a.email, 'Anna', 'en', 'queued'],
        [b.id, b.email, 'Boris', 'sk', 'queued'],
      ].sort(),
    );
    expect(jobs.sent).toEqual([{ name: BULK_BATCH_JOB, data: { campaignId: id } }]);
  });

  it('leaves out an unsubscribed person', async () => {
    const admin = await sharedAdmin();
    const a = await newBulkPerson(db);
    const b = await newBulkPerson(db);
    await db.insert(bulkSubscriptions).values({
      userId: b.id,
      subscribed: false,
      email: b.email,
      source: 'profile',
      changedAt: new Date(),
    });
    const id = await newReadyCampaign(db, admin, [a.id, b.id]);
    await startSending({ db, config, jobs: createRecordingJobs() }, admin, id);
    expect((await recipientsOf(id)).map((r) => r.userId)).toEqual([a.id]);
  });

  it('with no recipients → EmptyAudienceError and still a draft without rows', async () => {
    const admin = await sharedAdmin();
    const id = await newReadyCampaign(db, admin, []);
    const jobs = createRecordingJobs();
    await expect(startSending({ db, config, jobs }, admin, id)).rejects.toBeInstanceOf(
      EmptyAudienceError,
    );
    expect((await campaignRow(db, id)).status).toBe('draft');
    expect(await recipientsOf(id)).toEqual([]);
    expect(jobs.sent).toEqual([]);
  });

  it('a campaign that is not ready → NotReadyError with the problems', async () => {
    const admin = await sharedAdmin();
    const a = await newBulkPerson(db);
    const id = await newReadyCampaign(db, admin, [a.id], { subject: '' });
    const error = await startSending({ db, config, jobs: createRecordingJobs() }, admin, id).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NotReadyError);
    expect((error as NotReadyError).problems).toEqual([{ problem: 'subject_missing' }]);
    expect((await campaignRow(db, id)).status).toBe('draft');
  });

  it('two concurrent sends: one starts, the other is NotDraftError', async () => {
    const admin = await sharedAdmin();
    const a = await newBulkPerson(db);
    const id = await newReadyCampaign(db, admin, [a.id]);
    const jobs = createRecordingJobs();
    const results = await Promise.allSettled([
      startSending({ db, config, jobs }, admin, id),
      startSending({ db, config, jobs }, admin, id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(NotDraftError);
    expect(await recipientsOf(id)).toHaveLength(1);
    expect(jobs.sent).toHaveLength(1);
  });

  it('an unknown campaign → CampaignNotFoundError', async () => {
    const admin = await sharedAdmin();
    await expect(
      startSending({ db, config, jobs: createRecordingJobs() }, admin, randomUUID()),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);
  });
});

describe('cancelSending', () => {
  it('marks queued rows cancelled and the campaign cancelled; a sending row finishes', async () => {
    const admin = await sharedAdmin();
    const a = await newBulkPerson(db);
    const b = await newBulkPerson(db);
    const id = await newReadyCampaign(db, admin, [a.id, b.id]);
    await startSending({ db, config, jobs: createRecordingJobs() }, admin, id);
    await db
      .update(bulkRecipients)
      .set({ status: 'sending' })
      .where(and(eq(bulkRecipients.campaignId, id), eq(bulkRecipients.userId, a.id)));

    const dto = await cancelSending({ db }, id);

    expect(dto.status).toBe('cancelled');
    expect(dto.finishedAt).not.toBeNull();
    expect(dto.counts).toMatchObject({ cancelled: 1, sending: 1, queued: 0 });
  });

  it('a draft or a cancelled campaign → NotSendingError; unknown → not found', async () => {
    const admin = await sharedAdmin();
    const a = await newBulkPerson(db);
    const id = await newReadyCampaign(db, admin, [a.id]);
    await expect(cancelSending({ db }, id)).rejects.toBeInstanceOf(NotSendingError);
    await startSending({ db, config, jobs: createRecordingJobs() }, admin, id);
    await cancelSending({ db }, id);
    await expect(cancelSending({ db }, id)).rejects.toBeInstanceOf(NotSendingError);
    await expect(cancelSending({ db }, randomUUID())).rejects.toBeInstanceOf(CampaignNotFoundError);
  });
});

describe('test send', () => {
  it('queues a job for the actor only and answers their address', async () => {
    const admin = await sharedAdmin();
    const id = await newReadyCampaign(db, admin, []);
    const jobs = createRecordingJobs();
    const result = await queueTestSend({ db, jobs }, admin, id);
    expect(result).toEqual({ to: admin.email });
    expect(jobs.sent).toHaveLength(1);
    expect(jobs.sent[0]).toMatchObject({
      name: BULK_TEST_JOB,
      data: { campaignId: id, userId: admin.id },
    });
  });

  it('a campaign that is not ready → NotReadyError, nothing queued', async () => {
    const admin = await sharedAdmin();
    const id = await newReadyCampaign(db, admin, [], { blocks: [] });
    const jobs = createRecordingJobs();
    await expect(queueTestSend({ db, jobs }, admin, id)).rejects.toBeInstanceOf(NotReadyError);
    expect(jobs.sent).toEqual([]);
  });

  it('reaches only the actor, with [Test] , their name and a token for the campaign id test', async () => {
    const admin = await newBulkAdmin(db, 'Tess');
    await db.update(user).set({ language: 'en' }).where(eq(user.id, admin.id));
    const other = await newBulkPerson(db);
    const id = await newReadyCampaign(db, admin, [other.id]);
    const jobs = createRecordingJobs();
    await queueTestSend({ db, jobs }, admin, id);
    const bulkEmail = createFakeBulkSender();

    await runTestSend({ db, config, bulkEmail }, jobs.sent[0]!.data as never);

    expect(bulkEmail.sent).toHaveLength(1);
    const msg = bulkEmail.sent[0]!;
    expect(msg.to).toEqual([admin.email]);
    expect(msg.subject).toBe('[Test] News');
    expect(msg.html).toContain('Hello Tess');
    expect(msg.html).not.toContain('data-sp-block'); // preview markers never go out
    expect(msg.html).toContain('Unsubscribe'); // English footer
    const token = signUnsubscribeToken(config.appSecret, admin.id, TEST_CAMPAIGN_ID);
    expect(msg.unsubscribeUrl).toBe(`${config.publicUrl}/unsubscribe/${token}`);
    expect(msg.html).toContain(`/unsubscribe/${token}`);
    // No recipient rows: a test is not part of the campaign.
    expect(await recipientsOf(id)).toEqual([]);
  });

  it('a retried test job reuses its idempotency key; a new test gets a new one', async () => {
    const admin = await sharedAdmin();
    const id = await newReadyCampaign(db, admin, []);
    const jobs = createRecordingJobs();
    await queueTestSend({ db, jobs }, admin, id);
    await queueTestSend({ db, jobs }, admin, id);
    const bulkEmail = createFakeBulkSender();
    await runTestSend({ db, config, bulkEmail }, jobs.sent[0]!.data as never);
    await runTestSend({ db, config, bulkEmail }, jobs.sent[0]!.data as never);
    await runTestSend({ db, config, bulkEmail }, jobs.sent[1]!.data as never);
    expect(bulkEmail.sent).toHaveLength(2);
  });

  it('a final provider error is not retried (no throw); a retryable one throws', async () => {
    const admin = await sharedAdmin();
    const id = await newReadyCampaign(db, admin, []);
    const jobs = createRecordingJobs();
    await queueTestSend({ db, jobs }, admin, id);
    const data = jobs.sent[0]!.data as never;
    const bulkEmail = createFakeBulkSender();
    bulkEmail.failNext(400);
    await expect(runTestSend({ db, config, bulkEmail }, data)).resolves.toBeUndefined();
    bulkEmail.failNext(503);
    await expect(runTestSend({ db, config, bulkEmail }, data)).rejects.toThrow();
  });
});
