import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
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

/**
 * The admins who manage a group (its account managers). Many per group, many groups per admin.
 * Only active admins and superadmins count: read it through `managers.ts`, which filters on the role
 * and `disabled_at`.
 */
export const groupManagers = pgTable(
  'group_managers',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('group_managers_user_id_idx').on(t.userId),
  ],
);
