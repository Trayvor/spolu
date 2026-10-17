import { splitParagraphs, type BulkBlock, type UserLanguage } from '@spolu/shared';
import { serverTexts } from '../i18n/index.js';
import type { EmailMessage } from './email.js';
import { renderEmail } from './render.js';

/**
 * A system email (login and email-change codes, invites, notification digests, tickets) in the
 * one email design (`render.ts`, the same as bulk emails): the logo, a heading, an optional code,
 * plain-text paragraphs and at most one button, with the system footer in `lang`.
 *
 * Kept simple for deliverability: no tracking, no images but the logo, no unsubscribe link or
 * List-Unsubscribe header (transactional mail), and a plain-text part. Texts are shown as written
 * (no `{{name}}` or `**bold**`); http(s) links in them become clickable.
 */
export type SystemEmail = {
  to: string;
  lang: UserLanguage;
  /** The app's origin, for the logo. */
  publicUrl: string;
  subject: string;
  /** The heading; the subject when left out. */
  heading?: string;
  /** A one-time code, shown large under the heading. */
  code?: string;
  paragraphs: string[];
  button?: { label: string; url: string };
};

export function buildEmail(i: SystemEmail): EmailMessage {
  const block = <T extends BulkBlock['type']>(type: T, rest: object): BulkBlock =>
    ({ id: type, type, ...rest }) as BulkBlock;
  const blocks: BulkBlock[] = [
    block('logo', { align: 'left' }),
    block('heading', { text: i.heading ?? i.subject, align: 'left' }),
    ...(i.code ? [block('heading', { text: i.code, align: 'left' })] : []),
    ...(i.paragraphs.length > 0
      ? [
          block('text', {
            align: 'left',
            // One plain run a paragraph: shown as written (`literal`), no `**` or `{{name}}`.
            content: splitParagraphs(i.paragraphs.join('\n\n')).map((text) => ({
              type: 'paragraph',
              content: [{ text }],
            })),
          }),
        ]
      : []),
    ...(i.button ? [block('button', { ...i.button, align: 'left' })] : []),
  ];
  const { html, text } = renderEmail({
    subject: i.subject,
    preheader: '',
    blocks,
    language: i.lang,
    name: '',
    literal: true,
    footer: { lines: serverTexts(i.lang).email.footer },
    publicUrl: i.publicUrl,
  });
  return { to: [i.to], subject: i.subject, text, html };
}
