import type { Server as SocketIOServer } from 'socket.io';
import {
  ChatEvents,
  type ChatMessageEvent,
  type ChatReadEvent,
  type ChatThreadReplyEvent,
  type MessageDto,
} from '@spolu/shared';
import { emitToGroup, userRoom } from '../../infra/realtime/rooms.js';
import type { ChannelRow } from './service.js';

/**
 * Pushes a new, edited or deleted message (or a parent's new reply count) to the group room; a
 * task chat's events carry its `taskId`. Call after commit.
 */
export function emitMessage(
  io: SocketIOServer,
  channel: Pick<ChannelRow, 'groupId' | 'taskId'>,
  message: MessageDto,
  isNew: boolean,
): void {
  const event: ChatMessageEvent = {
    groupId: channel.groupId,
    channelId: message.channelId,
    taskId: channel.taskId,
    message,
    isNew,
  };
  emitToGroup(io, channel.groupId, ChatEvents.message, event);
}

/** Tells all sockets of one user that the channel is read up to `lastReadAt`. */
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
