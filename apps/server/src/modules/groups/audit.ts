import { eq, inArray, sql } from 'drizzle-orm';
import type { AuditChanges } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { AuditActor } from '../audit/actor.js';
import { registerAuditResolver } from '../audit/resolvers.js';
import { recordAudit, type AuditEntry } from '../audit/service.js';
import { user } from '../users/schema.js';
import { groupManagers, groupMembers, groups } from './schema.js';

/**
 * The groups module's audit rows (spec §3.1): `group`, `membership` and `manager`. A membership
 * and a manager are named `<groupId>:<userId>`; their label is the person's name, or their email
 * while they have none (an invited person, Q4).
 */
export const memberEntityId = (groupId: string, userId: string) => `${groupId}:${userId}`;

/** The person's audit label: their name, or their email while they have no name. */
export async function personLabel(db: Db, userId: string): Promise<string> {
  const [row] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  return row ? row.name.trim() || row.email : userId;
}

type MemberAction = 'added' | 'invited' | 'invite_cancelled' | 'removed' | 'restored';

/** Records one membership row (no row without an author: callers outside a request pass none). */
export async function recordMembership(
  tx: Db,
  by: AuditActor | undefined,
  groupId: string,
  userId: string,
  action: MemberAction,
  changes: AuditChanges = {},
): Promise<void> {
  if (!by) return;
  await recordAudit(tx, by, [
    {
      entityType: 'membership',
      entityId: memberEntityId(groupId, userId),
      entityLabel: await personLabel(tx, userId),
      groupId,
      action,
      changes,
    },
  ]);
}

export function groupEntry(
  group: { id: string; name: string },
  action: AuditEntry['action'],
  changes: AuditChanges = {},
): AuditEntry {
  return {
    entityType: 'group',
    entityId: group.id,
    entityLabel: group.name,
    groupId: group.id,
    action,
    changes,
  };
}

const splitIds = (ids: string[]) =>
  ids.flatMap((id) => {
    const at = id.indexOf(':');
    return at < 0 ? [] : [{ id, groupId: id.slice(0, at), userId: id.slice(at + 1) }];
  });

/** The live-record resolvers of `group`, `membership` and `manager` (registered by `app.ts`). */
export function registerGroupsAuditResolvers(): void {
  registerAuditResolver('group', {
    async existingIds(db, ids) {
      const rows = await db.select({ id: groups.id }).from(groups).where(inArray(groups.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
  // A membership or manager links to the group's Members tab while the group exists.
  for (const type of ['membership', 'manager'] as const) {
    registerAuditResolver(type, {
      async existingIds(db, ids) {
        const parts = splitIds(ids);
        if (parts.length === 0) return new Set();
        const table = type === 'membership' ? groupMembers : groupManagers;
        const rows = await db
          .select({ groupId: table.groupId, userId: table.userId })
          .from(table)
          .where(
            sql`(${table.groupId}, ${table.userId}) in (${sql.join(
              parts.map((p) => sql`(${p.groupId}, ${p.userId})`),
              sql`, `,
            )})`,
          );
        const live = new Set(rows.map((r) => memberEntityId(r.groupId, r.userId)));
        return new Set(parts.filter((p) => live.has(p.id)).map((p) => p.id));
      },
    });
  }
}
