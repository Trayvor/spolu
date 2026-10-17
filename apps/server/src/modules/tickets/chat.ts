import { userRoom } from '../../infra/realtime/rooms.js';
import { fileInReadableChannel, registerChannelKind, type ChannelRef } from '../chat/access.js';
import { fileOfAttachedKnowledge } from '../chat/knowledge-links.js';
import { registerFileReadRule } from '../files/read-rules.js';
import { ensureTicketChannel, moveTicketChannel } from '../chat/service.js';
import type { Db } from '../../infra/db/client.js';
import { getUserById } from '../users/service.js';
import { onTicketChange } from './hooks.js';
import { ticketPayload } from './notify.js';
import { ticketAudienceIds } from './audience.js';
import {
  actorReadsTicket,
  fileOfReadableTicket,
  getTicketRow,
  readableTicketIds,
} from './service.js';

const ticketOf = (db: Db, channel: ChannelRef) =>
  channel.ticketId ? getTicketRow(db, channel.ticketId) : Promise.resolve(null);

/**
 * The ticket chat (Phase 21, part 21.3): the chat module reads a `ticket` channel by the ticket's
 * rules, pushes its messages to the initiator's own sockets too (a ziadatel is in no group room),
 * lets the initiator be mentioned, makes `@all` mean the people who hear the ticket's updates
 * (`ticketAudienceIds`: its riešitelia, or its watchers while it has none, and its initiator) and
 * tells them about each message (`ticket.message`, part 21.6). The initiator also reads the files
 * of knowledge items attached there (Phase 28). A ticket gets its
 * chat when it gets a client; the chat moves with the ticket. The files uploaded with a ticket are
 * read by whoever reads it. Call once at start-up.
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
      return (await actorReadsTicket(
        db,
        { ...initiator, role: initiator.role, finance: false },
        ticket,
      ))
        ? [{ id: initiator.id, name: initiator.name }]
        : [];
    },
    async allRecipients(db, channel) {
      const ticket = await ticketOf(db, channel);
      return ticket ? ticketAudienceIds(db, ticket) : [];
    },
    async readableTickets(db, channel, ticketIds) {
      const ticket = await ticketOf(db, channel);
      if (!ticket?.requesterUserId) return new Set();
      const initiator = await getUserById(db, ticket.requesterUserId);
      if (!initiator || initiator.disabledAt) return new Set();
      return readableTicketIds(
        db,
        { ...initiator, role: initiator.role, finance: false },
        ticketIds,
      );
    },
    async messageNotice(db, channel) {
      const ticket = await ticketOf(db, channel);
      if (!ticket) return null;
      return {
        kind: 'ticket.message',
        recipients: await ticketAudienceIds(db, ticket),
        payload: ticketPayload(ticket),
      };
    },
  });
  onTicketChange(createOrMoveChat);
  registerFileReadRule(fileInReadableChannel);
  // Phase 28: the files of knowledge items attached in the chat, for the initiator.
  registerFileReadRule(fileOfAttachedKnowledge);
  registerFileReadRule(fileOfReadableTicket);
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
