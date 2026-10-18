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
import { emitAdminActivity, emitToGroup } from '../../infra/realtime/rooms.js';

/**
 * Every event goes to the group room and carries its `groupId`; call after the write commits. A
 * task change or delete also sends `admin:activity` (kind `task`) to the admins room.
 */
export function emitBuckets(io: SocketIOServer, groupId: string, buckets: BucketDto[]): void {
  const event: BoardBucketsEvent = { groupId, buckets };
  emitToGroup(io, groupId, BoardEvents.buckets, event);
}

export function emitTask(io: SocketIOServer, task: TaskDto, actor: TaskPerson): void {
  const event: BoardTaskEvent = { task, actor };
  emitToGroup(io, task.groupId, BoardEvents.task, event);
  emitAdminActivity(io, { groupId: task.groupId, kind: 'task' });
}

/**
 * A batch of new cards (2026-10-18: from a message, a ticket or a meeting): each card's board
 * event, but one `admin:activity` per group, not one per card.
 */
export function emitTasks(io: SocketIOServer, tasks: TaskDto[], actor: TaskPerson): void {
  for (const task of tasks) {
    const event: BoardTaskEvent = { task, actor };
    emitToGroup(io, task.groupId, BoardEvents.task, event);
  }
  for (const groupId of new Set(tasks.map((t) => t.groupId))) {
    emitAdminActivity(io, { groupId, kind: 'task' });
  }
}

export function emitTaskDeleted(io: SocketIOServer, groupId: string, taskId: string): void {
  const event: BoardTaskDeletedEvent = { groupId, taskId };
  emitToGroup(io, groupId, BoardEvents.taskDeleted, event);
  emitAdminActivity(io, { groupId, kind: 'task' });
}
