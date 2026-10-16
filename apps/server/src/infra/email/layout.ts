import type { EmailMessage } from './email.js';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** The egrant primary button (ink on white text), inline styles because email clients drop CSS. */
const BUTTON_STYLE =
  'display:inline-block;padding:10px 20px;background:#141414;color:#ffffff;' +
  'text-decoration:none;border-radius:6px;font-weight:600';

/**
 * Builds a message from plain-text paragraphs; the HTML part escapes every one. A button adds
 * `label: url` to the text part and an `<a>` styled as the primary button to the HTML part.
 */
export function buildEmail(i: {
  to: string;
  subject: string;
  paragraphs: string[];
  button?: { label: string; url: string };
}): EmailMessage {
  const text = i.paragraphs.join('\n\n');
  const html = i.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  if (!i.button) return { to: [i.to], subject: i.subject, text, html };
  const { label, url } = i.button;
  return {
    to: [i.to],
    subject: i.subject,
    text: `${text}\n\n${label}: ${url}`,
    html: `${html}\n<p><a href="${escapeHtml(url)}" style="${BUTTON_STYLE}">${escapeHtml(label)}</a></p>`,
  };
}
