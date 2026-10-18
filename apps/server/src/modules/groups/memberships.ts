import { and, asc, eq, inArray, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { MemberRole, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { hasInitiatedTicketIn } from '../tickets/initiators.js';
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
/**
 * The membership's group is not deactivated. A deactivated group keeps its memberships (so
 * reactivating restores them) but none of them counts: its clients and requesters read nothing
 * of it. Every reader of memberships below adds this, so no module needs its own check.
 */
const inLiveGroup = sql`not exists (select 1 from groups dg where dg.id = ${groupMembers.groupId}
  and dg.deactivated_at is not null)`;
/**
 * `inLiveGroup` for other modules' raw SQL: the group `groupId` (an SQL expression, e.g.
 * `t.group_id`) is not deactivated. True for a null id (a ticket or reminder without a client),
 * so only rows of a deactivated group drop out. One primary key lookup per row.
 */
export function liveGroupSql(groupId: SQL): SQL<boolean> {
  return sql<boolean>`not exists (select 1 from groups dg where dg.id = ${groupId}
    and dg.deactivated_at is not null)`;
}
/** `inLiveGroup` for the raw-SQL helpers, on `gm.group_id`. */
const gmInLiveGroup = liveGroupSql(sql`gm.group_id`);

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
    .where(and(eq(groupMembers.userId, userId), isActive, isNull(groups.deactivatedAt)))
    .orderBy(asc(groups.name), asc(groups.id));
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
        inLiveGroup,
      ),
    );
  return new Map(rows.map((r) => [r.userId, r.role]));
}

/** The groups the user reads as a client: their active `client` memberships. */
export async function clientGroupIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.userId, userId), eq(groupMembers.role, 'client'), isActive, inLiveGroup),
    );
  return rows.map((r) => r.groupId);
}

/**
 * The user's active role in each group, from one query (global search, 2026-10-18): what the
 * modules' policies need to decide what a non-admin reads. Admins have no rows. A deactivated
 * group's memberships do not count (`inLiveGroup`).
 */
export type GroupAccess = { roles: ReadonlyMap<string, MemberRole> };

export async function groupAccessOf(db: Db, userId: string): Promise<GroupAccess> {
  const rows = await db
    .select({ groupId: groupMembers.groupId, role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), isActive, inLiveGroup));
  return { roles: new Map(rows.map((r) => [r.groupId, r.role])) };
}

/** The groups of `access` with an active `client` membership (`clientGroupIds`, no query). */
export function clientIdsOf(access: GroupAccess): string[] {
  return [...access.roles].filter(([, role]) => role === 'client').map(([id]) => id);
}

/**
 * The first group (by name) of the user's active memberships as `{ id, name }` JSON, or null, as
 * SQL for other modules' one-statement queries (the people of the global search).
 */
export function firstActiveGroupSql(
  userId: SQL | AnyColumn,
): SQL<{ id: string; name: string } | null> {
  return sql<{
    id: string;
    name: string;
  } | null>`(select jsonb_build_object('id', g.id, 'name', g.name)
    from group_members gm inner join groups g on g.id = gm.group_id
    where gm.user_id = ${userId} and gm.removed_at is null and g.deactivated_at is null
    order by g.name, g.id limit 1)`;
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

/**
 * Cancels an admin's invite ("Odobrať" on a "Pozvaný" row): the user's active client membership
 * of the group, only while the user has never signed in (`email_verified = false`), checked in
 * the same statement. A person who initiated a ticket of the group goes back to ziadatel, so
 * they keep their tickets; otherwise the membership is deleted (not marked removed). Their
 * pending link invite for this group goes too. The account stays. True when a membership changed.
 */
export async function cancelInvitedMembership(
  db: Db,
  groupId: string,
  userId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const invited = sql`gm.group_id = ${groupId} and gm.user_id = ${userId} and gm.role = 'client'
      and gm.removed_at is null and gm.user_id = u.id and u.email_verified = false`;
    const changed = (await hasInitiatedTicketIn(tx, userId, groupId))
      ? await tx.execute(sql`update group_members gm set role = 'ziadatel' from "user" u
          where ${invited} returning gm.user_id`)
      : await tx.execute(sql`delete from group_members gm using "user" u
          where ${invited} returning gm.user_id`);
    if (changed.length === 0) return false;
    await tx
      .delete(pendingInvites)
      .where(and(eq(pendingInvites.userId, userId), eq(pendingInvites.groupId, groupId)));
    return true;
  });
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
 * removed one stays removed). An invite to a group deactivated since it was typed is dropped
 * without a membership (reactivating the group later does not bring it back). Returns the group
 * joined or promoted in, else null.
 */
export async function applyPendingInvite(db: Db, userId: string): Promise<string | null> {
  const [invite] = await db
    .delete(pendingInvites)
    .where(eq(pendingInvites.userId, userId))
    .returning({ groupId: pendingInvites.groupId });
  if (!invite) return null;
  const [group] = await db
    .select({ deactivatedAt: groups.deactivatedAt })
    .from(groups)
    .where(eq(groups.id, invite.groupId));
  if (!group || group.deactivatedAt !== null) return null;
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
    and gm.group_id = ${groupColumn} and gm.removed_at is null and ${gmInLiveGroup})`;
}

/**
 * The users with an active membership of one of `roles`, as a parenthesized subquery for other
 * modules' one-statement queries (the bulk email audience): `sql\`u.id in ${…}\``. `groupScope`
 * builds the condition on the membership's group column; null = every group. Served by the
 * partial index `group_members_group_active_idx`.
 */
export function activeMemberIdsSql(
  roles: MemberRole[],
  groupScope: ((groupColumn: SQL) => SQL) | null,
): SQL {
  const roleList = sql.join(
    roles.map((role) => sql`${role}`),
    sql`, `,
  );
  const scope = groupScope ? sql` and ${groupScope(sql`gm.group_id`)}` : sql``;
  return sql`(select gm.user_id from group_members gm where gm.removed_at is null
    and gm.role in (${roleList}) and ${gmInLiveGroup}${scope})`;
}

/** "The user has an active membership of this role (any group)", as SQL. */
export function hasActiveRoleSql(userId: SQL | AnyColumn, role: MemberRole): SQL<boolean> {
  return sql<boolean>`exists (select 1 from group_members gm where gm.user_id = ${userId}
    and gm.role = ${role} and gm.removed_at is null and ${gmInLiveGroup})`;
}

/** The names of the user's actively joined groups, by name, as a SQL text array. */
export function activeGroupNamesSql(userId: SQL | AnyColumn): SQL<string[]> {
  return sql<string[]>`array(select g.name from group_members gm
    inner join groups g on g.id = gm.group_id
    where gm.user_id = ${userId} and gm.removed_at is null and g.deactivated_at is null
    order by g.name, g.id)`;
}
