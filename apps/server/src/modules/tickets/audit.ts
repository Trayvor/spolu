import { inArray } from 'drizzle-orm';
import type { AuditChanges } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { AuditActor } from '../audit/actor.js';
import { diffFields, hasChanges, type FieldValues } from '../audit/diff.js';
import { registerAuditResolver } from '../audit/resolvers.js';
import { recordAudit } from '../audit/service.js';
import { getGroupLabels } from '../groups/service.js';
import { projectRefs } from '../projects/refs.js';
import { tickets } from './schema.js';
import type { TicketRow } from './service.js';

/** A ticket's label in the log: its number and subject. */
export const ticketLabel = (t: Pick<TicketRow, 'number' | 'subject'>) =>
  `#${t.number}${t.subject ? ` ${t.subject}` : ''}`;

/** The audited fields of a ticket (spec §3.1), with its client's and project's names. */
export async function ticketAuditValues(db: Db, t: TicketRow): Promise<FieldValues> {
  const [groups, refs] = await Promise.all([
    t.groupId ? getGroupLabels(db, [t.groupId]) : Promise.resolve(new Map()),
    projectRefs(db, [{ projectId: t.projectId, eventId: t.eventId }]),
  ]);
  const project = refs.project(t.projectId);
  const event = refs.event(t.eventId);
  return {
    subject: t.subject,
    status: t.status,
    area: t.area,
    programme: t.programme,
    dueDate: t.dueDate,
    url: t.url,
    body: t.body,
    client: t.groupId ? { id: t.groupId, label: groups.get(t.groupId)?.name ?? t.groupId } : null,
    project: project ? { id: project.id, label: project.name } : null,
    event: event ? { id: event.id, label: event.name } : null,
  };
}

/** Records one ticket row (a `created` with the initial values, an `updated` with the diff). */
export async function recordTicket(
  tx: Db,
  by: AuditActor | undefined,
  ticket: TicketRow,
  action: 'created' | 'updated' | 'assignee_added' | 'assignee_removed',
  changes: AuditChanges,
): Promise<void> {
  if (!by || (action === 'updated' && !hasChanges(changes))) return;
  await recordAudit(tx, by, [
    {
      entityType: 'ticket',
      entityId: ticket.id,
      entityLabel: ticketLabel(ticket),
      groupId: ticket.groupId,
      action,
      changes,
    },
  ]);
}

/** `ticket.updated` from the row before and after the change. */
export async function recordTicketUpdate(
  tx: Db,
  by: AuditActor | undefined,
  before: TicketRow,
  after: TicketRow,
): Promise<void> {
  if (!by) return;
  const changes = diffFields(
    'ticket',
    await ticketAuditValues(tx, before),
    await ticketAuditValues(tx, after),
  );
  await recordTicket(tx, by, after, 'updated', changes);
}

export async function recordTicketCreated(
  tx: Db,
  by: AuditActor | undefined,
  ticket: TicketRow,
): Promise<void> {
  if (!by) return;
  const changes = diffFields('ticket', null, await ticketAuditValues(tx, ticket));
  await recordTicket(tx, by, ticket, 'created', changes);
}

export function registerTicketsAuditResolvers(): void {
  registerAuditResolver('ticket', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(inArray(tickets.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
