import type { Server as SocketIOServer } from 'socket.io';
import { TicketEvents, type TicketEventPayload } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { ADMINS_ROOM, groupRoom, userRoom } from '../../infra/realtime/rooms.js';
import { getTicketRow } from './service.js';

/**
 * Tells who may see a ticket that it changed: the group's room (its clients and the admins who
 * opened it), every admin (the global view), and the initiator's own sockets (a ziadatel is in
 * no group room). The payload only names the ticket; listeners refetch.
 */
export function emitTicket(
  io: SocketIOServer,
  event: 'created' | 'updated' | 'moved',
  ticket: { id: string; groupId: string | null; requesterUserId: string | null },
): void {
  const rooms = [ADMINS_ROOM];
  if (ticket.groupId) rooms.push(groupRoom(ticket.groupId));
  if (ticket.requesterUserId) rooms.push(userRoom(ticket.requesterUserId));
  const payload: TicketEventPayload = { ticketId: ticket.id, groupId: ticket.groupId };
  io.to(rooms).emit(TicketEvents[event], payload);
}

/**
 * Tells the ticket's readers to refetch it after a change made elsewhere, such as a task made from
 * it being edited, moved or deleted (its page lists those tasks). No hook runs: nobody is
 * notified. Call it after the write committed.
 */
export async function emitTicketRefresh(
  io: SocketIOServer,
  db: Db,
  ticketId: string | null,
): Promise<void> {
  if (ticketId === null) return;
  const ticket = await getTicketRow(db, ticketId);
  if (ticket) emitTicket(io, 'updated', ticket);
}

/**
 * A rating was set or changed (2026-10-19): only to every admin and the rater's own sockets, never
 * to the group room, so other clients of the group are not even told a rating exists. The payload
 * names the ticket only (no value, no comment). Call it after the write committed.
 */
export function emitTicketRated(
  io: SocketIOServer,
  ticket: { id: string; groupId: string | null },
  raterId: string,
): void {
  const payload: TicketEventPayload = { ticketId: ticket.id, groupId: ticket.groupId };
  io.to([ADMINS_ROOM, userRoom(raterId)]).emit(TicketEvents.rated, payload);
}
