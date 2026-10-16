import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { groups } from '../groups/schema.js';
import { user } from '../users/schema.js';

/**
 * A stored file of one group. `attachedAt` stays null until the owning module uses it.
 * `groupId` null: a file sent to the ticket intake for a ticket without a client (only admins
 * read it; it moves to the client with the ticket). `uploadedBy` null: received from an
 * integration, not uploaded by a person.
 */
export const files = pgTable(
  'files',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    uploadedBy: text('uploaded_by').references(() => user.id),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    previewKey: text('preview_key'),
    width: integer('width'),
    height: integer('height'),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    /** Attached to an admins-only knowledge item: clients cannot read it. Follows the item. */
    adminsOnly: boolean('admins_only').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('files_group_id_idx').on(t.groupId),
    index('files_unattached_idx')
      .on(t.createdAt)
      .where(sql`${t.attachedAt} is null`),
  ],
);
