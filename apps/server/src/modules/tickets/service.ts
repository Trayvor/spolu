import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type {
  MemberRole,
  SessionUser,
  TicketDto,
  TicketListItem,
  TicketListQuery,
  TicketPatchBody,
  TicketSource,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { attachFiles, type FileDeps } from '../files/service.js';
import { activeMemberOfSql, getMembership } from '../groups/memberships.js';
import { listGroupManagers, managedGroupIds } from '../groups/managers.js';
// Deliberate read-only exception: the list joins the group's name in its one query.
import { groups } from '../groups/schema.js';
import { getGroup } from '../groups/service.js';
import { countTasksFromTicket } from '../tasks/task-service.js';
import { getTicketChannel } from '../chat/service.js';
import { isAdmin } from '../users/policy.js';
import { getUserById, getUserNames } from '../users/service.js';
import { canReadTicket } from './policy.js';
import { resolveRequester } from './requester.js';
import { ticketAttachments, ticketFollowers, tickets } from './schema.js';

export type TicketRow = typeof tickets.$inferSelect;

/** The content of a ticket as the shared schemas parse it. */
export type TicketFields = {
  area: string | null;
  subject: string | null;
  programme: string | null;
  body: string | null;
  dueDate: string | null;
  url: string | null;
  fileLinks: string[];
};

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
  const membership = await getMembership(db, actor.id, groupId);
  return membership && !membership.removedAt ? membership.role : null;
}

/** Whether the actor may read the ticket (one membership lookup). */
export async function actorReadsTicket(
  db: Db,
  actor: SessionUser,
  ticket: Pick<TicketRow, 'groupId' | 'requesterUserId'>,
): Promise<boolean> {
  return canReadTicket(actor, ticket, await roleIn(db, actor, ticket.groupId));
}

export async function getTicketRow(db: Db, id: string): Promise<TicketRow | null> {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, id));
  return row ?? null;
}

/**
 * Who follows from the start: the initiator's account, the group's active managers and the
 * admin who created the ticket by hand. Idempotent.
 */
async function addAutoFollowers(db: Db, ticket: TicketRow): Promise<void> {
  const ids = new Set<string>();
  if (ticket.requesterUserId) ids.add(ticket.requesterUserId);
  if (ticket.groupId) for (const m of await listGroupManagers(db, ticket.groupId)) ids.add(m.id);
  if (ticket.createdBy && ticket.source === 'manual') {
    const creator = await getUserById(db, ticket.createdBy);
    if (creator && creator.role !== 'client') ids.add(ticket.createdBy);
  }
  if (ids.size === 0) return;
  await db
    .insert(ticketFollowers)
    .values([...ids].map((userId) => ({ ticketId: ticket.id, userId, source: 'auto' as const })))
    .onConflictDoNothing();
}

export type CreateTicketInput = {
  source: TicketSource;
  groupId: string | null;
  createdBy: string | null;
  fields: TicketFields;
  requester: { email: string | null; name: string | null; phone: string | null };
  /** Files uploaded in the manual form (they must belong to `groupId`). */
  fileIds?: string[];
  /** The eGrant instance link the API sent. */
  instanceUrl?: string | null;
};

/**
 * Saves a ticket. With a client, the initiator is resolved first (it may add a ziadatel
 * membership), then the ticket and its auto followers are written in one transaction. Returns
 * the row and whether the initiator should get the "Ticket created" email.
 */
export async function createTicket(
  deps: FileDeps,
  input: CreateTicketInput,
): Promise<{ ticket: TicketRow; notifyRequester: boolean }> {
  const { db } = deps;
  const resolved =
    input.groupId === null
      ? { userId: null, notify: false }
      : await resolveRequester(db, input.groupId, input.requester.email, input.requester.name);
  const now = new Date();
  const ticket = await db.transaction(async (tx) => {
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
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const created = row!;
    if (input.groupId && input.fileIds && input.fileIds.length > 0) {
      await attachFiles(tx, input.groupId, input.fileIds, input.createdBy ?? '');
      await tx
        .insert(ticketAttachments)
        .values(input.fileIds.map((fileId) => ({ ticketId: created.id, fileId })));
    }
    await addAutoFollowers(tx, created);
    return created;
  });
  const notifyRequester =
    resolved.notify && resolved.userId !== null && resolved.userId !== input.createdBy;
  return { ticket, notifyRequester };
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

async function isFollowing(db: Db, ticketId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ticketFollowers.userId })
    .from(ticketFollowers)
    .where(and(eq(ticketFollowers.ticketId, ticketId), eq(ticketFollowers.userId, userId)));
  return row !== undefined;
}

async function groupNameOf(db: Db, groupId: string | null): Promise<string | null> {
  return groupId === null ? null : ((await getGroup(db, groupId))?.name ?? null);
}

/** The ticket as the viewer sees it. */
export async function toTicketDto(db: Db, row: TicketRow, viewerId: string): Promise<TicketDto> {
  const [groupName, following, taskCount, channel] = await Promise.all([
    groupNameOf(db, row.groupId),
    isFollowing(db, row.id, viewerId),
    countTasksFromTicket(db, row.id),
    getTicketChannel(db, row.id),
  ]);
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
    fileLinks: row.fileLinks,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    following,
    taskCount,
    channelId: channel?.id ?? null,
  };
}

/** The ticket for the actor, or null when it is unknown or they may not read it (404). */
export async function getTicketForActor(
  db: Db,
  actor: SessionUser,
  id: string,
): Promise<TicketDto | null> {
  const row = await getTicketRow(db, id);
  if (!row || !(await actorReadsTicket(db, actor, row))) return null;
  return toTicketDto(db, row, actor.id);
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
  const where: (SQL | undefined)[] = [];
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
  const following = sql<boolean>`exists (select 1 from ticket_followers f
    where f.ticket_id = ${tickets.id} and f.user_id = ${actor.id})`;
  if (query.following) where.push(following);
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
      following,
      requesterName: tickets.requesterName,
      excerpt: sql<string | null>`left(${tickets.body}, ${EXCERPT})`,
    })
    .from(tickets)
    .leftJoin(groups, eq(groups.id, tickets.groupId))
    .where(and(...where))
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

/** Applies an admin's edit; says whether the status and whether other fields changed. */
export async function updateTicket(
  db: Db,
  id: string,
  patch: TicketPatchBody,
): Promise<{ ticket: TicketRow; statusChanged: boolean; fieldsChanged: boolean } | null> {
  const before = await getTicketRow(db, id);
  if (!before) return null;
  const { status, ...fields } = patch;
  const statusChanged = status !== undefined && status !== before.status;
  const fieldsChanged = (Object.keys(fields) as (keyof typeof fields)[]).some(
    (key) => fields[key] !== before[key],
  );
  if (!statusChanged && !fieldsChanged) return { ticket: before, statusChanged, fieldsChanged };
  const now = new Date();
  const [row] = await db
    .update(tickets)
    .set({
      ...fields,
      ...(statusChanged ? { status, resolvedAt: status === 'resolved' ? now : null } : {}),
      updatedAt: now,
    })
    .where(eq(tickets.id, id))
    .returning();
  return { ticket: row!, statusChanged, fieldsChanged };
}

/** Whether a follower still reads the ticket in its group (admins always do). */
async function followerReads(db: Db, ticket: TicketRow, userId: string): Promise<boolean> {
  const row = await getUserById(db, userId);
  if (!row || row.disabledAt) return false;
  const who = { id: userId, role: row.role } as SessionUser;
  return actorReadsTicket(db, who, ticket);
}

/**
 * Gives a ticket its client, or moves it to another one. The initiator is resolved for the new
 * group, auto followers are added and followers who cannot read it there are dropped. A ticket
 * with tasks stays where it is (`TicketHasTasksError`): its tasks live on that client's board.
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
      .set({ groupId, requesterUserId: resolved.userId, updatedAt: new Date() })
      .where(eq(tickets.id, id))
      .returning();
    const moved = row!;
    await addAutoFollowers(tx, moved);
    const followers = await tx
      .select({ userId: ticketFollowers.userId })
      .from(ticketFollowers)
      .where(eq(ticketFollowers.ticketId, id));
    for (const f of followers) {
      if (!(await followerReads(tx, moved, f.userId))) {
        await tx
          .delete(ticketFollowers)
          .where(and(eq(ticketFollowers.ticketId, id), eq(ticketFollowers.userId, f.userId)));
      }
    }
    return moved;
  });
  return {
    ticket,
    previousGroupId: before.groupId,
    notifyRequester: resolved.notify && resolved.userId !== null,
  };
}

/** Follow a ticket (idempotent); an existing auto row stays auto. */
export async function follow(db: Db, ticketId: string, userId: string): Promise<void> {
  await db
    .insert(ticketFollowers)
    .values({ ticketId, userId, source: 'manual' })
    .onConflictDoNothing();
}

/** Stop following, whatever made the person a follower. */
export async function unfollow(db: Db, ticketId: string, userId: string): Promise<void> {
  await db
    .delete(ticketFollowers)
    .where(and(eq(ticketFollowers.ticketId, ticketId), eq(ticketFollowers.userId, userId)));
}

/** The followers of a ticket, by name. */
export async function listFollowers(
  db: Db,
  ticketId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ userId: ticketFollowers.userId })
    .from(ticketFollowers)
    .where(eq(ticketFollowers.ticketId, ticketId));
  const names = await getUserNames(
    db,
    rows.map((r) => r.userId),
  );
  return [...names]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sk') || a.id.localeCompare(b.id));
}

/** The ids of the followers who can still read the ticket (for notifications, part 21.6). */
export async function readingFollowerIds(db: Db, ticket: TicketRow): Promise<string[]> {
  const followers = await db
    .select({ userId: ticketFollowers.userId })
    .from(ticketFollowers)
    .where(eq(ticketFollowers.ticketId, ticket.id));
  const out: string[] = [];
  for (const f of followers) if (await followerReads(db, ticket, f.userId)) out.push(f.userId);
  return out;
}
