import { eq, and } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { AuditActor } from '../audit/actor.js';
import { activeRolesIn } from '../groups/memberships.js';
import { isAdmin } from '../users/policy.js';
import { getActiveRoles } from '../users/service.js';
import { recordTicketUpdate } from './audit.js';
import { ticketAssigneeIds } from './audience.js';
import { canConfirmTicket, startsTicketOnOpen } from './policy.js';
import { tickets } from './schema.js';
import type { TicketRow } from './service.js';
import { ticketStatusTime } from './time.js';

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
        adminDoneClearedAt: null,
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
