import { z } from 'zod';
import { FileInfoSchema } from './files.js';

export const MESSAGE_MAX_LENGTH = 10_000;
export const MESSAGE_MAX_FILES = 10;
export const MESSAGE_PAGE_SIZE = 50;
export const CHANGES_MAX = 500;
export const MENTION_ALL_TOKEN = '<@all>';
export const mentionToken = (userId: string): string => `<@${userId}>`;

export const ChatAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  isAdmin: z.boolean(),
});
export type ChatAuthor = z.infer<typeof ChatAuthorSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  parentId: z.string().nullable(),
  replyToId: z.string().nullable(),
  author: ChatAuthorSchema,
  body: z.string(),
  mentions: z.array(z.string()),
  mentionsAll: z.boolean(),
  attachments: z.array(FileInfoSchema),
  clientId: z.string().nullable(),
  replyCount: z.number().int(),
  lastReplyAt: z.string().nullable(),
  editedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  changeSeq: z.number().int(),
});
export type MessageDto = z.infer<typeof MessageSchema>;

/** Ids are uuids or short tokens; the pattern also keeps NUL (which Postgres rejects) out of queries. */
export const ID_RE = /^[\w-]{1,64}$/;
const IdSchema = z.string().regex(ID_RE);
/** Message text: bounded, and no NUL character (Postgres text cannot store it). */
const BodySchema = z
  .string()
  .max(MESSAGE_MAX_LENGTH)
  .refine((v) => !v.includes('\0'));

export const SendMessageInputSchema = z
  .object({
    body: BodySchema,
    parentId: IdSchema.optional(),
    replyToId: IdSchema.optional(),
    fileIds: z
      .array(IdSchema)
      .max(MESSAGE_MAX_FILES)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    clientId: IdSchema,
  })
  .refine((v) => v.body.trim().length > 0 || (v.fileIds?.length ?? 0) > 0, { path: ['body'] })
  .refine((v) => v.replyToId === undefined || v.parentId !== undefined, { path: ['replyToId'] });
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const EditMessageInputSchema = z.object({ body: BodySchema });
export type EditMessageInput = z.infer<typeof EditMessageInputSchema>;

export const MarkReadInputSchema = z.object({
  // Postgres timestamptz rejects years before 1 AD; nothing before 1970 is a real read time.
  at: z.iso.datetime().refine((v) => new Date(v).getUTCFullYear() >= 1970),
});
export type MarkReadInput = z.infer<typeof MarkReadInputSchema>;

export const GroupChannelSchema = z.object({
  id: z.string(),
  lastSeq: z.number().int(),
  lastReadAt: z.string().nullable(),
  unread: z.number().int(),
});
export type GroupChannel = z.infer<typeof GroupChannelSchema>;

/** `before` pages are newest first, `after` pages oldest first. */
export const MessagePageSchema = z.object({
  messages: z.array(MessageSchema),
  hasMore: z.boolean(),
  lastSeq: z.number().int(),
  lastReadAt: z.string().nullable(),
});
export type MessagePage = z.infer<typeof MessagePageSchema>;

/** Messages oldest first; `targetId` is the top-level id of the requested message. */
export const AroundPageSchema = z.object({
  messages: z.array(MessageSchema),
  hasOlder: z.boolean(),
  hasNewer: z.boolean(),
  targetId: z.string(),
  lastSeq: z.number().int(),
  lastReadAt: z.string().nullable(),
});
export type AroundPage = z.infer<typeof AroundPageSchema>;

export const ChangesSchema = z.object({
  messages: z.array(MessageSchema),
  lastSeq: z.number().int(),
  truncated: z.boolean(),
});
export type Changes = z.infer<typeof ChangesSchema>;

export const ThreadSchema = z.object({ root: MessageSchema, replies: z.array(MessageSchema) });
export type Thread = z.infer<typeof ThreadSchema>;

/** Unread message count per group id (top-level messages and replies in the reader's threads). */
export const UnreadByGroupSchema = z.record(z.string(), z.number());
export type UnreadByGroup = z.infer<typeof UnreadByGroupSchema>;

/** The roots of a channel's threads with replies the reader has not read. */
export const UnreadThreadsSchema = z.array(z.string());
export type UnreadThreads = z.infer<typeof UnreadThreadsSchema>;

/** A task's chat on the board: its live messages (replies included) and whether any is unread. */
export const TaskChatSummarySchema = z.object({ count: z.number().int(), unread: z.boolean() });
/** By task id; tasks whose chat was never opened are absent. */
export const TaskChatSummariesSchema = z.record(z.string(), TaskChatSummarySchema);
export type TaskChatSummary = z.infer<typeof TaskChatSummarySchema>;
export type TaskChatSummaries = z.infer<typeof TaskChatSummariesSchema>;

export const ChatEvents = {
  message: 'chat:message',
  read: 'chat:read',
  threadReply: 'chat:thread-reply',
} as const;

/** Chat events name the channel's group and, for a task chat, its task (`taskId`, else null). */
export interface ChatMessageEvent {
  groupId: string;
  channelId: string;
  taskId: string | null;
  message: MessageDto;
  isNew: boolean;
}
/**
 * The channel (or, with `rootId`, one of its threads) is read up to `lastReadAt`; with `all`, the
 * whole channel is read, every thread of the reader included.
 */
export interface ChatReadEvent {
  groupId: string;
  channelId: string;
  taskId: string | null;
  lastReadAt: string;
  rootId?: string;
  all?: true;
}
/** To each person of the thread but the author: a new reply that counts as unread for them. */
export interface ChatThreadReplyEvent {
  groupId: string;
  channelId: string;
  taskId: string | null;
  rootId: string;
}

/** Global regexes: use them only with `matchAll`/`replace`, never `exec`/`test` (shared `lastIndex`). */
export const MENTION_RE = /<@([\w-]+)>/g;
export const CODE_RE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

export type MentionPart = { type: 'text'; text: string } | { type: 'mention'; id: string };

/** Splits a body into text and mention parts (`id` is `'all'` for @all); code fences and spans stay text. */
export function splitMentionTokens(body: string): MentionPart[] {
  const parts: MentionPart[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.type === 'text') last.text += text;
    else parts.push({ type: 'text', text });
  };
  const scan = (chunk: string) => {
    let at = 0;
    for (const m of chunk.matchAll(MENTION_RE)) {
      pushText(chunk.slice(at, m.index));
      parts.push({ type: 'mention', id: m[1] as string });
      at = m.index + m[0].length;
    }
    pushText(chunk.slice(at));
  };
  let at = 0;
  for (const code of body.matchAll(CODE_RE)) {
    scan(body.slice(at, code.index));
    pushText(code[0]);
    at = code.index + code[0].length;
  }
  scan(body.slice(at));
  return parts;
}

/** Unique mentioned user ids (order of first appearance) and whether `<@all>` appears; code is ignored. */
export function extractMentions(body: string): { userIds: string[]; all: boolean } {
  const userIds = new Set<string>();
  let all = false;
  for (const part of splitMentionTokens(body)) {
    if (part.type !== 'mention') continue;
    if (part.id === 'all') all = true;
    else userIds.add(part.id);
  }
  return { userIds: [...userIds], all };
}

/** One-line plain text of a body for notifications and reply strips. */
export function plainExcerpt(
  body: string,
  nameOf: (id: string) => string | undefined,
  max: number,
  allLabel = '@all',
): string {
  const text = body
    .replace(MENTION_RE, (_, id: string) => (id === 'all' ? allLabel : `@${nameOf(id) ?? '?'}`))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
