import { sql } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import type { UserLanguage } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { BulkSendError } from '../../infra/email/bulk.js';
import { emitBulkUpdated } from './events.js';
import { imageSizes } from './images.js';
import { contentOf, imageIdsOf, personalMessage } from './message.js';
import { unsubscribedSql } from './subscriptions.js';

/**
 * The batch job of a sending campaign (spec §4): each run takes up to `BATCH_SIZE` people,
 * sends one email per person and queues the next run, spaced by `BULK_EMAIL_PER_MINUTE`.
 * Each row's state is committed before and after its call, and the idempotency key is
 * `<campaignId>:<userId>`, so a crashed or retried run never mails anyone twice.
 */

/** `{ campaignId }`: one run of a campaign's sending. */
export const BULK_BATCH_JOB = 'bulk-email.batch';
export const BATCH_SIZE = 20;
/** Attempts per person before a retryable error becomes `failed`. */
const MAX_ATTEMPTS = 3;
/** A row in `sending` older than this failed in an unknown way (the idempotency key lasts 24 h). */
const STUCK_SENDING_MS = 20 * 3_600_000;
/** A sending campaign whose rows did not change for this long lost its job (at least 10 min). */
const MIN_STALE_MS = 10 * 60_000;
/** Provider text kept on a failed row. */
const ERROR_LENGTH = 500;

/** Seconds between two runs, so at most `perMinute` emails go out a minute. */
export function nextDelaySeconds(perMinute: number): number {
  return Math.ceil((BATCH_SIZE / perMinute) * 60);
}

type BatchDeps = Pick<AppDeps, 'db' | 'config' | 'bulkEmail' | 'jobs'> & {
  io?: SocketIOServer | null;
};

type TakenRow = {
  user_id: string;
  email: string;
  name: string;
  language: UserLanguage;
  status: 'sending' | 'skipped';
  attempts: number;
};

/**
 * One run: stop unless the campaign is sending; take up to 20 queued (or crashed `sending`)
 * rows with `skip locked`, skip people who are now unsubscribed or disabled, mark the rest
 * `sending` with one more attempt and commit; send each; record the result; emit
 * `bulk:updated`; then queue the next run (`'more'`) or set the campaign `sent` (`'done'`).
 */
export async function runBatch(
  deps: BatchDeps,
  campaignId: string,
): Promise<'more' | 'done' | 'stopped'> {
  const { db, config, bulkEmail, jobs } = deps;
  const [row] = await db.execute<{
    status: string;
    subject: string;
    preheader: string;
    blocks: unknown;
    phone_blocks: unknown;
    content_version: number;
  }>(sql`select status, subject, preheader, blocks, phone_blocks, content_version
    from bulk_campaigns where id = ${campaignId}`);
  if (!row || row.status !== 'sending') return 'stopped';
  // A campaign sending since before Phase 31 is content version 1: upgraded like every read.
  const campaign = contentOf(row);

  const taken = await db.transaction(async (tx) => {
    // Re-check under a share lock, so a cancel that committed first is seen.
    const [locked] = await tx.execute<{ status: string }>(
      sql`select status from bulk_campaigns where id = ${campaignId} for share`,
    );
    if (locked?.status !== 'sending') return null;
    return tx.execute<TakenRow>(sql`
      with picked as (
        select r.user_id from bulk_recipients r
        where r.campaign_id = ${campaignId} and r.status in ('queued', 'sending')
        order by r.user_id
        limit ${BATCH_SIZE}
        for update skip locked
      ),
      flagged as (
        select p.user_id,
          case when u.disabled_at is not null then 'disabled'
            when ${unsubscribedSql(sql`p.user_id`)} then 'unsubscribed'
          end as reason
        from picked p join "user" u on u.id = p.user_id
      )
      update bulk_recipients r set
        status = case when f.reason is null then 'sending' else 'skipped' end,
        error = f.reason,
        attempts = case when f.reason is null then r.attempts + 1 else r.attempts end,
        updated_at = now()
      from flagged f
      where r.campaign_id = ${campaignId} and r.user_id = f.user_id
      returning r.user_id, r.email, r.name, r.language, r.status, r.attempts`);
  });
  if (taken === null) return 'stopped';

  const sending = [...taken].filter((r) => r.status === 'sending');
  if (sending.length > 0) {
    const sizes = await imageSizes(db, imageIdsOf(campaign));
    for (const row of sending) {
      const key = `${campaignId}:${row.user_id}`;
      const message = personalMessage(
        { config, bulkEmail },
        campaign,
        sizes,
        { userId: row.user_id, email: row.email, name: row.name, language: row.language },
        { tokenCampaignId: campaignId, idempotencyKey: key, postback: key },
      );
      try {
        const result = await bulkEmail.send(message);
        await db.execute(sql`
          update bulk_recipients set status = 'sent', error = null, sent_at = now(),
            provider_transaction_id = ${result.transactionId},
            provider_message_id = ${result.messageId}, updated_at = now()
          where campaign_id = ${campaignId} and user_id = ${row.user_id}`);
      } catch (error) {
        await recordFailure(deps, campaignId, row, error);
      }
    }
  }

  if (deps.io) emitBulkUpdated(deps.io, campaignId);

  const [left] = await db.execute<{ queued: boolean }>(sql`
    select exists (select 1 from bulk_recipients
      where campaign_id = ${campaignId} and status = 'queued') as queued`);
  if (left?.queued) {
    await jobs.send(
      BULK_BATCH_JOB,
      { campaignId },
      { startAfter: nextDelaySeconds(config.bulkEmailPerMinute) },
    );
    return 'more';
  }
  // Rows another run still holds in `sending` keep the campaign open; that run finishes it.
  const finished = await db.execute(sql`
    update bulk_campaigns set status = 'sent', finished_at = now(), updated_at = now()
    where id = ${campaignId} and status = 'sending'
      and not exists (select 1 from bulk_recipients
        where campaign_id = ${campaignId} and status in ('queued', 'sending'))
    returning id`);
  if (finished.length > 0 && deps.io) emitBulkUpdated(deps.io, campaignId);
  return 'done';
}

/**
 * A failed send: a retryable error goes back to `queued` (or `cancelled` when the campaign was
 * cancelled meanwhile) until the third attempt, then `failed`; a final error is `failed` at once.
 */
async function recordFailure(
  deps: BatchDeps,
  campaignId: string,
  row: TakenRow,
  error: unknown,
): Promise<void> {
  const known = error instanceof BulkSendError;
  const retryable = known ? error.retryable : true;
  let message = error instanceof Error ? error.message : String(error);
  if (known && error.status === 422) {
    message = `Elastic refused a changed email for the same idempotency key (422): ${message}`;
  }
  message = message.slice(0, ERROR_LENGTH);
  if (!known) console.error(`bulk-email: sending ${campaignId} to ${row.user_id} failed`, error);
  const again = retryable && row.attempts < MAX_ATTEMPTS;
  await deps.db.execute(sql`
    update bulk_recipients set
      status = ${
        again
          ? sql`case when (select status from bulk_campaigns where id = ${campaignId}) = 'sending'
              then 'queued' else 'cancelled' end`
          : sql`'failed'`
      },
      error = ${message}, updated_at = now()
    where campaign_id = ${campaignId} and user_id = ${row.user_id}`);
}

/**
 * The daily sweep (spec §4): rows of sending campaigns stuck in `sending` for 20 h become
 * `failed` with `unknown` (their idempotency key is about to expire, so a resend could
 * duplicate); a sending campaign whose rows did not change for a while (its job was lost) gets
 * a new batch job. "A while" is 10 minutes or three run delays, whichever is longer, so a
 * campaign that is still moving never gets a second job chain.
 */
export async function sweepStuck(
  deps: Pick<AppDeps, 'db' | 'config' | 'jobs'>,
  now: Date,
): Promise<void> {
  const { db, config, jobs } = deps;
  const stuckBefore = new Date(now.getTime() - STUCK_SENDING_MS);
  await db.execute(sql`
    update bulk_recipients set status = 'failed', error = 'unknown', updated_at = now()
    where campaign_id in (select id from bulk_campaigns where status = 'sending')
      and status = 'sending' and updated_at < ${stuckBefore.toISOString()}::timestamptz`);

  const staleMs = Math.max(MIN_STALE_MS, 3 * nextDelaySeconds(config.bulkEmailPerMinute) * 1000);
  const staleBefore = new Date(now.getTime() - staleMs);
  const stale = await db.execute<{ id: string }>(sql`
    select c.id from bulk_campaigns c
    where c.status = 'sending'
      and coalesce(
        (select max(r.updated_at) from bulk_recipients r where r.campaign_id = c.id),
        c.send_started_at
      ) < ${staleBefore.toISOString()}::timestamptz`);
  for (const { id } of stale) await jobs.send(BULK_BATCH_JOB, { campaignId: id });
}
