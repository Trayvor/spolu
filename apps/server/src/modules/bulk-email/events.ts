import type { Server as SocketIOServer } from 'socket.io';
import { BulkEvents, type BulkEventPayload } from '@spolu/shared';
import { ADMINS_ROOM } from '../../infra/realtime/rooms.js';

/**
 * Tells every admin that a campaign changed (created, saved, deleted, duplicated, each send
 * state change and each batch). Only admins use the module, so only the admins room hears it;
 * the payload names the campaign and listeners refetch.
 */
export function emitBulkUpdated(io: SocketIOServer, campaignId: string): void {
  const payload: BulkEventPayload = { campaignId };
  io.to(ADMINS_ROOM).emit(BulkEvents.updated, payload);
}

let attached: SocketIOServer | null = null;

/** The app attaches its Socket.IO server here, so the batch job (built first) can emit. */
export function attachBulkRealtime(io: SocketIOServer | null): void {
  attached = io;
}

/** The attached Socket.IO server; null before the app is built or after it closed. */
export function bulkRealtime(): SocketIOServer | null {
  return attached;
}
