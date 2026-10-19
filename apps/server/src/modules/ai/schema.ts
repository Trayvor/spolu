import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { languageIn } from '../../infra/db/language-check.js';
import type { UserLanguage } from '@spolu/shared';
import { messages } from '../chat/schema.js';
import { tickets } from '../tickets/schema.js';

/**
 * Translations of received texts (2026-10-19, ADR 0061): a chat message or a ticket description
 * translated into one of the UI languages, stored so the next reader with that language does not
 * call the model again. Exactly one of `messageId` and `ticketId` is set; a row goes with its
 * message or ticket (cascade), with an edit or a delete of the message (the chat's body hook) and
 * with an edit of the ticket. `sourceHash` is the SHA-256 of the text that was translated: a row
 * whose hash is not the current text's is never served (a translation that raced an edit).
 */
export const aiTranslations = pgTable(
  'ai_translations',
  {
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    ticketId: text('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }),
    language: text('language').$type<UserLanguage>().notNull(),
    sourceHash: text('source_hash').notNull(),
    /** The ISO 639-1 code the model recognised; null when it could not tell. */
    sourceLanguage: text('source_language'),
    /** The translation, or the original when it already was in `language`. */
    text: text('text').notNull(),
    /** The text already was in `language` (`text` is the original). */
    unchanged: boolean('unchanged').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ai_translations_subject_check',
      sql`(${t.messageId} is null) <> (${t.ticketId} is null)`,
    ),
    check('ai_translations_language_check', languageIn(t.language)),
    // One row per subject and language; also the index of each cascade.
    uniqueIndex('ai_translations_message_unique')
      .on(t.messageId, t.language)
      .where(sql`${t.messageId} is not null`),
    uniqueIndex('ai_translations_ticket_unique')
      .on(t.ticketId, t.language)
      .where(sql`${t.ticketId} is not null`),
  ],
);
