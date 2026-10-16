import type { Server as SocketIOServer } from 'socket.io';
import { GroupEvents, type GroupManagersEvent } from '@spolu/shared';
import { ADMINS_ROOM, groupRoom } from '../../infra/realtime/rooms.js';

/**
 * Pushes a group's new manager list to its room and to every admin. One `emit` to both rooms,
 * so a socket in both gets it once. Call after commit.
 */
export function emitManagers(io: SocketIOServer, event: GroupManagersEvent): void {
  io.to([groupRoom(event.groupId), ADMINS_ROOM]).emit(GroupEvents.managers, event);
}
