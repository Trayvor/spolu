import type { Server as SocketIOServer } from 'socket.io';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { SessionUser, TicketStatus } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { AuditActor } from '../audit/actor.js';
import type { TimeEffect } from '../finance/task-time.js';
import { activeRolesIn } from '../groups/memberships.js';
import { isAdmin } from '../users/policy.js';
import { getActiveRoles } from '../users/service.js';
import { recordTicketUpdate } from './audit.js';
import { ticketAssigneeIds } from './audience.js';
import { emitTicket } from './events.js';
import { canConfirmTicket, startsTicketOnOpen } from './policy.js';
import { tickets } from './schema.js';
import { getTicketRow, updateTicket, type TicketRow } from './service.js';
import { ticketDoneTime, ticketStatusTime } from './time.js';

/** The ticket is not in the state the action needs: answers 409 `invalid_ticket_state`. */
export class InvalidTicketStateError extends Error {
  constructor() {
    super('The ticket is not in the state this action needs');
    this.name = 'InvalidTicketStateError';
  }
}

/**
 * Opening a new ticket's page starts it (ticket lifecycle rework, design 5.2): `new` becomes
 * `in_progress` as an ordinary status change by `actor` (audit row, time hooks). The update is
 * conditional on `status = 'new'`, so two people opening it at once change it once: the second
 * gets null, as does anyone who may not start it. The riešitelia are read only for an admin on a
 * new ticket, so the usual `seen` call costs nothing more.
 */
export async function startTicketOnOpen(
  db: Db,
  actor: SessionUser,
  row: TicketRow,
  by: AuditActor,
): Promise<TicketRow | null> {
  if (row.status !== 'new' || !isAdmin(actor)) return null;
  const assignees = await ticketAssigneeIds(db, row.id);
  if (!startsTicketOnOpen(actor, row, assignees.includes(actor.id), assignees.length > 0)) {
    return null;
  }
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(tickets)
      .set({
        status: 'in_progress',
        resolvedAt: null,
        adminDoneAt: null,
        adminDoneBy: null,
        updatedAt: new Date(),
      })
      .where(and(eq(tickets.id, row.id), eq(tickets.status, 'new')))
      .returning();
    if (!after) return null;
    await ticketStatusTime(tx, actor, row, after);
    await recordTicketUpdate(tx, by, row, after);
    return after;
  });
}

/**
 * Whether the ticket's author can confirm it (design 2): they exist, are not an admin, have an
 * active account and read the ticket, which is `canConfirmTicket` for them. On a ticket made on
 * behalf of someone this is the named person, not the manager who created it.
 */
export async function hasConfirmableAuthor(
  db: Db,
  ticket: Pick<TicketRow, 'groupId' | 'requesterUserId'>,
): Promise<boolean> {
  const id = ticket.requesterUserId;
  if (id === null) return false;
  const role = (await getActiveRoles(db, [id])).get(id);
  if (role === undefined) return false;
  const memberRole =
    ticket.groupId === null
      ? null
      : ((await activeRolesIn(db, ticket.groupId, [id])).get(id) ?? null);
  return canConfirmTicket({ id, role } as SessionUser, ticket, memberRole);
}

/**
 * "Solved on our side" (design 5.3), on a ticket in progress without the mark. With a confirmable
 * author it sets the mark and the status stays; the write is conditional on that state, so two
 * admins pressing at once set it once. Without one nobody can answer, so it resolves at once.
 * Either way this is when time is asked (design 5.4). `marked` says which. Any other state throws
 * `InvalidTicketStateError`.
 */
export async function markTicketDone(
  db: Db,
  id: string,
  actor: { id: string; name: string },
  by: AuditActor,
): Promise<{ ticket: TicketRow; marked: boolean } & TimeEffect> {
  const before = await getTicketRow(db, id);
  if (!before || before.status !== 'in_progress' || before.adminDoneAt) {
    throw new InvalidTicketStateError();
  }
  if (!(await hasConfirmableAuthor(db, before))) {
    const { ticket, askTime, time } = await resolveTicket(db, id, actor, by, 'in_progress');
    return { ticket, marked: false, askTime, time };
  }
  const done = await db.transaction(async (tx) => {
    const now = new Date();
    const [after] = await tx
      .update(tickets)
      .set({ adminDoneAt: now, adminDoneBy: actor.id, adminDoneClearedAt: null, updatedAt: now })
      .where(
        and(eq(tickets.id, id), eq(tickets.status, 'in_progress'), isNull(tickets.adminDoneAt)),
      )
      .returning();
    if (!after) return null;
    await recordTicketUpdate(tx, by, before, after);
    return { ticket: after, ...(await ticketDoneTime(tx, actor, before, now)) };
  });
  if (!done) throw new InvalidTicketStateError();
  return { ...done, marked: true };
}

/** The author's "Solved": resolves a ticket that is not resolved yet, mark or not (design 5.3). */
export function confirmTicket(
  db: Db,
  id: string,
  actor: { id: string; name: string },
  by: AuditActor,
) {
  return resolveTicket(db, id, actor, by);
}

/**
 * The author's "Not solved yet" (design 5.3): needs the mark, the status stays. `markedBy` is the
 * admin who pressed, read before the mark goes: they hear it even if they are no riešiteľ.
 */
export async function declineTicket(
  db: Db,
  id: string,
  by: AuditActor,
): Promise<{ ticket: TicketRow; markedBy: string | null }> {
  const before = await getTicketRow(db, id);
  const ticket = before && (await clearTicketMark(db, before, by));
  if (!ticket) throw new InvalidTicketStateError();
  return { ticket, markedBy: before.adminDoneBy };
}

/**
 * Clears the mark and notes that it was cleared, for the time review (design 5.1, 5.4). The write
 * is conditional on the mark being set, so null says there was none and nothing was written.
 * `before` is the row as read, for the audit.
 */
export async function clearTicketMark(
  db: Db,
  before: TicketRow,
  by: AuditActor,
): Promise<TicketRow | null> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [after] = await tx
      .update(tickets)
      .set({ adminDoneAt: null, adminDoneBy: null, adminDoneClearedAt: now, updatedAt: now })
      .where(and(eq(tickets.id, before.id), isNotNull(tickets.adminDoneAt)))
      .returning();
    if (!after) return null;
    await recordTicketUpdate(tx, by, before, after);
    return after;
  });
}

/**
 * The author's new message in the ticket chat (a reply in a thread too) takes the ticket back to
 * in progress: it clears the "solved on our side" mark like a decline (design 5.3), through
 * `clearTicketMark`, so the write is conditional on the mark and audited. The author is
 * `requesterUserId`; anyone else's message leaves the mark alone. Pushes `ticket:updated` once
 * after a real clear; no notification, the message itself reaches the riešitelia.
 */
export async function clearMarkOnAuthorMessage(
  deps: { db: Db; io: SocketIOServer },
  ticket: TicketRow,
  authorId: string,
  by: AuditActor,
): Promise<void> {
  if (ticket.adminDoneAt === null || ticket.requesterUserId !== authorId) return;
  const after = await clearTicketMark(deps.db, ticket, by);
  if (after) emitTicket(deps.io, 'updated', after);
}

/**
 * Resolves through `updateTicket`, so time and audit stay in one path. Throws when nothing changed:
 * already resolved, resolved by someone else at the same moment, or no longer in `onlyFrom`.
 */
async function resolveTicket(
  db: Db,
  id: string,
  actor: { id: string; name: string },
  by: AuditActor,
  onlyFrom?: TicketStatus,
) {
  const result = await updateTicket(db, id, { status: 'resolved' }, actor, by, onlyFrom);
  if (!result?.statusChanged) throw new InvalidTicketStateError();
  return result;
}
