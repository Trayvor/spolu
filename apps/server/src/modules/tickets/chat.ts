import { userRoom } from '../../infra/realtime/rooms.js';
import { fileInReadableChannel, registerChannelKind, type ChannelRef } from '../chat/access.js';
import { registerFileReadRule } from '../files/read-rules.js';
import { ensureTicketChannel, moveTicketChannel } from '../chat/service.js';
import type { Db } from '../../infra/db/client.js';
import { getUserById } from '../users/service.js';
import { onTicketChange } from './hooks.js';
import { actorReadsTicket, getTicketRow, readingFollowerIds } from './service.js';

const ticketOf = (db: Db, channel: ChannelRef) =>
  channel.ticketId ? getTicketRow(db, channel.ticketId) : Promise.resolve(null);

/**
 * The ticket chat (Phase 21, part 21.3): the chat module reads a `ticket` channel by the ticket's
 * rules, pushes its messages to the initiator's own sockets too (a ziadatel is in no group room),
 * lets the initiator be mentioned and makes `@all` mean the ticket's followers. A ticket gets its
 * chat when it gets a client; the chat moves with the ticket. Call once at start-up.
 */
export function registerTicketChat(): void {
  registerChannelKind('ticket', {
    async canRead(db, actor, channel) {
      const ticket = await ticketOf(db, channel);
      return ticket !== null && (await actorReadsTicket(db, actor, ticket));
    },
    async extraRooms(db, channel) {
      const ticket = await ticketOf(db, channel);
      return ticket?.requesterUserId ? [userRoom(ticket.requesterUserId)] : [];
    },
    async extraPeople(db, channel) {
      const ticket = await ticketOf(db, channel);
      if (!ticket?.requesterUserId) return [];
      const initiator = await getUserById(db, ticket.requesterUserId);
      if (!initiator || initiator.disabledAt || initiator.name.trim() === '') return [];
      return (await actorReadsTicket(db, { ...initiator, role: initiator.role }, ticket))
        ? [{ id: initiator.id, name: initiator.name }]
        : [];
    },
    async allRecipients(db, channel) {
      const ticket = await ticketOf(db, channel);
      return ticket ? readingFollowerIds(db, ticket) : [];
    },
  });
  onTicketChange(createOrMoveChat);
  registerFileReadRule(fileInReadableChannel);
}

async function createOrMoveChat(
  deps: { db: Db },
  change: Parameters<Parameters<typeof onTicketChange>[0]>[1],
): Promise<void> {
  const { ticket } = change;
  if (ticket.groupId === null) return;
  if (change.kind === 'moved') await moveTicketChannel(deps.db, ticket.id, ticket.groupId);
  if (change.kind === 'created' || change.kind === 'moved') {
    await ensureTicketChannel(deps.db, { id: ticket.id, groupId: ticket.groupId });
  }
}
