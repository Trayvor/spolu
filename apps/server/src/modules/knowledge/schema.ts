import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type AnyPgColumn,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { messageAttachments } from '../chat/schema.js';
import { files } from '../files/schema.js';
import { groups } from '../groups/schema.js';
import { user } from '../users/schema.js';

/**
 * A folder of one group's knowledge base; `parent_id` null is the top level. Everything inside an
 * admins-only folder is admins-only (kept by the service, see `folders.ts`).
 */
export const knowledgeFolders = pgTable(
  'knowledge_folders',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    // No action on delete: a folder's contents move up before it goes, and a group's delete
    // cascades to all of its folders in the same statement.
    parentId: text('parent_id').references((): AnyPgColumn => knowledgeFolders.id),
    name: text('name').notNull(),
    /** `public` (the group and admins) or `admins` (admins only). */
    visibility: text('visibility').notNull().default('public'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check('knowledge_folders_visibility_check', sql`${t.visibility} in ('public', 'admins')`),
    check('knowledge_folders_name_check', sql`char_length(${t.name}) between 1 and 100`),
    index('knowledge_folders_group_idx').on(t.groupId),
    index('knowledge_folders_parent_idx').on(t.parentId),
  ],
);

/** A knowledge card of one group: a note, a file, a link or a reminder. */
export const knowledgeItems = pgTable(
  'knowledge_items',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    /** `public` (the group and admins) or `admins` (admins only). */
    visibility: text('visibility').notNull().default('public'),
    title: text('title').notNull(),
    /** The note or reminder body, the file or link description (Markdown, max 10 000). */
    body: text('body').notNull().default(''),
    /** Set exactly for links. */
    url: text('url'),
    /** The item's folder; null is the top level. */
    folderId: text('folder_id').references(() => knowledgeFolders.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    /**
     * Full precision: items created in one transaction share it, so the list cursor carries the
     * database's text of it, never a JS `Date`.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Millisecond precision, so the ISO string round-trips for the 409 `knowledge_changed` check. */
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    /**
     * Title, body as plain text, URL and file names, lower-cased and without diacritics; written
     * by the service on every change, searched with `ILIKE` through the trigram index.
     */
    searchText: text('search_text').notNull(),
    /**
     * A chat file (`type` `chat_file`): the message and file of its `message_attachments` row,
     * which it cascades from, so the entry goes with the message, the file, the task, the ticket
     * or the group. Written only by the chat hooks (`chat-files.ts`).
     */
    chatMessageId: text('chat_message_id'),
    chatFileId: text('chat_file_id'),
    /** The message's chat; a ticket chat that moves to another group moves its entries by it. */
    chatChannelId: text('chat_channel_id'),
    /** `group`, `task` or `ticket`: the kind of that chat (the `chats` list filter). */
    chatKind: text('chat_kind'),
  },
  (t) => [
    check(
      'knowledge_items_type_check',
      sql`${t.type} in ('note', 'file', 'link', 'reminder', 'meeting', 'chat_file')`,
    ),
    check(
      'knowledge_items_chat_check',
      sql`(${t.type} = 'chat_file') = (${t.chatMessageId} is not null) and (${t.chatMessageId} is null) = (${t.chatFileId} is null) and (${t.chatMessageId} is null) = (${t.chatChannelId} is null) and (${t.chatMessageId} is null) = (${t.chatKind} is null)`,
    ),
    check(
      'knowledge_items_chat_kind_check',
      sql`${t.chatKind} is null or ${t.chatKind} in ('group', 'task', 'ticket')`,
    ),
    foreignKey({
      name: 'knowledge_items_chat_attachment_fk',
      columns: [t.chatMessageId, t.chatFileId],
      foreignColumns: [messageAttachments.messageId, messageAttachments.fileId],
    }).onDelete('cascade'),
    // One entry per file of a message; also the lookup of the cascade above.
    uniqueIndex('knowledge_items_chat_unique')
      .on(t.chatMessageId, t.chatFileId)
      .where(sql`${t.chatMessageId} is not null`),
    index('knowledge_items_chat_channel_idx')
      .on(t.chatChannelId)
      .where(sql`${t.chatChannelId} is not null`),
    // A group's chat files, newest first (the `chats` filter's kind is checked on top).
    index('knowledge_items_group_chat_created_idx')
      .on(t.groupId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.type} = 'chat_file'`),
    // The folder view's top level, which never lists chat files (they have no folder either).
    index('knowledge_items_root_created_idx')
      .on(t.groupId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.folderId} is null and ${t.type} <> 'chat_file'`),
    check('knowledge_items_visibility_check', sql`${t.visibility} in ('public', 'admins')`),
    check('knowledge_items_url_check', sql`(${t.type} = 'link') = (${t.url} is not null)`),
    check('knowledge_items_title_check', sql`char_length(${t.title}) <= 200`),
    // NULLS FIRST is what `order by created_at desc, id desc` means; drizzle's `.desc()` alone
    // writes NULLS LAST, which that order could not read from the index.
    index('knowledge_items_group_created_idx').on(
      t.groupId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('knowledge_items_created_idx').on(
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('knowledge_items_created_by_idx').on(t.createdBy),
    // A folder's page (`folder_id = $1`, or `is null` with the group), newest first; folder
    // first, so the foreign key check of a folder's delete uses it too.
    index('knowledge_items_folder_created_idx').on(
      t.folderId,
      t.groupId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('knowledge_items_search_idx').using('gin', t.searchText.op('gin_trgm_ops')),
  ],
);

/** The files of a note or file item. */
export const knowledgeAttachments = pgTable(
  'knowledge_attachments',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.fileId] }),
    index('knowledge_attachments_file_id_idx').on(t.fileId),
  ],
);

/**
 * A meeting item's own fields (Phase 30), one row per `meeting` item. The compact audio is a
 * `files` row attached through `knowledge_attachments` (so it follows the item's visibility);
 * `recording_file_id` names it. `upload_key` is the original upload while it waits for the
 * transcoder (deleted after). `summary` is `MeetingSummary` JSON.
 */
export const knowledgeMeetings = pgTable(
  'knowledge_meetings',
  {
    itemId: text('item_id')
      .primaryKey()
      .references(() => knowledgeItems.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true, precision: 3 }).notNull(),
    meetingUrl: text('meeting_url'),
    recordingUrl: text('recording_url'),
    transcriptUrl: text('transcript_url'),
    transcript: text('transcript').notNull().default(''),
    /** `manual` or `ai`; null while there is no transcript. */
    transcriptSource: text('transcript_source'),
    /** `none`, `processing`, `ready` or `failed`. */
    recordingState: text('recording_state').notNull().default('none'),
    recordingFileId: text('recording_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    uploadKey: text('upload_key'),
    /** `idle`, `queued`, `transcribing`, `summarizing`, `done` or `failed`. */
    aiState: text('ai_state').notNull().default('idle'),
    aiError: text('ai_error'),
    /** Bumped by every run, so a stale job of an earlier run stops. */
    aiRun: integer('ai_run').notNull().default(0),
    aiUpdatedAt: timestamp('ai_updated_at', { withTimezone: true, precision: 3 }),
    summary: jsonb('summary'),
  },
  (t) => [
    check(
      'knowledge_meetings_recording_state_check',
      sql`${t.recordingState} in ('none', 'processing', 'ready', 'failed')`,
    ),
    check(
      'knowledge_meetings_ai_state_check',
      sql`${t.aiState} in ('idle', 'queued', 'transcribing', 'summarizing', 'done', 'failed')`,
    ),
    check(
      'knowledge_meetings_transcript_source_check',
      sql`${t.transcriptSource} is null or ${t.transcriptSource} in ('manual', 'ai')`,
    ),
    index('knowledge_meetings_starts_at_idx').on(t.startsAt),
    index('knowledge_meetings_recording_file_idx').on(t.recordingFileId),
  ],
);
