import type { Server as SocketIOServer } from 'socket.io';
import {
  BoardEvents,
  type BoardBucketsEvent,
  type BoardTaskDeletedEvent,
  type BoardTaskEvent,
  type BucketDto,
  type TaskDto,
  type TaskPerson,
} from '@spolu/shared';
import { emitToGroup } from '../../infra/realtime/rooms.js';

/** Every event goes to the group room and carries its `groupId`; call after the write commits. */
export function emitBuckets(io: SocketIOServer, groupId: string, buckets: BucketDto[]): void {
  const event: BoardBucketsEvent = { groupId, buckets };
  emitToGroup(io, groupId, BoardEvents.buckets, event);
}

export function emitTask(io: SocketIOServer, task: TaskDto, actor: TaskPerson): void {
  const event: BoardTaskEvent = { task, actor };
  emitToGroup(io, task.groupId, BoardEvents.task, event);
}

export function emitTaskDeleted(io: SocketIOServer, groupId: string, taskId: string): void {
  const event: BoardTaskDeletedEvent = { groupId, taskId };
  emitToGroup(io, groupId, BoardEvents.taskDeleted, event);
}
