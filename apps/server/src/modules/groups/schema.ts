import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from '../users/schema.js';

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  logoKey: text('logo_key'),
  /** Normalized origin, e.g. `https://firma.egrant.sk`. */
  egrantUrl: text('egrant_url').notNull().unique('groups_egrant_url_unique'),
  inviteToken: text('invite_token').notNull().unique('groups_invite_token_unique'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per client: a client belongs to exactly one group. Admins have no rows. */
export const groupMembers = pgTable(
  'group_members',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('group_members_group_id_idx').on(t.groupId)],
);
