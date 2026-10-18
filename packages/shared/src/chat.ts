import { z } from 'zod';
import { FileInfoSchema } from './files.js';

export const MESSAGE_MAX_LENGTH = 10_000;
export const MESSAGE_MAX_FILES = 10;
/** Knowledge items one message may carry (Phase 28). */
export const MESSAGE_MAX_KNOWLEDGE = 5;
/** Tasks and tickets one message may carry each (Phase 34). */
export const MESSAGE_MAX_WORK = 5;
/** Different emoji one message may carry (Phase 28). */
export const MESSAGE_MAX_EMOJI = 20;
/** The quick row of reactions, in this order (Phase 28). */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅'] as const;
export const MESSAGE_PAGE_SIZE = 50;
export const MENTION_ALL_TOKEN = '<@all>';
export const mentionToken = (userId: string): string => `<@${userId}>`;

export const ChatAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  isAdmin: z.boolean(),
});
export type ChatAuthor = z.infer<typeof ChatAuthorSchema>;

/** A task made from a message, for the message's "Turned into tasks" footer. */
export const MessageTaskLinkSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});
export type MessageTaskLink = z.infer<typeof MessageTaskLinkSchema>;

/** One emoji on a message and who added it, oldest first (Phase 28). */
export const ReactionSchema = z.object({
  emoji: z.string(),
  userIds: z.array(z.string()),
});
export type Reaction = z.infer<typeof ReactionSchema>;

/**
 * A knowledge item attached to a message (Phase 28): its card while the item is still visible to
 * everyone in the channel's group, else only its id (`available: false`, shown as unavailable).
 * `type` is a `KnowledgeType`; `folderPath` the names of its folders from the top.
 */
export const MessageKnowledgeSchema = z.discriminatedUnion('available', [
  z.object({
    id: z.string(),
    available: z.literal(true),
    type: z.string(),
    title: z.string(),
    folderPath: z.array(z.string()),
    /**
     * Phase 34: `admin_group` for an item of the admin group "eGrant tím" shown in a client's
     * place (the badge; a non-admin opens it read-only through the place, and its folders stay
     * hidden: `folderPath` is empty). Absent for the place's own items.
     */
    source: z.literal('admin_group').optional(),
  }),
  z.object({ id: z.string(), available: z.literal(false) }),
]);
export type MessageKnowledge = z.infer<typeof MessageKnowledgeSchema>;

const WorkPersonSchema = z.object({ id: z.string(), name: z.string() });

/**
 * A task attached to a message (Phase 34): its live card while the task exists, else only its id
 * (`available: false`). `bucketKind` is a `BucketKind`, `bucketName` set for custom buckets.
 */
export const MessageAttachedTaskSchema = z.discriminatedUnion('available', [
  z.object({
    id: z.string(),
    available: z.literal(true),
    groupId: z.string(),
    title: z.string(),
    completed: z.boolean(),
    bucketKind: z.string(),
    bucketName: z.string().nullable(),
    /** At most three, by name. */
    assignees: z.array(WorkPersonSchema),
    dueDate: z.string().nullable(),
    urgent: z.boolean(),
  }),
  z.object({ id: z.string(), available: z.literal(false) }),
]);
export type MessageAttachedTask = z.infer<typeof MessageAttachedTaskSchema>;

/**
 * A ticket attached to a message (Phase 34): its live card while it exists in the channel's
 * group, else only its id. `status` is a `TicketStatus`.
 */
export const MessageAttachedTicketSchema = z.discriminatedUnion('available', [
  z.object({
    id: z.string(),
    available: z.literal(true),
    groupId: z.string().nullable(),
    number: z.number().int(),
    subject: z.string().nullable(),
    status: z.string(),
    /** At most three, by name. */
    assignees: z.array(WorkPersonSchema),
  }),
  z.object({ id: z.string(), available: z.literal(false) }),
]);
export type MessageAttachedTicket = z.infer<typeof MessageAttachedTicketSchema>;

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
  /** Tasks made from the message, oldest first; always empty on a deleted message. */
  tasks: z.array(MessageTaskLinkSchema),
  /** Phase 28: always empty on a deleted message. */
  reactions: z.array(ReactionSchema),
  /** Phase 28: the attached knowledge items in their order; always empty on a deleted message. */
  knowledge: z.array(MessageKnowledgeSchema),
  /** Phase 34: the attached tasks in their order; always empty on a deleted message. */
  attachedTasks: z.array(MessageAttachedTaskSchema),
  /** Phase 34: the attached tickets in their order; always empty on a deleted message. */
  attachedTickets: z.array(MessageAttachedTicketSchema),
});
export type MessageDto = z.infer<typeof MessageSchema>;

/** Ids are uuids or short tokens; the pattern also keeps NUL (which Postgres rejects) out of queries. */
export const ID_RE = /^[\w-]{1,64}$/;
export const IdSchema = z.string().regex(ID_RE);
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
    /** Knowledge items of the channel's group, visible to everyone there (Phase 28). */
    knowledgeIds: z
      .array(IdSchema)
      .max(MESSAGE_MAX_KNOWLEDGE)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    /** Tasks of the channel's group (Phase 34). */
    taskIds: z
      .array(IdSchema)
      .max(MESSAGE_MAX_WORK)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    /** Tickets of the channel's group (Phase 34). */
    ticketIds: z
      .array(IdSchema)
      .max(MESSAGE_MAX_WORK)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    clientId: IdSchema,
  })
  .refine(
    (v) =>
      v.body.trim().length > 0 ||
      (v.fileIds?.length ?? 0) > 0 ||
      (v.knowledgeIds?.length ?? 0) > 0 ||
      (v.taskIds?.length ?? 0) > 0 ||
      (v.ticketIds?.length ?? 0) > 0,
    { path: ['body'] },
  )
  .refine((v) => v.replyToId === undefined || v.parentId !== undefined, { path: ['replyToId'] });
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const EditMessageInputSchema = z.object({ body: BodySchema });
export type EditMessageInput = z.infer<typeof EditMessageInputSchema>;

/** One emoji: pictographs with their modifiers, joiners, flags and keycaps; never plain text. */
const EMOJI_CHARS = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\u20e3)+$/u;
const EMOJI_CORE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
const graphemes = (v: string): number =>
  typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(v)].length
    : 1;
/** At most 32 UTF-16 units and one grapheme: `👍👍` is two reactions, not one. */
export const EmojiSchema = z
  .string()
  .refine(
    (v) =>
      v.length > 0 &&
      v.length <= 32 &&
      EMOJI_CHARS.test(v) &&
      EMOJI_CORE.test(v) &&
      graphemes(v) === 1,
  );

/** `PUT /api/messages/:id/reactions`: the actor's reaction with this emoji is on or off. */
export const SetReactionInputSchema = z.object({ emoji: EmojiSchema, on: z.boolean() });
export type SetReactionInput = z.infer<typeof SetReactionInputSchema>;

/** The answer of a reaction write: the message's reactions after it and its `changeSeq`. */
export const MessageReactionsSchema = z.object({
  messageId: z.string(),
  changeSeq: z.number().int(),
  reactions: z.array(ReactionSchema),
});
export type MessageReactions = z.infer<typeof MessageReactionsSchema>;

/** `GET /api/messages/:id/reactions`: who added each emoji, oldest first. */
export const ReactionPeopleSchema = z.array(
  z.object({
    emoji: z.string(),
    people: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
);
export type ReactionPeople = z.infer<typeof ReactionPeopleSchema>;

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
  messageTasks: 'chat:message_tasks',
  reactions: 'chat:reactions',
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

/** The tasks made from a message changed (created, renamed, completed, reopened or deleted). */
export interface ChatMessageTasksEvent {
  groupId: string;
  channelId: string;
  messageId: string;
  parentId: string | null;
  tasks: MessageTaskLink[];
}

/** A message's reactions changed (Phase 28); `changeSeq` is the message's new one. */
export interface ChatReactionsEvent {
  groupId: string;
  channelId: string;
  taskId: string | null;
  messageId: string;
  parentId: string | null;
  changeSeq: number;
  reactions: Reaction[];
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
