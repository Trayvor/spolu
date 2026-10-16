import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import {
  isPickable,
  type GroupInput,
  type GroupManager,
  type GroupPerson,
  type GroupSummary,
  type Member,
  type MemberRole,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { isUniqueViolation } from '../../infra/db/errors.js';
import { user } from '../users/schema.js';
import { createUnverifiedClient, findUserByEmail, type UserRow } from '../users/service.js';
import { normalizeEgrantUrl } from './egrant-url.js';
import { addMembership, setPendingInvite } from './memberships.js';
import { groupManagers, groupMembers, groups } from './schema.js';

export type GroupRow = typeof groups.$inferSelect;

export class EgrantUrlTakenError extends Error {
  constructor() {
    super('This eGrant URL is already used by another group');
    this.name = 'EgrantUrlTakenError';
  }
}

/** The submitted URL is not an http(s) URL. */
export class InvalidEgrantUrlError extends Error {
  constructor() {
    super('Not a valid eGrant URL');
    this.name = 'InvalidEgrantUrlError';
  }
}

const newInviteToken = (): string => randomBytes(24).toString('base64url');

function isEgrantUrlViolation(error: unknown): boolean {
  // drizzle may wrap the driver error in `cause`
  const e = error as { code?: unknown; constraint_name?: unknown; cause?: unknown } | null;
  if (e?.code === '23505') return e.constraint_name === 'groups_egrant_url_unique';
  return e?.cause !== undefined && isEgrantUrlViolation(e.cause);
}

function normalizedOrThrow(url: string): string {
  const normalized = normalizeEgrantUrl(url);
  if (!normalized) throw new InvalidEgrantUrlError();
  return normalized;
}

// Deliberate read-only exception to "no other module's tables": the member count, the managers and
// the member list join the users table in one query (no N+1). Writes to users go through the users service.
/**
 * Groups by name with the number of verified, active clients, the active admins who manage them
 * and whether `viewerId` is one. The managers are aggregated per group first, so they cannot
 * multiply the member rows.
 */
export async function listGroups(db: Db, viewerId: string): Promise<GroupSummary[]> {
  const managerAgg = db
    .select({
      groupId: groupManagers.groupId,
      managers: sql<
        GroupManager[]
      >`jsonb_agg(jsonb_build_object('id', ${user.id}, 'name', ${user.name}) order by ${user.name}, ${user.id})`.as(
        'managers',
      ),
      managedByMe: sql<boolean>`bool_or(${groupManagers.userId} = ${viewerId})`.as('managed_by_me'),
    })
    .from(groupManagers)
    .innerJoin(user, and(eq(user.id, groupManagers.userId), isActiveAdmin))
    .groupBy(groupManagers.groupId)
    .as('manager_agg');
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      hasLogo: sql<boolean>`${groups.logoKey} is not null`,
      memberCount: sql<number>`count(${user.id})::int`,
      updatedAt: groups.updatedAt,
      managers: sql<GroupManager[]>`coalesce(${managerAgg.managers}, '[]'::jsonb)`,
      managedByMe: sql<boolean>`coalesce(${managerAgg.managedByMe}, false)`,
    })
    .from(groups)
    .leftJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groups.id),
        eq(groupMembers.role, 'client'),
        isNull(groupMembers.removedAt),
      ),
    )
    .leftJoin(user, and(eq(user.id, groupMembers.userId), isActiveVerifiedClient()))
    .leftJoin(managerAgg, eq(managerAgg.groupId, groups.id))
    .groupBy(groups.id, managerAgg.managers, managerAgg.managedByMe)
    .orderBy(asc(groups.name), asc(groups.id));
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

function isActiveVerifiedClient() {
  return and(eq(user.emailVerified, true), isNull(user.disabledAt));
}

export async function getGroup(db: Db, id: string): Promise<GroupRow | null> {
  const [row] = await db.select().from(groups).where(eq(groups.id, id));
  return row ?? null;
}

export async function createGroup(db: Db, input: GroupInput): Promise<GroupRow> {
  const egrantUrl = normalizedOrThrow(input.egrantUrl);
  try {
    const [row] = await db
      .insert(groups)
      .values({ id: randomUUID(), name: input.name, egrantUrl, inviteToken: newInviteToken() })
      .returning();
    return row as GroupRow;
  } catch (error) {
    if (isEgrantUrlViolation(error)) throw new EgrantUrlTakenError();
    throw error;
  }
}

/** Null when the group does not exist. */
export async function updateGroup(db: Db, id: string, input: GroupInput): Promise<GroupRow | null> {
  const egrantUrl = normalizedOrThrow(input.egrantUrl);
  try {
    const [row] = await db
      .update(groups)
      .set({ name: input.name, egrantUrl, updatedAt: new Date() })
      .where(eq(groups.id, id))
      .returning();
    return row ?? null;
  } catch (error) {
    if (isEgrantUrlViolation(error)) throw new EgrantUrlTakenError();
    throw error;
  }
}

/** Replaces the invite token; the old link stops working. Returns the new token. */
export async function regenerateInvite(db: Db, id: string): Promise<string> {
  const inviteToken = newInviteToken();
  const [row] = await db
    .update(groups)
    .set({ inviteToken, updatedAt: new Date() })
    .where(eq(groups.id, id))
    .returning({ id: groups.id });
  if (!row) throw new Error(`Group ${id} not found`);
  return inviteToken;
}

/**
 * The group whose eGrant URL names the same host as `url` (tickets, Phase 21), else null. The
 * scheme, a leading `www.`, the path and the case do not matter: `https://www.X.egrant.sk/app`
 * matches a group saved as `http://x.egrant.sk`.
 */
export async function findGroupByEgrantUrl(db: Db, url: string | null): Promise<GroupRow | null> {
  const normalized = url === null ? null : normalizeEgrantUrl(url);
  if (!normalized) return null;
  const host = new URL(normalized).host.replace(/^www\./, '');
  const [row] = await db
    .select()
    .from(groups)
    .where(sql`regexp_replace(${groups.egrantUrl}, '^https?://(www\.)?', '') = ${host}`)
    .orderBy(asc(groups.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getGroupByInviteToken(db: Db, token: string): Promise<GroupRow | null> {
  const [row] = await db.select().from(groups).where(eq(groups.inviteToken, token));
  return row ?? null;
}

/**
 * Verified members of the group with the given role (default clients): the active ones, or the
 * ones an admin removed (`removed: true`). Requesters (`role: 'ziadatel'`) are listed whether or
 * not they have signed in yet: the tickets module made their accounts, nobody invited them.
 */
export async function listMembers(
  db: Db,
  groupId: string,
  options: { removed: boolean; role?: MemberRole },
): Promise<Member[]> {
  const role = options.role ?? 'client';
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(groupMembers)
    .innerJoin(user, eq(user.id, groupMembers.userId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.role, role),
        role === 'client' ? eq(user.emailVerified, true) : undefined,
        options.removed
          ? isNotNull(groupMembers.removedAt)
          : and(isNull(groupMembers.removedAt), isNull(user.disabledAt)),
      ),
    )
    .orderBy(asc(user.name), asc(user.email));
}

// One definition of "a person of this group", shared by the list and the single check.
const isActiveAdmin = and(inArray(user.role, ['admin', 'superadmin']), isNull(user.disabledAt));
// A ziadatel (requester) is not a person of the group: they never read its chat or board.
const isNamedActiveMember = (groupId: string) =>
  and(
    eq(groupMembers.groupId, groupId),
    eq(groupMembers.role, 'client'),
    isNull(groupMembers.removedAt),
    eq(user.emailVerified, true),
    isNull(user.disabledAt),
    sql`trim(${user.name}) <> ''`,
  );

/**
 * The readers of the group: its verified, named, active clients and every active admin, each
 * with whether the admin manages this group. One query, ordered by name.
 */
export async function listGroupPeople(db: Db, groupId: string): Promise<GroupPerson[]> {
  const clients = db
    .select({
      id: user.id,
      name: user.name,
      isAdmin: sql<boolean>`false`.as('is_admin'),
      isManager: sql<boolean>`false`.as('is_manager'),
    })
    .from(groupMembers)
    .innerJoin(user, eq(user.id, groupMembers.userId))
    .where(isNamedActiveMember(groupId));
  const admins = db
    .select({
      id: user.id,
      name: user.name,
      isAdmin: sql<boolean>`true`.as('is_admin'),
      isManager: sql<boolean>`${groupManagers.userId} is not null`.as('is_manager'),
    })
    .from(user)
    .leftJoin(
      groupManagers,
      and(eq(groupManagers.userId, user.id), eq(groupManagers.groupId, groupId)),
    )
    .where(isActiveAdmin);
  return unionAll(clients, admins).orderBy(asc(sql`name`), asc(sql`id`));
}

/** Who can be assigned or picked: the group's clients and its active managers. */
export async function listPickablePeople(db: Db, groupId: string): Promise<GroupPerson[]> {
  return (await listGroupPeople(db, groupId)).filter(isPickable);
}

/** The same condition as `listPickablePeople`, for one user, in one query. */
export async function isPickablePerson(db: Db, groupId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .leftJoin(
      groupMembers,
      and(eq(groupMembers.userId, user.id), eq(groupMembers.groupId, groupId)),
    )
    .leftJoin(
      groupManagers,
      and(eq(groupManagers.userId, user.id), eq(groupManagers.groupId, groupId)),
    )
    .where(
      and(
        eq(user.id, userId),
        or(isNamedActiveMember(groupId), and(isActiveAdmin, isNotNull(groupManagers.userId))),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * The same condition as `listGroupPeople`, for many users in one query: the ids among `userIds`
 * that are people of the group, each with whether they are an admin and whether they manage the
 * group (so `isPickable` applies to the result as to a `GroupPerson`).
 */
export async function getGroupPeopleRoles(
  db: Db,
  groupId: string,
  userIds: string[],
): Promise<Map<string, { isAdmin: boolean; isManager: boolean }>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: user.id,
      role: user.role,
      isManager: sql<boolean>`${groupManagers.userId} is not null`,
    })
    .from(user)
    .leftJoin(
      groupMembers,
      and(eq(groupMembers.userId, user.id), eq(groupMembers.groupId, groupId)),
    )
    .leftJoin(
      groupManagers,
      and(eq(groupManagers.userId, user.id), eq(groupManagers.groupId, groupId)),
    )
    .where(and(inArray(user.id, userIds), or(isActiveAdmin, isNamedActiveMember(groupId))));
  return new Map(rows.map((r) => [r.id, { isAdmin: r.role !== 'client', isManager: r.isManager }]));
}

/** Adds a client membership (see `addMembership`); joining twice changes nothing. */
export async function addMember(db: Db, groupId: string, userId: string): Promise<void> {
  await addMembership(db, userId, groupId, 'client');
}

/** Sets or clears the logo storage key. Returns the previous key so the caller can delete the file. */
export async function setLogoKey(db: Db, id: string, key: string | null): Promise<string | null> {
  const previous = await db.transaction(async (tx) => {
    const [old] = await tx
      .select({ logoKey: groups.logoKey })
      .from(groups)
      .where(eq(groups.id, id))
      .for('update');
    await tx.update(groups).set({ logoKey: key, updatedAt: new Date() }).where(eq(groups.id, id));
    return old?.logoKey ?? null;
  });
  return previous;
}

/**
 * Join by invite link. The group is only remembered as the person's pending invite
 * (`setPendingInvite`); it becomes a client membership when they sign in with a code
 * (`applyPendingInvite`), so typing an email never adds an account to a group by itself. An
 * unknown email becomes an unverified client first. Admins and disabled accounts are left
 * unchanged; the latest invite used wins. A concurrent duplicate counts as existing.
 */
export async function joinWithEmail(db: Db, groupId: string, email: string): Promise<void> {
  const existing = await findUserByEmail(db, email);
  if (existing) return rememberInvite(db, groupId, existing);
  try {
    await db.transaction(async (tx) => {
      const client = await createUnverifiedClient(tx, email);
      await setPendingInvite(tx, client.id, groupId);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findUserByEmail(db, email);
    if (winner) await rememberInvite(db, groupId, winner);
  }
}

/** Keeps the invite for a client account that is not disabled. */
export async function rememberInvite(db: Db, groupId: string, existing: UserRow): Promise<void> {
  if (existing.role !== 'client' || existing.disabledAt) return;
  await setPendingInvite(db, existing.id, groupId);
}
