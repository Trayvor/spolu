import { and, eq, inArray } from 'drizzle-orm';
import type { UserLanguage } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { listGroupPeople, namedClientsOfGroups } from '../groups/service.js';
import { getNotificationProfiles } from '../users/service.js';
import { weeklySummaryRecipients, weeklySummaryUnsubscribes } from './schema.js';

/**
 * Who gets a group's summary (spec §8): its clients by `listGroupPeople`'s rule (an active,
 * verified, named client membership; never a žiadateľ, an admin or a manager), with an account
 * that is not disabled and no unsubscribe row for the group. Taken at Send, not at draft time.
 */

export type Recipient = { userId: string; name: string; email: string; language: UserLanguage };

/** At most three queries: the group's people, their profiles, the unsubscribes. */
export async function currentRecipients(db: Db, groupId: string): Promise<Recipient[]> {
  const clients = (await listGroupPeople(db, groupId)).filter((p) => !p.isAdmin);
  if (clients.length === 0) return [];
  const ids = clients.map((c) => c.id);
  const [profiles, unsubscribed] = await Promise.all([
    getNotificationProfiles(db, ids),
    db
      .select({ userId: weeklySummaryUnsubscribes.userId })
      .from(weeklySummaryUnsubscribes)
      .where(
        and(
          eq(weeklySummaryUnsubscribes.groupId, groupId),
          inArray(weeklySummaryUnsubscribes.userId, ids),
        ),
      ),
  ]);
  const off = new Set(unsubscribed.map((r) => r.userId));
  return clients.flatMap((c) => {
    const p = profiles.get(c.id);
    if (!p || p.disabled || p.role !== 'client' || off.has(c.id)) return [];
    return [{ userId: c.id, name: c.name, email: p.email, language: p.language }];
  });
}

/**
 * Freezes the recipients of a summary at Send, in the caller's transaction: one insert with each
 * person's name, address and language. Returns how many.
 */
export async function freezeRecipients(
  tx: Db,
  summaryId: string,
  groupId: string,
): Promise<number> {
  const recipients = await currentRecipients(tx, groupId);
  if (recipients.length === 0) return 0;
  await tx
    .insert(weeklySummaryRecipients)
    .values(
      recipients.map((r) => ({
        summaryId,
        userId: r.userId,
        name: r.name,
        email: r.email,
        language: r.language,
      })),
    )
    .onConflictDoNothing();
  return recipients.length;
}

/** How many would get each group's summary now (a page of the list), in two queries. */
export async function currentRecipientCounts(
  db: Db,
  groupIds: string[],
): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();
  const [pairs, unsubscribed] = await Promise.all([
    namedClientsOfGroups(db, groupIds),
    db
      .select({
        userId: weeklySummaryUnsubscribes.userId,
        groupId: weeklySummaryUnsubscribes.groupId,
      })
      .from(weeklySummaryUnsubscribes)
      .where(inArray(weeklySummaryUnsubscribes.groupId, groupIds)),
  ]);
  const off = new Set(unsubscribed.map((r) => `${r.groupId}\u0000${r.userId}`));
  const counts = new Map<string, number>();
  for (const p of pairs) {
    if (off.has(`${p.groupId}\u0000${p.userId}`)) continue;
    counts.set(p.groupId, (counts.get(p.groupId) ?? 0) + 1);
  }
  return counts;
}
