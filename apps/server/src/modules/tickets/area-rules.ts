import { and, asc, eq, sql } from 'drizzle-orm';
import { ticketAreaKey, type TicketAreaRule, type TicketAreaRuleInput } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { systemActor, type AuditActor } from '../audit/actor.js';
import { diffFields, hasChanges } from '../audit/diff.js';
import { recordAudit } from '../audit/service.js';
import { getActiveRoles, getUserNames } from '../users/service.js';
import { canBeAreaAssignee } from './policy.js';
import { ticketAreaRules } from './schema.js';
import { addAssignee, InvalidTicketAssigneeError, type TicketRow } from './service.js';
import { ticketAssigneeIds } from './audience.js';

/**
 * Automatic riešitelia by question area (2026-10-21, "Automatické priraďovanie riešiteľov"): the
 * client's table of area → admin (`ticket_area_rules`), and the assignment it drives. See
 * docs/product/tickets.md, "Automatic assignees by area".
 */

/** The author of an automatic assignment in the audit log. */
export const AREA_AUTOASSIGN_JOB = 'tickets.area-autoassign';

/** A row names someone who is not an active admin. */
export class InvalidAreaRuleError extends Error {
  constructor() {
    super('a ticket area rule names someone who is not an active admin');
    this.name = 'InvalidAreaRuleError';
  }
}

type StoredRule = { area: string; areaKey: string; userId: string };

async function storedRules(db: Db, groupId: string): Promise<StoredRule[]> {
  return db
    .select({
      area: ticketAreaRules.area,
      areaKey: ticketAreaRules.areaKey,
      userId: ticketAreaRules.userId,
    })
    .from(ticketAreaRules)
    .where(eq(ticketAreaRules.groupId, groupId))
    .orderBy(asc(ticketAreaRules.position), asc(ticketAreaRules.areaKey));
}

async function withNames(db: Db, rules: StoredRule[]): Promise<TicketAreaRule[]> {
  const names = await getUserNames(db, [...new Set(rules.map((r) => r.userId))]);
  return rules.map((r) => ({
    area: r.area,
    user: { id: r.userId, name: names.get(r.userId) ?? '' },
  }));
}

/** The client's table in its saved order, with each admin's name (two queries). */
export async function listAreaRules(db: Db, groupId: string): Promise<TicketAreaRule[]> {
  return withNames(db, await storedRules(db, groupId));
}

/** The rows as the audit keeps them: one ref per area key and admin. */
async function auditRefs(db: Db, rules: StoredRule[]) {
  const names = await getUserNames(db, [...new Set(rules.map((r) => r.userId))]);
  return rules.map((r) => ({
    id: `${r.userId}:${r.areaKey}`,
    label: `${r.area} → ${names.get(r.userId) ?? r.userId}`,
  }));
}

/** One row per area key and admin, the first spelling and position winning. */
function dedupe(rules: TicketAreaRuleInput[]): StoredRule[] {
  const seen = new Set<string>();
  const out: StoredRule[] = [];
  for (const rule of rules) {
    const area = rule.area.trim();
    const areaKey = ticketAreaKey(area);
    const id = `${areaKey}\u0000${rule.userId}`;
    if (!areaKey || seen.has(id)) continue;
    seen.add(id);
    out.push({ area, areaKey, userId: rule.userId });
  }
  return out;
}

const sameRules = (a: StoredRule[], b: StoredRule[]) =>
  a.length === b.length &&
  a.every(
    (r, i) => r.area === b[i]!.area && r.areaKey === b[i]!.areaKey && r.userId === b[i]!.userId,
  );

/**
 * Replaces the client's whole table with `rules` (the web's save, MCP's `set_ticket_areas` and
 * eGrant's sync alike): duplicates of an area key and admin collapse to the first. Every admin
 * must be active (`canBeAreaAssignee`), else `InvalidAreaRuleError` and nothing changes. One
 * `ticket_area_rules.updated` audit row with the rows added and removed; a save of the same table
 * records nothing and answers `changed: false`. Serialized per client by an advisory lock.
 */
export async function replaceAreaRules(
  db: Db,
  group: { id: string; name: string },
  rules: TicketAreaRuleInput[],
  by: AuditActor,
): Promise<{ changed: boolean; rules: TicketAreaRule[] }> {
  const next = dedupe(rules);
  const roles = await getActiveRoles(
    db,
    next.map((r) => r.userId),
  );
  if (next.some((r) => !canBeAreaAssignee(roles.get(r.userId)))) throw new InvalidAreaRuleError();
  const changed = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ticket_area_rules:${group.id}`}, 0))`,
    );
    const before = await storedRules(tx, group.id);
    if (sameRules(before, next)) return false;
    await tx.delete(ticketAreaRules).where(eq(ticketAreaRules.groupId, group.id));
    if (next.length > 0) {
      await tx
        .insert(ticketAreaRules)
        .values(next.map((r, position) => ({ ...r, groupId: group.id, position })));
    }
    const changes = diffFields(
      'ticket_area_rules',
      { rules: await auditRefs(tx, before) },
      { rules: await auditRefs(tx, next) },
    );
    // Only the order changed: a change of the table still, but nothing for the log.
    if (hasChanges(changes)) {
      await recordAudit(tx, by, [
        {
          entityType: 'ticket_area_rules',
          entityId: group.id,
          entityLabel: group.name,
          groupId: group.id,
          action: 'updated',
          changes,
        },
      ]);
    }
    return true;
  });
  return { changed, rules: await listAreaRules(db, group.id) };
}

/**
 * The active admins the client's table names for this area, in the table's order. One indexed
 * read (`group_id`, `area_key`: the primary key's prefix) and the roles.
 */
export async function areaAdminIds(
  db: Db,
  groupId: string,
  area: string | null,
): Promise<string[]> {
  const areaKey = area === null ? '' : ticketAreaKey(area);
  if (!areaKey) return [];
  const rows = await db
    .select({ userId: ticketAreaRules.userId })
    .from(ticketAreaRules)
    .where(and(eq(ticketAreaRules.groupId, groupId), eq(ticketAreaRules.areaKey, areaKey)))
    .orderBy(asc(ticketAreaRules.position));
  const ids = rows.map((r) => r.userId);
  const roles = await getActiveRoles(db, ids);
  return ids.filter((id) => canBeAreaAssignee(roles.get(id)));
}

/**
 * Makes the area's admins riešitelia of the ticket (owner decision 2026-10-21). `created`: every
 * admin of the area who is not one yet, in addition to anyone assigned already. `ifNone` (the
 * area changed, the ticket got or changed its client): only while the ticket has no riešiteľ.
 * Each add is the manual one (`addAssignee`: audited as `ticket.assignee_added` by the system,
 * the limit of riešitelia kept); the caller runs the `assigned` hooks for the returned ids, so
 * they hear it as from a manual assignment. A ticket without a client or area gets nobody.
 */
export async function autoAssignByArea(
  db: Db,
  ticket: TicketRow,
  mode: 'created' | 'ifNone',
  by: AuditActor = systemActor(AREA_AUTOASSIGN_JOB),
): Promise<string[]> {
  if (ticket.groupId === null || !ticket.area) return [];
  const admins = await areaAdminIds(db, ticket.groupId, ticket.area);
  if (admins.length === 0) return [];
  const current = await ticketAssigneeIds(db, ticket.id);
  if (mode === 'ifNone' && current.length > 0) return [];
  const added: string[] = [];
  for (const id of admins) {
    if (current.includes(id)) continue;
    try {
      if (await addAssignee(db, ticket, id, by)) added.push(id);
    } catch (error) {
      // The ticket is full of riešitelia, or the admin left meanwhile: skipped.
      if (error instanceof InvalidTicketAssigneeError) continue;
      throw error;
    }
  }
  return added;
}
