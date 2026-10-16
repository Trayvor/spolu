import { and, asc, eq, inArray, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { MemberRole, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { isAdmin } from '../users/policy.js';
import { groupMembers, groups, pendingInvites } from './schema.js';

export type Membership = { role: MemberRole; removedAt: Date | null };
export type MembershipSummary = {
  groupId: string;
  name: string;
  role: MemberRole;
  hasLogo: boolean;
  updatedAt: Date;
};
export type AddResult = 'added' | 'promoted' | 'unchanged' | 'removed';

const isActive = isNull(groupMembers.removedAt);

/** The user's membership of one group, removed or not; null when they never belonged to it. */
export async function getMembership(
  db: Db,
  userId: string,
  groupId: string,
): Promise<Membership | null> {
  const [row] = await db
    .select({ role: groupMembers.role, removedAt: groupMembers.removedAt })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.groupId, groupId)));
  return row ?? null;
}

/** The user's active memberships, by group name. */
export async function listMemberships(db: Db, userId: string): Promise<MembershipSummary[]> {
  return db
    .select({
      groupId: groupMembers.groupId,
      name: groups.name,
      role: groupMembers.role,
      hasLogo: sql<boolean>`${groups.logoKey} is not null`,
      updatedAt: groups.updatedAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), isActive))
    .orderBy(asc(groups.name), asc(groups.id));
}

/** The users with an active membership of the given role in the group. */
export async function activeMemberIds(
  db: Db,
  groupId: string,
  role: MemberRole,
): Promise<string[]> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, role), isActive));
  return rows.map((r) => r.userId);
}

/** The active roles of the given users in the group, in one query; non-members are left out. */
export async function activeRolesIn(
  db: Db,
  groupId: string,
  userIds: string[],
): Promise<Map<string, MemberRole>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        inArray(groupMembers.userId, [...new Set(userIds)]),
        isActive,
      ),
    );
  return new Map(rows.map((r) => [r.userId, r.role]));
}

/** The groups the user reads as a client: their active `client` memberships. */
export async function clientGroupIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.role, 'client'), isActive));
  return rows.map((r) => r.groupId);
}

/**
 * Adds the user to the group. An existing ziadatel membership becomes `client` when `role` is
 * client; a client is never turned into a ziadatel; a membership an admin removed stays removed.
 */
export async function addMembership(
  db: Db,
  userId: string,
  groupId: string,
  role: MemberRole,
): Promise<AddResult> {
  const [inserted] = await db
    .insert(groupMembers)
    .values({ userId, groupId, role })
    .onConflictDoNothing()
    .returning({ userId: groupMembers.userId });
  if (inserted) return 'added';
  const existing = await getMembership(db, userId, groupId);
  if (!existing) return 'unchanged'; // deleted in between: nothing to add to
  if (existing.removedAt) return 'removed';
  if (role === 'client' && existing.role === 'ziadatel') {
    await db
      .update(groupMembers)
      .set({ role: 'client' })
      .where(and(eq(groupMembers.userId, userId), eq(groupMembers.groupId, groupId), isActive));
    return 'promoted';
  }
  return 'unchanged';
}

/** Marks the membership removed. `lastActive`: the user has no active membership left. */
export async function removeMembership(
  db: Db,
  groupId: string,
  userId: string,
): Promise<{ lastActive: boolean }> {
  await db
    .update(groupMembers)
    .set({ removedAt: new Date() })
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.groupId, groupId), isActive));
  const [left] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), isActive));
  return { lastActive: (left?.n ?? 0) === 0 };
}

/** Brings a removed membership back. */
export async function restoreMembership(db: Db, groupId: string, userId: string): Promise<void> {
  await db
    .update(groupMembers)
    .set({ removedAt: null })
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.groupId, groupId)));
}

/** Remembers the invite the user typed their email on; a later invite replaces it. */
export async function setPendingInvite(db: Db, userId: string, groupId: string): Promise<void> {
  await db
    .insert(pendingInvites)
    .values({ userId, groupId })
    .onConflictDoUpdate({
      target: pendingInvites.userId,
      set: { groupId, createdAt: new Date() },
    });
}

/**
 * On sign-in: turns the pending invite into a client membership (a ziadatel one is promoted; a
 * removed one stays removed). Returns the group joined or promoted in, else null.
 */
export async function applyPendingInvite(db: Db, userId: string): Promise<string | null> {
  const [invite] = await db
    .delete(pendingInvites)
    .where(eq(pendingInvites.userId, userId))
    .returning({ groupId: pendingInvites.groupId });
  if (!invite) return null;
  const result = await addMembership(db, userId, invite.groupId, 'client');
  return result === 'added' || result === 'promoted' ? invite.groupId : null;
}

/** Not an admin and no active client membership: the person sees only their tickets. */
export async function isRequesterOnly(db: Db, user: SessionUser): Promise<boolean> {
  if (isAdmin(user)) return false;
  return (await clientGroupIds(db, user.id)).length === 0;
}

/**
 * "The user has an active membership (any role) of the group in `groupColumn`", as SQL for
 * other modules' one-statement queries (the tickets' My tickets list).
 */
export function activeMemberOfSql(userId: string, groupColumn: SQL | AnyColumn): SQL {
  return sql`exists (select 1 from group_members gm where gm.user_id = ${userId}
    and gm.group_id = ${groupColumn} and gm.removed_at is null)`;
}
