import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Admin, GroupMode, Role, UserLanguage } from '@spolu/shared';
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
export async function createUnverifiedClient(db: Db, email: string): Promise<UserRow> {
  const [row] = await db
    .insert(user)
    .values({ id: randomUUID(), email: normalizeEmail(email), name: '', role: 'client' })
    .returning();
  return row as UserRow;
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
  pushEnabled: boolean;
  emailEnabled: boolean;
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
      pushEnabled: user.pushEnabled,
      emailEnabled: user.emailEnabled,
      defaultGroupMode: user.defaultGroupMode,
      disabledAt: user.disabledAt,
    })
    .from(user)
    .where(inArray(user.id, [...new Set(ids)]));
  return new Map(
    rows.map(({ disabledAt, ...row }) => [row.id, { ...row, disabled: disabledAt !== null }]),
  );
}

/** Sets only the switches present in the patch. */
export async function updateNotificationPrefs(
  db: Db,
  id: string,
  patch: { pushEnabled?: boolean; emailEnabled?: boolean },
): Promise<void> {
  const set: Partial<Pick<UserRow, 'pushEnabled' | 'emailEnabled'>> = {};
  if (patch.pushEnabled !== undefined) set.pushEnabled = patch.pushEnabled;
  if (patch.emailEnabled !== undefined) set.emailEnabled = patch.emailEnabled;
  if (Object.keys(set).length === 0) return;
  await db
    .update(user)
    .set({ ...set, updatedAt: new Date() })
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
 * The iOS fallback: turns email on once per user. Returns true only when it changed the row, so a
 * later manual opt-out is never undone.
 */
export async function applyEmailFallback(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(user)
    .set({ emailEnabled: true, emailFallbackAt: new Date(), updatedAt: new Date() })
    .where(and(eq(user.id, id), isNull(user.emailFallbackAt)))
    .returning({ id: user.id });
  return rows.length > 0;
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
