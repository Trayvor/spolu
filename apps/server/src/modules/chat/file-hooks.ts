import type { Server as SocketIOServer } from 'socket.io';
import type { Db } from '../../infra/db/client.js';

/** The files a new message brought, as the send's transaction wrote them. */
export type ChatFilesAttached = {
  channel: {
    id: string;
    groupId: string;
    kind: string;
    taskId: string | null;
    ticketId: string | null;
  };
  messageId: string;
  authorId: string;
  /** The message's `created_at`. */
  createdAt: Date;
  fileIds: string[];
};

/**
 * How another module follows the files of chat messages without the chat module importing it
 * (the knowledge base's "From chat" entries). The chat calls each hook at a fixed point:
 * - `attached` inside the send's transaction, after the attachment rows;
 * - `moved` inside the transaction that moves a ticket's chat to another group;
 * - `sent` after the send committed (to push live events);
 * - `removing` before a message is deleted; what it returns runs after the delete committed.
 * The files' rows themselves stay the chat's: a listener only adds its own rows next to them.
 */
export type ChatFileListener = {
  attached(tx: Db, change: ChatFilesAttached): Promise<void>;
  moved(tx: Db, change: { channelId: string; groupId: string }): Promise<void>;
  sent(db: Db, io: SocketIOServer, messageId: string): Promise<void>;
  removing(db: Db, messageId: string): Promise<(io: SocketIOServer) => void>;
};

const listeners: ChatFileListener[] = [];

/** Registers a listener; called once at start-up (a second call with the same one is ignored). */
export function onChatFiles(listener: ChatFileListener): void {
  if (!listeners.includes(listener)) listeners.push(listener);
}

export async function runFilesAttached(tx: Db, change: ChatFilesAttached): Promise<void> {
  if (change.fileIds.length === 0) return;
  for (const listener of listeners) await listener.attached(tx, change);
}

export async function runChannelMoved(
  tx: Db,
  change: { channelId: string; groupId: string },
): Promise<void> {
  for (const listener of listeners) await listener.moved(tx, change);
}

/** After a send committed; a failing listener is logged by the caller, never fails the send. */
export async function runFilesSent(db: Db, io: SocketIOServer, messageId: string): Promise<void> {
  for (const listener of listeners) await listener.sent(db, io, messageId);
}

/** Before a delete: the pushes to run once it committed. */
export async function prepareFilesRemoved(
  db: Db,
  messageId: string,
): Promise<(io: SocketIOServer) => void> {
  const pushes = await Promise.all(listeners.map((listener) => listener.removing(db, messageId)));
  return (io) => {
    for (const push of pushes) push(io);
  };
}
