import type { Server as SocketIOServer } from 'socket.io';
import type { Db } from '../../infra/db/client.js';
import { emitKnowledgeItem } from './events.js';
import { getItemSummary } from './service.js';

// The meeting jobs (Phase 30) are built before the app, so they reach the sockets through this
// slot, like the reminders' fire job.

let io: SocketIOServer | null = null;

export function attachMeetingsRealtime(server: SocketIOServer | null): void {
  io = server;
}

/** Pushes the item's row after a job step committed, to its readers. Never throws. */
export async function announceMeeting(db: Db, itemId: string): Promise<void> {
  if (!io) return;
  try {
    const summary = await getItemSummary(db, itemId);
    if (summary) emitKnowledgeItem(io, summary);
  } catch (error) {
    console.error(`meetings: could not announce item ${itemId}`, error);
  }
}
