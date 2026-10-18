import type { EmailMessage } from '../../infra/email/index.js';
import { buildEmail } from '../../infra/email/layout.js';
import { serverTexts } from '../../infra/i18n/index.js';
import type { Recipient } from '../auth/emails.js';

/** eGrant's managers webhook made an admin a manager of a client: the button opens the client. */
export function managerAddedEmail(
  r: Recipient,
  p: { groupName: string; groupUrl: string },
): EmailMessage {
  const t = serverTexts(r.lang).groups.managerAdded;
  return buildEmail({
    ...r,
    subject: t.subject(p.groupName),
    paragraphs: [t.body(p.groupName)],
    button: { label: t.button, url: p.groupUrl },
  });
}
