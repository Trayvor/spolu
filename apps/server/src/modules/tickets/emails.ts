import type { UserLanguage } from '@spolu/shared';
import type { EmailMessage } from '../../infra/email/index.js';
import { buildEmail } from '../../infra/email/layout.js';
import { serverTexts } from '../../infra/i18n/index.js';

/** The first lines of a ticket body for an email: at most 300 characters, whitespace collapsed. */
export function bodyExcerpt(body: string | null): string | null {
  if (!body) return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 300 ? `${flat.slice(0, 299)}…` : flat;
}

/**
 * "Ticket created" to the ticket's initiator (Phase 21): its number and subject, the first lines
 * of the text and a button to the ticket: a one-click sign-in link for a client (`oneClick`,
 * ADR 0020), the code login for an admin.
 */
export function ticketCreatedEmail(
  r: { to: string; lang: UserLanguage; publicUrl: string },
  p: {
    number: number;
    subject: string | null;
    excerpt: string | null;
    url: string;
    oneClick: boolean;
  },
): EmailMessage {
  const t = serverTexts(r.lang).tickets.created;
  const title = p.subject ?? t.untitled;
  return buildEmail({
    ...r,
    subject: t.subject(p.number, title),
    paragraphs: [
      t.received(p.number, title),
      ...(p.excerpt ? [p.excerpt] : []),
      p.oneClick ? t.followUpLink : t.followUp,
    ],
    button: { label: t.button, url: p.url },
  });
}
