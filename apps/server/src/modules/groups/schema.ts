import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { GroupKind, MemberRole } from '@spolu/shared';
import { foldSql } from '../../infra/db/fold.js';
import { user } from '../users/schema.js';

/**
 * A client's group, or (`kind = 'admin'`, Phase 34) the one internal group "eGrant tím": read by
 * every admin, with no eGrant URL, no members and no tickets. `ensureAdminGroup` keeps it.
 */
export const groups = pgTable(
  'groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').$type<GroupKind>().notNull().default('client'),
    logoKey: text('logo_key'),
    /** Normalized origin, e.g. `https://firma.egrant.sk`; null only for the admin group. */
    egrantUrl: text('egrant_url').unique('groups_egrant_url_unique'),
    /** The admin group's token is never shown and never opens anything. */
    inviteToken: text('invite_token').notNull().unique('groups_invite_token_unique'),
    /**
     * Set while a client group is deactivated (by an admin or the eGrant groups webhook): only
     * admins read it, read-only; nothing is deleted, reactivating clears it.
     */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('groups_kind_check', sql`${t.kind} in ('client', 'admin')`),
    check('groups_egrant_url_check', sql`${t.kind} = 'admin' or ${t.egrantUrl} is not null`),
    // Exactly one admin group: every row of that kind has the same key.
    uniqueIndex('groups_one_admin')
      .on(sql`(true)`)
      .where(sql`${t.kind} = 'admin'`),
    // `GET /groups?limit=` pages by name and id (2026-10-18).
    index('groups_name_id_idx').on(t.name, t.id),
    // The global search (2026-10-18): a fragment of the folded name, trigram.
    index('groups_name_fold_trgm_idx').using('gin', sql`${foldSql(t.name)} gin_trgm_ops`),
  ],
);

/**
 * A person's membership of a group (Phase 21): one row per user and group. `client` reads the
 * whole group; `ziadatel` (a requester) only reaches their own tickets. A client may belong to
 * several groups. `removed_at` marks a membership an admin removed; it stays removed until an
 * admin restores it. Admins have no rows.
 */
export const groupMembers = pgTable(
  'group_members',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    role: text('role').$type<MemberRole>().notNull().default('client'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.groupId] }),
    check('group_members_role_check', sql`${t.role} in ('client', 'ziadatel')`),
    index('group_members_group_active_idx')
      .on(t.groupId, t.role)
      .where(sql`${t.removedAt} is null`),
    index('group_members_user_active_idx')
      .on(t.userId)
      .where(sql`${t.removedAt} is null`),
    // The removed members and requesters of a group (2026-10-18): the primary key leads with the
    // user, and the active index skips removed rows.
    index('group_members_group_removed_idx')
      .on(t.groupId, t.role)
      .where(sql`${t.removedAt} is not null`),
  ],
);

/**
 * The latest invite a person used before signing in with a code: one per user. It becomes a
 * client membership when they sign in (`applyPendingInvite`), so typing an email on an invite
 * never adds an existing account to a group by itself.
 */
export const pendingInvites = pgTable(
  'pending_invites',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The cascade from a deleted group.
  (t) => [index('pending_invites_group_idx').on(t.groupId)],
);

/**
 * Admin substitution (2026-10-19, ADR 0059): `substitute_id` covers every client group that
 * `substituted_id` manages, as a manager, while `ended_at` is null. `ends_on` is the last day
 * (inclusive, Bratislava time); the hourly job ends it the day after. At most one active row per
 * substituted admin. Rows are kept after the end (the audit log has the story).
 */
export const adminSubstitutions = pgTable(
  'admin_substitutions',
  {
    id: text('id').primaryKey(),
    substitutedId: text('substituted_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    substituteId: text('substitute_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endsOn: date('ends_on', { mode: 'string' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: text('ended_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('admin_substitutions_active_substituted_idx')
      .on(t.substitutedId)
      .where(sql`${t.endedAt} is null`),
    index('admin_substitutions_active_substitute_idx')
      .on(t.substituteId)
      .where(sql`${t.endedAt} is null`),
    check('admin_substitutions_not_self', sql`${t.substitutedId} <> ${t.substituteId}`),
  ],
);

/**
 * The admins who manage a group (its account managers). Many per group, many groups per admin.
 * Only active admins and superadmins count: read it through `managers.ts`, which filters on the role
 * and `disabled_at`. A row with `substitution_id` is derived from a substitution (ADR 0059) and
 * counts like an own row everywhere.
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
    /**
     * Set on a derived row (ADR 0059): the admin manages the group only because of this active
     * substitution. Null = the admin's own row. `syncSubstitute` keeps these rows.
     */
    substitutionId: text('substitution_id').references(() => adminSubstitutions.id, {
      onDelete: 'cascade',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('group_managers_user_id_idx').on(t.userId),
    // The cascade from a deleted substitution; only derived rows have one.
    index('group_managers_substitution_id_idx')
      .on(t.substitutionId)
      .where(sql`${t.substitutionId} is not null`),
  ],
);
