import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
import { projectEvents, projects } from '../projects/schema.js';
import { taskAttachments, tasks } from '../tasks/schema.js';
import { ticketAttachments, tickets } from '../tickets/schema.js';
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
    /**
     * A ticket file (`ticket_file`, 2026-10-22): its `ticket_attachments` row (this ticket and
     * `source_file_id`), which it cascades from, so the entry goes with the file or the ticket.
     * Written only by `source-files.ts`, and only while the ticket has a client.
     */
    sourceTicketId: text('source_ticket_id'),
    /** A task file (`task_file`): its `task_attachments` row (this task and `source_file_id`). */
    sourceTaskId: text('source_task_id'),
    /** The file of a ticket or task file. */
    sourceFileId: text('source_file_id'),
  },
  (t) => [
    check(
      'knowledge_items_type_check',
      sql`${t.type} in ('note', 'file', 'link', 'reminder', 'meeting', 'chat_file', 'ticket_file', 'task_file')`,
    ),
    check(
      'knowledge_items_source_check',
      sql`(${t.type} = 'ticket_file') = (${t.sourceTicketId} is not null) and (${t.type} = 'task_file') = (${t.sourceTaskId} is not null) and (${t.type} in ('ticket_file', 'task_file')) = (${t.sourceFileId} is not null)`,
    ),
    foreignKey({
      name: 'knowledge_items_ticket_attachment_fk',
      columns: [t.sourceTicketId, t.sourceFileId],
      foreignColumns: [ticketAttachments.ticketId, ticketAttachments.fileId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'knowledge_items_task_attachment_fk',
      columns: [t.sourceTaskId, t.sourceFileId],
      foreignColumns: [taskAttachments.taskId, taskAttachments.fileId],
    }).onDelete('cascade'),
    // One entry per file of a ticket or task; also the lookups of the cascades above and of a
    // ticket's move to another client.
    uniqueIndex('knowledge_items_ticket_file_unique')
      .on(t.sourceTicketId, t.sourceFileId)
      .where(sql`${t.sourceTicketId} is not null`),
    uniqueIndex('knowledge_items_task_file_unique')
      .on(t.sourceTaskId, t.sourceFileId)
      .where(sql`${t.sourceTaskId} is not null`),
    // The items of a file (`knowledgeItemIdsOfFile`).
    index('knowledge_items_source_file_idx')
      .on(t.sourceFileId)
      .where(sql`${t.sourceFileId} is not null`),
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
    // Phase 28: the items of a file, for a ziadatel reading an item attached in their ticket chat.
    index('knowledge_items_chat_file_idx')
      .on(t.chatFileId)
      .where(sql`${t.chatFileId} is not null`),
    // A group's automatic files (chat, ticket and task files), newest first (the type and the
    // `chats` filter's kind are checked on top).
    index('knowledge_items_group_auto_created_idx')
      .on(t.groupId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.type} in ('chat_file', 'ticket_file', 'task_file')`),
    // The folder view's top level, which never lists automatic files (they have no folder).
    index('knowledge_items_root_created_idx')
      .on(t.groupId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(
        sql`${t.folderId} is null and ${t.type} not in ('chat_file', 'ticket_file', 'task_file')`,
      ),
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
 * Recurring calls (ADR 0049): the rule of a series and the template of its next calls. Every
 * call of a series is a `meeting` item of its own (`knowledge_meetings.series_id`), created
 * ahead of time: at the series' creation and by the series job, up to 60 days ahead.
 *
 * - The rule: occurrence `anchor_index` starts at `anchor_starts_at`, the others follow it by
 *   `frequency` in `time_zone` (the local time of day stays). An "all following" edit that
 *   moves the time re-anchors it at the edited call.
 * - The end: `until` (a local day, inclusive) or `count` (calls in all), or none.
 * - `next_index` is the next occurrence to create, never reused: a cancelled (deleted) call is
 *   not created again. `next_starts_at` is its start, null once the series has ended (the job's
 *   due rows, partial index).
 * - The template (title, body, visibility, folder, meeting link, reminder offsets and added
 *   recipients) is what the next calls get; "all following" edits change it.
 */
export const knowledgeMeetingSeries = pgTable(
  'knowledge_meeting_series',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** `weekly`, `biweekly`, `monthly_date` or `monthly_weekday`. */
    frequency: text('frequency').notNull(),
    timeZone: text('time_zone').notNull(),
    anchorStartsAt: timestamp('anchor_starts_at', { withTimezone: true, precision: 3 }).notNull(),
    anchorIndex: integer('anchor_index').notNull().default(0),
    until: date('until', { mode: 'string' }),
    count: integer('count'),
    nextIndex: integer('next_index').notNull().default(1),
    nextStartsAt: timestamp('next_starts_at', { withTimezone: true, precision: 3 }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    visibility: text('visibility').notNull().default('public'),
    folderId: text('folder_id').references(() => knowledgeFolders.id, { onDelete: 'set null' }),
    meetingUrl: text('meeting_url'),
    /** Minutes before each call's start at which its reminder fires (negative: after). */
    reminderOffsets: integer('reminder_offsets')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    reminderRecipientIds: text('reminder_recipient_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'knowledge_meeting_series_frequency_check',
      sql`${t.frequency} in ('weekly', 'biweekly', 'monthly_date', 'monthly_weekday')`,
    ),
    check(
      'knowledge_meeting_series_visibility_check',
      sql`${t.visibility} in ('public', 'admins')`,
    ),
    check('knowledge_meeting_series_end_check', sql`${t.until} is null or ${t.count} is null`),
    // The series job's due rows.
    index('knowledge_meeting_series_next_idx')
      .on(t.nextStartsAt)
      .where(sql`${t.nextStartsAt} is not null`),
    index('knowledge_meeting_series_group_idx').on(t.groupId),
    index('knowledge_meeting_series_folder_idx').on(t.folderId),
    index('knowledge_meeting_series_created_by_idx').on(t.createdBy),
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
    /** `manual`, `ai` or `teams` (Teams T1); null while there is no transcript. */
    transcriptSource: text('transcript_source'),
    /**
     * Teams T1: the transcript (and the summary made from it) is shown to admins only until an
     * admin shares it with the client. Set by a Teams import; cleared by "Share with the client".
     */
    transcriptAdminsOnly: boolean('transcript_admins_only').notNull().default(false),
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
    /** Recurring calls (ADR 0049): the call's series and its place in it (0 the first). */
    seriesId: text('series_id').references(() => knowledgeMeetingSeries.id, {
      onDelete: 'set null',
    }),
    seriesIndex: integer('series_index'),
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
      sql`${t.transcriptSource} is null or ${t.transcriptSource} in ('manual', 'ai', 'teams')`,
    ),
    index('knowledge_meetings_starts_at_idx').on(t.startsAt),
    index('knowledge_meetings_recording_file_idx').on(t.recordingFileId),
    // One call per place of a series; also the series' calls in order ("all following").
    uniqueIndex('knowledge_meetings_series_unique')
      .on(t.seriesId, t.seriesIndex)
      .where(sql`${t.seriesId} is not null`),
  ],
);

/**
 * Knowledge items attached to a description (Phase 33 part P5, spec §10.3): of a task, a ticket,
 * a project, an event or another knowledge item, exactly one. `item_id` has no FK: a deleted item
 * shows as unavailable, as in chat. Owned here; the other modules go through `links.ts`.
 * Lazy references: tasks/schema.ts imports this file through chat/schema.ts.
 */
export const knowledgeLinks = pgTable(
  'knowledge_links',
  {
    itemId: text('item_id').notNull(),
    taskId: text('task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    ticketId: text('ticket_id').references((): AnyPgColumn => tickets.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references((): AnyPgColumn => projects.id, {
      onDelete: 'cascade',
    }),
    eventId: text('event_id').references((): AnyPgColumn => projectEvents.id, {
      onDelete: 'cascade',
    }),
    knowledgeItemId: text('knowledge_item_id').references((): AnyPgColumn => knowledgeItems.id, {
      onDelete: 'cascade',
    }),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    check(
      'knowledge_links_subject_check',
      sql`num_nonnulls(${t.taskId}, ${t.ticketId}, ${t.projectId}, ${t.eventId}, ${t.knowledgeItemId}) = 1`,
    ),
    // One link per item and subject; it also leads with `item_id` for the file read rule.
    uniqueIndex('knowledge_links_item_subject_unique').on(
      t.itemId,
      sql`coalesce(${t.taskId}, ${t.ticketId}, ${t.projectId}, ${t.eventId}, ${t.knowledgeItemId})`,
    ),
    index('knowledge_links_task_idx')
      .on(t.taskId)
      .where(sql`${t.taskId} is not null`),
    index('knowledge_links_ticket_idx')
      .on(t.ticketId)
      .where(sql`${t.ticketId} is not null`),
    index('knowledge_links_project_idx')
      .on(t.projectId)
      .where(sql`${t.projectId} is not null`),
    index('knowledge_links_event_idx')
      .on(t.eventId)
      .where(sql`${t.eventId} is not null`),
    index('knowledge_links_knowledge_item_idx')
      .on(t.knowledgeItemId)
      .where(sql`${t.knowledgeItemId} is not null`),
  ],
);
