import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { BulkSubscriptionSource } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getUserById, getUsersByEmails } from '../users/service.js';
import { bulkCampaigns, bulkSubscriptions } from './schema.js';

/**
 * A person's bulk email setting (spec §5, P3, P4). Spolu is the source of truth; no row means
 * subscribed. Only bulk email reads it: login codes and notifications never do (P5).
 */

/** True unless the person unsubscribed. */
export async function isSubscribed(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ subscribed: bulkSubscriptions.subscribed })
    .from(bulkSubscriptions)
    .where(eq(bulkSubscriptions.userId, userId));
  return row?.subscribed ?? true;
}

/**
 * Sets a person's setting. `changed` only when it flipped: a repeated unsubscribe keeps the
 * first change (its campaign and time), and subscribing a person without a row writes nothing.
 * A campaign id that is no campaign (a deleted one) is stored as null; an unknown user is
 * `unchanged`.
 */
export async function setSubscribed(
  db: Db,
  userId: string,
  subscribed: boolean,
  source: BulkSubscriptionSource,
  campaignId: string | null,
): Promise<'changed' | 'unchanged'> {
  const person = await getUserById(db, userId);
  if (!person) return 'unchanged';
  const now = new Date();
  // Only the campaign's own table is read: a link of a deleted campaign still unsubscribes.
  const campaign = campaignId
    ? sql`(select ${bulkCampaigns.id} from ${bulkCampaigns} where ${bulkCampaigns.id} = ${campaignId})`
    : null;

  if (subscribed) {
    const rows = await db
      .update(bulkSubscriptions)
      .set({ subscribed: true, email: person.email, source, campaignId: campaign, changedAt: now })
      .where(and(eq(bulkSubscriptions.userId, userId), eq(bulkSubscriptions.subscribed, false)))
      .returning({ userId: bulkSubscriptions.userId });
    return rows.length > 0 ? 'changed' : 'unchanged';
  }

  const rows = await db
    .insert(bulkSubscriptions)
    .values({
      userId,
      subscribed: false,
      email: person.email,
      campaignId: campaign,
      source,
      changedAt: now,
    })
    .onConflictDoUpdate({
      target: bulkSubscriptions.userId,
      set: {
        subscribed: false,
        email: sql`excluded.email`,
        campaignId: sql`excluded.campaign_id`,
        source: sql`excluded.source`,
        changedAt: sql`excluded.changed_at`,
      },
      setWhere: eq(bulkSubscriptions.subscribed, true),
    })
    .returning({ userId: bulkSubscriptions.userId });
  return rows.length > 0 ? 'changed' : 'unchanged';
}

/**
 * A condition true when the user in `userIdColumn` unsubscribed; for the audience and the batch
 * job (a primary key lookup).
 */
export function unsubscribedSql(userIdColumn: AnyPgColumn | SQL): SQL {
  return sql`exists (select 1 from ${bulkSubscriptions} where ${bulkSubscriptions.userId} = ${userIdColumn} and ${bulkSubscriptions.subscribed} = false)`;
}

/**
 * Copies unsubscribes and complaints recorded by the provider (the daily safety net, spec §5):
 * each address of a Spolu user becomes unsubscribed with source `provider` and the provider's
 * date, unless the person already unsubscribed or their row was changed in Spolu at or after
 * that date. Answers how many people changed. One query to match, one upsert.
 */
export async function applyProviderSuppressions(
  db: Db,
  records: { email: string; date: Date }[],
): Promise<number> {
  if (records.length === 0) return 0;
  const users = await getUsersByEmails(
    db,
    records.map((r) => r.email),
  );
  const idByEmail = new Map(users.map((u) => [u.email, u.id]));
  // One row per person (an address can be both unsubscribed and a complaint): the newest date.
  const latest = new Map<string, { email: string; date: Date }>();
  for (const r of records) {
    const email = r.email.trim().toLowerCase();
    const id = idByEmail.get(email);
    if (!id) continue;
    const seen = latest.get(id);
    if (!seen || seen.date < r.date) latest.set(id, { email, date: r.date });
  }
  if (latest.size === 0) return 0;

  const rows = await db
    .insert(bulkSubscriptions)
    .values(
      [...latest].map(([userId, { email, date }]) => ({
        userId,
        subscribed: false,
        email,
        campaignId: null,
        source: 'provider' as const,
        changedAt: date,
      })),
    )
    .onConflictDoUpdate({
      target: bulkSubscriptions.userId,
      set: {
        subscribed: false,
        email: sql`excluded.email`,
        campaignId: null,
        source: sql`excluded.source`,
        changedAt: sql`excluded.changed_at`,
      },
      setWhere: sql`${bulkSubscriptions.subscribed} = true and ${bulkSubscriptions.changedAt} < excluded.changed_at`,
    })
    .returning({ userId: bulkSubscriptions.userId });
  return rows.length;
}
