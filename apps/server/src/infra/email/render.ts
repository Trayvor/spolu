import {
  BulkPalette,
  BulkLineColors,
  BulkTextColors,
  isBulkLinkUrl,
  isHttpUrl,
  type BulkAlign,
  type BulkBlock,
  type BulkInline,
  type BulkLeafBlock,
  type BulkTextNode,
  type UserLanguage,
} from '@spolu/shared';

/**
 * The one email design (docs/architecture/email.md): blocks → table-based HTML for old mail
 * apps (Outlook, Gmail, Apple Mail) plus a plain-text part. Bulk emails render the admin's
 * blocks (`modules/bulk-email/render.ts`); system emails (codes, invites, digests, tickets)
 * render a few fixed blocks through `buildEmail` (`layout.ts`), so both look the same.
 * Pure and deterministic: the preview, the test send and the real send all call it, and a
 * retried send renders the same body (Elastic's idempotency key needs the same body).
 *
 * Safety: every text is HTML-escaped; links are only http(s) (and `mailto:` on buttons and in
 * texts), re-checked here even though the shared schema already rejects anything else; colours,
 * shapes, sizes and node types are looked up in fixed tables, never copied from the input; there
 * is no raw HTML, no script, no form. Only `{{name}}` in headings and texts is replaced, and
 * nothing at all in `literal` emails.
 *
 * Phase 30 (builder v2): formatted text, image size/alignment/shape, spacer, the split container
 * and a phone version. Blocks without the new options render byte for byte as in Phase 23
 * (`render-compat.test.ts`), and the extra CSS is only added when an email needs it.
 */

/** The eGrant logo PNG served by the web app's static files (SVG is not shown by Gmail/Outlook). */
export const LOGO_PATH = '/brand/egrant-logo-email.png';
/** The logo as shown: half of the 360×68 PNG, for sharp rendering on high-density screens. */
const LOGO = { width: 180, height: 34 };

/** The small print under the card: lines of text, then an optional link (the unsubscribe). */
export type EmailFooter = { lines: string[]; link?: { label: string; href: string } };

export type EmailRenderInput = {
  subject: string;
  preheader: string;
  /** The desktop version (the only one of system emails). */
  blocks: BulkBlock[];
  /**
   * The phone version (Phase 30): shown instead of `blocks` on screens up to 600 px. Left out
   * or `null`: the phone follows the desktop version and the blocks are rendered once.
   */
  phoneBlocks?: BulkBlock[] | null;
  /** The `lang` of the HTML and the casing of headings in the text part. */
  language: UserLanguage;
  /** What `{{name}}` becomes (bulk emails). */
  name: string;
  /**
   * System emails: texts are shown as written, since names and group names may hold `**` or
   * `{{name}}`; http(s) links are still made clickable.
   */
  literal?: boolean;
  footer: EmailFooter;
  /** For the logo URL. */
  publicUrl: string;
  /** The public URL of an uploaded image (bulk emails); without it image blocks are left out. */
  imageUrl?: (imageId: string) => string;
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
/** Space between a split container's columns and its divider, each side. */
const GAP = 12;

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const TEXT_STYLE = `font-family:${FONT};font-size:16px;line-height:26px;font-weight:500;letter-spacing:0.2px;color:${C.ink}`;
const LINK_STYLE = `color:${C.ink};text-decoration:underline`;

/** The phone layout of the card (Phase 23). Clients that drop it keep 600 px. */
const CARD_CSS =
  '@media (max-width: 620px) { .sp-container { width:100% !important; } .sp-card { padding:28px 20px !important; } .sp-footer { padding:20px 20px 0 20px !important; } }';
/** Split containers stack, left first, on phones (Phase 30). */
const COLUMNS_CSS =
  '.sp-col { display:block !important; width:100% !important; max-width:100% !important; } .sp-col-r { padding-top:24px !important; } .sp-gap { display:none !important; width:0 !important; }';
/** A separate phone version replaces the desktop one on phones (Phase 30). */
const PHONE_CSS =
  '.sp-desktop { display:none !important; } .sp-phone { display:block !important; max-height:none !important; overflow:visible !important; }';

const NAME = '{{name}}';
/** A URL in a text; trailing punctuation is cut off afterwards. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g;
const TRAILING = /[.,;:!?)\]}]+$/;

const ALIGNS: readonly BulkAlign[] = ['left', 'center', 'right'];
const VALIGNS = ['top', 'middle', 'bottom'] as const;
const RADIUS = { rounded: '8px', roundedLarge: '24px', circle: '50%' } as const;
const SPACER = { small: 16, medium: 32, large: 48 } as const;
const HEADINGS = {
  h2: 'font-size:22px;line-height:28px',
  h3: 'font-size:18px;line-height:24px',
} as const;

const alignOf = (value: unknown, fallback: BulkAlign): BulkAlign =>
  ALIGNS.includes(value as BulkAlign) ? (value as BulkAlign) : fallback;
const textColor = (key: unknown): string | undefined =>
  (BulkTextColors as readonly unknown[]).includes(key)
    ? BulkPalette[key as keyof typeof BulkPalette]
    : undefined;
const lineColor = (key: unknown): string =>
  (BulkLineColors as readonly unknown[]).includes(key)
    ? BulkPalette[key as keyof typeof BulkPalette]
    : BulkPalette.line;

export function renderEmail(input: EmailRenderInput): { html: string; text: string } {
  const ctx = { ...input, publicUrl: trimSlash(input.publicUrl) };
  return { html: renderHtml(ctx), text: renderText(ctx) };
}

// ---------------------------------------------------------------- HTML

function renderHtml(i: EmailRenderInput): string {
  const { language, footer } = i;
  const phone = Array.isArray(i.phoneBlocks) ? i.phoneBlocks : null;
  const hasColumns = [...i.blocks, ...(phone ?? [])].some((b) => b.type === 'columns');
  const extraCss = [hasColumns ? COLUMNS_CSS : '', phone ? PHONE_CSS : '']
    .filter(Boolean)
    .join(' ');
  const css = extraCss ? `${CARD_CSS} @media (max-width: 600px) { ${extraCss} }` : CARD_CSS;
  const card = phone
    ? [
        '<div class="sp-desktop">',
        ...rowsTable(i.blocks, i, COLUMN),
        '</div>',
        // Outlook for Windows never sees the phone version; other clients without media queries
        // keep it hidden by the inline style.
        '<!--[if !mso]><!-->',
        '<div class="sp-phone" style="display:none;max-height:0;overflow:hidden;mso-hide:all">',
        ...rowsTable(phone, i, COLUMN),
        '</div>',
        '<!--<![endif]-->',
      ]
    : rowsTable(i.blocks, i, COLUMN);
  const small = [
    ...footer.lines.map(esc),
    ...(footer.link
      ? [
          `<a href="${esc(footer.link.href)}" target="_blank" style="color:${C.muted};text-decoration:underline">${esc(footer.link.label)}</a>`,
        ]
      : []),
  ];

  return [
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
    `<html xmlns="http://www.w3.org/1999/xhtml" lang="${language}">`,
    '<head>',
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<meta name="x-apple-disable-message-reformatting" />',
    `<title>${esc(i.subject)}</title>`,
    // The only CSS outside inline styles: the phone layout. Clients that drop it keep 600 px.
    `<style type="text/css">${css}</style>`,
    '</head>',
    `<body style="margin:0;padding:0;background-color:${C.base};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">`,
    preheader(i.preheader),
    `<table ${TABLE} width="100%" bgcolor="${C.base}" style="background-color:${C.base}">`,
    '<tr><td align="center" style="padding:32px 12px">',
    `<table ${TABLE} class="sp-container" width="${WIDTH}" style="width:${WIDTH}px;max-width:${WIDTH}px">`,
    `<tr><td class="sp-card" bgcolor="${C.surface}" style="background-color:${C.surface};border-radius:16px;padding:${PAD}px">`,
    ...card,
    '</td></tr>',
    `<tr><td class="sp-footer" style="padding:24px ${PAD}px 0 ${PAD}px;font-family:${FONT};font-size:13px;line-height:20px;font-weight:500;letter-spacing:0.25px;color:${C.muted}">`,
    small.join('<br />\n'),
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

/** The blocks as one full-width table, a row each, 24 px apart; `width` is the column width. */
function rowsTable(blocks: readonly BulkBlock[], i: EmailRenderInput, width: number): string[] {
  const shown = blocks.filter((block) => block.type !== 'image' || i.imageUrl);
  const rows = shown.map((block, n) => {
    const last = n === shown.length - 1;
    return `<tr><td${blockCell(block)} style="padding:0 0 ${last ? 0 : 24}px 0">${renderBlock(block, i, width)}</td></tr>`;
  });
  return [`<table ${TABLE} width="100%">`, ...rows, '</table>'];
}

/** The hidden preview line mail apps show next to the subject; padded so no body text leaks in. */
function preheader(text: string): string {
  if (!text) return '';
  const filler = '&#847;&zwnj;&nbsp;'.repeat(40);
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.base};opacity:0">${esc(text)}${filler}</div>`;
}

/** The `align` attribute of a block's cell (Outlook reads the attribute, not CSS). */
function blockCell(block: BulkBlock): string {
  if (!('align' in block) || block.align === undefined) return '';
  return ` align="${alignOf(block.align, 'left')}"`;
}

function renderBlock(block: BulkBlock, i: EmailRenderInput, width: number): string {
  switch (block.type) {
    case 'heading':
      return `<h1 style="margin:0;font-family:${FONT};font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.2px;color:${C.ink};text-align:${alignOf(block.align, 'left')}">${i.literal ? esc(block.text) : personalize(block.text, i.name, esc, esc)}</h1>`;
    case 'text':
      return textHtml(block.content, alignOf(block.align, 'left'), i);
    case 'image':
      return image(block, i, width);
    case 'button':
      return button(block.label, block.url, alignOf(block.align, 'left'));
    case 'divider':
      return `<table ${TABLE} width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;background-color:${C.line}">&nbsp;</td></tr></table>`;
    case 'logo':
      return `<img src="${esc(i.publicUrl + LOGO_PATH)}" width="${LOGO.width}" height="${LOGO.height}" alt="eGrant" style="${imgStyle(alignOf(block.align, 'center'), LOGO.width)}" />`;
    case 'spacer': {
      const h = SPACER[block.size] ?? SPACER.medium;
      return `<table ${TABLE} width="100%"><tr><td height="${h}" style="height:${h}px;line-height:${h}px;font-size:1px">&nbsp;</td></tr></table>`;
    }
    case 'columns':
      return columns(block, i, width);
    default:
      return '';
  }
}

// ---------------------------------------------------------------- text

type NodeGroup =
  | { kind: 'single'; node: BulkTextNode }
  | { kind: 'list'; ordered: boolean; items: BulkTextNode[] };

/** Consecutive `bullet` (or `ordered`) nodes form one list. */
function groupNodes(nodes: readonly BulkTextNode[]): NodeGroup[] {
  const groups: NodeGroup[] = [];
  for (const node of nodes) {
    if (node.type === 'bullet' || node.type === 'ordered') {
      const ordered = node.type === 'ordered';
      const last = groups[groups.length - 1];
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(node);
      else groups.push({ kind: 'list', ordered, items: [node] });
    } else {
      groups.push({ kind: 'single', node });
    }
  }
  return groups;
}

function textHtml(nodes: readonly BulkTextNode[], align: BulkAlign, i: EmailRenderInput): string {
  const groups = groupNodes(Array.isArray(nodes) ? nodes : []);
  return groups
    .map((group, n) => {
      const last = n === groups.length - 1;
      if (group.kind === 'list') {
        const tag = group.ordered ? 'ol' : 'ul';
        const items = group.items
          .map((item, k) => {
            const gap = k === group.items.length - 1 ? 0 : 4;
            return `<li style="margin:0 0 ${gap}px 0;text-align:${alignOf(item.align, align)}">${runsHtml(item.content, i)}</li>`;
          })
          .join('');
        return `<${tag} style="margin:0 0 ${last ? 0 : 16}px 0;padding:0 0 0 24px;${TEXT_STYLE}">${items}</${tag}>`;
      }
      const { node } = group;
      const nodeAlign = alignOf(node.align, align);
      const html = runsHtml(node.content, i);
      if (node.type === 'h2' || node.type === 'h3') {
        return `<${node.type} style="margin:0 0 ${last ? 0 : 12}px 0;font-family:${FONT};${HEADINGS[node.type]};font-weight:600;letter-spacing:0;color:${C.ink};text-align:${nodeAlign}">${html}</${node.type}>`;
      }
      return `<p style="margin:0 0 ${last ? 0 : 16}px 0;${TEXT_STYLE};text-align:${nodeAlign}">${html}</p>`;
    })
    .join('\n');
}

function runsHtml(runs: readonly BulkInline[], i: EmailRenderInput): string {
  return (Array.isArray(runs) ? runs : []).map((run) => runHtml(run, i)).join('');
}

/** One run as safe HTML: escaped text with `{{name}}`, line breaks, marks, colour and link. */
function runHtml(run: BulkInline, i: EmailRenderInput): string {
  const text = typeof run.text === 'string' ? run.text : '';
  const href =
    typeof run.href === 'string' && isBulkLinkUrl(run.href.trim()) ? run.href.trim() : null;
  // Inside a link nothing else is linked; elsewhere plain addresses become links (Phase 23).
  const format = href ? esc : linkify;
  let html = text
    .split('\n')
    .map((line) => (i.literal ? format(line) : personalize(line, i.name, format, esc)))
    .join('<br />');
  const marks = new Set(Array.isArray(run.marks) ? run.marks : []);
  const decoration = [
    marks.has('underline') ? 'underline' : '',
    marks.has('strike') ? 'line-through' : '',
  ].filter(Boolean);
  if (decoration.length > 0) {
    html = `<span style="text-decoration:${decoration.join(' ')}">${html}</span>`;
  }
  if (marks.has('italic')) html = `<em style="font-style:italic">${html}</em>`;
  if (marks.has('bold')) html = `<strong style="font-weight:600">${html}</strong>`;
  const color = textColor(run.color);
  if (href) {
    return `<a href="${esc(href)}" target="_blank" style="color:${color ?? C.ink};text-decoration:underline">${html}</a>`;
  }
  return color ? `<span style="color:${color}">${html}</span>` : html;
}

// ---------------------------------------------------------------- images, buttons, columns

function image(
  block: Extract<BulkBlock, { type: 'image' }>,
  i: EmailRenderInput,
  column: number,
): string {
  if (!i.imageUrl) return '';
  const size = i.imageSizes?.get(block.imageId);
  const width = imageWidth(block, size, column);
  const height = size ? ` height="${Math.round((size.height * width) / size.width)}"` : '';
  const shape =
    typeof block.shape === 'string' ? RADIUS[block.shape as keyof typeof RADIUS] : undefined;
  const radius = shape ? `;border-radius:${shape}` : '';
  const img = `<img src="${esc(i.imageUrl(block.imageId))}" width="${width}"${height} alt="${esc(block.alt)}" style="${imgStyle(alignOf(block.align, 'center'), width)}${radius}" />`;
  if (!block.href || !isHttpUrl(block.href)) return img;
  return `<a href="${esc(block.href)}" target="_blank" style="text-decoration:none">${img}</a>`;
}

/** The shown width: the chosen percent of the column or px (at most the column), else own size. */
function imageWidth(
  block: Extract<BulkBlock, { type: 'image' }>,
  size: { width: number; height: number } | undefined,
  column: number,
): number {
  const chosen = block.width;
  const value = chosen && Number.isInteger(chosen.value) ? chosen.value : null;
  if (chosen?.unit === 'percent' && value !== null && value > 0 && value <= 100) {
    return Math.max(1, Math.round((column * value) / 100));
  }
  if (chosen?.unit === 'px' && value !== null && value > 0) return Math.min(value, column);
  return size ? Math.min(size.width, column) : column;
}

function imgStyle(align: BulkAlign, width: number): string {
  const margin = align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0';
  return `display:block;margin:${margin};width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none`;
}

/** A "bulletproof" button: a coloured table cell with a padded link, works without CSS in Outlook. */
function button(label: string, url: string, align: BulkAlign): string {
  const link = `font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;letter-spacing:0.2px;color:${C.surface};text-decoration:none`;
  const inner = isSafeButtonUrl(url)
    ? `<a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 24px;${link};border-radius:80px">${esc(label)}</a>`
    : `<span style="display:inline-block;padding:12px 24px;${link}">${esc(label)}</span>`;
  return [
    `<table ${TABLE} align="${align}">`,
    '<tr>',
    `<td align="center" bgcolor="${C.ink}" style="background-color:${C.ink};border-radius:80px">${inner}</td>`,
    '</tr>',
    '</table>',
  ].join('\n');
}

/** The widths of a container's two columns inside `width`, after the gaps and the divider. */
function columnWidths(
  block: Extract<BulkBlock, { type: 'columns' }>,
  width: number,
): [number, number] {
  const inner = width - 2 * GAP - (block.divider ? 1 : 0);
  const left =
    block.ratio === '33-67'
      ? Math.round(inner / 3)
      : block.ratio === '67-33'
        ? Math.round((inner * 2) / 3)
        : Math.floor(inner / 2);
  return [left, inner - left];
}

/**
 * The split container (spec §3): one table row of real cells — left, gap, divider, gap, right —
 * so the divider is as tall as the taller column in every client, Outlook too (the "ghost
 * table" of the hybrid technique, here for every client). On phones the `.sp-col` cells become
 * full-width blocks, left first, and the gap and divider cells disappear.
 */
function columns(
  block: Extract<BulkBlock, { type: 'columns' }>,
  i: EmailRenderInput,
  width: number,
): string {
  const [left, right] = columnWidths(block, width);
  const valign = VALIGNS.includes(block.valign) ? block.valign : 'top';
  const side = (blocks: readonly BulkLeafBlock[], w: number) =>
    Array.isArray(blocks) && blocks.length > 0 ? rowsTable(blocks, i, w).join('\n') : '&nbsp;';
  const cell = (cls: string, w: number, blocks: readonly BulkLeafBlock[]) =>
    `<td class="${cls}" width="${w}" valign="${valign}" style="width:${w}px;vertical-align:${valign}">${side(blocks, w)}</td>`;
  const gap = (w: number) =>
    `<td class="sp-gap" width="${w}" style="width:${w}px;font-size:1px;line-height:1px">&nbsp;</td>`;
  const color = lineColor(block.dividerColor);
  const middle = block.divider
    ? [
        gap(GAP),
        `<td class="sp-gap sp-line" width="1" bgcolor="${color}" style="width:1px;background-color:${color};font-size:1px;line-height:1px">&nbsp;</td>`,
        gap(GAP),
      ]
    : [gap(2 * GAP)];
  return [
    `<table ${TABLE} width="100%">`,
    '<tr>',
    cell('sp-col', left, block.left),
    ...middle,
    cell('sp-col sp-col-r', right, block.right),
    '</tr>',
    '</table>',
  ].join('\n');
}

/** Text with http(s) links made clickable, everything escaped. */
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

function renderText(i: EmailRenderInput): string {
  const { footer } = i;
  const plain = (text: string): string => (i.literal ? text : personalize(text, i.name));
  const runsText = (runs: readonly BulkInline[]): string =>
    (Array.isArray(runs) ? runs : [])
      .map((run) => {
        const text = plain(typeof run.text === 'string' ? run.text : '');
        const href =
          typeof run.href === 'string' && isBulkLinkUrl(run.href.trim()) ? run.href.trim() : null;
        return href && href !== text ? `${text} (${href})` : text;
      })
      .join('');
  const blockText = (block: BulkBlock): string[] => {
    switch (block.type) {
      case 'heading':
        return [plain(block.text).toLocaleUpperCase(i.language)];
      case 'text':
        return groupNodes(Array.isArray(block.content) ? block.content : []).map((group) => {
          if (group.kind === 'list') {
            return group.items
              .map((item, n) => `${group.ordered ? `${n + 1}.` : '-'} ${runsText(item.content)}`)
              .join('\n');
          }
          const line = runsText(group.node.content);
          return group.node.type === 'h2' || group.node.type === 'h3'
            ? line.toLocaleUpperCase(i.language)
            : line;
        });
      case 'image':
        return i.imageUrl ? [`[${block.alt}]`] : [];
      case 'button':
        return [`${block.label}: ${block.url}`];
      case 'divider':
        return ['---'];
      case 'columns':
        return [...block.left, ...block.right].flatMap(blockText);
      default:
        return [];
    }
  };
  // The plain-text part is always the desktop version.
  const parts = i.blocks.flatMap(blockText);
  const small = [...footer.lines];
  if (footer.link) small.push(`${footer.link.label}: ${footer.link.href}`);
  if (small.length > 0) parts.push('---', small.join('\n'));
  return parts.filter((p) => p.trim() !== '').join('\n\n');
}

// ---------------------------------------------------------------- helpers

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

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
