import {
  BulkPalette,
  BulkTextColors,
  isBulkLinkUrl,
  splitBold,
  type BulkAlign,
  type BulkInline,
  type BulkMark,
  type BulkTextColor,
  type BulkTextNode,
} from '@spolu/shared';

/**
 * Phase 31 — the text block's document tree ↔ the editor's `contenteditable` DOM (spec §4).
 * `domToNodes` keeps only what the shared schema allows: marks, http(s)/mailto links, palette
 * colours, paragraphs, headings 2/3, list items and alignment. Anything else in the DOM
 * (pasted styles, images, scripts, tables) is dropped; their text stays. The server checks
 * the tree again (the schema is the allowlist) and the renderer escapes everything.
 */

const MARK_ORDER: readonly BulkMark[] = ['bold', 'italic', 'underline', 'strike'];
const ALIGNS: readonly BulkAlign[] = ['left', 'center', 'right'];

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- tree → editor HTML

function runToHtml(run: BulkInline): string {
  let html = escapeHtml(run.text).replace(/\n/g, '<br>');
  const marks = new Set(run.marks ?? []);
  if (marks.has('strike')) html = `<s>${html}</s>`;
  if (marks.has('underline')) html = `<u>${html}</u>`;
  if (marks.has('italic')) html = `<i>${html}</i>`;
  if (marks.has('bold')) html = `<b>${html}</b>`;
  if (run.color) html = `<font color="${BulkPalette[run.color]}">${html}</font>`;
  if (run.href) html = `<a href="${escapeHtml(run.href)}">${html}</a>`;
  return html;
}

const alignStyle = (align: BulkAlign) => (align === 'left' ? '' : ` style="text-align:${align}"`);

/** The editor's starting HTML for a text block (`align` is the block's default alignment). */
export function nodesToEditorHtml(nodes: readonly BulkTextNode[], align: BulkAlign): string {
  let html = '';
  let list: 'ul' | 'ol' | null = null;
  for (const node of nodes) {
    const tag = node.type === 'bullet' ? 'ul' : node.type === 'ordered' ? 'ol' : null;
    if (list && tag !== list) {
      html += `</${list}>`;
      list = null;
    }
    const inner = node.content.map(runToHtml).join('') || '<br>';
    const style = alignStyle(node.align ?? align);
    if (tag) {
      if (!list) {
        html += `<${tag}>`;
        list = tag;
      }
      html += `<li${style}>${inner}</li>`;
    } else {
      const el = node.type === 'h2' || node.type === 'h3' ? node.type : 'p';
      html += `<${el}${style}>${inner}</${el}>`;
    }
  }
  if (list) html += `</${list}>`;
  return html || '<p><br></p>';
}

// ---------------------------------------------------------------- editor DOM → tree

type Format = { marks: Set<BulkMark>; href?: string; color?: BulkTextColor };

const HEX = /^#([0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;

/** A CSS colour (`#7654ff`, `rgb(118, 84, 255)`) → its palette key; anything else → none. */
export function paletteKeyOf(color: string | null | undefined): BulkTextColor | undefined {
  if (!color) return undefined;
  let hex = color.trim().toLowerCase();
  const rgb = RGB.exec(hex);
  if (rgb) {
    hex = `#${[rgb[1], rgb[2], rgb[3]]
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  if (!HEX.test(hex)) return undefined;
  const key = BulkTextColors.find((k) => BulkPalette[k].toLowerCase() === hex);
  // Ink is the default text colour: no mark for it.
  return key === 'ink' ? undefined : key;
}

function formatOf(el: Element, parent: Format): Format {
  const marks = new Set(parent.marks);
  let { href, color } = parent;
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') marks.add('bold');
  if (tag === 'I' || tag === 'EM') marks.add('italic');
  if (tag === 'U' || tag === 'INS') marks.add('underline');
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') marks.add('strike');
  if (tag === 'A') {
    const value = (el.getAttribute('href') ?? '').trim();
    href = isBulkLinkUrl(value) ? value : undefined;
  }
  if (tag === 'FONT') color = paletteKeyOf(el.getAttribute('color')) ?? color;
  const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
  if (style) {
    const weight = style.fontWeight;
    if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) marks.add('bold');
    if (weight === 'normal' || (Number(weight) > 0 && Number(weight) < 600)) marks.delete('bold');
    if (style.fontStyle === 'italic') marks.add('italic');
    const decoration = `${style.textDecoration} ${style.textDecorationLine}`;
    if (decoration.includes('underline')) marks.add('underline');
    if (decoration.includes('line-through')) marks.add('strike');
    if (style.color) color = paletteKeyOf(style.color) ?? color;
  }
  return { marks, href, color };
}

function sameFormat(a: BulkInline, f: Format): boolean {
  const marks = MARK_ORDER.filter((m) => f.marks.has(m));
  return (a.marks ?? []).join() === marks.join() && a.href === f.href && a.color === f.color;
}

function pushText(runs: BulkInline[], text: string, f: Format) {
  if (text === '') return;
  const last = runs[runs.length - 1];
  if (last && sameFormat(last, f)) {
    last.text += text;
    return;
  }
  const marks = MARK_ORDER.filter((m) => f.marks.has(m));
  runs.push({
    text,
    ...(marks.length > 0 ? { marks } : {}),
    ...(f.href ? { href: f.href } : {}),
    ...(f.color ? { color: f.color } : {}),
  });
}

/** Tags whose content is never text of the email. */
const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'svg',
  'SVG',
  'IMG',
  'VIDEO',
  'AUDIO',
  'NOSCRIPT',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
]);
const BLOCKS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'TABLE',
  'TBODY',
  'THEAD',
  'TR',
  'TD',
  'TH',
]);

function alignOf(el: Element): BulkAlign | undefined {
  const value = (
    (el as HTMLElement).style?.textAlign ||
    el.getAttribute('align') ||
    ''
  ).toLowerCase();
  if (value === 'start') return 'left';
  if (value === 'end') return 'right';
  return ALIGNS.includes(value as BulkAlign) ? (value as BulkAlign) : undefined;
}

function nodeTypeOf(tag: string, inList: 'bullet' | 'ordered' | null): BulkTextNode['type'] {
  if (tag === 'LI') return inList ?? 'bullet';
  if (tag === 'H1' || tag === 'H2') return 'h2';
  if (tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') return 'h3';
  return 'paragraph';
}

/**
 * The document tree of the editor's DOM. Text directly in the root (before the browser wraps it
 * in a block) is a paragraph; `<br>` is a line break (a last one in a block is dropped); empty
 * nodes are dropped; alignment is kept only when the element sets one.
 */
export function domToNodes(root: Element): BulkTextNode[] {
  const out: BulkTextNode[] = [];
  let current: BulkTextNode | null = null;

  const close = () => {
    if (current) {
      const last = current.content[current.content.length - 1];
      if (last && last.text.endsWith('\n')) last.text = last.text.slice(0, -1);
      current.content = current.content.filter((r) => r.text !== '');
      if (current.content.some((r) => r.text.trim() !== '')) out.push(current);
    }
    current = null;
  };
  const open = (type: BulkTextNode['type'], align?: BulkAlign) => {
    close();
    current = { type, ...(align ? { align } : {}), content: [] };
  };

  const walkInline = (
    node: Node,
    f: Format,
    list: 'bullet' | 'ordered' | null,
    align?: BulkAlign,
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Collapse the whitespace of the HTML source, as the browser shows it.
      const text = (node.textContent ?? '').replace(/[ \t\r\n]+/g, ' ');
      if (text === '') return;
      if (!current) open('paragraph', align);
      pushText(current!.content, text, f);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName;
    if (SKIP.has(tag)) return;
    if (tag === 'BR') {
      if (!current) open('paragraph', align);
      pushText(current!.content, '\n', f);
      return;
    }
    if (BLOCKS.has(tag)) {
      walkBlock(el, list, align);
      return;
    }
    const next = formatOf(el, f);
    el.childNodes.forEach((child) => walkInline(child, next, list, align));
  };

  function walkBlock(el: Element, list: 'bullet' | 'ordered' | null, inherited?: BulkAlign) {
    const tag = el.tagName;
    const align = alignOf(el) ?? inherited;
    if (tag === 'UL' || tag === 'OL') {
      close();
      const kind = tag === 'OL' ? 'ordered' : 'bullet';
      el.childNodes.forEach((child) => walkInline(child, { marks: new Set() }, kind, align));
      close();
      return;
    }
    open(nodeTypeOf(tag, list), align);
    const format = formatOf(el, { marks: new Set() });
    el.childNodes.forEach((child) => walkInline(child, format, list, align));
    close();
  }

  root.childNodes.forEach((child) => walkInline(child, { marks: new Set() }, null));
  close();
  return out;
}

/**
 * `**word**` typed in a run that is not bold yet becomes bold (as in Phase 23). Answers `nodes`
 * itself when nothing changed.
 */
export function applyBoldShortcuts(nodes: BulkTextNode[]): BulkTextNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    const content = node.content.flatMap((run): BulkInline[] => {
      if (run.marks?.includes('bold') || !run.text.includes('**')) return [run];
      const parts = splitBold(run.text);
      if (!parts.some((p) => p.bold)) return [run];
      changed = true;
      return parts.map(({ text, bold }) => {
        const marks = bold
          ? MARK_ORDER.filter((m) => m === 'bold' || run.marks?.includes(m))
          : run.marks;
        return { ...run, text, ...(marks && marks.length > 0 ? { marks } : {}) };
      });
    });
    return { ...node, content };
  });
  return changed ? next : nodes;
}
