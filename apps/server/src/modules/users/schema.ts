import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { GroupMode, Role, UserLanguage } from '@spolu/shared';

// Shape required by better-auth (field names are its camelCase names), plus `role`, `disabledAt`
// and the Phase 6 notification settings.
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
    pushEnabled: boolean('push_enabled').notNull().default(true),
    emailEnabled: boolean('email_enabled').notNull().default(false),
    language: text('language').$type<UserLanguage>().notNull().default('sk'),
    emailFallbackAt: timestamp('email_fallback_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_role_idx').on(t.role),
    check('user_role_check', sql`${t.role} in ('superadmin', 'admin', 'client')`),
    check('user_email_lower_check', sql`${t.email} = lower(${t.email})`),
    check(
      'user_default_group_mode_check',
      sql`${t.defaultGroupMode} in ('all', 'mentions', 'off')`,
    ),
    check('user_language_check', sql`${t.language} in ('sk', 'en')`),
  ],
);
