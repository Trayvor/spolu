import { and, eq, inArray } from 'drizzle-orm';
import {
  effectiveGroupMode,
  roleDefaultMode,
  type GroupMode,
  type NotificationModes,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { adminGroupId } from '../groups/admin-group.js';
import { isAdmin } from '../users/policy.js';
import { user } from '../users/schema.js';
import { setDefaultGroupMode, type NotificationProfile } from '../users/service.js';
import { groupNotificationSettings } from './schema.js';

/**
 * The user's default mode, their role default and their per-group overrides; for an admin also
 * the admin group's id (its default is `all`, Phase 34).
 */
export async function getModeSettings(db: Db, actor: SessionUser): Promise<NotificationModes> {
  const [[row], overrides, adminGroup] = await Promise.all([
    db.select({ mode: user.defaultGroupMode }).from(user).where(eq(user.id, actor.id)),
    db
      .select({
        groupId: groupNotificationSettings.groupId,
        mode: groupNotificationSettings.mode,
        origin: groupNotificationSettings.origin,
      })
      .from(groupNotificationSettings)
      .where(eq(groupNotificationSettings.userId, actor.id)),
    isAdmin(actor) ? adminGroupId(db) : null,
  ]);
  return {
    defaultMode: row?.mode ?? null,
    roleDefault: roleDefaultMode(actor.role),
    overrides: Object.fromEntries(overrides.map((o) => [o.groupId, o.mode])),
    managerSet: overrides.filter((o) => o.origin === 'manager').map((o) => o.groupId),
    ...(isAdmin(actor) ? { adminGroupId: adminGroup } : {}),
  };
}

/**
 * The actor's effective mode for one group: their override, else (the admin group) `all`, else
 * their default, else the role's.
 */
export async function getEffectiveGroupMode(
  db: Db,
  actor: SessionUser,
  groupId: string,
): Promise<GroupMode> {
  const [[row], [override], adminGroup] = await Promise.all([
    db.select({ mode: user.defaultGroupMode }).from(user).where(eq(user.id, actor.id)),
    db
      .select({ mode: groupNotificationSettings.mode })
      .from(groupNotificationSettings)
      .where(
        and(
          eq(groupNotificationSettings.userId, actor.id),
          eq(groupNotificationSettings.groupId, groupId),
        ),
      ),
    adminGroupId(db),
  ]);
  return effectiveGroupMode({
    override: override?.mode ?? null,
    defaultMode: row?.mode ?? null,
    role: actor.role,
    adminGroup: groupId === adminGroup,
  });
}

/**
 * Becoming a group's manager: `all` for that group, marked `manager`, unless the user already
 * chose a mode for it (that row is kept as it is).
 */
export async function startManagerMode(tx: Db, userId: string, groupId: string): Promise<void> {
  await tx
    .insert(groupNotificationSettings)
    .values({ userId, groupId, mode: 'all', origin: 'manager' })
    .onConflictDoNothing();
}

/** Stopping: removes the row only if becoming manager wrote it and the user has not changed it. */
export async function stopManagerMode(tx: Db, userId: string, groupId: string): Promise<void> {
  await tx
    .delete(groupNotificationSettings)
    .where(
      and(
        eq(groupNotificationSettings.userId, userId),
        eq(groupNotificationSettings.groupId, groupId),
        eq(groupNotificationSettings.origin, 'manager'),
      ),
    );
}

/** Sets the user's mode for one group (an upsert). The row becomes the user's own (`user`). */
export async function setGroupMode(
  db: Db,
  userId: string,
  groupId: string,
  mode: GroupMode,
): Promise<void> {
  await db
    .insert(groupNotificationSettings)
    .values({ userId, groupId, mode, origin: 'user' })
    .onConflictDoUpdate({
      target: [groupNotificationSettings.userId, groupNotificationSettings.groupId],
      set: { mode, origin: 'user' },
    });
}

/**
 * Sets the all-groups default and drops the user's per-group overrides, manager rows included,
 * in one transaction.
 */
export async function setDefaultMode(db: Db, userId: string, mode: GroupMode): Promise<void> {
  await db.transaction(async (tx) => {
    await setDefaultGroupMode(tx, userId, mode);
    await tx.delete(groupNotificationSettings).where(eq(groupNotificationSettings.userId, userId));
  });
}

/**
 * The effective mode for each (user, group) pair (the admin group's default `all` included), keyed `${userId}:${groupId}`, from one query.
 * Pairs whose user has no profile are left out.
 */
export async function getEffectiveModes(
  db: Db,
  pairs: { userId: string; groupId: string }[],
  profiles: Map<string, NotificationProfile>,
): Promise<Map<string, GroupMode>> {
  const result = new Map<string, GroupMode>();
  if (pairs.length === 0) return result;
  const [rows, adminGroup] = await Promise.all([
    db
      .select()
      .from(groupNotificationSettings)
      .where(inArray(groupNotificationSettings.userId, [...new Set(pairs.map((p) => p.userId))])),
    adminGroupId(db),
  ]);
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
        adminGroup: groupId === adminGroup,
      }),
    );
  }
  return result;
}
