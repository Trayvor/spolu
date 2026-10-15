import type { EmailMessage } from '../../infra/email/index.js';
import type { EmailLanguage } from './language.js';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Builds the message from plain-text paragraphs; the HTML part escapes every one. */
function message(to: string, subject: string, paragraphs: string[]): EmailMessage {
  return {
    to: [to],
    subject,
    text: paragraphs.join('\n\n'),
    html: paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n'),
  };
}

export function loginCodeEmail(to: string, code: string, lang: EmailLanguage): EmailMessage {
  return lang === 'en'
    ? message(to, `Your Spolu login code: ${code}`, [
        `Your login code is ${code}. It is valid for 5 minutes. If you did not ask for it, ignore this email.`,
      ])
    : message(to, `Váš prihlasovací kód do Spolu: ${code}`, [
        `Váš prihlasovací kód je ${code}. Platí 5 minút. Ak ste oň nežiadali, tento e-mail ignorujte.`,
      ]);
}

export function adminAddedEmail(
  to: string,
  p: { name: string; addedBy: string; loginUrl: string },
  lang: EmailLanguage,
): EmailMessage {
  return lang === 'en'
    ? message(to, 'You were added to Spolu', [
        `Hello ${p.name},`,
        `${p.addedBy} added you as an administrator of Spolu by eGrant. Log in with your email ${to}: ${p.loginUrl}`,
      ])
    : message(to, 'Pridali vás do Spolu', [
        `Dobrý deň, ${p.name},`,
        `${p.addedBy} vás pridal(a) ako administrátora v Spolu by eGrant. Prihláste sa svojím e-mailom ${to}: ${p.loginUrl}`,
      ]);
}
