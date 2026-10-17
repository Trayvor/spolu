import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { financeItems } from '../finance/schema.js';
import { groups } from '../groups/schema.js';
import { knowledgeItems } from '../knowledge/schema.js';
import { tasks } from '../tasks/schema.js';
import { user } from '../users/schema.js';

/**
 * The reminders of one subject. One foreign key column per subject kind (not a generic
 * `subject_id`), so deleting the subject deletes its reminders in the database: a knowledge
 * reminder item (Phase 17), a task (Phase 19) or a finance item (Phase 32). Exactly one is set.
 */
export const reminderSets = pgTable(
  'reminder_sets',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    knowledgeItemId: text('knowledge_item_id').references(() => knowledgeItems.id, {
      onDelete: 'cascade',
    }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    financeItemId: text('finance_item_id').references(() => financeItems.id, {
      onDelete: 'cascade',
    }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'reminder_sets_subject_check',
      sql`num_nonnulls(${t.knowledgeItemId}, ${t.taskId}, ${t.financeItemId}) = 1`,
    ),
    // The group cascade, and the group-scoped reminder lists of later phases.
    index('reminder_sets_group_id_idx').on(t.groupId),
    uniqueIndex('reminder_sets_knowledge_item_unique').on(t.knowledgeItemId),
    uniqueIndex('reminder_sets_task_unique').on(t.taskId),
    uniqueIndex('reminder_sets_finance_item_unique').on(t.financeItemId),
  ],
);

/** One date-time of a set; `fired_at` is set once it has been handled by the fire job. */
export const reminderTimes = pgTable(
  'reminder_times',
  {
    id: text('id').primaryKey(),
    setId: text('set_id')
      .notNull()
      .references(() => reminderSets.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    /** When `at` was set; the calendar export's SEQUENCE and LAST-MODIFIED come from it. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reminder_times_due_idx')
      .on(t.at)
      .where(sql`${t.firedAt} is null`),
    index('reminder_times_set_at_idx').on(t.setId, t.at),
  ],
);

/** Who a set notifies, and how they got there. */
export const reminderRecipients = pgTable(
  'reminder_recipients',
  {
    setId: text('set_id')
      .notNull()
      .references(() => reminderSets.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** `author`, `added` (by the author) or `subscribed` (by themselves). */
    source: text('source').notNull(),
    addedBy: text('added_by')
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    check(
      'reminder_recipients_source_check',
      sql`${t.source} in ('author', 'added', 'subscribed')`,
    ),
    primaryKey({ columns: [t.setId, t.userId] }),
    index('reminder_recipients_user_id_idx').on(t.userId),
  ],
);
