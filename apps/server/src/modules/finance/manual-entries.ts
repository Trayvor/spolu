import { randomUUID } from 'node:crypto';
import { and, count, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import type { ManualEntryBody, SessionUser, TimeEntryPatch } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { emitFinanceChanged, emitTimeRequests } from './events.js';
import { canAddManualEntry, canEditTimeEntry } from './policy.js';
import { financeToday } from './rates.js';
import { financeTimeEntries } from './schema.js';

/**
 * Manual time entries and finance admins' corrections in the work log (Phase 32, spec §6.1,
 * §6.3): "admin X spent N on day D" for a client, the edit of any entry (a task or ticket entry
 * takes minutes only), the delete of a manual or a still requested entry. A filled task or
 * ticket entry is never deleted here: the work was done; it is reset to 0 instead.
 */

const e = financeTimeEntries;

export class TimeEntryForbiddenError extends Error {
  constructor() {
    super('Not allowed to change this time entry');
    this.name = 'TimeEntryForbiddenError';
  }
}

export class TimeEntryNotFoundError extends Error {
  constructor() {
    super('No such time entry or client');
    this.name = 'TimeEntryNotFoundError';
  }
}

/** The entry's admin is no admin (a client, an unknown id): 400 `invalid_assignee`. */
export class TimeEntryUserError extends Error {
  constructor() {
    super('Time is entered for admins only');
    this.name = 'TimeEntryUserError';
  }
}

/** A day in the future, or a field a task or ticket entry does not take: 400. */
export class TimeEntryInvalidError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TimeEntryInvalidError';
  }
}

type EntryDeps = { db: Db; io: SocketIOServer };

function checkDay(day: string, now: Date): void {
  if (day > financeToday(now)) throw new TimeEntryInvalidError('The day is in the future');
}

/** The admin's open requests (the dashboard's count), after a change of one of them. */
async function openRequestCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(e)
    .where(and(eq(e.userId, userId), isNull(e.minutes), isNotNull(e.workedOn)));
  return row?.n ?? 0;
}

/**
 * `POST /api/groups/:id/finance/time-entries` (a client's tab) and `POST /api/finance/time-entries`
 * ("Add time" on `/finance`, any client or `groupId` null: "Bez klienta", shown system-wide
 * only). Any admin (active or deactivated) may be named.
 */
export async function createManualEntry(
  { db, io }: EntryDeps,
  actor: SessionUser,
  groupId: string | null,
  body: ManualEntryBody,
  now: Date = new Date(),
): Promise<{ id: string }> {
  if (!canAddManualEntry(actor)) throw new TimeEntryForbiddenError();
  if (groupId !== null && !(await getGroup(db, groupId))) throw new TimeEntryNotFoundError();
  const [target] = await db.select({ role: user.role }).from(user).where(eq(user.id, body.userId));
  if (!target || target.role === 'client') throw new TimeEntryUserError();
  checkDay(body.workedOn, now);
  const id = randomUUID();
  await db.insert(e).values({
    id,
    groupId,
    userId: body.userId,
    source: 'manual',
    minutes: body.minutes,
    workedOn: body.workedOn,
    note: body.note,
    createdBy: actor.id,
    updatedBy: actor.id,
    filledAt: now,
  });
  emitFinanceChanged(io, groupId, 'time');
  return { id };
}

/**
 * `PATCH /api/finance/time-entries/:id`: a finance admin corrects an entry. A task or ticket
 * entry takes `minutes` only (a ticket entry then stops being "covered by the tasks"); filling a
 * requested one answers the request, so its admin's dashboard count follows.
 */
export async function updateTimeEntry(
  { db, io }: EntryDeps,
  actor: SessionUser,
  id: string,
  patch: TimeEntryPatch,
  now: Date = new Date(),
): Promise<void> {
  const [entry] = await db.select().from(e).where(eq(e.id, id));
  if (!entry) throw new TimeEntryNotFoundError();
  if (!canEditTimeEntry(actor, entry)) throw new TimeEntryForbiddenError();
  if (entry.source !== 'manual' && (patch.workedOn !== undefined || patch.note !== undefined)) {
    throw new TimeEntryInvalidError('A task or ticket entry takes minutes only');
  }
  if (patch.workedOn !== undefined) checkDay(patch.workedOn, now);
  const answers = entry.minutes === null && patch.minutes !== undefined;
  await db
    .update(e)
    .set({
      ...(patch.minutes !== undefined ? { minutes: patch.minutes, coveredByTasks: false } : {}),
      ...(patch.workedOn !== undefined ? { workedOn: patch.workedOn } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(answers ? { filledAt: now } : {}),
      updatedBy: actor.id,
      updatedAt: now,
    })
    .where(eq(e.id, id));
  emitFinanceChanged(io, entry.groupId, 'time');
  if (answers && entry.workedOn !== null) {
    emitTimeRequests(io, entry.userId, await openRequestCount(db, entry.userId));
  }
}

/**
 * `DELETE /api/finance/time-entries/:id`: a manual entry, or a request nobody will answer (the
 * admin left). A filled task or ticket entry answers 400: reset it to 0 instead.
 */
export async function deleteTimeEntry(
  { db, io }: EntryDeps,
  actor: SessionUser,
  id: string,
): Promise<void> {
  const [entry] = await db.select().from(e).where(eq(e.id, id));
  if (!entry) throw new TimeEntryNotFoundError();
  if (!canEditTimeEntry(actor, entry) || !canAddManualEntry(actor)) {
    throw new TimeEntryForbiddenError();
  }
  const requested = entry.minutes === null;
  if (entry.source !== 'manual' && !requested) {
    throw new TimeEntryInvalidError('A filled task or ticket entry is reset to 0, not deleted');
  }
  await db.delete(e).where(eq(e.id, id));
  emitFinanceChanged(io, entry.groupId, 'time');
  if (requested && entry.workedOn !== null) {
    emitTimeRequests(io, entry.userId, await openRequestCount(db, entry.userId));
  }
}
