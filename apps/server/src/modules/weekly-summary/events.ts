import type { Server as SocketIOServer } from 'socket.io';
import { WeeklySummaryEvents, type WeeklySummaryChanged } from '@spolu/shared';
import { ADMINS_ROOM } from '../../infra/realtime/rooms.js';

/**
 * Tells every admin that a summary changed (stored, edited, regenerated, sending, sent,
 * skipped), after the commit. Clients never get it: they never see drafts.
 */
export function emitSummaryChanged(
  io: SocketIOServer | null,
  row: {
    id: string;
    groupId: string;
    week: string;
    status: WeeklySummaryChanged['status'];
    version: number;
  },
): void {
  if (!io) return;
  const payload: WeeklySummaryChanged = {
    id: row.id,
    groupId: row.groupId,
    week: row.week,
    status: row.status,
    version: row.version,
  };
  io.to(ADMINS_ROOM).emit(WeeklySummaryEvents.changed, payload);
}

let attached: SocketIOServer | null = null;

/** The app attaches its Socket.IO server here, so the jobs (built first) can emit. */
export function attachWeeklySummaryRealtime(io: SocketIOServer | null): void {
  attached = io;
}

export function weeklySummaryRealtime(): SocketIOServer | null {
  return attached;
}
