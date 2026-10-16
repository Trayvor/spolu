import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { GroupManager } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { startManagerMode, stopManagerMode } from '../notifications/modes.js';
import { user } from '../users/schema.js';
import { groupManagers } from './schema.js';

/**
 * Group managers: the admins who look after a group. These helpers are the cross-module API;
 * a manager counts only while they are an active admin or superadmin (a disabled admin keeps
 * their rows and counts again when re-enabled).
 */

export class NotAnAdminError extends Error {
  constructor() {
    super('Only an active admin can manage a group');
    this.name = 'NotAnAdminError';
  }
}

const ADMIN_ROLES = ['admin', 'superadmin'] as const;
const activeAdmin = and(inArray(user.role, [...ADMIN_ROLES]), isNull(user.disabledAt));

/** Whether this user is an active manager of the group. One indexed lookup. */
export async function isGroupManager(db: Db, groupId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: user.id })
    .from(groupManagers)
    .innerJoin(user, eq(user.id, groupManagers.userId))
    .where(and(eq(groupManagers.groupId, groupId), eq(groupManagers.userId, userId), activeAdmin))
    .limit(1);
  return row !== undefined;
}

/** The groups this user actively manages; empty for clients and disabled admins. */
export async function managedGroupIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupManagers.groupId })
    .from(groupManagers)
    .innerJoin(user, eq(user.id, groupManagers.userId))
    .where(and(eq(groupManagers.userId, userId), activeAdmin));
  return rows.map((r) => r.groupId);
}

/**
 * `managedGroupIds` as a parenthesized subquery for other modules' single-statement queries:
 * `sql\`${groups.id} in ${managedGroupsSql(userId)}\``.
 */
export function managedGroupsSql(userId: string): SQL {
  return sql`(select gm."group_id" from "group_managers" gm join "user" u on u."id" = gm."user_id" where gm."user_id" = ${userId} and u."role" in ('admin', 'superadmin') and u."disabled_at" is null)`;
}

/** The group's active managers, by name, then id. */
export async function listGroupManagers(db: Db, groupId: string): Promise<GroupManager[]> {
  return db
    .select({ id: user.id, name: user.name })
    .from(groupManagers)
    .innerJoin(user, eq(user.id, groupManagers.userId))
    .where(and(eq(groupManagers.groupId, groupId), activeAdmin))
    .orderBy(asc(user.name), asc(user.id));
}

/**
 * Makes the user a manager of the group, and on a new row gives them `all` for it unless they
 * chose a mode already. Idempotent. Throws `NotAnAdminError` for a client, a disabled user or an
 * unknown id.
 */
export async function addManager(
  db: Db,
  groupId: string,
  userId: string,
): Promise<{ changed: boolean; managers: GroupManager[] }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: user.role, disabledAt: user.disabledAt })
      .from(user)
      .where(eq(user.id, userId))
      .for('share');
    if (!target || target.role === 'client' || target.disabledAt !== null) {
      throw new NotAnAdminError();
    }
    const inserted = await tx
      .insert(groupManagers)
      .values({ groupId, userId })
      .onConflictDoNothing()
      .returning({ userId: groupManagers.userId });
    const changed = inserted.length > 0;
    if (changed) await startManagerMode(tx, userId, groupId);
    return { changed, managers: await listGroupManagers(tx, groupId) };
  });
}

/**
 * Stops the user managing the group, and on a removed row drops the `all` mode that becoming
 * manager wrote (a mode they chose stays). Idempotent.
 */
export async function removeManager(
  db: Db,
  groupId: string,
  userId: string,
): Promise<{ changed: boolean; managers: GroupManager[] }> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(groupManagers)
      .where(and(eq(groupManagers.groupId, groupId), eq(groupManagers.userId, userId)))
      .returning({ userId: groupManagers.userId });
    const changed = deleted.length > 0;
    if (changed) await stopManagerMode(tx, userId, groupId);
    return { changed, managers: await listGroupManagers(tx, groupId) };
  });
}
