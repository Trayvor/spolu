import type { Server as SocketIOServer } from 'socket.io';
import { BulkEvents, type BulkEventPayload } from '@spolu/shared';
import { ADMINS_ROOM } from '../../infra/realtime/rooms.js';

/**
 * Tells every admin that a campaign changed (created, saved, deleted, duplicated; later each
 * send state change and batch). Only admins use the module, so only the admins room hears it;
 * the payload names the campaign and listeners refetch.
 */
export function emitBulkUpdated(io: SocketIOServer, campaignId: string): void {
  const payload: BulkEventPayload = { campaignId };
  io.to(ADMINS_ROOM).emit(BulkEvents.updated, payload);
}
