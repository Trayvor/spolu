import { pgTable, text } from 'drizzle-orm/pg-core';

// Technical table that proves migrations work; not a product entity.
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
