import { asc, eq, inArray } from 'drizzle-orm';
import type {
  MessageAttachedTask,
  MessageAttachedTicket,
  MessageDto,
  SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { clientGroupIds } from '../groups/memberships.js';
import { attachableTaskCards } from '../tasks/attachable.js';
import { attachableTicketCards } from '../tickets/attachable.js';
import { isAdmin } from '../users/policy.js';
import { channelKindAccess, type ChannelRef } from './access.js';
import { canAttachWork } from './policy.js';
import { messageTaskLinks, messageTicketLinks } from './schema.js';

/**
 * Phase 34: tasks and tickets attached to chat messages. The rows are the chat's; which tasks and
 * tickets may be attached and shown is the tasks' and tickets' call (`attachableTaskCards`,
 * `attachableTicketCards`), and who reads a ticket on a requester's copy is the ticket chat's.
 */

/** The actor may not attach work here: they do not read the group (route: 403 forbidden). */
export class WorkAttachForbiddenError extends Error {
  constructor() {
    super('Only readers of the group attach its tasks and tickets');
    this.name = 'WorkAttachForbiddenError';
  }
}

/** A task or ticket is not of this channel's group, or is gone (route: 400 invalid_attachment). */
export class InvalidWorkError extends Error {
  constructor() {
    super('A task or ticket is not available in this chat');
    this.name = 'InvalidWorkError';
  }
}

/** Throws unless the actor may attach work in the group and every item belongs to it. */
export async function checkWorkIds(
  db: Db,
  actor: SessionUser,
  groupId: string,
  ids: { taskIds: string[]; ticketIds: string[] },
): Promise<void> {
  if (ids.taskIds.length === 0 && ids.ticketIds.length === 0) return;
  const groupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
  if (!canAttachWork(actor, groupId, groupIds)) throw new WorkAttachForbiddenError();
  const [tasks, tickets] = await Promise.all([
    attachableTaskCards(db, groupId, ids.taskIds),
    attachableTicketCards(db, groupId, ids.ticketIds),
  ]);
  if (ids.taskIds.some((id) => !tasks.has(id)) || ids.ticketIds.some((id) => !tickets.has(id))) {
    throw new InvalidWorkError();
  }
}

/** Writes the rows of a new message, in its order (inside the send's transaction). */
export async function attachWork(
  tx: Db,
  messageId: string,
  ids: { taskIds: string[]; ticketIds: string[] },
): Promise<void> {
  if (ids.taskIds.length > 0) {
    await tx
      .insert(messageTaskLinks)
      .values(ids.taskIds.map((taskId, position) => ({ messageId, taskId, position })));
  }
  if (ids.ticketIds.length > 0) {
    await tx
      .insert(messageTicketLinks)
      .values(ids.ticketIds.map((ticketId, position) => ({ messageId, ticketId, position })));
  }
}

/** Removes the rows of a deleted message (inside the delete's transaction). */
export async function detachWork(tx: Db, messageId: string): Promise<void> {
  await tx.delete(messageTaskLinks).where(eq(messageTaskLinks.messageId, messageId));
  await tx.delete(messageTicketLinks).where(eq(messageTicketLinks.messageId, messageId));
}

/** Whether the message carries any task or ticket. */
export async function hasWork(db: Db, messageId: string): Promise<boolean> {
  const [task, ticket] = await Promise.all([
    db
      .select({ id: messageTaskLinks.taskId })
      .from(messageTaskLinks)
      .where(eq(messageTaskLinks.messageId, messageId))
      .limit(1),
    db
      .select({ id: messageTicketLinks.ticketId })
      .from(messageTicketLinks)
      .where(eq(messageTicketLinks.messageId, messageId))
      .limit(1),
  ]);
  return task.length > 0 || ticket.length > 0;
}

/**
 * The attached tasks and tickets of these messages, by message id, each checked again against the
 * channel's group: a live card while it belongs there, else only its id. Two queries for the rows
 * plus one per kind for the cards (and one for the tickets' riešitelia), for any number of messages.
 */
export async function loadMessageWork(
  db: Db,
  groupId: string,
  messageIds: string[],
): Promise<{
  tasks: Map<string, MessageAttachedTask[]>;
  tickets: Map<string, MessageAttachedTicket[]>;
}> {
  const tasksOf = new Map<string, MessageAttachedTask[]>();
  const ticketsOf = new Map<string, MessageAttachedTicket[]>();
  if (messageIds.length === 0) return { tasks: tasksOf, tickets: ticketsOf };
  const [taskRows, ticketRows] = await Promise.all([
    db
      .select({ messageId: messageTaskLinks.messageId, id: messageTaskLinks.taskId })
      .from(messageTaskLinks)
      .where(inArray(messageTaskLinks.messageId, messageIds))
      .orderBy(asc(messageTaskLinks.messageId), asc(messageTaskLinks.position)),
    db
      .select({ messageId: messageTicketLinks.messageId, id: messageTicketLinks.ticketId })
      .from(messageTicketLinks)
      .where(inArray(messageTicketLinks.messageId, messageIds))
      .orderBy(asc(messageTicketLinks.messageId), asc(messageTicketLinks.position)),
  ]);
  const [taskCards, ticketCards] = await Promise.all([
    attachableTaskCards(
      db,
      groupId,
      taskRows.map((r) => r.id),
    ),
    attachableTicketCards(
      db,
      groupId,
      ticketRows.map((r) => r.id),
    ),
  ]);
  for (const row of taskRows) {
    const card: MessageAttachedTask = taskCards.get(row.id) ?? { id: row.id, available: false };
    tasksOf.set(row.messageId, [...(tasksOf.get(row.messageId) ?? []), card]);
  }
  for (const row of ticketRows) {
    const card: MessageAttachedTicket = ticketCards.get(row.id) ?? {
      id: row.id,
      available: false,
    };
    ticketsOf.set(row.messageId, [...(ticketsOf.get(row.messageId) ?? []), card]);
  }
  return { tasks: tasksOf, tickets: ticketsOf };
}

/**
 * The messages as someone who reads the channel but not its group sees them (a ziadatel in their
 * ticket chat, Phase 21 and 34): no "Turned into tasks" links, no attached tasks (they never see
 * the client's tasks) and only the attached tickets the channel's owner says they read; the rest
 * are dropped without a trace. One call of the owner for all the messages.
 */
export async function forRequester(
  db: Db,
  channel: ChannelRef,
  messages: MessageDto[],
): Promise<MessageDto[]> {
  const wanted = [
    ...new Set(
      messages.flatMap((m) => m.attachedTickets.filter((t) => t.available).map((t) => t.id)),
    ),
  ];
  const access = channelKindAccess(channel);
  const readable =
    wanted.length > 0 && access ? await access.readableTickets(db, channel, wanted) : new Set();
  return messages.map((m) =>
    m.tasks.length === 0 && m.attachedTasks.length === 0 && m.attachedTickets.length === 0
      ? m
      : {
          ...m,
          tasks: [],
          attachedTasks: [],
          attachedTickets: m.attachedTickets.filter((t) => readable.has(t.id)),
        },
  );
}
