import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MESSAGE_PAGE_SIZE, SendMessageInputSchema } from '@spolu/shared';
import type { ApiCaller } from '../call.js';
import {
  defineTool,
  fromApi,
  idArg,
  invalidArguments,
  query,
  type ToolDef,
  type ToolOutcome,
} from './define.js';

const ids = (what: string) => z.array(z.string()).optional().describe(`Ids of ${what} to attach`);

const messageFields = {
  body: z
    .string()
    .describe(
      'The message in Markdown (**bold**, _italic_, lists, links). Mention a person with <@userId>, everyone with <@all>.',
    ),
  parentId: z.string().optional().describe('Reply in the thread of this top-level message'),
  replyToId: z.string().optional().describe('Quote this message of the thread (needs parentId)'),
  knowledgeIds: ids('knowledge items of the group (public ones)'),
  taskIds: ids('tasks of the group'),
  ticketIds: ids('tickets of the group'),
};

/** Sends as the user through the chat's own route (same checks, events and notifications). */
async function sendMessage(
  api: ApiCaller,
  channelId: string,
  fields: Record<string, unknown>,
): Promise<ToolOutcome> {
  // A fresh clientId per call: the route's idempotency key for the sender's own retries.
  const payload = { ...fields, clientId: randomUUID() };
  const checked = SendMessageInputSchema.safeParse(payload);
  if (!checked.success) return invalidArguments(checked.error);
  const res = await api('POST', `/api/channels/${channelId}/messages`, { body: payload });
  const id = (res.body as { id?: unknown } | null)?.id;
  return { ...fromApi(res), targetId: typeof id === 'string' ? id : channelId };
}

function pick(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (args[key] !== undefined) out[key] = args[key];
  return out;
}
const MESSAGE_KEYS = Object.keys(messageFields);

/** Chats: the group chat, task chats and ticket chats, their messages and threads. */
export const chatTools: ToolDef[] = [
  defineTool({
    name: 'get_chat_channel',
    title: 'Get a chat channel',
    description:
      'The chat channel of a group, a task or a ticket (give exactly one id), with its id for list_messages and send_message, and the unread count.',
    input: z
      .object({
        groupId: idArg('group').optional(),
        taskId: idArg('task').optional(),
        ticketId: idArg('ticket').optional(),
      })
      .refine((v) => [v.groupId, v.taskId, v.ticketId].filter(Boolean).length === 1, {
        message: 'give exactly one of groupId, taskId, ticketId',
      }),
    run: async ({ api }, { groupId, taskId, ticketId }) => {
      const path = groupId
        ? `/api/groups/${groupId}/chat`
        : taskId
          ? `/api/tasks/${taskId}/chat`
          : `/api/tickets/${ticketId}/chat`;
      return fromApi(await api('GET', path));
    },
  }),
  defineTool({
    name: 'list_messages',
    title: 'List chat messages',
    description: `Top-level messages of a channel, newest page first (up to ${MESSAGE_PAGE_SIZE}). Page back with "before" (the oldest message's cursor from the answer) or forward with "after". Thread replies: get_thread.`,
    input: z.object({
      channelId: idArg('channel'),
      before: z.string().max(500).optional(),
      after: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(MESSAGE_PAGE_SIZE).optional(),
    }),
    run: async ({ api }, { channelId, ...rest }) =>
      fromApi(await api('GET', `/api/channels/${channelId}/messages`, { query: query(rest) })),
  }),
  defineTool({
    name: 'get_thread',
    title: 'Get a thread',
    description: 'A top-level message with its thread replies.',
    input: z.object({ messageId: idArg('message') }),
    run: async ({ api }, { messageId }) =>
      fromApi(await api('GET', `/api/messages/${messageId}/thread`)),
  }),
  defineTool({
    name: 'list_unread_chats',
    title: 'List unread chats',
    description: 'The chats with messages the user has not read yet.',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/chat/unread')),
  }),
  defineTool({
    name: 'send_message',
    title: 'Send a chat message',
    description:
      'Sends a message as the user to a channel (get_chat_channel gives the id): everyone in the chat sees it at once and is notified as in the app.',
    input: z.object({ channelId: idArg('channel'), ...messageFields }),
    write: true,
    target: ({ channelId }) => channelId,
    run: async ({ api }, { channelId }, raw) =>
      sendMessage(api, channelId, pick(raw, MESSAGE_KEYS)),
  }),
  defineTool({
    name: 'reply_to_ticket',
    title: 'Reply to a ticket',
    description:
      'Sends a message as the user to the ticket’s chat (the conversation with its initiator), as in the app.',
    input: z.object({
      ticketId: idArg('ticket'),
      body: messageFields.body,
      parentId: messageFields.parentId,
    }),
    write: true,
    target: ({ ticketId }) => ticketId,
    run: async ({ api }, { ticketId }, raw) => {
      const channel = await api('GET', `/api/tickets/${ticketId}/chat`);
      const channelId = (channel.body as { id?: unknown } | null)?.id;
      if (channel.status !== 200 || typeof channelId !== 'string') return fromApi(channel);
      return sendMessage(api, channelId, pick(raw, ['body', 'parentId']));
    },
  }),
];
