import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { BulkEventKind } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { bulkEvents, bulkRecipients } from './schema.js';
import { suppressPeople } from './subscriptions.js';

/**
 * Elastic Email's webhook events (ADR 0070). The payload is a flat JSON object with lowercase
 * names (`status`, `postback`, `messageid`, `transaction`, `date`, `category`, …); source:
 * Elastic's examples repository, docs/webhooks.md, "What arrives", and the help article
 * "Notification settings". Only the fields below are read; the address, IP, user agent and
 * clicked URL are never stored.
 */

const KIND_OF_STATUS: Record<string, BulkEventKind> = {
  Sent: 'delivered',
  Opened: 'opened',
  Clicked: 'clicked',
  Error: 'bounced',
  AbuseReport: 'complaint',
  Unsubscribed: 'unsubscribed',
};

/**
 * Bounce categories that stop later bulk email. Elastic documents only `NoMailbox` as permanent
 * ("will permanently turn the contact's status to Invalid", help article "What are the bounce
 * error categories and filters"); the others can pass, and Elastic keeps its own block list.
 */
const HARD_BOUNCES = new Set(['NoMailbox']);

/** Our postback is `<campaignId>:<userId>`; a test send's has a third part and is ignored. */
const POSTBACK = /^([^:\s]{1,100}):([^:\s]{1,100})$/;
const MAX_CATEGORY = 50;
/** A date further ahead than this (a wrong clock or a forged value) becomes the time received. */
const FUTURE_SLACK_MS = 5 * 60_000;

export type ElasticEvent = {
  /** Hash of `messageid`, `transaction`, `postback`, `status` and `date`: one event, once. */
  key: string;
  campaignId: string;
  userId: string;
  kind: BulkEventKind;
  occurredAt: Date;
  category: string | null;
  hardBounce: boolean;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Elastic's `date` ("date and time of the event, UTC"): the documented example is
 * `3/10/2012 10:20:30 AM`; ISO text, with or without a zone, is read too. Unreadable, missing or
 * in the future: `now`.
 */
export function parseElasticDate(value: unknown, now: Date): Date {
  if (typeof value !== 'string') return now;
  let date: Date | null = null;
  const us = US_DATE.exec(value.trim());
  if (us) {
    const [, month, day, year, hour, minute, second, half] = us;
    const h = (Number(hour) % 12) + (half!.toUpperCase() === 'PM' ? 12 : 0);
    date = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), h, Number(minute), Number(second)),
    );
  } else if (ISO_DATE.test(value.trim())) {
    const iso = value.trim();
    date = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
  }
  if (!date || Number.isNaN(date.getTime())) return now;
  return date.getTime() > now.getTime() + FUTURE_SLACK_MS ? now : date;
}

/**
 * The event of a verified webhook body, or null for anything to ignore: the save-time test
 * event (`status=opened` in lower case), an unknown status, or a postback that is not one of our
 * campaign emails (none, or a test send's).
 */
export function parseElasticEvent(body: unknown, now: Date): ElasticEvent | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  const status = text(fields.status);
  const kind = status !== null ? KIND_OF_STATUS[status] : undefined;
  const postback = text(fields.postback);
  const match = postback !== null ? POSTBACK.exec(postback) : null;
  if (!kind || !match) return null;
  const date = text(fields.date);
  const key = createHash('sha256')
    .update(
      JSON.stringify([text(fields.messageid), text(fields.transaction), postback, status, date]),
    )
    .digest('hex');
  const category = kind === 'bounced' ? text(fields.category) : null;
  return {
    key,
    campaignId: match[1]!,
    userId: match[2]!,
    kind,
    occurredAt: parseElasticDate(date, now),
    category: category?.slice(0, MAX_CATEGORY) ?? null,
    hardBounce: category !== null && HARD_BOUNCES.has(category),
  };
}

/** The recipient column holding the first time of each kind; an unsubscribe has none. */
const STAMP: Partial<
  Record<BulkEventKind, 'deliveredAt' | 'openedAt' | 'clickedAt' | 'bouncedAt' | 'complainedAt'>
> = {
  delivered: 'deliveredAt',
  opened: 'openedAt',
  clicked: 'clickedAt',
  bounced: 'bouncedAt',
  complaint: 'complainedAt',
};

/**
 * Stores one event (ADR 0070): `unknown` when the postback names no recipient row, `duplicate`
 * when the key was stored before, else `recorded`. A recorded event keeps the earliest time per
 * kind on the recipient row (what the report reads); a complaint, a hard bounce or an
 * unsubscribe also unsubscribes the person from bulk email, as the daily sync does (source
 * `provider`, never over a newer change made in Spolu). One transaction.
 */
export async function recordBulkEvent(
  db: Db,
  event: ElasticEvent,
): Promise<'recorded' | 'duplicate' | 'unknown'> {
  return db.transaction(async (tx) => {
    const where = and(
      eq(bulkRecipients.campaignId, event.campaignId),
      eq(bulkRecipients.userId, event.userId),
    );
    const [recipient] = await tx
      .select({ email: bulkRecipients.email })
      .from(bulkRecipients)
      .where(where);
    if (!recipient) return 'unknown';
    const inserted = await tx
      .insert(bulkEvents)
      .values({
        providerEventKey: event.key,
        campaignId: event.campaignId,
        userId: event.userId,
        kind: event.kind,
        occurredAt: event.occurredAt,
        category: event.category,
      })
      .onConflictDoNothing()
      .returning({ key: bulkEvents.providerEventKey });
    if (inserted.length === 0) return 'duplicate';

    const stamp = STAMP[event.kind];
    if (stamp) {
      // least() skips a null, so the first event sets the time and an earlier one moves it back.
      await tx
        .update(bulkRecipients)
        .set({
          [stamp]: sql`least(${bulkRecipients[stamp]}, ${event.occurredAt.toISOString()}::timestamptz)`,
        })
        .where(where);
    }
    const suppress =
      event.kind === 'complaint' ||
      event.kind === 'unsubscribed' ||
      (event.kind === 'bounced' && event.hardBounce);
    if (suppress) {
      await suppressPeople(tx, [
        { userId: event.userId, email: recipient.email, date: event.occurredAt },
      ]);
    }
    return 'recorded';
  });
}
