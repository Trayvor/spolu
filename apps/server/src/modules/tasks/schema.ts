import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { messages } from '../chat/schema.js';
import { files } from '../files/schema.js';
import { groups } from '../groups/schema.js';
import { knowledgeItems } from '../knowledge/schema.js';
import { projectEvents, projects } from '../projects/schema.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';

/** Fractional-index keys compare byte-wise, so the column is collated "C", not the database default. */
const positionText = customType<{ data: string }>({
  dataType: () => 'text collate "C"',
});

export const buckets = pgTable(
  'buckets',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Custom buckets only. */
    name: text('name'),
    position: positionText('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'buckets_kind_check',
      sql`${t.kind} in ('todo', 'egrant_review', 'client_review', 'done', 'custom')`,
    ),
    check(
      'buckets_name_check',
      sql`(${t.kind} = 'custom') = (${t.name} is not null) and char_length(${t.name}) <= 60`,
    ),
    uniqueIndex('buckets_group_fixed_kind_unique')
      .on(t.groupId, t.kind)
      .where(sql`${t.kind} <> 'custom'`),
    uniqueIndex('buckets_group_position_unique').on(t.groupId, t.position),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    // NO ACTION, not RESTRICT: a group delete cascades both tables in one statement.
    bucketId: text('bucket_id')
      .notNull()
      .references(() => buckets.id, { onDelete: 'no action' }),
    position: positionText('position').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    dueDate: date('due_date', { mode: 'string' }),
    urgent: boolean('urgent').notNull().default(false),
    /** An http(s) URL (checked by the shared schema), or null. */
    link: text('link'),
    /** Set when moved into Completed, cleared when moved out. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /**
     * The chat message the task was made from; cleared when that message's channel is deleted
     * (with its task). Lazy reference: chat/schema.ts imports this file too.
     */
    sourceMessageId: text('source_message_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    /** The ticket the task was made from (Phase 21); cleared when the ticket is deleted. */
    sourceTicketId: text('source_ticket_id').references(() => tickets.id, {
      onDelete: 'set null',
    }),
    /**
     * The meeting (a knowledge item of type meeting) the task was made from; cleared when the
     * item is deleted. Lazy reference: knowledge/schema.ts imports chat/schema.ts, which imports
     * this file.
     */
    sourceMeetingId: text('source_meeting_id').references((): AnyPgColumn => knowledgeItems.id, {
      onDelete: 'set null',
    }),
    /**
     * The task's project and event (Phase 33; set by part P2). Composite FKs: the project is of
     * the task's own client, the event of that project. Deleting an event clears `event_id`,
     * deleting a project `project_id` (column-list `set null`, written by hand in migration 0038;
     * the projects service deletes the events first, so the CHECK holds).
     */
    projectId: text('project_id'),
    eventId: text('event_id'),
    // Always written from JS `new Date()` (millisecond precision) so the ISO string round-trips.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'tasks_project_fk',
      columns: [t.projectId, t.groupId],
      foreignColumns: [projects.id, projects.groupId],
    }).onDelete('set null'),
    foreignKey({
      name: 'tasks_event_fk',
      columns: [t.eventId, t.projectId],
      foreignColumns: [projectEvents.id, projectEvents.projectId],
    })
      .onDelete('set null')
      .onUpdate('cascade'),
    check(
      'tasks_event_needs_project_check',
      sql`${t.eventId} is null or ${t.projectId} is not null`,
    ),
    // The board filters (part P2) and the project FK.
    index('tasks_group_project_event_idx').on(t.groupId, t.projectId, t.eventId),
    // The timeline rows (part P4) and the event FK.
    index('tasks_event_project_idx')
      .on(t.eventId, t.projectId)
      .where(sql`${t.eventId} is not null`),
    uniqueIndex('tasks_bucket_position_unique').on(t.bucketId, t.position),
    // A group's picker (Phase 34) newest first, open first, in index order (2026-10-18); it also
    // serves every lookup by group and the foreign key.
    index('tasks_group_search_order_idx').on(
      t.groupId,
      sql`(${t.completedAt} is not null)`,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // The global task board: the chosen clients' tasks, open or recently completed.
    index('tasks_open_group_idx').on(t.groupId, t.completedAt),
    index('tasks_due_date_open_idx')
      .on(t.dueDate)
      .where(sql`${t.completedAt} is null`),
    // The hourly urgent reminders read open urgent tasks only (2026-10-18).
    index('tasks_urgent_open_idx')
      .on(t.urgent)
      .where(sql`${t.urgent} and ${t.completedAt} is null`),
    // Serves the set-null cascade when a task chat goes, and listing a message's tasks.
    index('tasks_source_ticket_id_idx')
      .on(t.sourceTicketId)
      .where(sql`${t.sourceTicketId} is not null`),
    // The meeting's task list and the set-null cascade when the meeting is deleted.
    index('tasks_source_meeting_id_idx')
      .on(t.sourceMeetingId)
      .where(sql`${t.sourceMeetingId} is not null`),
    // The picker's title search (Phase 34); trigram as in ADR 0015.
    index('tasks_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    // The admin group's picker across every group (Phase 34 part D): open first, newest first.
    index('tasks_search_order_idx').on(
      sql`(${t.completedAt} is not null)`,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('tasks_source_message_id_idx')
      .on(t.sourceMessageId)
      .where(sql`${t.sourceMessageId} is not null`),
  ],
);

export const taskAssignees = pgTable(
  'task_assignees',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index('task_assignees_user_id_idx').on(t.userId),
  ],
);

export const taskAttachments = pgTable(
  'task_attachments',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.fileId] }),
    // The cascade from a deleted file.
    index('task_attachments_file_idx').on(t.fileId),
  ],
);
