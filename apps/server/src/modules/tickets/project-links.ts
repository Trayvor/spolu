import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { EventRefDto, ProjectFilter, ProjectRefDto, TicketProjectBody } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { onSubjectProjectChanged } from '../finance/project-links.js';
import { getProjectRef } from '../projects/refs.js';
import { tickets } from './schema.js';
import type { AuditActor } from '../audit/actor.js';
import { recordTicketUpdate } from './audit.js';

type TicketRow = typeof tickets.$inferSelect;

/**
 * Tickets and projects (Phase 33 part P2): the list filters, what a žiadateľ sees, the ticket's
 * own project route and the merge's move. Pairs are validated by the projects module's
 * `getProjectRef` in the write's transaction.
 */

/**
 * The `project` / `event` filter of a ticket list (`<id>` or `none`), on
 * `tickets_group_project_event_idx`; undefined when neither is set.
 */
export function ticketProjectFilter(filter: ProjectFilter): SQL | undefined {
  const parts: SQL[] = [];
  if (filter.project === 'none') parts.push(isNull(tickets.projectId));
  else if (filter.project !== undefined) parts.push(eq(tickets.projectId, filter.project));
  if (filter.event === 'none') parts.push(isNull(tickets.eventId));
  else if (filter.event !== undefined) parts.push(eq(tickets.eventId, filter.event));
  return parts.length > 0 ? and(...parts) : undefined;
}

/**
 * The project and event of a ticket DTO for its viewer: in full for admins and the group's
 * clients (`seesAll`); a žiadateľ gets the project's name without its colour and never the event
 * (spec §4, decision 7).
 */
export function forProjectReader(
  project: ProjectRefDto | null,
  event: EventRefDto | null,
  seesAll: boolean,
): { project: ProjectRefDto | null; event: EventRefDto | null } {
  if (seesAll) return { project, event };
  return { project: project && { ...project, color: null }, event: null };
}

/**
 * Sets or clears the ticket's project and event (`PUT /api/tickets/:id/project`). The pair is
 * checked against the ticket's client in the transaction (`InvalidProjectError`); the update is
 * guarded by that client, so a move committed meanwhile changes nothing (null). `changed` is
 * false when the pair was already set. The ticket's time entries follow in the same
 * transaction (`onSubjectProjectChanged`, Phase 33 P6); `entriesMoved` says whether any did.
 */
export async function setTicketProject(
  db: Db,
  ticket: TicketRow & { groupId: string },
  body: TicketProjectBody,
  by?: AuditActor,
): Promise<{ ticket: TicketRow; changed: boolean; entriesMoved: boolean } | null> {
  return db.transaction(async (tx) => {
    const ref = await getProjectRef(tx, ticket.groupId, body.projectId, body.eventId);
    const projectId = ref?.projectId ?? null;
    const eventId = ref?.eventId ?? null;
    const [current] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, ticket.id), eq(tickets.groupId, ticket.groupId)))
      .for('update');
    if (!current) return null;
    if (current.projectId === projectId && current.eventId === eventId) {
      return { ticket: current, changed: false, entriesMoved: false };
    }
    const [row] = await tx
      .update(tickets)
      .set({ projectId, eventId, updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id))
      .returning();
    const moved = await onSubjectProjectChanged(tx, {
      kind: 'ticket',
      id: ticket.id,
      projectId,
      eventId,
    });
    await recordTicketUpdate(tx, by, current, row!);
    return { ticket: row!, changed: true, entriesMoved: moved > 0 };
  });
}

/**
 * Moves the client's tickets of project `fromProjectId` (those without an event; tickets on an
 * event follow the event through its FK's `on update cascade`) to `toProjectId`, in the merge's
 * transaction (Phase 33, spec §3.1). One statement on `tickets_group_project_event_idx`.
 */
export async function reassignTicketProject(
  tx: Db,
  groupId: string,
  fromProjectId: string,
  toProjectId: string,
): Promise<void> {
  await tx
    .update(tickets)
    .set({ projectId: toProjectId })
    .where(
      and(
        eq(tickets.groupId, groupId),
        eq(tickets.projectId, fromProjectId),
        isNull(tickets.eventId),
      ),
    );
}

/**
 * The project and event of each of these tickets (Phase 33 part P6): what the finance module's
 * startup backfill copies onto time entries made before its migration, so finance never reads
 * `tickets`. One query on the primary key; unknown ids are absent.
 */
export async function projectOfTickets(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, { projectId: string | null; eventId: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: tickets.id, projectId: tickets.projectId, eventId: tickets.eventId })
    .from(tickets)
    .where(inArray(tickets.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, { projectId: r.projectId, eventId: r.eventId }]));
}
