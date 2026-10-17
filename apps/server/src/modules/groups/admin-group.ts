import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { GroupKind } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { groups } from './schema.js';

/**
 * The admin group "eGrant tím" (Phase 34, ADR 0029): one `groups` row with `kind = 'admin'`.
 * Every admin reads it (as every group); no client has a membership, so none reads it. These
 * helpers are the cross-module API of the kind; each refusing route calls `isAdminGroup` once.
 */

export const ADMIN_GROUP_NAME = 'eGrant tím';

/** Whether the group is the admin group. */
export function isAdminGroup(group: { kind: GroupKind }): boolean {
  return group.kind === 'admin';
}

/** The admin group's id, or null (only before `ensureAdminGroup` ran on an empty database). */
export async function adminGroupId(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.kind, 'admin'))
    .limit(1);
  return row?.id ?? null;
}

/** Whether `groupId` names the admin group, as an SQL condition for other modules' statements. */
export function isAdminGroupSql(groupId: string | SQL): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${groups} where ${groups.id} = ${groupId} and ${groups.kind} = 'admin')`;
}

/**
 * Makes sure the admin group exists (the migration inserts it; this keeps a database that lost
 * it working) and returns its id. Idempotent and safe in parallel: the partial unique index
 * `groups_one_admin` keeps one row. The caller creates its board and chat (`main.ts`).
 */
export async function ensureAdminGroup(db: Db): Promise<string> {
  await db
    .insert(groups)
    .values({
      id: randomUUID(),
      name: ADMIN_GROUP_NAME,
      kind: 'admin',
      egrantUrl: null,
      inviteToken: randomBytes(24).toString('base64url'),
    })
    .onConflictDoNothing();
  const id = await adminGroupId(db);
  if (!id) throw new Error('The admin group could not be created');
  return id;
}

/**
 * The default "my clients" scope plus the admin group (decision 7: every admin is effectively
 * its manager). An empty list stays empty: it already means every group.
 */
export async function withAdminGroup(db: Db, managed: string[]): Promise<string[]> {
  if (managed.length === 0) return managed;
  const id = await adminGroupId(db);
  return id && !managed.includes(id) ? [...managed, id] : managed;
}
