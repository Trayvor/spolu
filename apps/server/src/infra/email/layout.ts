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
  /**
   * More parts after the paragraphs and the button, each after a divider, with its own heading,
   * paragraphs and button: one digest email listing several tickets and groups (2026-10-18).
   */
  sections?: { heading?: string; paragraphs: string[]; button?: { label: string; url: string } }[];
  /** Lines after the system footer (the weekly summary's personal unsubscribe line). */
  footerLines?: string[];
  /** Extra headers passed to the sender (`List-Unsubscribe` of a recurring email). */
  headers?: Record<string, string>;
};

export function buildEmail(i: SystemEmail): EmailMessage {
  const block = <T extends BulkBlock['type']>(type: T, rest: object): BulkBlock =>
    ({ id: type, type, ...rest }) as BulkBlock;
  const textBlocks = (paragraphs: string[]): BulkBlock[] =>
    paragraphs.length > 0
      ? [
          block('text', {
            align: 'left',
            // One plain run a paragraph: shown as written (`literal`), no `**` or `{{name}}`.
            content: splitParagraphs(paragraphs.join('\n\n')).map((text) => ({
              type: 'paragraph',
              content: [{ text }],
            })),
          }),
        ]
      : [];
  const button = (b: { label: string; url: string } | undefined): BulkBlock[] =>
    b ? [block('button', { ...b, align: 'left' })] : [];
  const blocks: BulkBlock[] = [
    block('logo', { align: 'left' }),
    block('heading', { text: i.heading ?? i.subject, align: 'left' }),
    ...(i.code ? [block('heading', { text: i.code, align: 'left' })] : []),
    ...textBlocks(i.paragraphs),
    ...button(i.button),
    ...(i.sections ?? []).flatMap((s) => [
      block('divider', {}),
      ...(s.heading ? [block('heading', { text: s.heading, align: 'left' })] : []),
      ...textBlocks(s.paragraphs),
      ...button(s.button),
    ]),
  ];
  const { html, text } = renderEmail({
    subject: i.subject,
    preheader: '',
    blocks,
    language: i.lang,
    name: '',
    literal: true,
    footer: { lines: [...serverTexts(i.lang).email.footer, ...(i.footerLines ?? [])] },
    publicUrl: i.publicUrl,
  });
  return {
    to: [i.to],
    subject: i.subject,
    text,
    html,
    ...(i.headers ? { headers: i.headers } : {}),
  };
}
