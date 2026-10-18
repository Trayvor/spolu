import type { EmailMessage } from '../../infra/email/index.js';
import { buildEmail } from '../../infra/email/layout.js';
import { serverTexts } from '../../infra/i18n/index.js';
import type { EmailLanguage } from './language.js';

/**
 * Who gets a system email and how: the address, the language of the texts (the recipient's
 * stored language, else the request's) and the app's origin (for the logo).
 */
export type Recipient = { to: string; lang: EmailLanguage; publicUrl: string };

const auth = (lang: EmailLanguage) => serverTexts(lang).auth;

export function loginCodeEmail(r: Recipient, code: string): EmailMessage {
  const t = auth(r.lang).loginCode;
  return buildEmail({
    ...r,
    subject: t.subject(code),
    heading: t.heading,
    code,
    paragraphs: [t.body],
  });
}

export function adminAddedEmail(
  r: Recipient,
  p: { name: string; addedBy: string; loginUrl: string },
): EmailMessage {
  const t = auth(r.lang).adminAdded;
  return buildEmail({
    ...r,
    subject: t.subject,
    paragraphs: [t.greeting(p.name), t.body({ addedBy: p.addedBy, email: r.to })],
    button: { label: t.button, url: p.loginUrl },
  });
}

/** An admin invited a person who has not signed in yet to a group (Phase 22b). */
export function memberInvitedEmail(
  r: Recipient,
  p: { groupName: string; invitedBy: string; loginUrl: string },
): EmailMessage {
  const t = auth(r.lang).memberInvited;
  return buildEmail({
    ...r,
    subject: t.subject(p.groupName),
    paragraphs: [t.body({ invitedBy: p.invitedBy, groupName: p.groupName, email: r.to })],
    button: { label: t.button, url: p.loginUrl },
  });
}

/** An admin added a signed-in client to one more group (Phase 22b). */
export function memberAddedEmail(
  r: Recipient,
  p: { groupName: string; addedBy: string; groupUrl: string },
): EmailMessage {
  const t = auth(r.lang).memberAdded;
  return buildEmail({
    ...r,
    subject: t.subject(p.groupName),
    paragraphs: [t.body({ addedBy: p.addedBy, groupName: p.groupName })],
    button: { label: t.button, url: p.groupUrl },
  });
}

/** The code that confirms a new email address; sent to that new address. */
export function emailChangeCodeEmail(r: Recipient, code: string): EmailMessage {
  const t = auth(r.lang).emailChangeCode;
  return buildEmail({
    ...r,
    subject: t.subject(code),
    heading: t.heading,
    code,
    paragraphs: [t.body(r.to)],
  });
}

/** Tells the old address that the account's email changed. */
export function emailChangedNoticeEmail(r: Recipient, newEmail: string): EmailMessage {
  const t = auth(r.lang).emailChanged;
  return buildEmail({ ...r, subject: t.subject, paragraphs: [t.body(newEmail), t.warning] });
}

/** The code that re-checks a stale session before a passkey is added (ADR 0050). */
export function passkeyCodeEmail(r: Recipient, code: string): EmailMessage {
  const t = auth(r.lang).passkeyCode;
  return buildEmail({
    ...r,
    subject: t.subject(code),
    heading: t.heading,
    code,
    paragraphs: [t.body],
  });
}

/**
 * Tells an admin that a passkey was added to their account (ADR 0050), so one added with a
 * stolen session is noticed, as the MCP token notice does. Never anything of the key itself.
 */
export function passkeyAddedEmail(
  r: Recipient,
  p: { name: string; createdAt: Date },
): EmailMessage {
  const texts = serverTexts(r.lang);
  const t = texts.auth.passkeyAdded;
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
