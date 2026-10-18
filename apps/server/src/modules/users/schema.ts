import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { ChannelMap, GroupMode, Role, UserLanguage } from '@spolu/shared';
import { foldSql } from '../../infra/db/fold.js';
import { languageIn } from '../../infra/db/language-check.js';

// Shape required by better-auth (field names are its camelCase names), plus `role`, `disabledAt`
// the notification settings (Phase 6; the channel per notification group from brief item C) and
// the finance right (Phase 32).
export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: text('role').$type<Role>().notNull().default('client'),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    defaultGroupMode: text('default_group_mode').$type<GroupMode>(),
    /** Only the user's own choices, by notification group; a missing group uses its default. */
    notificationChannels: jsonb('notification_channels')
      .$type<Partial<ChannelMap>>()
      .notNull()
      .default({}),
    language: text('language').$type<UserLanguage>().notNull().default('sk'),
    emailFallbackAt: timestamp('email_fallback_at', { withTimezone: true }),
    /**
     * The finance right (Phase 32): when and by whom the superadmin granted it; null = none. Only
     * an admin holds it (CHECK); the superadmin has it without a row value. Deactivation clears it.
     */
    financeAccessAt: timestamp('finance_access_at', { withTimezone: true }),
    financeAccessBy: text('finance_access_by').references((): AnyPgColumn => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_role_idx').on(t.role),
    // The global search's people (2026-10-18): the folded name and the email, trigram.
    index('user_search_fold_trgm_idx').using(
      'gin',
      sql`${foldSql(sql`${t.name} || ' ' || ${t.email}`)} gin_trgm_ops`,
    ),
    check('user_role_check', sql`${t.role} in ('superadmin', 'admin', 'client')`),
    check('user_email_lower_check', sql`${t.email} = lower(${t.email})`),
    check(
      'user_default_group_mode_check',
      sql`${t.defaultGroupMode} in ('all', 'mentions', 'off')`,
    ),
    check('user_language_check', languageIn(t.language)),
    check(
      'user_finance_access_check',
      sql`${t.financeAccessAt} is null or ${t.role} in ('admin', 'superadmin')`,
    ),
  ],
);
