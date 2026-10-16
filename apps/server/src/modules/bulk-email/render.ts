import { isHttpUrl, type BulkAlign, type BulkBlock, type UserLanguage } from '@spolu/shared';
import { BULK_FOOTER } from './texts.js';

/**
 * The bulk email renderer (spec §3): blocks → table-based HTML for old mail apps (Outlook,
 * Gmail, Apple Mail) plus a plain-text part. Pure and deterministic: the preview, the test send
 * and the real send all call it, so what the admin sees is what is sent, and a retried send
 * renders the same body (Elastic's idempotency key needs the same body).
 *
 * Safety: every text the admin or the recipient's name brings is HTML-escaped; links are only
 * http(s) (and `mailto:` on buttons), re-checked here even though the shared schema already
 * rejects anything else; there is no raw HTML, no script, no form. Only `{{name}}` in headings
 * and texts is replaced.
 */

/** The eGrant logo PNG served by the web app's static files (SVG is not shown by Gmail/Outlook). */
export const LOGO_PATH = '/brand/egrant-logo-email.png';
/** The logo as shown: half of the 360×68 PNG, for sharp rendering on high-density screens. */
const LOGO = { width: 180, height: 34 };

/** The public URL of an uploaded image (`GET /api/bulk-email/images/:id`, no session). */
export function imageUrl(publicUrl: string, imageId: string): string {
  return `${trimSlash(publicUrl)}/api/bulk-email/images/${encodeURIComponent(imageId)}`;
}

export type RenderInput = {
  subject: string;
  preheader: string;
  blocks: BulkBlock[];
  recipient: { name: string; language: UserLanguage };
  /** Already wrapped by the bulk sender (`unsubscribeHref`), e.g. `{unsubscribe:<url>}`. */
  unsubscribeHref: string;
  /** For image and logo URLs. */
  publicUrl: string;
  /**
   * Stored sizes of uploaded images by id (from `bulk_images`). Optional: without a size an
   * image is shown at the column width.
   */
  imageSizes?: ReadonlyMap<string, { width: number; height: number }>;
};

// egrant.sk tokens (docs/design/tokens.md). Mail apps cannot load Saans, so the stack falls
// back to the system and web-safe fonts.
const C = {
  base: '#F5F3F1',
  surface: '#FFFFFF',
  ink: '#141414',
  muted: '#6B6B6B',
  line: '#E3DEDA',
};
const FONT = `'Saans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const WIDTH = 600;
const PAD = 40;
/** The width of the content column inside the card. */
const COLUMN = WIDTH - 2 * PAD;

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const TEXT_STYLE = `font-family:${FONT};font-size:16px;line-height:26px;font-weight:500;letter-spacing:0.2px;color:${C.ink}`;
const LINK_STYLE = `color:${C.ink};text-decoration:underline`;

const NAME = '{{name}}';
/** A URL in a text; trailing punctuation is cut off afterwards. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g;
const TRAILING = /[.,;:!?)\]}]+$/;

export function renderCampaign(input: RenderInput): { html: string; text: string } {
  const ctx = { ...input, publicUrl: trimSlash(input.publicUrl) };
  return { html: renderHtml(ctx), text: renderText(ctx) };
}

// ---------------------------------------------------------------- HTML

function renderHtml(i: RenderInput): string {
  const { language } = i.recipient;
  const footer = BULK_FOOTER[language];
  const rows = i.blocks.map((block, n) => {
    const last = n === i.blocks.length - 1;
    return `<tr><td${blockCell(block)} style="padding:0 0 ${last ? 0 : 24}px 0">${renderBlock(block, i)}</td></tr>`;
  });

  return [
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
    `<html xmlns="http://www.w3.org/1999/xhtml" lang="${language}">`,
    '<head>',
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<meta name="x-apple-disable-message-reformatting" />',
    `<title>${esc(i.subject)}</title>`,
    // The only CSS outside inline styles: the phone layout. Clients that drop it keep 600 px.
    '<style type="text/css">@media (max-width: 620px) { .sp-container { width:100% !important; } .sp-card { padding:28px 20px !important; } .sp-footer { padding:20px 20px 0 20px !important; } }</style>',
    '</head>',
    `<body style="margin:0;padding:0;background-color:${C.base};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">`,
    preheader(i.preheader),
    `<table ${TABLE} width="100%" bgcolor="${C.base}" style="background-color:${C.base}">`,
    '<tr><td align="center" style="padding:32px 12px">',
    `<table ${TABLE} class="sp-container" width="${WIDTH}" style="width:${WIDTH}px;max-width:${WIDTH}px">`,
    `<tr><td class="sp-card" bgcolor="${C.surface}" style="background-color:${C.surface};border-radius:16px;padding:${PAD}px">`,
    `<table ${TABLE} width="100%">`,
    ...rows,
    '</table>',
    '</td></tr>',
    `<tr><td class="sp-footer" style="padding:24px ${PAD}px 0 ${PAD}px;font-family:${FONT};font-size:13px;line-height:20px;font-weight:500;letter-spacing:0.25px;color:${C.muted}">`,
    `${esc(footer.reason)}<br />`,
    `<a href="${esc(i.unsubscribeHref)}" target="_blank" style="color:${C.muted};text-decoration:underline">${esc(footer.unsubscribe)}</a>`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

/** The hidden preview line mail apps show next to the subject; padded so no body text leaks in. */
function preheader(text: string): string {
  if (!text) return '';
  const filler = '&#847;&zwnj;&nbsp;'.repeat(40);
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.base};opacity:0">${esc(text)}${filler}</div>`;
}

/** The `align` attribute of a block's cell (Outlook reads the attribute, not CSS). */
function blockCell(block: BulkBlock): string {
  return 'align' in block ? ` align="${block.align}"` : '';
}

function renderBlock(block: BulkBlock, i: RenderInput): string {
  switch (block.type) {
    case 'heading':
      return `<h1 style="margin:0;font-family:${FONT};font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.2px;color:${C.ink};text-align:${block.align}">${personalize(block.text, i.recipient.name, esc, esc)}</h1>`;
    case 'text':
      return paragraphs(block.text)
        .map((p, n, all) => {
          const margin = n === all.length - 1 ? 0 : 16;
          return `<p style="margin:0 0 ${margin}px 0;${TEXT_STYLE};text-align:${block.align}">${inlineHtml(p, i.recipient.name)}</p>`;
        })
        .join('\n');
    case 'image':
      return image(block, i);
    case 'button':
      return button(block.label, block.url, block.align);
    case 'divider':
      return `<table ${TABLE} width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;background-color:${C.line}">&nbsp;</td></tr></table>`;
    case 'logo':
      return `<img src="${esc(i.publicUrl + LOGO_PATH)}" width="${LOGO.width}" height="${LOGO.height}" alt="eGrant" style="${imgStyle(block.align, LOGO.width)}" />`;
  }
}

function image(block: Extract<BulkBlock, { type: 'image' }>, i: RenderInput): string {
  const size = i.imageSizes?.get(block.imageId);
  const width = size ? Math.min(size.width, COLUMN) : COLUMN;
  const height = size ? ` height="${Math.round((size.height * width) / size.width)}"` : '';
  const img = `<img src="${esc(imageUrl(i.publicUrl, block.imageId))}" width="${width}"${height} alt="${esc(block.alt)}" style="${imgStyle('center', width)}" />`;
  if (!block.href || !isHttpUrl(block.href)) return img;
  return `<a href="${esc(block.href)}" target="_blank" style="text-decoration:none">${img}</a>`;
}

function imgStyle(align: BulkAlign, width: number): string {
  const margin = align === 'center' ? '0 auto' : '0';
  return `display:block;margin:${margin};width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none`;
}

/** A "bulletproof" button: a coloured table cell with a padded link, works without CSS in Outlook. */
function button(label: string, url: string, align: BulkAlign): string {
  const link = `font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;letter-spacing:0.2px;color:${C.surface};text-decoration:none`;
  const inner = isSafeButtonUrl(url)
    ? `<a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 24px;${link};border-radius:80px">${esc(label)}</a>`
    : `<span style="display:inline-block;padding:12px 24px;${link}">${esc(label)}</span>`;
  return [
    `<table ${TABLE} align="${align === 'center' ? 'center' : 'left'}">`,
    '<tr>',
    `<td align="center" bgcolor="${C.ink}" style="background-color:${C.ink};border-radius:80px">${inner}</td>`,
    '</tr>',
    '</table>',
  ].join('\n');
}

/** Text with `**bold**`, http(s) links and `{{name}}`, as safe HTML. */
function inlineHtml(paragraph: string, name: string): string {
  return paragraph
    .split('\n')
    .map((line) =>
      splitBold(line)
        .map(({ text, bold }) => {
          const html = personalize(text, name, linkify, esc);
          return bold ? `<strong style="font-weight:600">${html}</strong>` : html;
        })
        .join(''),
    )
    .join('<br />');
}

function linkify(text: string): string {
  let out = '';
  let at = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = match[0].replace(TRAILING, '');
    const start = match.index;
    if (!isHttpUrl(url)) continue;
    out += esc(text.slice(at, start));
    out += `<a href="${esc(url)}" target="_blank" style="${LINK_STYLE}">${esc(url)}</a>`;
    at = start + url.length;
  }
  return out + esc(text.slice(at));
}

// ---------------------------------------------------------------- text part

function renderText(i: RenderInput): string {
  const footer = BULK_FOOTER[i.recipient.language];
  const parts = i.blocks.flatMap((block): string[] => {
    switch (block.type) {
      case 'heading':
        return [personalize(block.text, i.recipient.name).toLocaleUpperCase(i.recipient.language)];
      case 'text':
        return paragraphs(block.text).map((p) =>
          splitBold(p)
            .map((s) => personalize(s.text, i.recipient.name))
            .join(''),
        );
      case 'image':
        return [`[${block.alt}]`];
      case 'button':
        return [`${block.label}: ${block.url}`];
      case 'divider':
        return ['---'];
      case 'logo':
        return [];
    }
  });
  parts.push('---', `${footer.reason}\n${footer.unsubscribe}: ${i.unsubscribeHref}`);
  return parts.filter((p) => p.trim() !== '').join('\n\n');
}

// ---------------------------------------------------------------- helpers

/** Paragraphs split on a blank line; empty ones dropped; `\r\n` normalised. */
function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '');
}

/** `a **b** c` → plain, bold, plain. An unclosed `**` stays as written. */
function splitBold(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), bold: false });
    out.push({ text: m[1]!, bold: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), bold: false });
  return out;
}

/**
 * Replaces `{{name}}`. `format` turns the pieces around it into output (escaped text, or text
 * with links) and `formatName` the name, which is only ever escaped: markup in a name never
 * becomes bold or a link.
 */
function personalize(
  text: string,
  name: string,
  format: (s: string) => string = identity,
  formatName: (s: string) => string = identity,
): string {
  return text
    .split(NAME)
    .map((piece) => format(piece))
    .join(formatName(name));
}

const identity = (s: string): string => s;

function isSafeButtonUrl(url: string): boolean {
  return isHttpUrl(url) || /^mailto:[^\s]+$/i.test(url);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
