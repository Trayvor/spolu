import type { Server as SocketIOServer } from 'socket.io';
import { ProjectEvents, type ProjectChangeKind, type ProjectChangedEvent } from '@spolu/shared';
import { emitToGroup } from '../../infra/realtime/rooms.js';

/**
 * Tells the client's room that a project, an event or its pending eGrant changes changed (spec
 * §8): the open overview refetches. Call after the write commits.
 */
export function emitProjectChanged(
  io: SocketIOServer,
  groupId: string,
  projectId: string,
  kind: ProjectChangeKind,
): void {
  const payload: ProjectChangedEvent = { groupId, projectId, kind };
  emitToGroup(io, groupId, ProjectEvents.changed, payload);
}
