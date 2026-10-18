import { eq } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { listAdmins } from '../users/service.js';
import { GraphError, type TeamsGraph } from './graph-client.js';
import { teamsOrganizers } from './schema.js';

// Teams T1: Help admins and their Microsoft accounts. Any eGrant colleague may organise (owner
// answer 1): the organizer of a meeting made from Help is the admin who made it; Graph refuses
// one whose account is outside the organizers group, which the caller reports clearly.

export type Organizer = typeof teamsOrganizers.$inferSelect;

/** A lookup is trusted for a day. */
const ORGANIZER_TTL_MS = 24 * 60 * 60_000;

/**
 * The admin's Microsoft account, from the cache or `GET /users/{email}`; null when the tenant
 * has no such user. Other Graph errors are thrown.
 */
export async function organizerOf(
  deps: { db: Db; graph: TeamsGraph },
  person: { id: string; email: string },
  now: Date = new Date(),
): Promise<Organizer | null> {
  const { db, graph } = deps;
  const [row] = await db
    .select()
    .from(teamsOrganizers)
    .where(eq(teamsOrganizers.userId, person.id));
  if (row && now.getTime() - row.checkedAt.getTime() < ORGANIZER_TTL_MS) return row;
  const found = await graph.getUser(person.email);
  if (!found) {
    if (row) await db.delete(teamsOrganizers).where(eq(teamsOrganizers.userId, person.id));
    return null;
  }
  const values = {
    userId: person.id,
    entraUserId: found.id.toLowerCase(),
    upn: found.userPrincipalName,
    displayName: found.displayName,
    checkedAt: now,
  };
  // A Microsoft account moved to another Help admin: the old mapping goes.
  await db.delete(teamsOrganizers).where(eq(teamsOrganizers.entraUserId, values.entraUserId));
  const [saved] = await db
    .insert(teamsOrganizers)
    .values(values)
    .onConflictDoUpdate({ target: teamsOrganizers.userId, set: values })
    .returning();
  return saved!;
}

/**
 * The known organizers: every active Help admin with a Microsoft account in the tenant, by
 * Entra id; `first` (the acting admin) is looked up first. An admin whose lookup fails is
 * skipped (a later call tries again).
 */
export async function knownOrganizers(
  deps: { db: Db; graph: TeamsGraph },
  first: { id: string; email: string },
  now: Date = new Date(),
): Promise<Organizer[]> {
  const admins = await listAdmins(deps.db);
  const people = [first, ...admins.filter((a) => a.id !== first.id)];
  const out: Organizer[] = [];
  for (const person of people) {
    try {
      const organizer = await organizerOf(deps, person, now);
      if (organizer) out.push(organizer);
    } catch (error) {
      if (!(error instanceof GraphError)) throw error;
    }
  }
  return out;
}
