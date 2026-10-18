import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import {
  isPickable,
  type GroupInput,
  type GroupManager,
  type GroupPage,
  type GroupPerson,
  type GroupSummary,
  type InviteMemberBody,
  type InviteOutcome,
  type Member,
  type MemberRole,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { isUniqueViolation } from '../../infra/db/errors.js';
import { escapeLike } from '../../infra/text/search.js';
import { user } from '../users/schema.js';
import {
  createUnverifiedClient,
  EmailTakenError,
  findUserByEmail,
  reactivateUser,
  setNameIfEmpty,
  type UserRow,
} from '../users/service.js';
import { isAdminGroupSql } from './admin-group.js';
import { normalizeEgrantUrl } from './egrant-url.js';
import { addMembership, getMembership, setPendingInvite } from './memberships.js';
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

/** The email belongs to an active, signed-in client member of the group. */
export class AlreadyMemberError extends Error {
  constructor() {
    super('This person is already a member of the group');
    this.name = 'AlreadyMemberError';
  }
}

/** An admin removed the person from the group; only Restore brings them back. */
export class MemberRemovedError extends Error {
  constructor(readonly userId: string) {
    super('This person was removed from the group');
    this.name = 'MemberRemovedError';
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
export async function listGroups(
  db: Db,
  viewerId: string,
  options: { q?: string; limit?: number; after?: GroupCursor } = {},
): Promise<GroupSummary[]> {
  const where: SQL[] = [];
  if (options.q) {
    where.push(sql`${groups.name} ilike ${`%${escapeLike(options.q)}%`} escape '\\'`);
  }
  if (options.after) {
    where.push(sql`(${groups.name}, ${groups.id}) > (${options.after.name}, ${options.after.id})`);
  }
  // A page (2026-10-18) picks its groups first (`groups_name_id_idx`), so only those are joined.
  const page =
    options.limit === undefined
      ? undefined
      : inArray(
          groups.id,
          db
            .select({ id: groups.id })
            .from(groups)
            .where(and(...where))
            .orderBy(asc(groups.name), asc(groups.id))
            .limit(options.limit),
        );
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
      kind: groups.kind,
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
    .where(page ?? and(...where))
    .groupBy(groups.id, managerAgg.managers, managerAgg.managedByMe)
    .orderBy(asc(groups.name), asc(groups.id));
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

/** Where a page of `listGroupsPage` continues: after this name and id. */
export type GroupCursor = { name: string; id: string };

export class InvalidGroupCursorError extends Error {
  constructor() {
    super('Invalid groups cursor');
    this.name = 'InvalidGroupCursorError';
  }
}

const encodeGroupCursor = (c: GroupCursor) =>
  Buffer.from(JSON.stringify([c.name, c.id])).toString('base64url');

function decodeGroupCursor(cursor: string): GroupCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw new InvalidGroupCursorError();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string'
  ) {
    throw new InvalidGroupCursorError();
  }
  return { name: parsed[0], id: parsed[1] };
}

/**
 * One page of `listGroups` (2026-10-18, `GET /groups?limit=`): `limit` groups by name and id after
 * `cursor`, and the cursor of the next page (null on the last). Throws `InvalidGroupCursorError`.
 */
export async function listGroupsPage(
  db: Db,
  viewerId: string,
  query: { q?: string; limit: number; cursor?: string },
): Promise<GroupPage> {
  const after = query.cursor === undefined ? undefined : decodeGroupCursor(query.cursor);
  const rows = await listGroups(db, viewerId, { q: query.q, limit: query.limit + 1, after });
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > query.limit && last ? encodeGroupCursor(last) : null,
  };
}

function isActiveVerifiedClient() {
  return and(eq(user.emailVerified, true), isNull(user.disabledAt));
}

export async function getGroup(db: Db, id: string): Promise<GroupRow | null> {
  const [row] = await db.select().from(groups).where(eq(groups.id, id));
  return row ?? null;
}

/** What a list of other modules shows of a client: name and logo (one query, by primary key). */
export type GroupLabel = { name: string; hasLogo: boolean; updatedAt: string };

export async function getGroupLabels(db: Db, ids: string[]): Promise<Map<string, GroupLabel>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      logoKey: groups.logoKey,
      updatedAt: groups.updatedAt,
    })
    .from(groups)
    .where(inArray(groups.id, [...new Set(ids)]));
  return new Map(
    rows.map((r) => [
      r.id,
      { name: r.name, hasLogo: r.logoKey !== null, updatedAt: r.updatedAt.toISOString() },
    ]),
  );
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

/** Renames the admin group (it has no eGrant URL). Null when it is not the admin group. */
export async function renameAdminGroup(db: Db, id: string, name: string): Promise<GroupRow | null> {
  const [row] = await db
    .update(groups)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(groups.id, id), eq(groups.kind, 'admin')))
    .returning();
  return row ?? null;
}

/** Null when the group does not exist or is the admin group (`renameAdminGroup`). */
export async function updateGroup(db: Db, id: string, input: GroupInput): Promise<GroupRow | null> {
  const egrantUrl = normalizedOrThrow(input.egrantUrl);
  try {
    const [row] = await db
      .update(groups)
      .set({ name: input.name, egrantUrl, updatedAt: new Date() })
      .where(and(eq(groups.id, id), eq(groups.kind, 'client')))
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

/** The client group of an invite token; the admin group's token never opens anything. */
export async function getGroupByInviteToken(db: Db, token: string): Promise<GroupRow | null> {
  const [row] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.inviteToken, token), eq(groups.kind, 'client')));
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

/**
 * The profile languages of the group's active clients, one entry per client (Phase 28: the
 * translate target of the AI text tools). Uses `group_members_group_active_idx`.
 */
export async function clientLanguages(db: Db, groupId: string): Promise<string[]> {
  const rows = await db
    .select({ language: user.language })
    .from(groupMembers)
    .innerJoin(user, eq(user.id, groupMembers.userId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.role, 'client'),
        isNull(groupMembers.removedAt),
        isNull(user.disabledAt),
      ),
    );
  return rows.map((r) => r.language);
}

// One definition of "a person of this group", shared by the list and the single check.
const isActiveAdmin = and(inArray(user.role, ['admin', 'superadmin']), isNull(user.disabledAt));
// A ziadatel (requester) is not a person of the group: they never read its chat or board.
const isNamedActiveMember = (groupId: string | SQL) =>
  and(
    eq(groupMembers.groupId, groupId),
    eq(groupMembers.role, 'client'),
    isNull(groupMembers.removedAt),
    eq(user.emailVerified, true),
    isNull(user.disabledAt),
    sql`trim(${user.name}) <> ''`,
  );

/**
 * An admin manages the group: a `group_managers` row, or every admin in the admin group
 * (Phase 34: there every active admin is pickable). Needs `group_managers` left-joined.
 */
const managesSql = (groupId: string) =>
  sql<boolean>`(${groupManagers.userId} is not null or ${isAdminGroupSql(groupId)})`;

/**
 * The readers of the group: its verified, named, active clients and every active admin, each
 * with whether the admin manages this group (in the admin group every admin). One query,
 * ordered by name.
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
      isManager: managesSql(groupId).as('is_manager'),
    })
    .from(user)
    .leftJoin(
      groupManagers,
      and(eq(groupManagers.userId, user.id), eq(groupManagers.groupId, groupId)),
    )
    .where(isActiveAdmin);
  return unionAll(clients, admins).orderBy(asc(sql`name`), asc(sql`id`));
}

/**
 * Which of the (user, group) pairs are people of their group by `listGroupPeople`'s rule (an
 * active admin, or a verified, named, active client member); a pair with `requesters` also counts
 * an active `ziadatel` member. One query for any number of pairs (the delivery batch, Phase 27
 * S7). Returns the keys `pairKey(userId, groupId, requesters)` of the pairs that are.
 */
export async function groupPeopleAmong(
  db: Db,
  pairs: { userId: string; groupId: string; requesters: boolean }[],
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();
  const values = sql.join(
    pairs.map((p) => sql`(${p.userId}::text, ${p.groupId}::text, ${p.requesters}::boolean)`),
    sql`, `,
  );
  const rows = await db.execute<{ user_id: string; group_id: string; requesters: boolean }>(sql`
    select v.user_id, v.group_id, v.requesters
    from (values ${values}) as v(user_id, group_id, requesters)
    join ${user} on ${user.id} = v.user_id
    where ${isActiveAdmin}
      or exists (select 1 from ${groupMembers}
        where ${groupMembers.userId} = v.user_id and (${isNamedActiveMember(sql`v.group_id`)}
          or (v.requesters and ${groupMembers.groupId} = v.group_id
            and ${groupMembers.role} = 'ziadatel' and ${groupMembers.removedAt} is null)))
  `);
  return new Set([...rows].map((r) => pairKey(r.user_id, r.group_id, r.requesters)));
}

/** The key of a pair in `groupPeopleAmong`'s result. */
export const pairKey = (userId: string, groupId: string, requesters: boolean) =>
  `${userId}\u0000${groupId}\u0000${requesters ? 1 : 0}`;

/**
 * Who can be assigned or picked: the group's clients and its active managers; in the admin group
 * every active admin.
 */
export async function listPickablePeople(db: Db, groupId: string): Promise<GroupPerson[]> {
  return (await listGroupPeople(db, groupId)).filter(isPickable);
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
      isManager: managesSql(groupId),
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

export type InviteResult = { member: Member; outcome: InviteOutcome; verified: boolean };

/**
 * An admin adds a person to the group by email (Phase 22b). The admin is trusted, so this is a
 * client membership at once, not a pending invite: a new email becomes an unverified client
 * ("Pozvaný" until their first sign-in), a ziadatel of the group is promoted, a client of other
 * groups joins, a client disabled by their last removal is reactivated. Throws
 * `EmailTakenError('admin')` for any admin, `MemberRemovedError` for a removed member and
 * `AlreadyMemberError` for a signed-in member. `resent`: already invited here, unchanged.
 * The name only fills an empty one.
 */
export async function inviteMember(
  db: Db,
  groupId: string,
  input: InviteMemberBody,
): Promise<InviteResult> {
  const name = input.name ?? '';
  let account = await findUserByEmail(db, input.email);
  if (!account) {
    try {
      const created = await db.transaction(async (tx) => {
        const row = await createUnverifiedClient(tx, input.email, name);
        await addMembership(tx, row.id, groupId, 'client');
        return row;
      });
      return result(created, 'invited');
    } catch (error) {
      // A concurrent call created the same email first: carry on with that account.
      if (!isUniqueViolation(error)) throw error;
      account = await findUserByEmail(db, input.email);
      if (!account) throw error;
    }
  }
  if (account.role !== 'client') throw new EmailTakenError('admin');

  const existing = await getMembership(db, account.id, groupId);
  if (existing?.removedAt) throw new MemberRemovedError(account.id);
  let added = false;
  if (existing?.role !== 'client') {
    const outcome = await addMembership(db, account.id, groupId, 'client');
    if (outcome === 'removed') throw new MemberRemovedError(account.id);
    added = outcome !== 'unchanged'; // unchanged: a concurrent add won
  }
  if (!added && account.emailVerified && !account.disabledAt) throw new AlreadyMemberError();

  if (account.disabledAt) await reactivateUser(db, account.id);
  if (name.trim() !== '') await setNameIfEmpty(db, account.id, name);
  const fresh = (await findUserByEmail(db, input.email)) ?? account;
  if (!fresh.emailVerified) return result(fresh, added ? 'invited' : 'resent');
  return result(fresh, 'added');
}

const result = (row: UserRow, outcome: InviteOutcome): InviteResult => ({
  member: { id: row.id, name: row.name, email: row.email },
  outcome,
  verified: row.emailVerified,
});

/**
 * The group's invited people ("Pozvaný"): active client memberships of users who have never
 * signed in, by email. `listMembers` leaves them out.
 */
export async function listInvitedMembers(db: Db, groupId: string): Promise<Member[]> {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(groupMembers)
    .innerJoin(user, eq(user.id, groupMembers.userId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.role, 'client'),
        isNull(groupMembers.removedAt),
        eq(user.emailVerified, false),
        isNull(user.disabledAt),
      ),
    )
    .orderBy(asc(user.email));
}
