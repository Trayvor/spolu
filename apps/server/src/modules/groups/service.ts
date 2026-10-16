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
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { isUniqueViolation } from '../../infra/db/errors.js';
import { user } from '../users/schema.js';
import { createUnverifiedClient, findUserByEmail, type UserRow } from '../users/service.js';
import { normalizeEgrantUrl } from './egrant-url.js';
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
    .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
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

export async function getGroupByInviteToken(db: Db, token: string): Promise<GroupRow | null> {
  const [row] = await db.select().from(groups).where(eq(groups.inviteToken, token));
  return row ?? null;
}

export async function getMembershipGroupId(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  return row?.groupId ?? null;
}

/** Verified clients of the group: the active ones, or the removed ones (`removed: true`). */
export async function listMembers(
  db: Db,
  groupId: string,
  options: { removed: boolean },
): Promise<Member[]> {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(groupMembers)
    .innerJoin(user, eq(user.id, groupMembers.userId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(user.emailVerified, true),
        options.removed ? isNotNull(user.disabledAt) : isNull(user.disabledAt),
      ),
    )
    .orderBy(asc(user.name), asc(user.email));
}

// One definition of "a person of this group", shared by the list and the single check.
const isActiveAdmin = and(inArray(user.role, ['admin', 'superadmin']), isNull(user.disabledAt));
const isNamedActiveMember = (groupId: string) =>
  and(
    eq(groupMembers.groupId, groupId),
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

/** Idempotent: a client is in one group, joining twice changes nothing. */
export async function addMember(db: Db, groupId: string, userId: string): Promise<void> {
  await db.insert(groupMembers).values({ userId, groupId }).onConflictDoNothing();
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
 * Join by invite link: an unknown email becomes an unverified client in the group, in one
 * transaction. An unverified, active client who never signed in follows the latest invite they
 * used (so a link cannot reserve someone else's email); every other existing user is left
 * unchanged. A concurrent duplicate counts as existing.
 */
export async function joinWithEmail(db: Db, groupId: string, email: string): Promise<void> {
  const existing = await findUserByEmail(db, email);
  if (existing) return moveUnverified(db, groupId, existing);
  try {
    await db.transaction(async (tx) => {
      const client = await createUnverifiedClient(tx, email);
      await addMember(tx, groupId, client.id);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findUserByEmail(db, email);
    if (winner) await moveUnverified(db, groupId, winner);
  }
}

/**
 * Moves a client to `groupId` only while they are still an unverified, active client. The
 * condition is part of the write, so a client who verified after `existing` was read stays put.
 */
export async function moveUnverified(db: Db, groupId: string, existing: UserRow): Promise<void> {
  if (existing.role !== 'client' || existing.emailVerified || existing.disabledAt) return;
  await db
    .insert(groupMembers)
    .values({ userId: existing.id, groupId })
    .onConflictDoUpdate({
      target: groupMembers.userId,
      set: { groupId },
      setWhere: sql`exists (select 1 from "user" u where u.id = ${groupMembers.userId} and u.email_verified = false and u.disabled_at is null and u.role = 'client')`,
    });
}
