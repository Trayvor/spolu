import type { Server as SocketIOServer } from 'socket.io';
import {
  ChatEvents,
  type ChatMessageEvent,
  type ChatMessageTasksEvent,
  type ChatReadEvent,
  type ChatThreadReplyEvent,
  type MessageDto,
} from '@spolu/shared';
import { emitAdminActivity, emitToGroup, groupRoom, userRoom } from '../../infra/realtime/rooms.js';
import { withoutTaskLinks } from './dto.js';
import type { ChannelRow } from './service.js';

/**
 * Pushes a new, edited or deleted message (or a parent's new reply count) to the group room and
 * `extraRooms` (a ticket chat's initiator, see `extraRoomsOf`); a task chat's events carry its
 * `taskId`. Sockets only in `extraRooms` read the channel but not the group, so they get the
 * message without its task links. Also sends `admin:activity` (kind `chat`) to the admins room.
 * Call after commit.
 */
export function emitMessage(
  io: SocketIOServer,
  channel: Pick<ChannelRow, 'groupId' | 'taskId'>,
  message: MessageDto,
  isNew: boolean,
  extraRooms: string[] = [],
): void {
  const event: ChatMessageEvent = {
    groupId: channel.groupId,
    channelId: message.channelId,
    taskId: channel.taskId,
    message,
    isNew,
  };
  const room = groupRoom(channel.groupId);
  io.to(room).emit(ChatEvents.message, event);
  if (extraRooms.length > 0) {
    io.to(extraRooms)
      .except(room)
      .emit(ChatEvents.message, { ...event, message: withoutTaskLinks(message) });
  }
  emitAdminActivity(io, { groupId: channel.groupId, kind: 'chat' });
}

/**
 * Tells all sockets of one user that the channel (with `rootId` one thread, with `all` the whole
 * chat and their threads) is read up to `lastReadAt`.
 */
export function emitRead(io: SocketIOServer, userId: string, event: ChatReadEvent): void {
  io.to(userRoom(userId)).emit(ChatEvents.read, event);
}

/** Tells the people of a thread (never the author) that a reply there is unread for them. */
export function emitThreadReply(
  io: SocketIOServer,
  userIds: string[],
  event: ChatThreadReplyEvent,
): void {
  if (userIds.length > 0) io.to(userIds.map(userRoom)).emit(ChatEvents.threadReply, event);
}

/** Pushes a message's current task links to its group room (its chat footer). Call after commit. */
export function emitMessageTasks(io: SocketIOServer, event: ChatMessageTasksEvent): void {
  emitToGroup(io, event.groupId, ChatEvents.messageTasks, event);
}
