import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Substitution } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { isUniqueViolation } from '../../infra/db/errors.js';
import { actorUserId, systemActor, type AuditActor } from '../audit/actor.js';
import { diffFields } from '../audit/diff.js';
import { recordAudit } from '../audit/service.js';
import { startManagerModes, stopManagerModes } from '../notifications/modes.js';
import { user } from '../users/schema.js';
import { canBeSubstitute } from './policy.js';
import { adminSubstitutions, groupManagers } from './schema.js';

/**
 * Admin substitution ("Zastúpiť", 2026-10-19, ADR 0059). While admin A is substituted by B, B has
 * a **derived** `group_managers` row (`substitution_id` set) for every client group A manages on
 * their own. Every reader of `group_managers` counts it like an own row, so B gets what a manager
 * gets (notification mode, ticket watch, pickable, scopes) without any other module changing.
 * `syncSubstitute` is the one place that writes derived rows; it is idempotent.
 */

export const SUBSTITUTION_EXPIRE_ACTOR = 'admin-substitution.expire';

/** A is unknown, a client or deactivated. */
export class SubstitutedNotFoundError extends Error {
  constructor() {
    super('No such active admin');
    this.name = 'SubstitutedNotFoundError';
  }
}

/** B is A, unknown, a client or deactivated. */
export class InvalidSubstituteError extends Error {
  constructor() {
    super('The substitute must be another active admin');
    this.name = 'InvalidSubstituteError';
  }
}

/** A already has an active substitution. */
export class AlreadySubstitutedError extends Error {
  constructor() {
    super('This admin is substituted already');
    this.name = 'AlreadySubstitutedError';
  }
}

/** B is substituted themselves right now (no chains). */
export class SubstituteAwayError extends Error {
  constructor() {
    super('The substitute is substituted themselves');
    this.name = 'SubstituteAwayError';
  }
}

/** The end date is before today. */
export class EndsInPastError extends Error {
  constructor() {
    super('The end date is in the past');
    this.name = 'EndsInPastError';
  }
}

/** Today's date in Bratislava, `YYYY-MM-DD` (end dates are Bratislava days). */
export function bratislavaDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(now);
}

const active = isNull(adminSubstitutions.endedAt);
const labelOf = (row: { name: string; email: string }) => row.name.trim() || row.email;

/**
 * Makes B's derived manager rows equal to "the own rows of every admin B substitutes now":
 * deletes the ones no longer wanted, re-points a row to another active substitution (B covers
 * two admins of one group), inserts the missing ones and never touches a row B has of their own.
 * Starts and stops the manager notification mode as `addManager` / `removeManager` do. Returns
 * the groups whose managers changed.
 */
export async function syncSubstitute(tx: Db, substituteId: string): Promise<string[]> {
  const [wantedRows, currentRows] = await Promise.all([
    tx
      .selectDistinctOn([groupManagers.groupId], {
        groupId: groupManagers.groupId,
        substitutionId: adminSubstitutions.id,
      })
      .from(adminSubstitutions)
      .innerJoin(
        groupManagers,
        and(
          eq(groupManagers.userId, adminSubstitutions.substitutedId),
          isNull(groupManagers.substitutionId),
        ),
      )
      .where(and(eq(adminSubstitutions.substituteId, substituteId), active))
      .orderBy(
        groupManagers.groupId,
        asc(adminSubstitutions.createdAt),
        asc(adminSubstitutions.id),
      ),
    tx
      .select({ groupId: groupManagers.groupId, substitutionId: groupManagers.substitutionId })
      .from(groupManagers)
      .where(eq(groupManagers.userId, substituteId)),
  ]);
  const wanted = new Map(wantedRows.map((r) => [r.groupId, r.substitutionId]));
  const current = new Map(currentRows.map((r) => [r.groupId, r.substitutionId]));

  const drop = currentRows
    .filter((r) => r.substitutionId !== null && !wanted.has(r.groupId))
    .map((r) => r.groupId);
  const add = [...wanted].filter(([groupId]) => !current.has(groupId));
  const repoint = currentRows.filter(
    (r) =>
      r.substitutionId !== null &&
      wanted.has(r.groupId) &&
      wanted.get(r.groupId) !== r.substitutionId,
  );

  let dropped: string[] = [];
  if (drop.length > 0) {
    dropped = (
      await tx
        .delete(groupManagers)
        .where(
          and(
            eq(groupManagers.userId, substituteId),
            inArray(groupManagers.groupId, drop),
            isNotNull(groupManagers.substitutionId),
          ),
        )
        .returning({ groupId: groupManagers.groupId })
    ).map((r) => r.groupId);
    await stopManagerModes(tx, substituteId, dropped);
  }
  for (const row of repoint) {
    await tx
      .update(groupManagers)
      .set({ substitutionId: wanted.get(row.groupId)! })
      .where(
        and(
          eq(groupManagers.groupId, row.groupId),
          eq(groupManagers.userId, substituteId),
          isNotNull(groupManagers.substitutionId),
        ),
      );
  }
  let added: string[] = [];
  if (add.length > 0) {
    added = (
      await tx
        .insert(groupManagers)
        .values(
          add.map(([groupId, substitutionId]) => ({
            groupId,
            userId: substituteId,
            substitutionId,
          })),
        )
        .onConflictDoNothing()
        .returning({ groupId: groupManagers.groupId })
    ).map((r) => r.groupId);
    await startManagerModes(tx, substituteId, added);
  }
  return [...dropped, ...added];
}

/**
 * After A's own manager rows changed (`addManager`, `removeManager`): brings the derived rows of
 * whoever substitutes A now up to date. Returns the groups whose managers changed.
 */
export async function syncSubstitutesOf(tx: Db, substitutedId: string): Promise<string[]> {
  const rows = await tx
    .select({ substituteId: adminSubstitutions.substituteId })
    .from(adminSubstitutions)
    .where(and(eq(adminSubstitutions.substitutedId, substitutedId), active));
  const changed: string[] = [];
  for (const { substituteId } of rows) changed.push(...(await syncSubstitute(tx, substituteId)));
  return changed;
}

/**
 * Starts "B substitutes A" at once, until `endsOn` (inclusive; null = until ended). Throws
 * `SubstitutedNotFoundError`, `InvalidSubstituteError`, `SubstituteAwayError`,
 * `AlreadySubstitutedError` or `EndsInPastError`. Writes `substitution.started`.
 */
export async function startSubstitution(
  db: Db,
  input: { substitutedId: string; substituteId: string; endsOn: string | null },
  by: AuditActor,
  today: string = bratislavaDate(),
): Promise<{ substitution: Substitution; changedGroupIds: string[] }> {
  if (input.endsOn !== null && input.endsOn < today) throw new EndsInPastError();
  try {
    return await db.transaction(async (tx) => {
      const people = await tx
        .select({
          id: user.id,
          role: user.role,
          disabledAt: user.disabledAt,
          name: user.name,
          email: user.email,
        })
        .from(user)
        .where(inArray(user.id, [input.substitutedId, input.substituteId]))
        .orderBy(asc(user.id))
        .for('share');
      const substituted = people.find((p) => p.id === input.substitutedId);
      const substitute = people.find((p) => p.id === input.substituteId);
      if (!substituted || substituted.role === 'client' || substituted.disabledAt !== null) {
        throw new SubstitutedNotFoundError();
      }
      if (!canBeSubstitute(substituted.id, substitute)) throw new InvalidSubstituteError();

      const busy = await tx
        .select({ substitutedId: adminSubstitutions.substitutedId })
        .from(adminSubstitutions)
        .where(
          and(inArray(adminSubstitutions.substitutedId, [substituted.id, substitute!.id]), active),
        );
      if (busy.some((r) => r.substitutedId === substituted.id)) {
        throw new AlreadySubstitutedError();
      }
      if (busy.length > 0) throw new SubstituteAwayError();

      const id = randomUUID();
      await tx.insert(adminSubstitutions).values({
        id,
        substitutedId: substituted.id,
        substituteId: substitute!.id,
        endsOn: input.endsOn,
        createdBy: actorUserId(by),
      });
      const changedGroupIds = await syncSubstitute(tx, substitute!.id);
      await recordAudit(tx, by, [
        {
          entityType: 'substitution',
          entityId: id,
          entityLabel: labelOf(substituted),
          groupId: null,
          action: 'started',
          changes: diffFields('substitution', null, {
            substituted: { id: substituted.id, label: labelOf(substituted) },
            substitute: { id: substitute!.id, label: labelOf(substitute!) },
            endsOn: input.endsOn,
          }),
        },
      ]);
      return {
        substitution: {
          id,
          substitutedId: substituted.id,
          substituteId: substitute!.id,
          substituteName: labelOf(substitute!),
          endsOn: input.endsOn,
        },
        changedGroupIds,
      };
    });
  } catch (error) {
    // Two starts for the same admin at once: the partial unique index lets one through.
    if (isUniqueViolation(error)) throw new AlreadySubstitutedError();
    throw error;
  }
}

/** Ends one substitution row in `tx` (if still active) and writes `substitution.ended`. */
async function endRow(
  tx: Db,
  substitutionId: string,
  by: AuditActor,
): Promise<{ ended: boolean; changedGroupIds: string[] }> {
  const [row] = await tx
    .update(adminSubstitutions)
    .set({ endedAt: new Date(), endedBy: actorUserId(by) })
    .where(and(eq(adminSubstitutions.id, substitutionId), active))
    .returning({
      substitutedId: adminSubstitutions.substitutedId,
      substituteId: adminSubstitutions.substituteId,
      endsOn: adminSubstitutions.endsOn,
    });
  if (!row) return { ended: false, changedGroupIds: [] };
  const changedGroupIds = await syncSubstitute(tx, row.substituteId);
  const people = await tx
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(inArray(user.id, [row.substitutedId, row.substituteId]));
  const label = (id: string) => {
    const person = people.find((p) => p.id === id);
    return person ? labelOf(person) : id;
  };
  await recordAudit(tx, by, [
    {
      entityType: 'substitution',
      entityId: substitutionId,
      entityLabel: label(row.substitutedId),
      groupId: null,
      action: 'ended',
      changes: diffFields(
        'substitution',
        {
          substituted: { id: row.substitutedId, label: label(row.substitutedId) },
          substitute: { id: row.substituteId, label: label(row.substituteId) },
          endsOn: row.endsOn,
        },
        null,
      ),
    },
  ]);
  return { ended: true, changedGroupIds };
}

/**
 * Ends A's active substitution, if any ("Ukončiť zastupovanie"): B stops managing exactly the
 * groups it made B a manager of. Idempotent.
 */
export async function endSubstitution(
  db: Db,
  substitutedId: string,
  by: AuditActor,
): Promise<{ ended: boolean; changedGroupIds: string[] }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: adminSubstitutions.id })
      .from(adminSubstitutions)
      .where(and(eq(adminSubstitutions.substitutedId, substitutedId), active));
    if (!row) return { ended: false, changedGroupIds: [] };
    return endRow(tx, row.id, by);
  });
}

/**
 * Ends every active substitution where the user is A or B (their deactivation). Returns the
 * groups whose managers changed.
 */
export async function endSubstitutionsOf(
  db: Db,
  userId: string,
  by: AuditActor,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: adminSubstitutions.id })
      .from(adminSubstitutions)
      .where(
        and(
          or(
            eq(adminSubstitutions.substitutedId, userId),
            eq(adminSubstitutions.substituteId, userId),
          ),
          active,
        ),
      );
    const changed = new Set<string>();
    for (const { id } of rows) {
      for (const groupId of (await endRow(tx, id, by)).changedGroupIds) changed.add(groupId);
    }
    return [...changed];
  });
}

/**
 * The hourly job: ends every active substitution whose last day is before `today` (Bratislava),
 * with the system as author. Idempotent: an ended row is never ended again. Returns how many
 * ended.
 */
export async function expireSubstitutions(
  db: Db,
  today: string = bratislavaDate(),
): Promise<number> {
  const due = await db
    .select({ id: adminSubstitutions.id })
    .from(adminSubstitutions)
    .where(and(active, lt(adminSubstitutions.endsOn, today)));
  let count = 0;
  for (const { id } of due) {
    const { ended } = await db.transaction((tx) =>
      endRow(tx, id, systemActor(SUBSTITUTION_EXPIRE_ACTOR)),
    );
    if (ended) count += 1;
  }
  return count;
}

/** Every active substitution, by the substituted admin's id. One query. */
export async function activeSubstitutions(db: Db): Promise<Map<string, Substitution>> {
  const rows = await db
    .select({
      id: adminSubstitutions.id,
      substitutedId: adminSubstitutions.substitutedId,
      substituteId: adminSubstitutions.substituteId,
      endsOn: adminSubstitutions.endsOn,
      name: user.name,
      email: user.email,
    })
    .from(adminSubstitutions)
    .innerJoin(user, eq(user.id, adminSubstitutions.substituteId))
    .where(active);
  return new Map(
    rows.map((r) => [
      r.substitutedId,
      {
        id: r.id,
        substitutedId: r.substitutedId,
        substituteId: r.substituteId,
        substituteName: labelOf(r),
        endsOn: r.endsOn,
      },
    ]),
  );
}
