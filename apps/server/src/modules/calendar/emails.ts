import type { UserLanguage } from '@spolu/shared';
import type { EmailMessage } from '../../infra/email/index.js';
import { buildEmail } from '../../infra/email/layout.js';
import { serverTexts } from '../../infra/i18n/index.js';

/**
 * Tells the owner that a calendar feed link was created or rotated (ADR 0051), so a link made
 * with a stolen session gets noticed. Never the link itself.
 */
export function feedCreatedEmail(r: {
  to: string;
  lang: UserLanguage;
  publicUrl: string;
}): EmailMessage {
  const t = serverTexts(r.lang).calendarFeed.createdEmail;
  return buildEmail({
    ...r,
    subject: t.subject,
    paragraphs: t.lines,
    button: { label: t.button, url: `${r.publicUrl}/settings` },
  });
}
