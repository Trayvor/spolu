import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { onTicketsLinkedToProject } from '../finance/project-links.js';
import {
  findEgrantProject,
  findProjectByName,
  projectEgrantFlags,
} from '../projects/egrant-match.js';
import { lockGroupProjects } from '../projects/refs.js';
import { tickets } from './schema.js';
import type { TicketRow } from './service.js';

/**
 * The intake's `project_id` link (Phase 33 part P3, spec §5.5). eGrant never updates a ticket:
 * a ticket is linked once, only while it has no project, and never gets an event from eGrant.
 */

/**
 * Links a new, assigned or moved ticket to its client's project with this eGrant id, in the
 * caller's transaction. Keeps the raw id (`tickets.egrant_project_id`) in every case, so a ticket
 * whose project has not arrived, or which has no client yet, is linked later. Never sets an
 * event, and never touches a ticket that already has a project.
 *
 * Takes the client's project lock, so a delivery creating the project at the same moment either
 * commits first (the project is found here) or sees this ticket waiting (`linkWaitingTickets`).
 */
export async function linkTicketProject(
  tx: Db,
  ticket: TicketRow,
  egrantProjectId: string | null,
): Promise<'linked' | 'waiting' | 'none'> {
  if (egrantProjectId === null || ticket.projectId !== null) return 'none';
  let projectId: string | null = null;
  if (ticket.groupId !== null) {
    await lockGroupProjects(tx, ticket.groupId);
    projectId = await findEgrantProject(tx, ticket.groupId, egrantProjectId);
  }
  const linked = await tx
    .update(tickets)
    .set({ egrantProjectId, ...(projectId ? { projectId } : {}) })
    .where(and(eq(tickets.id, ticket.id), isNull(tickets.projectId)))
    .returning({ id: tickets.id });
  if (!projectId) return 'waiting';
  // Its time entries (Phase 33 P6) follow, e.g. after a move to the project's client.
  if (linked.length > 0) await onTicketsLinkedToProject(tx, [ticket.id], projectId);
  return 'linked';
}

/**
 * The fallback switch `TICKETS_PROJECT_FIELD=programme` (decision 1): links a new ticket of a
 * client to the project whose name key equals its `programme`, if there is one. Never creates a
 * project, never keeps anything for later.
 */
export async function linkTicketByProgramme(tx: Db, ticket: TicketRow): Promise<boolean> {
  if (ticket.groupId === null || ticket.projectId !== null || !ticket.programme) return false;
  const projectId = await findProjectByName(tx, ticket.groupId, ticket.programme);
  if (projectId === null) return false;
  const linked = await tx
    .update(tickets)
    .set({ projectId })
    .where(and(eq(tickets.id, ticket.id), isNull(tickets.projectId)))
    .returning({ id: tickets.id });
  await onTicketsLinkedToProject(
    tx,
    linked.map((r) => r.id),
    projectId,
  );
  return true;
}

/** What the intake asks to link: eGrant's `project_id`, and whether the programme fallback is on. */
export type IntakeProjectLink = { egrantProjectId: string | null; byProgramme: boolean };

/** The fallback switch, read here only (decision 1): `TICKETS_PROJECT_FIELD=programme`. */
export function intakeProjectLink(
  config: { ticketsProjectField?: 'programme' | null },
  egrantProjectId: string | null,
): IntakeProjectLink {
  return { egrantProjectId, byProgramme: config.ticketsProjectField === 'programme' };
}

async function reread(tx: Db, ticket: TicketRow): Promise<TicketRow> {
  const [row] = await tx.select().from(tickets).where(eq(tickets.id, ticket.id));
  return row ?? ticket;
}

/**
 * The intake ticket's link, in its creating transaction: `project_id` when sent; otherwise the
 * programme fallback when it is on. Returns the row as it is now.
 */
export async function linkIntakeTicket(
  tx: Db,
  ticket: TicketRow,
  link: IntakeProjectLink,
): Promise<TicketRow> {
  const changed =
    link.egrantProjectId !== null
      ? (await linkTicketProject(tx, ticket, link.egrantProjectId)) !== 'none'
      : link.byProgramme && (await linkTicketByProgramme(tx, ticket));
  return changed ? reread(tx, ticket) : ticket;
}

/**
 * After a ticket got its client or moved to another one (its old project and event already
 * cleared): eGrant's raw `project_id` is matched in the new client. Returns the row as it is now.
 */
export async function relinkTicket(tx: Db, ticket: TicketRow): Promise<TicketRow> {
  const result = await linkTicketProject(tx, ticket, ticket.egrantProjectId);
  return result === 'linked' ? reread(tx, ticket) : ticket;
}

/**
 * The eGrant fields of a ticket's DTO (`TicketDto`): for admins and the group's clients
 * (`sees`), nothing for anyone else (a žiadateľ). One query when the ticket has a project.
 */
export async function ticketEgrantFields(
  db: Db,
  ticket: TicketRow,
  sees: boolean,
): Promise<{
  egrantProjectId: string | null;
  waitingForProject: boolean;
  egrantChanges: boolean;
  projectArchived: boolean;
}> {
  if (!sees) {
    return {
      egrantProjectId: null,
      waitingForProject: false,
      egrantChanges: false,
      projectArchived: false,
    };
  }
  const flags =
    ticket.projectId === null
      ? undefined
      : (await projectEgrantFlags(db, [ticket.projectId])).get(ticket.projectId);
  return {
    egrantProjectId: ticket.egrantProjectId,
    waitingForProject:
      ticket.groupId !== null && ticket.projectId === null && ticket.egrantProjectId !== null,
    egrantChanges: flags?.egrantChanges ?? false,
    projectArchived: flags?.archived ?? false,
  };
}

/**
 * Links the client's tickets waiting for this eGrant project (one update on
 * `tickets_waiting_project_idx`, one on their finance entries); returns their ids for
 * `ticket:updated`.
 */
export async function linkWaitingTickets(
  tx: Db,
  groupId: string,
  egrantProjectId: string,
  projectId: string,
): Promise<string[]> {
  const rows = await tx
    .update(tickets)
    .set({ projectId, updatedAt: new Date() })
    .where(
      and(
        eq(tickets.groupId, groupId),
        eq(tickets.egrantProjectId, egrantProjectId),
        isNull(tickets.projectId),
      ),
    )
    .returning({ id: tickets.id });
  const ids = rows.map((r) => r.id);
  // Time already written on them (Phase 33 P6) follows, in one statement.
  await onTicketsLinkedToProject(tx, ids, projectId);
  return ids;
}
