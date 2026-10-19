import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { IncomingTranslation, UserLanguage } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { onMessageBodyChange } from '../chat/body-hooks.js';
import { onTicketChange } from '../tickets/hooks.js';
import { aiTranslations } from './schema.js';

// 2026-10-19 (ADR 0061): the stored translations of received messages and ticket descriptions.

/** What was translated: a chat message or a ticket's description. */
export type TranslationSubject = { messageId: string } | { ticketId: string };

/** The SHA-256 of the translated text: a stored row is served only while the text is the same. */
export const sourceHash = (text: string): string => createHash('sha256').update(text).digest('hex');

const subjectIs = (subject: TranslationSubject) =>
  'messageId' in subject
    ? eq(aiTranslations.messageId, subject.messageId)
    : eq(aiTranslations.ticketId, subject.ticketId);

/** The stored translation of this very text into `language`, else null (one index lookup). */
export async function storedTranslation(
  db: Db,
  subject: TranslationSubject,
  language: UserLanguage,
  hash: string,
): Promise<IncomingTranslation | null> {
  const [row] = await db
    .select({
      text: aiTranslations.text,
      sourceLanguage: aiTranslations.sourceLanguage,
      unchanged: aiTranslations.unchanged,
    })
    .from(aiTranslations)
    .where(
      and(
        subjectIs(subject),
        eq(aiTranslations.language, language),
        eq(aiTranslations.sourceHash, hash),
      ),
    );
  return row ? { ...row, targetLanguage: language } : null;
}

/** Stores a translation, replacing the subject's older one in that language. */
export async function storeTranslation(
  db: Db,
  subject: TranslationSubject,
  hash: string,
  translation: IncomingTranslation & { targetLanguage: UserLanguage },
): Promise<void> {
  const values = {
    sourceHash: hash,
    sourceLanguage: translation.sourceLanguage,
    text: translation.text,
    unchanged: translation.unchanged,
    createdAt: sql`now()`,
  };
  const isMessage = 'messageId' in subject;
  await db
    .insert(aiTranslations)
    .values({ ...subject, language: translation.targetLanguage, ...values })
    .onConflictDoUpdate({
      target: isMessage
        ? [aiTranslations.messageId, aiTranslations.language]
        : [aiTranslations.ticketId, aiTranslations.language],
      targetWhere: isMessage
        ? sql`${aiTranslations.messageId} is not null`
        : sql`${aiTranslations.ticketId} is not null`,
      set: values,
    });
}

async function forgetMessage(tx: Db, messageId: string): Promise<void> {
  await tx.delete(aiTranslations).where(eq(aiTranslations.messageId, messageId));
}

/**
 * Drops the stored translations of a message when it is edited or deleted (inside that
 * transaction) and of a ticket when its content changes. Call once at start-up.
 */
export function registerTranslationHooks(): void {
  onMessageBodyChange(forgetMessage);
  onTicketChange(forgetTicket);
}

async function forgetTicket(
  deps: { db: Db },
  change: { kind: string; ticket: { id: string } },
): Promise<void> {
  if (change.kind !== 'updated') return;
  await deps.db.delete(aiTranslations).where(eq(aiTranslations.ticketId, change.ticket.id));
}
