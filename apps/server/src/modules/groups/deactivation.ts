import type { Server as SocketIOServer } from 'socket.io';
import { GroupEvents, type GroupStatusEvent } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import {
  ADMINS_ROOM,
  groupRoom,
  joinGroupRoom,
  leaveGroupRoom,
} from '../../infra/realtime/rooms.js';
import { stopGroupNotifications } from '../notifications/service.js';
import { activeClientIds, setGroupDeactivated, type GroupRow } from './service.js';

/** The PostgreSQL error code of the trigger that refuses new content in a deactivated group. */
export const GROUP_INACTIVE_SQLSTATE = 'SPG01';

/** True for the database error of a write into a deactivated group (drizzle may wrap it). */
export function isGroupInactiveError(error: unknown): boolean {
  const e = error as { code?: unknown; cause?: unknown } | null;
  if (e?.code === GROUP_INACTIVE_SQLSTATE) return true;
  return e?.cause !== undefined && e.cause !== error && isGroupInactiveError(e.cause);
}

export const isDeactivated = (group: Pick<GroupRow, 'deactivatedAt'>): boolean =>
  group.deactivatedAt !== null;

export type GroupActiveChange = { group: GroupRow; changed: boolean };

/**
 * Deactivates (`active: false`) or reactivates a client group, the one way for both the app
 * (`POST /api/groups/:id/deactivate|reactivate`) and the eGrant groups webhook. Nothing is
 * deleted. Deactivating stops the group's pending notifications and takes its members' sockets
 * out of its room; reactivating puts them back. Admins get `group:status` either way. Null for
 * an unknown id or the admin group.
 */
export async function setGroupActive(
  deps: { db: Db; io: SocketIOServer },
  groupId: string,
  active: boolean,
): Promise<GroupActiveChange | null> {
  const { db, io } = deps;
  const result = await setGroupDeactivated(db, groupId, !active);
  if (!result?.changed) return result;
  if (!active) await stopGroupNotifications(db, groupId);
  for (const userId of await activeClientIds(db, groupId)) {
    if (active) joinGroupRoom(io, userId, groupId);
    else leaveGroupRoom(io, userId, groupId);
  }
  const event: GroupStatusEvent = {
    groupId,
    deactivatedAt: result.group.deactivatedAt?.toISOString() ?? null,
  };
  io.to(active ? [ADMINS_ROOM, groupRoom(groupId)] : ADMINS_ROOM).emit(GroupEvents.status, event);
  return result;
}
