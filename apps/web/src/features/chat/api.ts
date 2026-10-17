import { queryOptions } from '@tanstack/react-query';
import {
  AroundPageSchema,
  ChangesSchema,
  GroupChannelSchema,
  KnowledgeItemDtoSchema,
  MessagePageSchema,
  MessageReactionsSchema,
  ReactionPeopleSchema,
  MessageSchema,
  ThreadSchema,
  UnreadByGroupSchema,
  UnreadThreadsSchema,
  type AroundPage,
  type KnowledgeItemDto,
  type MessageReactions,
  type Changes,
  type MessageDto,
  type MessagePage,
  type SendMessageInput,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

// Kept small on purpose: the unread badges import this file eagerly, so nothing heavy belongs here.

const enc = encodeURIComponent;

/** The group's channel with the reader's unread count and read cursor. */
export const groupChatQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['chat', 'group', groupId],
    queryFn: () => apiGet(`/groups/${enc(groupId)}/chat`, GroupChannelSchema),
  });

/** A task's chat (created on first open) with the reader's unread count and read cursor. */
export const taskChatQuery = (taskId: string) =>
  queryOptions({
    queryKey: ['chat', 'task', taskId],
    queryFn: () => apiGet(`/tasks/${enc(taskId)}/chat`, GroupChannelSchema),
  });

/** A ticket's chat (Phase 21; it exists once the ticket has a client), as `taskChatQuery`. */
export const ticketChatQuery = (ticketId: string) =>
  queryOptions({
    queryKey: ['chat', 'ticket', ticketId],
    queryFn: () => apiGet(`/tickets/${enc(ticketId)}/chat`, GroupChannelSchema),
  });

/** Unread message count (top-level and replies in the reader's threads) per group the user can read. */
export const chatUnreadQuery = queryOptions({
  queryKey: ['chat', 'unread'],
  queryFn: () => apiGet('/chat/unread', UnreadByGroupSchema),
});

/** The roots of the channel's threads with replies the reader has not read. */
export const unreadThreadsQuery = (channelId: string) =>
  queryOptions({
    queryKey: ['chat', 'unread-threads', channelId],
    queryFn: () => apiGet(`/channels/${enc(channelId)}/unread-threads`, UnreadThreadsSchema),
  });

/** A thread: its root and every reply, oldest first. Live events patch it in place. */
export const threadQuery = (rootId: string) =>
  queryOptions({
    queryKey: ['chat', 'thread', rootId],
    queryFn: () => apiGet(`/messages/${enc(rootId)}/thread`, ThreadSchema),
  });

/** The `(createdAt, id)` cursor the server pages by. */
export const messageCursor = (m: Pick<MessageDto, 'createdAt' | 'id'>): string =>
  `${m.createdAt},${m.id}`;

/**
 * A page of top-level messages. Without a cursor: the newest page. `before` pages are newest
 * first, `after` pages oldest first. Cursors come from `messageCursor`.
 */
export function fetchPage(
  channelId: string,
  cursor: { before?: string; after?: string } = {},
): Promise<MessagePage> {
  const params = new URLSearchParams();
  if (cursor.before !== undefined) params.set('before', cursor.before);
  if (cursor.after !== undefined) params.set('after', cursor.after);
  const query = params.toString();
  return apiGet(
    `/channels/${enc(channelId)}/messages${query ? `?${query}` : ''}`,
    MessagePageSchema,
  );
}

/** The top-level page around a message (or around its thread root), oldest first. */
export function fetchAround(messageId: string): Promise<AroundPage> {
  return apiGet(`/messages/${enc(messageId)}/around`, AroundPageSchema);
}

/** Catch-up: every message changed after `afterSeq`, ascending, at most 500. */
export function fetchChanges(channelId: string, afterSeq: number): Promise<Changes> {
  return apiGet(`/channels/${enc(channelId)}/changes?afterSeq=${afterSeq}`, ChangesSchema);
}

/** 201 with the new message, or 200 with the stored one when `clientId` was already sent. */
export function sendMessage(channelId: string, input: SendMessageInput): Promise<MessageDto> {
  return apiSend('POST', `/channels/${enc(channelId)}/messages`, input, MessageSchema);
}

export function editMessage(id: string, body: string): Promise<MessageDto> {
  return apiSend('PATCH', `/messages/${enc(id)}`, { body }, MessageSchema);
}

export async function deleteMessage(id: string): Promise<void> {
  await apiSend('DELETE', `/messages/${enc(id)}`);
}

/** Marks the channel read up to `at` (an ISO time); the server never moves the cursor back. */
export async function markRead(channelId: string, at: string): Promise<void> {
  await apiSend('POST', `/channels/${enc(channelId)}/read`, { at });
}

/** Marks the whole channel read up to now, every thread of the reader included. */
export async function markAllRead(channelId: string): Promise<void> {
  await apiSend('POST', `/channels/${enc(channelId)}/read-all`);
}

/** Marks a thread read up to now; a no-op for someone who is not one of its people. */
export async function markThreadRead(rootId: string): Promise<void> {
  await apiSend('POST', `/messages/${enc(rootId)}/thread/read`);
}

/** Phase 28: turns the reader's reaction with `emoji` on or off (idempotent). */
export function setReaction(
  messageId: string,
  emoji: string,
  on: boolean,
): Promise<MessageReactions> {
  return apiSend(
    'PUT',
    `/messages/${enc(messageId)}/reactions`,
    { emoji, on },
    MessageReactionsSchema,
  );
}

/** Who reacted with what; `changeSeq` in the key refetches it after a change. */
export const reactionPeopleQuery = (messageId: string, changeSeq: number) =>
  queryOptions({
    queryKey: ['chat', 'reactions', messageId, changeSeq],
    queryFn: () => apiGet(`/messages/${enc(messageId)}/reactions`, ReactionPeopleSchema),
    staleTime: 30_000,
  });

/** An item attached to a message, read through the message (a ziadatel in a ticket chat). */
export const sharedKnowledgeQuery = (messageId: string, itemId: string) =>
  queryOptions({
    queryKey: ['chat', 'knowledge', messageId, itemId],
    queryFn: (): Promise<KnowledgeItemDto> =>
      apiGet(`/messages/${enc(messageId)}/knowledge/${enc(itemId)}`, KnowledgeItemDtoSchema),
  });
