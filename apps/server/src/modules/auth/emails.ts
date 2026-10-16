import type { EmailMessage } from '../../infra/email/index.js';
import { buildEmail } from '../../infra/email/layout.js';
import type { EmailLanguage } from './language.js';

const message = (to: string, subject: string, paragraphs: string[]): EmailMessage =>
  buildEmail({ to, subject, paragraphs });

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

/** The code that confirms a new email address; sent to that new address. */
export function emailChangeCodeEmail(to: string, code: string, lang: EmailLanguage): EmailMessage {
  return lang === 'en'
    ? message(to, `Your Spolu email change code: ${code}`, [
        `Your code is ${code}. Enter it in Spolu to change your email to ${to}. It is valid for 5 minutes. If you did not ask for it, ignore this email.`,
      ])
    : message(to, `Kód na zmenu e-mailu v Spolu: ${code}`, [
        `Váš kód je ${code}. Zadajte ho v Spolu a váš e-mail sa zmení na ${to}. Platí 5 minút. Ak ste oň nežiadali, tento e-mail ignorujte.`,
      ]);
}

/** Tells the old address that the account's email changed. */
export function emailChangedNoticeEmail(
  to: string,
  newEmail: string,
  lang: EmailLanguage,
): EmailMessage {
  return lang === 'en'
    ? message(to, 'Your Spolu email was changed', [
        `The email of your Spolu account was changed to ${newEmail}. From now on, log in with the new address.`,
        'If you did not do this, contact your administrator at once.',
      ])
    : message(to, 'Váš e-mail v Spolu bol zmenený', [
        `E-mail vášho účtu v Spolu bol zmenený na ${newEmail}. Odteraz sa prihlasujte novou adresou.`,
        'Ak ste to neboli vy, ihneď kontaktujte svojho administrátora.',
      ]);
}
