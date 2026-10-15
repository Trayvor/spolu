import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Admin } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { user } from './schema.js';

export type UserRow = typeof user.$inferSelect;

/** The email belongs to an admin (`admin`) or to a client (`client`). */
export class EmailTakenError extends Error {
  constructor(readonly kind: 'admin' | 'client') {
    super(`Email is already used by ${kind === 'admin' ? 'an admin' : 'a client'}`);
    this.name = 'EmailTakenError';
  }
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const adminColumns = { id: user.id, name: user.name, email: user.email, role: user.role };

function isUniqueViolation(error: unknown): boolean {
  // drizzle may wrap the driver error in `cause`
  const code = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;
  return code(error) === '23505' || code((error as { cause?: unknown } | null)?.cause) === '23505';
}

/** Makes sure the configured superadmin exists, is active and has the superadmin role. */
export async function ensureSuperadmin(
  db: Db,
  input: { email: string; name: string },
): Promise<void> {
  const email = normalizeEmail(input.email);
  await db
    .insert(user)
    .values({ id: randomUUID(), email, name: input.name, role: 'superadmin', emailVerified: true })
    .onConflictDoUpdate({
      target: user.email,
      set: { role: 'superadmin', disabledAt: null, updatedAt: new Date() },
    });
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.email, normalizeEmail(email)));
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
  await db.update(user).set({ disabledAt: new Date(), updatedAt: new Date() }).where(eq(user.id, id));
}
