import type { UserLanguage } from '@spolu/shared';
import type { EmailMessage } from '../../infra/email/index.js';
import { buildEmail } from '../../infra/email/layout.js';
import { serverTexts } from '../../infra/i18n/index.js';

/**
 * Tells a token's owner that a new MCP token was made, so a token made by someone else (a
 * stolen session) is noticed. Never the token itself.
 */
export function tokenCreatedEmail(
  r: { to: string; lang: UserLanguage; publicUrl: string },
  p: { name: string; createdAt: Date },
): EmailMessage {
  const texts = serverTexts(r.lang);
  const t = texts.mcp.tokenCreated;
  const date = new Intl.DateTimeFormat(texts.intl, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Bratislava',
  }).format(p.createdAt);
  return buildEmail({
    ...r,
    subject: t.subject,
    paragraphs: [t.body({ name: p.name, date }), t.warning],
    button: { label: t.button, url: `${r.publicUrl}/settings` },
  });
}

/**
 * Tells a user that an OAuth client (a Claude custom connector) was connected to their account
 * (ADR 0034), so a connection approved with a stolen session is noticed. Never a code or token.
 */
export function connectionApprovedEmail(
  r: { to: string; lang: UserLanguage; publicUrl: string },
  p: { name: string; host: string; approvedAt: Date },
): EmailMessage {
  const texts = serverTexts(r.lang);
  const t = texts.mcp.connectionApproved;
  const date = new Intl.DateTimeFormat(texts.intl, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Bratislava',
  }).format(p.approvedAt);
  return buildEmail({
    ...r,
    subject: t.subject,
    paragraphs: [t.body({ name: p.name, host: p.host, date }), t.warning],
    button: { label: t.button, url: `${r.publicUrl}/settings` },
  });
}
