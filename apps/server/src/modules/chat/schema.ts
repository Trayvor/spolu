import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  unique,
} from 'drizzle-orm/pg-core';
import { files } from '../files/schema.js';
import { groups } from '../groups/schema.js';
import { tasks } from '../tasks/schema.js';
import { user } from '../users/schema.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

/**
 * A chat room: the group chat (one per group) and the task chats (one per task, created on first
 * use, deleted with the task). `lastSeq` is the per-channel change counter.
 */
export const channels = pgTable(
  'channels',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Set exactly for task chats. Lazy reference: tasks/schema.ts imports this file too. */
    taskId: text('task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('channels_kind_check', sql`${t.kind} in ('group', 'task')`),
    check('channels_task_check', sql`(${t.kind} = 'task') = (${t.taskId} is not null)`),
    uniqueIndex('channels_group_unique')
      .on(t.groupId)
      .where(sql`${t.kind} = 'group'`),
    // `task_id is not null` (same rows as kind = 'task', by the check above) rather than
    // kind = 'task': the planner can then use it for the cascade `where task_id = $1`.
    uniqueIndex('channels_task_unique')
      .on(t.taskId)
      .where(sql`${t.taskId} is not null`),
    index('channels_group_id_idx').on(t.groupId),
  ],
);

/** A top-level message (`parentId` null) or a reply in the thread of its root. */
export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    parentId: text('parent_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'cascade',
    }),
    replyToId: text('reply_to_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'cascade',
    }),
    body: text('body').notNull(),
    mentionsAll: boolean('mentions_all').notNull().default(false),
    /** Client-generated id that makes a retried send idempotent. */
    clientId: text('client_id').notNull(),
    /** The channel's `lastSeq` at the time of the last change to this message. */
    changeSeq: bigint('change_seq', { mode: 'number' }).notNull(),
    replyCount: integer('reply_count').notNull().default(0),
    lastReplyAt: timestamptz('last_reply_at'),
    editedAt: timestamptz('edited_at'),
    deletedAt: timestamptz('deleted_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('messages_author_client_unique').on(t.authorId, t.clientId),
    index('messages_channel_parent_created_idx').on(t.channelId, t.parentId, t.createdAt),
    index('messages_channel_seq_idx').on(t.channelId, t.changeSeq),
  ],
);

export const messageMentions = pgTable(
  'message_mentions',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

export const messageAttachments = pgTable(
  'message_attachments',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.fileId] }),
    index('message_attachments_file_id_idx').on(t.fileId),
  ],
);

/** Where a user has read a channel up to: its top-level messages by others created after it are unread. */
export const readStates = pgTable(
  'read_states',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    lastReadAt: timestamptz('last_read_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] })],
);

/**
 * Where a user has read one thread up to. A row exists only for the people of the thread (its
 * root author and everyone who replied, which includes everyone a reply can quote): their unread
 * count includes the thread's replies by others created after `lastReadAt`. Written when a reply
 * is sent and when the user opens the thread. `lastReplyAt` copies the thread's newest reply
 * time, so the partial index holds only threads with something new and the unread count never
 * looks at the others.
 */
export const threadReadStates = pgTable(
  'thread_read_states',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    rootId: text('root_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    lastReadAt: timestamptz('last_read_at').notNull(),
    lastReplyAt: timestamptz('last_reply_at').notNull(),
  },
  (t) => [
    // Root first: it also serves the cascade from a deleted message and the update per reply.
    primaryKey({ columns: [t.rootId, t.userId] }),
    index('thread_read_states_unread_idx')
      .on(t.userId, t.channelId)
      .where(sql`${t.lastReplyAt} > ${t.lastReadAt}`),
  ],
);
