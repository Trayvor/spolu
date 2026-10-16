import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { files } from '../files/schema.js';
import { groups } from '../groups/schema.js';
import { user } from '../users/schema.js';

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
  },
  (t) => [
    check('knowledge_items_type_check', sql`${t.type} in ('note', 'file', 'link', 'reminder')`),
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
