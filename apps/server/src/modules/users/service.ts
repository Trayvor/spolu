import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  DEFAULT_CHANNELS,
  NotificationChannels,
  resolveChannels,
  type Admin,
  type ChannelMap,
  type GroupMode,
  type NotificationCategory,
  type NotificationChannel,
  type Role,
  type UserLanguage,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { isUniqueViolation } from '../../infra/db/errors.js';
import { user } from './schema.js';

export type UserRow = typeof user.$inferSelect;

/** The email belongs to an admin (`admin`) or to a client (`client`). */
export class EmailTakenError extends Error {
  constructor(readonly kind: 'admin' | 'client') {
    super(`Email is already used by ${kind === 'admin' ? 'an admin' : 'a client'}`);
    this.name = 'EmailTakenError';
  }
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const adminColumns = { id: user.id, name: user.name, email: user.email, role: user.role };

/**
 * Makes sure the configured superadmin exists and is active. Only a row that is already the
 * superadmin is re-enabled; an existing admin or client with that email is never promoted
 * (whoever holds the address could otherwise become superadmin on the next start), and the
 * answer is `refused`, for the caller to log. Promoting someone is a manual database change.
 */
export async function ensureSuperadmin(
  db: Db,
  input: { email: string; name: string },
): Promise<'ok' | 'refused'> {
  const email = normalizeEmail(input.email);
  await db
    .insert(user)
    .values({ id: randomUUID(), email, name: input.name, role: 'superadmin', emailVerified: true })
    .onConflictDoNothing({ target: user.email });
  const rows = await db
    .update(user)
    .set({ disabledAt: null, updatedAt: new Date() })
    .where(and(eq(user.email, email), eq(user.role, 'superadmin')))
    .returning({ id: user.id });
  return rows.length > 0 ? 'ok' : 'refused';
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.email, normalizeEmail(email)));
  return row ?? null;
}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The mailbox an address delivers to, for matching people across spellings: case and spaces
 * never matter, a `+tag` in the local part is dropped, and for Gmail the dots too
 * (`googlemail.com` is `gmail.com`). Only for finding an existing account; accounts keep and
 * log in with their exact address.
 */
export function mailboxKey(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0) return normalized;
  const domain = normalized.slice(at + 1);
  const local = normalized.slice(0, at).split('+')[0]!;
  return GMAIL_DOMAINS.has(domain)
    ? `${local.replaceAll('.', '')}@gmail.com`
    : `${local}@${domain}`;
}

/** `mailboxKey` in SQL, for the stored (already normalized) `user.email`. */
const mailboxKeySql = sql`(case
  when split_part(${user.email}, '@', 2) in ('gmail.com', 'googlemail.com')
  then replace(split_part(split_part(${user.email}, '@', 1), '+', 1), '.', '') || '@gmail.com'
  else split_part(split_part(${user.email}, '@', 1), '+', 1) || '@' || split_part(${user.email}, '@', 2)
end)`;

/**
 * The account whose address delivers to the same mailbox as `email` (see `mailboxKey`), when
 * no account has the exact address. Several: an admin first, then the oldest. A full scan of
 * the small `user` table; called only when a ticket's initiator has no exact match.
 */
export async function findUserByMailbox(db: Db, email: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(sql`${mailboxKeySql} = ${mailboxKey(email)}`)
    .orderBy(sql`${user.role} = 'client'`, asc(user.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getUserById(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.id, id));
  return row ?? null;
}

/** Active admins and superadmins: superadmin first, then by name. */
export async function listAdmins(db: Db): Promise<Admin[]> {
  const rows = await db
    .select(adminColumns)
    .from(user)
    .where(and(inArray(user.role, ['superadmin', 'admin']), isNull(user.disabledAt)))
    .orderBy(sql`${user.role} = 'superadmin' desc`, asc(user.name), asc(user.id));
  return rows as Admin[];
}

export async function addAdmin(db: Db, input: { email: string; name: string }): Promise<Admin> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  const existing = await findUserByEmail(db, email);
  if (existing) {
    if (existing.role === 'client') throw new EmailTakenError('client');
    if (existing.role === 'superadmin' || existing.disabledAt === null) {
      throw new EmailTakenError('admin');
    }
    // A removed admin comes back with the new name.
    const [row] = await db
      .update(user)
      .set({ name, disabledAt: null, updatedAt: new Date() })
      .where(eq(user.id, existing.id))
      .returning(adminColumns);
    return row as Admin;
  }

  try {
    const [row] = await db
      .insert(user)
      .values({ id: randomUUID(), email, name, role: 'admin', emailVerified: true })
      .returning(adminColumns);
    return row as Admin;
  } catch (error) {
    // Two fast requests with the same email: the loser hits the unique index.
    if (isUniqueViolation(error)) throw new EmailTakenError('admin');
    throw error;
  }
}

/** Marks the user as disabled. Their sessions are revoked by the auth module. */
export async function deactivateUser(db: Db, id: string): Promise<void> {
  await db
    .update(user)
    .set({ disabledAt: new Date(), updatedAt: new Date() })
    .where(eq(user.id, id));
}

/** Clears `disabled_at`: a removed user comes back (a removed client re-joining). */
export async function reactivateUser(db: Db, id: string): Promise<void> {
  await db.update(user).set({ disabledAt: null, updatedAt: new Date() }).where(eq(user.id, id));
}

/** Sets the user's display name (the caller has already validated it). */
export async function updateUserName(db: Db, id: string, name: string): Promise<void> {
  await db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, id));
}

/** A client who typed their email on an invite: not verified yet, no name yet. */
export async function createUnverifiedClient(db: Db, email: string, name = ''): Promise<UserRow> {
  const [row] = await db
    .insert(user)
    .values({ id: randomUUID(), email: normalizeEmail(email), name: name.trim(), role: 'client' })
    .returning();
  return row as UserRow;
}

/** Sets the name only when the account has none: an invite never renames someone. */
export async function setNameIfEmpty(db: Db, id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') return;
  await db
    .update(user)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(user.id, id), sql`trim(${user.name}) = ''`));
}

/**
 * A person who reported a ticket and has no account yet (Phase 21): a client account, not
 * verified, with the name the ticket gave (empty asks for it at the first login).
 */
export async function createRequesterAccount(
  db: Db,
  input: { email: string; name: string | null },
): Promise<UserRow> {
  const [row] = await db
    .insert(user)
    .values({
      id: randomUUID(),
      email: normalizeEmail(input.email),
      name: input.name?.trim() ?? '',
      role: 'client',
    })
    .returning();
  return row as UserRow;
}

/** What notification delivery needs to know about a recipient. */
export type NotificationProfile = {
  id: string;
  email: string;
  name: string;
  role: Role;
  language: UserLanguage;
  /** The channel per notification group, defaults filled in. */
  channels: ChannelMap;
  defaultGroupMode: GroupMode | null;
  disabled: boolean;
};

/** Notification profiles of the given users, keyed by id, in one query. Unknown ids are absent. */
export async function getNotificationProfiles(
  db: Db,
  ids: string[],
): Promise<Map<string, NotificationProfile>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      language: user.language,
      notificationChannels: user.notificationChannels,
      defaultGroupMode: user.defaultGroupMode,
      disabledAt: user.disabledAt,
    })
    .from(user)
    .where(inArray(user.id, [...new Set(ids)]));
  return new Map(
    rows.map(({ disabledAt, notificationChannels, ...row }) => [
      row.id,
      { ...row, channels: resolveChannels(notificationChannels), disabled: disabledAt !== null },
    ]),
  );
}

/**
 * SQL for one group's channel of the `"user"` row aliased `alias`, defaults filled in: a stored
 * value that is not a channel counts as unset, as in `resolveChannels`.
 */
export function channelSql(
  alias: string,
  category: NotificationCategory,
): SQL<NotificationChannel> {
  const stored = sql`${sql.identifier(alias)}.notification_channels ->> ${category}::text`;
  const known = sql.join(
    NotificationChannels.map((c) => sql`${c}::text`),
    sql`, `,
  );
  return sql<NotificationChannel>`(case when ${stored} in (${known}) then ${stored} else ${DEFAULT_CHANNELS[category]}::text end)`;
}

/** The user's channel per notification group, defaults filled in. */
export async function getNotificationChannels(db: Db, id: string): Promise<ChannelMap> {
  const [row] = await db
    .select({ channels: user.notificationChannels })
    .from(user)
    .where(eq(user.id, id));
  return resolveChannels(row?.channels);
}

/** Stores one group's channel; a single `jsonb_set`, so concurrent changes of two groups both stay. */
export async function setNotificationChannel(
  db: Db,
  id: string,
  category: NotificationCategory,
  channel: NotificationChannel,
): Promise<void> {
  await db
    .update(user)
    .set({
      notificationChannels: sql`jsonb_set(${user.notificationChannels}, array[${category}::text], to_jsonb(${channel}::text))`,
      updatedAt: new Date(),
    })
    .where(eq(user.id, id));
}

/** Sets the user's own default group mode; null falls back to the role default. */
export async function setDefaultGroupMode(
  tx: Db,
  id: string,
  mode: GroupMode | null,
): Promise<void> {
  await tx
    .update(user)
    .set({ defaultGroupMode: mode, updatedAt: new Date() })
    .where(eq(user.id, id));
}

export async function setUserLanguage(db: Db, id: string, language: UserLanguage): Promise<void> {
  await db.update(user).set({ language, updatedAt: new Date() }).where(eq(user.id, id));
}

/**
 * Stores a new, already confirmed email address. Throws `EmailTakenError` (with the other
 * account's kind) when another account has it. Runs in a savepoint (a transaction when `db` is
 * not one), so a caller's transaction survives the unique violation and can roll back cleanly.
 */
export async function changeUserEmail(db: Db, id: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  try {
    await db.transaction(async (sp) => {
      await sp
        .update(user)
        .set({ email: normalized, emailVerified: true, updatedAt: new Date() })
        .where(eq(user.id, id));
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const owner = await findUserByEmail(db, normalized);
    throw new EmailTakenError(owner?.role === 'client' ? 'client' : 'admin');
  }
}

/**
 * The iOS fallback, once per user: every listed group whose channel is push becomes both (email
 * added); email, both and none stay. Returns true only when it changed a group, so it tells
 * whether email was turned on; `email_fallback_at` is set either way, and a later manual change
 * is never undone.
 */
export async function applyEmailFallback(
  db: Db,
  id: string,
  categories: NotificationCategory[],
): Promise<boolean> {
  const patch = sql.join(
    [
      sql`'{}'::jsonb`,
      ...categories.map(
        (c) =>
          sql`(case when ${channelSql('u', c)} = 'push' then jsonb_build_object(${c}::text, 'both') else '{}'::jsonb end)`,
      ),
    ],
    sql` || `,
  );
  const rows = await db.execute<{ before: unknown }>(sql`
    with prev as (
      select id, notification_channels as before from "user"
      where id = ${id} and email_fallback_at is null
      for update
    )
    update "user" u
    set notification_channels = u.notification_channels || ${patch},
      email_fallback_at = now(), updated_at = now()
    from prev
    where u.id = prev.id
    returning prev.before
  `);
  const [row] = [...rows];
  if (!row) return false;
  const before = resolveChannels(row.before);
  return categories.some((c) => before[c] === 'push');
}

/** Names of the given users in one query; unknown ids are left out. */
export async function getUserNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The roles of the given users who are not disabled, in one query; others are left out. */
export async function getActiveRoles(db: Db, ids: string[]): Promise<Map<string, Role>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(and(inArray(user.id, [...new Set(ids)]), isNull(user.disabledAt)));
  return new Map(rows.map((r) => [r.id, r.role as Role]));
}

/** Ids and addresses of the users with the given emails (any case), in one query; unknown ones are left out. */
export async function getUsersByEmails(
  db: Db,
  emails: string[],
): Promise<{ id: string; email: string }[]> {
  const wanted = [...new Set(emails.map(normalizeEmail))];
  if (wanted.length === 0) return [];
  return db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.email, wanted));
}
