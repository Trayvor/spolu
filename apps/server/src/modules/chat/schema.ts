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
import { user } from '../users/schema.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

/** A chat room: the group chat, and (Phase 9) one per task. `lastSeq` is the per-channel change counter. */
export const channels = pgTable(
  'channels',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Set for task chats; the FK to tasks is added in Phase 9. */
    taskId: text('task_id'),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('channels_kind_check', sql`${t.kind} in ('group', 'task')`),
    uniqueIndex('channels_group_unique')
      .on(t.groupId)
      .where(sql`${t.kind} = 'group'`),
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

/** Where a user has read a channel up to; unread = top-level messages by others created after it. */
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
