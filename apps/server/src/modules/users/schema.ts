import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Role } from '@spolu/shared';

// Shape required by better-auth (field names are its camelCase names), plus `role` and `disabledAt`.
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_role_idx').on(t.role),
    check('user_role_check', sql`${t.role} in ('superadmin', 'admin', 'client')`),
    check('user_email_lower_check', sql`${t.email} = lower(${t.email})`),
  ],
);
