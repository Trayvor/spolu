import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  BulkBlockSchema,
  flattenBlocks,
  type BulkBlock,
  type BulkCampaignDto,
  type BulkCampaignStatus,
  type BulkNotReadyProblem,
  type BulkTestSendResult,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { BulkSendError } from '../../infra/email/bulk.js';
import { getUserById } from '../users/service.js';
import { recipientsSql } from './audience.js';
import { BULK_BATCH_JOB } from './batch.js';
import {
  CampaignNotFoundError,
  EmptyAudienceError,
  NotDraftError,
  NotReadyError,
  NotSendingError,
} from './errors.js';
import { imageExists, imageSizes } from './images.js';
import { contentOf, imageIdsOf, personalMessage } from './message.js';
import { getCampaign } from './service.js';
import { TEST_CAMPAIGN_ID } from './token.js';
import { userActor, type AuditActor } from '../audit/actor.js';
import { recordAudit, type AuditEntry } from '../audit/service.js';

/**
 * Starting, cancelling and test-sending a campaign (spec §4). The real send runs in the batch
 * job (`batch.ts`); these functions only change state and queue jobs.
 */

/** `{ campaignId, userId, key }`: one test email to one admin; `key` is its idempotency key. */
export const BULK_TEST_JOB = 'bulk-email.test';
export type BulkTestJobData = { campaignId: string; userId: string; key: string };

/** The prefix of a test email's subject. */
const TEST_SUBJECT_PREFIX = '[Test] ';

/**
 * What a campaign misses to be sent: a subject, a block, existing images, valid links. Limits
 * are checked by the shared schema on every save; a block that fails it here has a bad link.
 */
export function validateForSend(
  campaign: {
    subject: string;
    blocks: readonly BulkBlock[];
    /** Phase 31: checked too when it is its own version; its problems say `phone: true`. */
    phoneBlocks?: readonly BulkBlock[] | null;
  },
  existingImageIds: ReadonlySet<string>,
): BulkNotReadyProblem[] {
  const problems: BulkNotReadyProblem[] = [];
  if (campaign.subject.trim() === '') problems.push({ problem: 'subject_missing' });
  const check = (blocks: readonly BulkBlock[], tag: { phone?: true }) => {
    if (blocks.length === 0) problems.push({ problem: 'no_blocks', ...tag });
    for (const block of flattenBlocks(blocks)) {
      if (block.type === 'image' && !existingImageIds.has(block.imageId)) {
        problems.push({ blockId: block.id, problem: 'image_missing', ...tag });
      } else if (
        (block.type === 'button' || block.type === 'image') &&
        !BulkBlockSchema.safeParse(block).success
      ) {
        problems.push({ blockId: block.id, problem: 'invalid_url', ...tag });
      }
    }
  };
  check(campaign.blocks, {});
  if (campaign.phoneBlocks) check(campaign.phoneBlocks, { phone: true });
  return problems;
}

type LockedCampaign = {
  status: BulkCampaignStatus;
  subject: string;
  preheader: string;
  blocks: unknown;
  phone_blocks: unknown;
  content_version: number;
  audience: BulkCampaignDto['audience'];
};

/**
 * Starts sending a draft, in one transaction: lock the row, check it is a ready draft, insert
 * the recipients in one `insert … select` (`EmptyAudienceError` when nobody), set `sending`.
 * After the commit it queues the first batch. The caller emits `bulk:updated`.
 */
export async function startSending(
  deps: Pick<AppDeps, 'db' | 'config' | 'jobs'>,
  actor: SessionUser,
  id: string,
  by: AuditActor = userActor(actor),
): Promise<BulkCampaignDto> {
  const { db, config, jobs } = deps;
  await db.transaction(async (tx) => {
    const [campaign] = await tx.execute<LockedCampaign>(sql`
      select status, subject, preheader, blocks, phone_blocks, content_version, audience
      from bulk_campaigns where id = ${id} for update`);
    if (!campaign) throw new CampaignNotFoundError();
    if (campaign.status !== 'draft') throw new NotDraftError();
    const content = contentOf(campaign);
    const problems = validateForSend(content, await imageExists(tx, imageIdsOf(content)));
    if (problems.length > 0) throw new NotReadyError(problems);

    const [inserted] = await tx.execute<{ count: number }>(sql`
      with ins as (
        insert into bulk_recipients (campaign_id, user_id, email, name, language)
        select ${id}, r.user_id, r.email, r.name, r.language
        from (${recipientsSql(campaign.audience)}) r
        returning 1
      )
      select count(*)::int as count from ins`);
    const count = inserted?.count ?? 0;
    if (count === 0) throw new EmptyAudienceError();

    await tx.execute(sql`
      update bulk_campaigns set status = 'sending', sender = ${config.bulkEmail.from},
        recipient_count = ${count}, sent_by = ${actor.id}, send_started_at = now(),
        updated_at = now()
      where id = ${id}`);
    // The subject and the number of recipients; never the content (spec §9).
    await recordAudit(tx, by, [
      campaignEntry(id, campaign.subject, 'sent', {
        subject: { to: campaign.subject },
        recipients: { to: count },
      }),
    ]);
  });
  await jobs.send(BULK_BATCH_JOB, { campaignId: id });
  return (await getCampaign(db, id))!;
}

/**
 * Stops a sending campaign, in one statement: `cancelled`, `finished_at`, and every queued row
 * `cancelled`. Rows already `sending` finish; the next batch sees the status and stops.
 */
export async function cancelSending(
  deps: Pick<AppDeps, 'db'>,
  id: string,
  by?: AuditActor,
): Promise<BulkCampaignDto> {
  const { db } = deps;
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ id: string; subject: string }>(sql`
    with c as (
      update bulk_campaigns set status = 'cancelled', finished_at = now(), updated_at = now()
      where id = ${id} and status = 'sending'
      returning id, subject
    ),
    r as (
      update bulk_recipients set status = 'cancelled', updated_at = now()
      where campaign_id in (select id from c) and status = 'queued'
    )
    select id, subject from c`);
    if (row && by) await recordAudit(tx, by, [campaignEntry(id, row.subject, 'cancelled')]);
    return row;
  });
  if (!done) {
    const exists = await getCampaign(db, id);
    if (!exists) throw new CampaignNotFoundError();
    throw new NotSendingError();
  }
  return (await getCampaign(db, id))!;
}

/**
 * Queues a test of the campaign as it is now to the signed-in admin's own address only (never
 * another). Any state may be tested; it must be ready (`NotReadyError`).
 */
export async function queueTestSend(
  deps: Pick<AppDeps, 'db' | 'jobs'>,
  actor: SessionUser,
  id: string,
): Promise<BulkTestSendResult> {
  const { db, jobs } = deps;
  const campaign = await getCampaign(db, id);
  if (!campaign) throw new CampaignNotFoundError();
  const problems = validateForSend(campaign, await imageExists(db, imageIdsOf(campaign)));
  if (problems.length > 0) throw new NotReadyError(problems);
  const me = await getUserById(db, actor.id);
  const to = me?.email ?? actor.email;
  const data: BulkTestJobData = { campaignId: id, userId: actor.id, key: randomUUID() };
  await jobs.send(BULK_TEST_JOB, data);
  return { to };
}

/**
 * The test job: renders the campaign for the admin (name, language), subject prefixed
 * `[Test] `, with an unsubscribe token for the campaign id `test`, and sends it through the
 * bulk sender. A retryable error throws (pg-boss retries with the same key); a final one is
 * logged. A campaign or admin deleted meanwhile is nothing to do.
 */
export async function runTestSend(
  deps: Pick<AppDeps, 'db' | 'config' | 'bulkEmail'>,
  data: BulkTestJobData,
): Promise<void> {
  const { db } = deps;
  const [campaign, me] = await Promise.all([
    getCampaign(db, data.campaignId),
    getUserById(db, data.userId),
  ]);
  if (!campaign || !me || me.disabledAt) return;
  const message = personalMessage(
    deps,
    campaign,
    await imageSizes(db, imageIdsOf(campaign)),
    { userId: me.id, email: me.email, name: me.name, language: me.language },
    {
      tokenCampaignId: TEST_CAMPAIGN_ID,
      idempotencyKey: `${TEST_CAMPAIGN_ID}:${data.key}`,
      postback: `${TEST_CAMPAIGN_ID}:${data.campaignId}:${me.id}`,
      subject: `${TEST_SUBJECT_PREFIX}${campaign.subject}`,
    },
  );
  try {
    await deps.bulkEmail.send(message);
  } catch (error) {
    if (error instanceof BulkSendError && !error.retryable) {
      console.error(`bulk-email: test send of ${data.campaignId} failed: ${error.message}`);
      return;
    }
    throw error;
  }
}

function campaignEntry(
  id: string,
  subject: string,
  action: 'sent' | 'cancelled',
  changes: AuditEntry['changes'] = {},
): AuditEntry {
  return {
    entityType: 'bulk_campaign',
    entityId: id,
    entityLabel: subject,
    groupId: null,
    action,
    changes,
  };
}
