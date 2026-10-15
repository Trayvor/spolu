import { eq, inArray } from 'drizzle-orm';
import {
  effectiveGroupMode,
  roleDefaultMode,
  type GroupMode,
  type NotificationModes,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { user } from '../users/schema.js';
import { setDefaultGroupMode, type NotificationProfile } from '../users/service.js';
import { groupNotificationSettings } from './schema.js';

/** The user's default mode, their role default and their per-group overrides. */
export async function getModeSettings(db: Db, actor: SessionUser): Promise<NotificationModes> {
  const [[row], overrides] = await Promise.all([
    db.select({ mode: user.defaultGroupMode }).from(user).where(eq(user.id, actor.id)),
    db
      .select({ groupId: groupNotificationSettings.groupId, mode: groupNotificationSettings.mode })
      .from(groupNotificationSettings)
      .where(eq(groupNotificationSettings.userId, actor.id)),
  ]);
  return {
    defaultMode: row?.mode ?? null,
    roleDefault: roleDefaultMode(actor.role),
    overrides: Object.fromEntries(overrides.map((o) => [o.groupId, o.mode])),
  };
}

/** Sets the user's mode for one group (an upsert). */
export async function setGroupMode(
  db: Db,
  userId: string,
  groupId: string,
  mode: GroupMode,
): Promise<void> {
  await db
    .insert(groupNotificationSettings)
    .values({ userId, groupId, mode })
    .onConflictDoUpdate({
      target: [groupNotificationSettings.userId, groupNotificationSettings.groupId],
      set: { mode },
    });
}

/** Sets the all-groups default and drops the user's per-group overrides, in one transaction. */
export async function setDefaultMode(db: Db, userId: string, mode: GroupMode): Promise<void> {
  await db.transaction(async (tx) => {
    await setDefaultGroupMode(tx, userId, mode);
    await tx.delete(groupNotificationSettings).where(eq(groupNotificationSettings.userId, userId));
  });
}

/**
 * The effective mode for each (user, group) pair, keyed `${userId}:${groupId}`, from one query.
 * Pairs whose user has no profile are left out.
 */
export async function getEffectiveModes(
  db: Db,
  pairs: { userId: string; groupId: string }[],
  profiles: Map<string, NotificationProfile>,
): Promise<Map<string, GroupMode>> {
  const result = new Map<string, GroupMode>();
  if (pairs.length === 0) return result;
  const rows = await db
    .select()
    .from(groupNotificationSettings)
    .where(inArray(groupNotificationSettings.userId, [...new Set(pairs.map((p) => p.userId))]));
  const overrides = new Map(rows.map((r) => [`${r.userId}:${r.groupId}`, r.mode]));
  for (const { userId, groupId } of pairs) {
    const profile = profiles.get(userId);
    if (!profile) continue;
    const key = `${userId}:${groupId}`;
    result.set(
      key,
      effectiveGroupMode({
        override: overrides.get(key) ?? null,
        defaultMode: profile.defaultGroupMode,
        role: profile.role,
      }),
    );
  }
  return result;
}
