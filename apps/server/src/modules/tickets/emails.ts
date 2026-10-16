import type { EmailMessage } from '../../infra/email/index.js';
import { buildEmail } from '../../infra/email/layout.js';
import type { UserLanguage } from '@spolu/shared';

/** The first lines of a ticket body for an email: at most 300 characters, whitespace collapsed. */
export function bodyExcerpt(body: string | null): string | null {
  if (!body) return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 300 ? `${flat.slice(0, 299)}…` : flat;
}

/**
 * "Ticket created" to the ticket's initiator (Phase 21): its number and subject, the first lines
 * of the text and a button to the ticket, which goes through the code login.
 */
export function ticketCreatedEmail(
  to: string,
  p: { number: number; subject: string | null; excerpt: string | null; url: string },
  lang: UserLanguage,
): EmailMessage {
  const title = p.subject ?? (lang === 'en' ? 'your request' : 'vaša požiadavka');
  return lang === 'en'
    ? buildEmail({
        to,
        subject: `Ticket #${p.number} created: ${title}`,
        paragraphs: [
          `We received your support ticket #${p.number}: ${title}.`,
          ...(p.excerpt ? [p.excerpt] : []),
          'You can follow it and write to eGrant in the Help app. Log in with this email address; we will send you a code.',
        ],
        button: { label: 'Open the ticket', url: p.url },
      })
    : buildEmail({
        to,
        subject: `Tiket #${p.number} bol vytvorený: ${title}`,
        paragraphs: [
          `Prijali sme váš tiket technickej podpory #${p.number}: ${title}.`,
          ...(p.excerpt ? [p.excerpt] : []),
          'V aplikácii Help ho môžete sledovať a písať eGrantu. Prihláste sa touto e-mailovou adresou, pošleme vám kód.',
        ],
        button: { label: 'Otvoriť tiket', url: p.url },
      });
}
