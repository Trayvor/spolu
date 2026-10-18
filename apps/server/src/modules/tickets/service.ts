import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type {
  MemberRole,
  SessionUser,
  TicketDto,
  TicketListItem,
  TicketListQuery,
  TicketCandidate,
  TicketPatchBody,
  TicketPerson,
  TicketSource,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { escapeLike } from '../../infra/text/search.js';
import type { FileReadRule } from '../files/read-rules.js';
import {
  attachFiles,
  attachReceivedFiles,
  getFilesForGroup,
  moveFilesToGroup,
  type FileDeps,
} from '../files/service.js';
import { activeMemberOfSql, activeRolesIn, listMemberships } from '../groups/memberships.js';
import { managedGroupIds } from '../groups/managers.js';
import {
  InvalidKnowledgeLinkError,
  linkedCardsOf,
  linkedItemIds,
  setLinkedItems,
} from '../knowledge/links.js';
// Deliberate read-only exception: the list joins the group's name in its one query.
import { groups } from '../groups/schema.js';
import { getGroup, listGroupPeople } from '../groups/service.js';
import { countTasksFromTicket, listTasksFromTicket } from '../tasks/task-service.js';
import { channelFileIds } from '../chat/messages.js';
import { getTicketChannel } from '../chat/service.js';
import { getProjectRef, InvalidProjectError, projectRefs } from '../projects/refs.js';
import { recordDescriptionMentions } from '../notifications/description-mentions.js';
import { ticketUnseenSql } from '../notifications/unseen.js';
import { isAdmin } from '../users/policy.js';
import { getActiveRoles, getUserNames, listAdmins } from '../users/service.js';
import {
  canAssignTicket,
  canBeTicketAssignee,
  canHoldTickets,
  canReadTicket,
  canSplitTicket,
} from './policy.js';
import { resolveRequester } from './requester.js';
import { ticketAssignees, ticketAttachments, tickets } from './schema.js';
import { forProjectReader, ticketProjectFilter } from './project-links.js';
import {
  linkIntakeTicket,
  relinkTicket,
  ticketEgrantFields,
  type IntakeProjectLink,
} from './egrant-link.js';
import { pendingEgrantChangesSql } from '../projects/egrant-match.js';
import { noTimeEffect, type TimeEffect } from '../finance/task-time.js';
import { onTicketAssigneesRemoved, onTicketMoved } from '../finance/ticket-time.js';
import { ticketStatusTime } from './time.js';

export type TicketRow = typeof tickets.$inferSelect;

/** The content of a ticket as the shared schemas parse it. */
type TicketFields = {
  area: string | null;
  subject: string | null;
  programme: string | null;
  body: string | null;
  dueDate: string | null;
  url: string | null;
};

/** The group cannot hold tickets: the admin group (Phase 34, `canHoldTickets`). */
export class InvalidTicketGroupError extends Error {
  constructor() {
    super('The admin group has no tickets');
    this.name = 'InvalidTicketGroupError';
  }
}

export class TicketHasTasksError extends Error {
  constructor() {
    super('A ticket with tasks cannot move to another client');
    this.name = 'TicketHasTasksError';
  }
}

/** The actor's active role in the group; null for admins, outsiders and removed members. */
export async function roleIn(
  db: Db,
  actor: SessionUser,
  groupId: string | null,
): Promise<MemberRole | null> {
  if (isAdmin(actor) || groupId === null) return null;
  // Through `activeRolesIn`, so a deactivated group's membership counts for nothing.
  return (await activeRolesIn(db, groupId, [actor.id])).get(actor.id) ?? null;
}

/** Whether the actor may read the ticket (one membership lookup). */
export async function actorReadsTicket(
  db: Db,
  actor: SessionUser,
  ticket: Pick<TicketRow, 'groupId' | 'requesterUserId'>,
): Promise<boolean> {
  return canReadTicket(actor, ticket, await roleIn(db, actor, ticket.groupId));
}

/**
 * Which of the tickets the actor reads now, in two queries whatever the count (the tickets and,
 * for a non-admin, their active memberships). For lists built elsewhere that link to tickets.
 */
export async function readableTicketIds(
  db: Db,
  actor: SessionUser,
  ids: string[],
): Promise<Set<string>> {
  return new Set((await readableTicketGroups(db, actor, ids)).keys());
}

/**
 * `readableTicketIds` with each readable ticket's client (null for none), by id, in the same two
 * queries (2026-10-18, the file read rules).
 */
export async function readableTicketGroups(
  db: Db,
  actor: SessionUser,
  ids: string[],
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: tickets.id, groupId: tickets.groupId, requesterUserId: tickets.requesterUserId })
    .from(tickets)
    .where(inArray(tickets.id, [...new Set(ids)]));
  const roles = isAdmin(actor)
    ? new Map<string, MemberRole>()
    : new Map((await listMemberships(db, actor.id)).map((m) => [m.groupId, m.role]));
  return new Map(
    rows
      .filter((r) => canReadTicket(actor, r, r.groupId ? (roles.get(r.groupId) ?? null) : null))
      .map((r) => [r.id, r.groupId]),
  );
}

export async function getTicketRow(db: Db, id: string): Promise<TicketRow | null> {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, id));
  return row ?? null;
}

export type CreateTicketInput = {
  source: TicketSource;
  groupId: string | null;
  createdBy: string | null;
  fields: TicketFields;
  requester: { email: string | null; name: string | null; phone: string | null };
  /** Files uploaded in the manual form (they must belong to `groupId`). */
  fileIds?: string[];
  /**
   * Files sent to the intake, already stored with `createReceivedFile` in `groupId` (null for a
   * ticket without a client). Attached in the ticket's transaction; on a duplicate or a failure
   * they stay unattached and the caller deletes them.
   */
  receivedFileIds?: string[];
  /** The eGrant instance link the API sent. */
  instanceUrl?: string | null;
  /** The intake's idempotency key: a second ticket with the same key is never written. */
  requestId?: string | null;
  /** Knowledge attached to the text (Phase 33 part P5; the manual form only, needs `groupId`). */
  knowledgeIds?: string[];
  /** The project and event (Phase 33 part P2; the manual form only, needs `groupId`). */
  project?: { projectId: string | null; eventId: string | null };
  /** The intake's project link (Phase 33 part P3): eGrant's `project_id`, or the fallback. */
  egrantProject?: IntakeProjectLink;
};

/** The ticket the intake already made for `requestId`, if any. */
export async function findTicketByRequestId(db: Db, requestId: string): Promise<TicketRow | null> {
  const [row] = await db.select().from(tickets).where(eq(tickets.requestId, requestId));
  return row ?? null;
}

/**
 * Saves a ticket. With a client, the initiator is resolved first (it may add a ziadatel
 * membership), then the ticket and its files are written in one transaction. Returns
 * the row and whether the initiator should get the "Ticket created" email. When another ticket
 * already holds `requestId` (a concurrent retry), nothing is written and `duplicate` is true
 * with that ticket.
 */
export async function createTicket(
  deps: FileDeps,
  input: CreateTicketInput,
): Promise<{ ticket: TicketRow; notifyRequester: boolean; duplicate: boolean }> {
  const { db } = deps;
  const target = input.groupId === null ? null : await getGroup(db, input.groupId);
  if (target && !canHoldTickets(target)) throw new InvalidTicketGroupError();
  const resolved =
    input.groupId === null
      ? { userId: null, notify: false }
      : await resolveRequester(db, input.groupId, input.requester.email, input.requester.name);
  const now = new Date();
  const ticket = await db.transaction(async (tx) => {
    const wanted = input.project ?? { projectId: null, eventId: null };
    if (input.groupId === null && wanted.projectId !== null) throw new InvalidProjectError();
    const ref =
      input.groupId === null
        ? null
        : await getProjectRef(tx, input.groupId, wanted.projectId, wanted.eventId);
    const [row] = await tx
      .insert(tickets)
      .values({
        id: randomUUID(),
        groupId: input.groupId,
        source: input.source,
        requesterUserId: resolved.userId,
        requesterName: input.requester.name,
        requesterEmail: input.requester.email,
        requesterPhone: input.requester.phone,
        ...input.fields,
        instanceUrl: input.instanceUrl ?? null,
        requestId: input.requestId ?? null,
        projectId: ref?.projectId ?? null,
        eventId: ref?.eventId ?? null,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: tickets.requestId })
      .returning();
    if (!row) return null;
    const created = row;
    if (input.groupId && input.fileIds && input.fileIds.length > 0) {
      await attachFiles(tx, input.groupId, input.fileIds, input.createdBy ?? '');
      await tx
        .insert(ticketAttachments)
        .values(
          input.fileIds.map((fileId, position) => ({ ticketId: created.id, fileId, position })),
        );
    }
    if (input.receivedFileIds && input.receivedFileIds.length > 0) {
      await attachReceivedFiles(tx, input.receivedFileIds);
      await tx.insert(ticketAttachments).values(
        input.receivedFileIds.map((fileId, position) => ({
          ticketId: created.id,
          fileId,
          position,
        })),
      );
    }
    if (input.knowledgeIds && input.knowledgeIds.length > 0) {
      if (input.groupId === null) throw new InvalidKnowledgeLinkError();
      await setLinkedItems(
        tx,
        { kind: 'ticket', id: created.id },
        input.groupId,
        input.knowledgeIds,
      );
    }
    // Phase 33 part P3: the intake's `project_id` (or the programme fallback), once.
    return input.egrantProject ? linkIntakeTicket(tx, created, input.egrantProject) : created;
  });
  if (!ticket) {
    const existing = await findTicketByRequestId(db, input.requestId!);
    return { ticket: existing!, notifyRequester: false, duplicate: true };
  }
  const notifyRequester =
    resolved.notify && resolved.userId !== null && resolved.userId !== input.createdBy;
  return { ticket, notifyRequester, duplicate: false };
}

/**
 * Marks the "Ticket created" email as sent, once per ticket: true only for the call that set it,
 * so a retry or a second assignment never sends it again.
 */
export async function claimRequesterEmail(db: Db, ticketId: string): Promise<boolean> {
  const rows = await db
    .update(tickets)
    .set({ requesterNotifiedAt: new Date() })
    .where(and(eq(tickets.id, ticketId), isNull(tickets.requesterNotifiedAt)))
    .returning({ id: tickets.id });
  return rows.length === 1;
}

async function groupNameOf(db: Db, groupId: string | null): Promise<string | null> {
  return groupId === null ? null : ((await getGroup(db, groupId))?.name ?? null);
}

/** The ids of the files uploaded with the ticket in the manual form or sent to the intake. */
async function attachmentIds(db: Db, ticketId: string): Promise<string[]> {
  const rows = await db
    .select({ fileId: ticketAttachments.fileId })
    .from(ticketAttachments)
    .where(eq(ticketAttachments.ticketId, ticketId))
    .orderBy(ticketAttachments.position, ticketAttachments.fileId);
  return rows.map((r) => r.fileId);
}

/** The files of the ticket; a ticket without a client keeps the intake's files in no group. */
export async function ticketFiles(db: Db, row: TicketRow) {
  return getFilesForGroup(db, row.groupId, await attachmentIds(db, row.id));
}

/**
 * The files a ticket's task cards may copy: the ticket's own (uploaded with it or sent to the
 * intake) and those sent in its chat (owner bug report 2026-10-18), without repeats. Everyone
 * who uses the group's board reads the ticket and its chat, so a copy shows them nothing new.
 */
export async function ticketTaskFiles(db: Db, row: TicketRow) {
  const channel = await getTicketChannel(db, row.id);
  const [own, chat] = await Promise.all([
    attachmentIds(db, row.id),
    channel ? channelFileIds(db, channel.id) : [],
  ]);
  return getFilesForGroup(db, row.groupId, [...new Set([...own, ...chat])]);
}

/**
 * A file uploaded with a ticket is read by whoever reads the ticket (its initiator, a ziadatel,
 * reads no group files otherwise). Registered with the files module at start-up.
 */
export const fileOfReadableTicket: FileReadRule = async (db, actor, file) => {
  const rows = await db
    .select({ ticketId: ticketAttachments.ticketId })
    .from(ticketAttachments)
    .where(eq(ticketAttachments.fileId, file.id));
  // 2026-10-18: every ticket of the file in two queries, not two per ticket.
  const readable = await readableTicketGroups(
    db,
    actor,
    rows.map((r) => r.ticketId),
  );
  return [...readable.values()].some((groupId) => groupId === file.groupId);
};

/**
 * The ticket as the viewer sees it. `seesTasks`: the viewer uses the group's board (admins and
 * the group's clients) and gets the linked tasks and the full project and event; anyone else
 * (a žiadateľ) only the task count and the project's name (Phase 33 decision 7).
 */
async function toTicketDto(
  db: Db,
  row: TicketRow,
  seesTasks: boolean,
  canAssign = false,
): Promise<TicketDto> {
  const [groupName, taskList, channel, files, assignees, linkedKnowledge, refs, egrant] =
    await Promise.all([
      groupNameOf(db, row.groupId),
      seesTasks ? listTasksFromTicket(db, row.id) : countTasksFromTicket(db, row.id),
      getTicketChannel(db, row.id),
      ticketFiles(db, row),
      assigneesOf(db, [row.id]),
      linkedCardsOf(db, 'ticket', row.id, row.groupId),
      projectRefs(db, [row]),
      ticketEgrantFields(db, row, seesTasks),
    ]);
  const project = forProjectReader(refs.project(row.projectId), refs.event(row.eventId), seesTasks);
  const taskCount = typeof taskList === 'number' ? taskList : taskList.length;
  return {
    id: row.id,
    number: row.number,
    groupId: row.groupId,
    groupName,
    status: row.status,
    source: row.source,
    requester: {
      userId: row.requesterUserId,
      name: row.requesterName,
      email: row.requesterEmail,
      phone: row.requesterPhone,
    },
    area: row.area,
    subject: row.subject,
    programme: row.programme,
    body: row.body,
    dueDate: row.dueDate,
    url: row.url,
    instanceUrl: row.instanceUrl,
    files,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    taskCount,
    tasks: typeof taskList === 'number' ? null : taskList,
    channelId: channel?.id ?? null,
    assignees: assignees.get(row.id) ?? [],
    canAssign,
    ...project,
    linkedKnowledge,
    // Phase 33 part P3: admins and the group's clients only (those who see its tasks).
    ...egrant,
  };
}

/** The ticket for the actor, or null when it is unknown or they may not read it (404). */
export async function getTicketForActor(
  db: Db,
  actor: SessionUser,
  id: string,
): Promise<TicketDto | null> {
  const row = await getTicketRow(db, id);
  if (!row) return null;
  const role = await roleIn(db, actor, row.groupId);
  if (!canReadTicket(actor, row, role)) return null;
  // A ticket without a client has no board: admins see its (empty) task list all the same.
  const seesTasks = row.groupId === null || canSplitTicket(actor, row, role);
  return toTicketDto(db, row, seesTasks, canAssignTicket(actor, row, role));
}

// ---------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------

export class InvalidTicketCursorError extends Error {
  constructor() {
    super('Invalid ticket list cursor');
    this.name = 'InvalidTicketCursorError';
  }
}

const encodeCursor = (row: { createdAt: Date; id: string }) =>
  Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(at ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) throw new InvalidTicketCursorError();
  return { createdAt, id };
}

/** Which list: one group's tab, the initiator's own tickets, or the admins' global view. */
export type TicketListSource =
  | { kind: 'group'; groupId: string; role: MemberRole | null }
  | { kind: 'mine' }
  | { kind: 'global' };

const EXCERPT = 140;

/**
 * One page of tickets, newest first, keyset on (created_at, id), one query. The caller has
 * checked that the actor may open the source (the group's tab, or admins for the global view);
 * a ziadatel's group tab is narrowed here to their own tickets.
 */
export async function listTickets(
  db: Db,
  actor: SessionUser,
  source: TicketListSource,
  query: TicketListQuery,
): Promise<{ items: TicketListItem[]; nextCursor: string | null }> {
  // Phase 33 part P2: the Project and Event filters (the route checked where they apply).
  const where: (SQL | undefined)[] = [ticketProjectFilter(query)];
  if (source.kind === 'group') {
    where.push(eq(tickets.groupId, source.groupId));
    if (!isAdmin(actor) && source.role !== 'client') {
      where.push(eq(tickets.requesterUserId, actor.id));
    }
  } else if (source.kind === 'mine') {
    // My tickets, in groups where I am still a member.
    where.push(eq(tickets.requesterUserId, actor.id), activeMemberOfSql(actor.id, tickets.groupId));
  } else if (query.clients && query.clients.length > 0) {
    where.push(inArray(tickets.groupId, query.clients));
  } else if (query.scope === 'none') {
    where.push(isNull(tickets.groupId));
  } else if (query.scope === 'mine') {
    const managed = await managedGroupIds(db, actor.id);
    // Like the global board: an admin who manages no client sees every client.
    if (managed.length > 0) where.push(inArray(tickets.groupId, managed));
  }
  if (query.status === 'open') where.push(inArray(tickets.status, ['new', 'in_progress']));
  if (query.status === 'resolved') where.push(eq(tickets.status, 'resolved'));
  if (query.area) where.push(sql`lower(${tickets.area}) = lower(${query.area})`);
  if (query.assignee === 'me') {
    where.push(sql`exists (select 1 from ticket_assignees a
      where a.ticket_id = ${tickets.id} and a.user_id = ${actor.id})`);
  } else if (query.assignee === 'none') {
    where.push(
      sql`not exists (select 1 from ticket_assignees a where a.ticket_id = ${tickets.id})`,
    );
  }
  if (query.q) {
    // Phase 34 (the picker): `123` or `#123` is the number; else the subject (trigram index) or
    // the start of the body (2026-10-18: `left(body, 200)`, the same for a `q` of at most 100
    // characters, reads `tickets_body_head_trgm_idx`).
    const number = /^#?(\d{1,9})$/.exec(query.q);
    const like = escapeLike(query.q);
    where.push(
      number
        ? eq(tickets.number, Number(number[1]))
        : or(
            sql`${tickets.subject} ilike ${`%${like}%`} escape '\\'`,
            sql`left(${tickets.body}, 200) ilike ${`${like}%`} escape '\\'`,
          ),
    );
  }
  // Phase 33 part P3: eGrant changes are for admins and the group's clients only; the filter
  // would tell anyone else which tickets have them (400 `invalid_filter`).
  const seesEgrant = isAdmin(actor) || (source.kind === 'group' && source.role === 'client');
  if (query.egrant === 'pending') {
    if (!seesEgrant) throw new InvalidTicketCursorError();
    where.push(pendingEgrantChangesSql(tickets.projectId));
  }
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    where.push(
      or(
        lt(tickets.createdAt, c.createdAt),
        and(eq(tickets.createdAt, c.createdAt), lt(tickets.id, c.id)),
      ),
    );
  }
  const limit = 50;
  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      groupId: tickets.groupId,
      groupName: groups.name,
      status: tickets.status,
      area: tickets.area,
      subject: tickets.subject,
      dueDate: tickets.dueDate,
      createdAt: tickets.createdAt,
      requesterName: tickets.requesterName,
      projectId: tickets.projectId,
      eventId: tickets.eventId,
      excerpt: sql<string | null>`left(${tickets.body}, ${EXCERPT})`,
      // 2026-10-17: a change the viewer has not seen. An expensive expression: PostgreSQL
      // evaluates it after the sort and the limit, for the page only.
      unseen: ticketUnseenSql(actor.id, sql`${tickets.id}`),
      egrantChanges: pendingEgrantChangesSql(tickets.projectId),
    })
    .from(tickets)
    .leftJoin(groups, eq(groups.id, tickets.groupId))
    .where(and(...where))
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const [assignees, refs, seesProject] = await Promise.all([
    assigneesOf(
      db,
      page.map((r) => r.id),
    ),
    projectRefs(db, page),
    projectSightOf(db, actor, source),
  ]);
  return {
    items: page.map(({ projectId, eventId, ...r }) => ({
      ...r,
      egrantChanges: seesEgrant && r.egrantChanges,
      createdAt: r.createdAt.toISOString(),
      assignees: assignees.get(r.id) ?? [],
      ...forProjectReader(refs.project(projectId), refs.event(eventId), seesProject(r.groupId)),
    })),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/**
 * Whether the viewer of a list sees a row's full project and event (admins and the group's
 * clients) or the project's name only (a žiadateľ, decision 7). One membership query for the
 * initiator's own list, none otherwise.
 */
async function projectSightOf(
  db: Db,
  actor: SessionUser,
  source: TicketListSource,
): Promise<(groupId: string | null) => boolean> {
  if (isAdmin(actor)) return () => true;
  if (source.kind === 'group') return () => source.role === 'client';
  if (source.kind === 'global') return () => false;
  const roles = new Map((await listMemberships(db, actor.id)).map((m) => [m.groupId, m.role]));
  return (groupId) => groupId !== null && roles.get(groupId) === 'client';
}

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

/**
 * Applies an admin's edit; says whether the status and whether other fields changed. A status
 * change to or from `resolved` asks or drops time in the same transaction (`ticketStatusTime`,
 * Phase 32): `askTime` for the answer, `time` to announce after the commit.
 */
export async function updateTicket(
  db: Db,
  id: string,
  patch: TicketPatchBody,
  actor: { id: string; name: string } | null = null,
): Promise<
  | ({
      ticket: TicketRow;
      statusChanged: boolean;
      fieldsChanged: boolean;
      /** F16: `description.mention` events of the people the new text names, to deliver. */
      mentionEventIds: string[];
    } & TimeEffect)
  | null
> {
  const before = await getTicketRow(db, id);
  if (!before) return null;
  const { status, knowledgeIds, ...fields } = patch;
  const statusChanged = status !== undefined && status !== before.status;
  // Phase 33 part P5: a changed list of attached knowledge is an edit of the text.
  const linksChanged =
    knowledgeIds !== undefined &&
    (await linkedItemIds(db, { kind: 'ticket', id })).join() !== knowledgeIds.join();
  if (linksChanged && before.groupId === null) throw new InvalidKnowledgeLinkError();
  const fieldsChanged =
    linksChanged ||
    (Object.keys(fields) as (keyof typeof fields)[]).some((key) => fields[key] !== before[key]);
  if (!statusChanged && !fieldsChanged) {
    return {
      ticket: before,
      statusChanged,
      fieldsChanged,
      mentionEventIds: [],
      ...noTimeEffect(before.groupId),
    };
  }
  const now = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(tickets)
      .set({
        ...fields,
        ...(statusChanged ? { status, resolvedAt: status === 'resolved' ? now : null } : {}),
        updatedAt: now,
      })
      .where(eq(tickets.id, id))
      .returning();
    if (linksChanged) {
      await setLinkedItems(tx, { kind: 'ticket', id }, before.groupId!, knowledgeIds!);
    }
    const effect = statusChanged
      ? await ticketStatusTime(tx, actor, before, row!)
      : noTimeEffect(row!.groupId);
    const mentionEventIds =
      actor && fields.body !== undefined
        ? await recordTicketMentions(tx, actor, row!, before.body)
        : [];
    return { ticket: row!, statusChanged, fieldsChanged, mentionEventIds, ...effect };
  });
}

/**
 * F16: records `description.mention` for the people a ticket's text newly names (against
 * `before`), only those who can read the ticket (`readingIds`). A ticket without a client names
 * nobody (its text is a plain field). Returns the event ids, for `requestDelivery`.
 */
export async function recordTicketMentions(
  db: Db,
  actor: { id: string; name: string },
  ticket: TicketRow,
  before: string | null,
): Promise<string[]> {
  if (ticket.groupId === null || !ticket.body) return [];
  return recordDescriptionMentions(db, {
    actor,
    groupId: ticket.groupId,
    subject: {
      kind: 'ticket',
      id: ticket.id,
      number: ticket.number,
      subject: ticket.subject ?? '',
    },
    before,
    after: ticket.body,
    readers: (ids) => readingIds(db, ticket, ids),
  });
}

/**
 * Gives a ticket its client, or moves it to another one. The initiator is resolved for the new
 * group and the riešitelia who cannot be one there are dropped. A ticket with tasks stays where it is (`TicketHasTasksError`): its tasks live on that client's board.
 */
export async function assignTicketGroup(
  db: Db,
  id: string,
  groupId: string,
): Promise<{ ticket: TicketRow; previousGroupId: string | null; notifyRequester: boolean } | null> {
  const before = await getTicketRow(db, id);
  if (!before) return null;
  if (before.groupId === groupId) {
    return { ticket: before, previousGroupId: groupId, notifyRequester: false };
  }
  if (before.groupId !== null && (await countTasksFromTicket(db, id)) > 0) {
    throw new TicketHasTasksError();
  }
  const resolved = await resolveRequester(db, groupId, before.requesterEmail, before.requesterName);
  const ticket = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tickets)
      // Projects are per client: the move clears the project and event (Phase 33 part P2).
      .set({
        groupId,
        requesterUserId: resolved.userId,
        projectId: null,
        eventId: null,
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, id))
      .returning();
    // The ticket's files (form or intake) belong to its client, like its chat's files.
    await moveFilesToGroup(tx, await attachmentIds(tx, id), groupId);
    // Its time entries (Phase 32) belong to its client too.
    await onTicketMoved(tx, id, groupId);
    // Phase 33 part P3: eGrant's raw `project_id` is matched in the new client (after the
    // entries moved, so they take the new project too).
    const moved = await relinkTicket(tx, row!);
    await dropInvalidAssignees(tx, moved);
    return moved;
  });
  return {
    ticket,
    previousGroupId: before.groupId,
    notifyRequester: resolved.notify && resolved.userId !== null,
  };
}

/**
 * Which of these users can still read the ticket, by `canReadTicket`: not disabled, and an admin
 * or a member of its group with the right role. Three queries whatever the number of people (it
 * runs for every message of the ticket's chat).
 */
export async function readingIds(db: Db, ticket: TicketRow, userIds: string[]): Promise<string[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const roles = await getActiveRoles(db, ids);
  const memberRoles =
    ticket.groupId === null ? new Map() : await activeRolesIn(db, ticket.groupId, ids);
  return ids.filter((id) => {
    const role = roles.get(id);
    if (role === undefined) return false;
    return canReadTicket({ id, role } as SessionUser, ticket, memberRoles.get(id) ?? null);
  });
}

// ---------------------------------------------------------------------------------------------
// Riešitelia (assignees)
// ---------------------------------------------------------------------------------------------

/** The most riešitelia a ticket has. */
const MAX_TICKET_ASSIGNEES = 10;

export class InvalidTicketAssigneeError extends Error {
  constructor() {
    super('This person cannot be a riešiteľ of the ticket');
    this.name = 'InvalidTicketAssigneeError';
  }
}

/** The riešitelia of the given tickets, by name, in two queries whatever the count. */
export async function assigneesOf(
  db: Db,
  ticketIds: string[],
): Promise<Map<string, TicketPerson[]>> {
  const result = new Map<string, TicketPerson[]>();
  if (ticketIds.length === 0) return result;
  const rows = await db
    .select({ ticketId: ticketAssignees.ticketId, userId: ticketAssignees.userId })
    .from(ticketAssignees)
    .where(inArray(ticketAssignees.ticketId, [...new Set(ticketIds)]));
  if (rows.length === 0) return result;
  const names = await getUserNames(
    db,
    rows.map((r) => r.userId),
  );
  for (const r of rows) {
    const name = names.get(r.userId);
    if (name === undefined) continue;
    const list = result.get(r.ticketId) ?? [];
    list.push({ id: r.userId, name });
    result.set(r.ticketId, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'sk') || a.id.localeCompare(b.id));
  }
  return result;
}

/**
 * Who can be a riešiteľ of the ticket: every active admin and the named active clients of its
 * group (`listGroupPeople`, also those who do not watch its tickets); admins only for a ticket
 * without a client. One query.
 */
export async function assigneeCandidates(
  db: Db,
  ticket: Pick<TicketRow, 'groupId'>,
): Promise<TicketCandidate[]> {
  if (ticket.groupId === null) {
    return (await listAdmins(db))
      .map((a) => ({ id: a.id, name: a.name, isAdmin: true }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sk') || a.id.localeCompare(b.id));
  }
  return (await listGroupPeople(db, ticket.groupId)).map((p) => ({
    id: p.id,
    name: p.name,
    isAdmin: p.isAdmin,
  }));
}

/** Whether each of these users can be a riešiteľ of the ticket now (`canBeTicketAssignee`). */
async function assignableIds(db: Db, ticket: TicketRow, userIds: string[]): Promise<Set<string>> {
  const roles = await getActiveRoles(db, userIds);
  const memberRoles =
    ticket.groupId === null ? new Map() : await activeRolesIn(db, ticket.groupId, userIds);
  return new Set(
    userIds.filter((id) => {
      const role = roles.get(id);
      return role !== undefined && canBeTicketAssignee(role, ticket, memberRoles.get(id) ?? null);
    }),
  );
}

/**
 * Makes the user a riešiteľ of the ticket, in one transaction. Answers
 * whether they were new. Throws `InvalidTicketAssigneeError` for someone who cannot be one or
 * when the ticket already has `MAX_TICKET_ASSIGNEES`.
 */
export async function addAssignee(db: Db, ticket: TicketRow, userId: string): Promise<boolean> {
  if (!(await assignableIds(db, ticket, [userId])).has(userId)) {
    throw new InvalidTicketAssigneeError();
  }
  return db.transaction(async (tx) => {
    // Locks the ticket so two adds never pass the limit together.
    await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
      .for('update');
    const current = await tx
      .select({ userId: ticketAssignees.userId })
      .from(ticketAssignees)
      .where(eq(ticketAssignees.ticketId, ticket.id));
    if (current.some((r) => r.userId === userId)) return false;
    if (current.length >= MAX_TICKET_ASSIGNEES) throw new InvalidTicketAssigneeError();
    await tx.insert(ticketAssignees).values({ ticketId: ticket.id, userId });
    return true;
  });
}

/**
 * Removes a riešiteľ, and their unanswered time request (Phase 32; filled time stays). Answers
 * whether they were one.
 */
export async function removeAssignee(db: Db, ticketId: string, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(ticketAssignees)
      .where(and(eq(ticketAssignees.ticketId, ticketId), eq(ticketAssignees.userId, userId)))
      .returning({ userId: ticketAssignees.userId });
    if (rows.length === 0) return false;
    await onTicketAssigneesRemoved(tx, ticketId, [userId]);
    return true;
  });
}

/** After a move: the riešitelia who cannot be one in the new client (its old clients) go. */
async function dropInvalidAssignees(db: Db, ticket: TicketRow): Promise<void> {
  const rows = await db
    .select({ userId: ticketAssignees.userId })
    .from(ticketAssignees)
    .where(eq(ticketAssignees.ticketId, ticket.id));
  const ids = rows.map((r) => r.userId);
  const keep = await assignableIds(db, ticket, ids);
  const drop = ids.filter((id) => !keep.has(id));
  if (drop.length === 0) return;
  await db
    .delete(ticketAssignees)
    .where(and(eq(ticketAssignees.ticketId, ticket.id), inArray(ticketAssignees.userId, drop)));
}
