import type { Server as SocketIOServer } from 'socket.io';
import {
  FinanceEvents,
  type FinanceChangeKind,
  type FinanceChangedEvent,
  type TimeRequestsEvent,
} from '@spolu/shared';
import { userRoom } from '../../infra/realtime/rooms.js';

/**
 * Finance realtime (Phase 32, spec §11). Finance events go to this room only, never to a group
 * room, a group's admins room or `admins`. A socket joins it on connect when its user passes
 * `canSeeFinance` (`infra/realtime/socket.ts`); the grant routes move a user's sockets.
 */
export const FINANCE_ROOM = 'finance';

/** Tells the finance admins what changed, after the write commits; `groupId` null for rates. */
export function emitFinanceChanged(
  io: SocketIOServer,
  groupId: string | null,
  kind: FinanceChangeKind,
): void {
  const payload: FinanceChangedEvent = { groupId, kind };
  io.to(FINANCE_ROOM).emit(FinanceEvents.changed, payload);
}

/** The user's count of open time requests changed (the dashboard's "Fill in your time" rows). */
export function emitTimeRequests(io: SocketIOServer, userId: string, count: number): void {
  const payload: TimeRequestsEvent = { count };
  io.to(userRoom(userId)).emit(FinanceEvents.timeRequests, payload);
}

/**
 * The user's finance right changed: their sockets join or leave the room, their session snapshot
 * follows, and `me:changed` makes the web refetch `/api/me` (the tab and the header link).
 */
export async function moveFinanceSockets(
  io: SocketIOServer,
  userId: string,
  finance: boolean,
): Promise<void> {
  const room = io.in(userRoom(userId));
  if (finance) room.socketsJoin(FINANCE_ROOM);
  else room.socketsLeave(FINANCE_ROOM);
  for (const socket of await room.fetchSockets()) {
    socket.data.user = { ...socket.data.user, finance };
  }
  io.to(userRoom(userId)).emit(FinanceEvents.meChanged, {});
}
