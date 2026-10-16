import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
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
    // Always written from JS `new Date()` (millisecond precision) so the ISO string round-trips.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('tasks_bucket_position_unique').on(t.bucketId, t.position),
    index('tasks_group_id_idx').on(t.groupId),
    // The global task board: the chosen clients' tasks, open or recently completed.
    index('tasks_open_group_idx').on(t.groupId, t.completedAt),
    index('tasks_due_date_open_idx')
      .on(t.dueDate)
      .where(sql`${t.completedAt} is null`),
    index('tasks_urgent_idx')
      .on(t.urgent)
      .where(sql`${t.urgent}`),
    // Serves the set-null cascade when a task chat goes, and listing a message's tasks.
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
  (t) => [primaryKey({ columns: [t.taskId, t.fileId] })],
);
