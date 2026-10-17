import { mentionToken, MENTION_ALL_TOKEN, splitMentionTokens } from '@spolu/shared';

/**
 * Parser for the chat's small Markdown subset. It returns a plain tree (no HTML strings), so the
 * renderer can only ever produce the elements it chooses. Every step is linear in the body length
 * (bodies are at most 10 000 characters, possibly hostile): closers are found through
 * precomputed "next closer" tables and memoised forward searches, never by rescanning.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic' | 'strike'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'mention'; userId: string }
  | { type: 'mentionAll' }
  | { type: 'break' };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'codeBlock'; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] };

/** Deeper `>` levels stay literal text, which bounds both recursion and work. */
const MAX_QUOTE_DEPTH = 3;
const FENCE = '```';
const ORDERED_ITEM_RE = /^(\d{1,9})\. /;
/** `# `, `## ` or `### ` followed by some text. */
const HEADING_RE = /^(#{1,3}) (?=\S)/;
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
/** Trailing characters that end a sentence rather than a bare URL. */
const URL_TRAILING = '.,;:!?*~';
/** Longer bare URL candidates stay text, which bounds the cost of validating one. */
const MAX_URL_LENGTH = 2048;
/** A fence's first line that is one word (`js`, `c++`, `objective-c`) is a language tag. */
const FENCE_LANGUAGE_RE = /^[\w+#.-]{1,32}$/;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
const SPACE_RE = /\s/;

/** A line of the body (or of a quote's content) and the body offset of its first character. */
interface Line {
  text: string;
  at: number;
}

/** Body offset of each mention token → user id (`'all'` for @all), from the shared tokenizer. */
type MentionMap = Map<number, string>;

export function parseMessage(body: string): Block[] {
  const mentions: MentionMap = new Map();
  let offset = 0;
  for (const part of splitMentionTokens(body)) {
    if (part.type === 'text') {
      offset += part.text.length;
    } else {
      mentions.set(offset, part.id);
      offset += tokenOf(part.id).length;
    }
  }

  const lines: Line[] = [];
  let at = 0;
  for (const raw of body.split('\n')) {
    lines.push({ text: raw.endsWith('\r') ? raw.slice(0, -1) : raw, at });
    at += raw.length + 1;
  }
  return parseBlocks(lines, 0, mentions);
}

/** Returns a URL that is safe to put in `href` (normalised by the URL parser), or null. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

const tokenOf = (id: string) => (id === 'all' ? MENTION_ALL_TOKEN : mentionToken(id));
const isBlank = (text: string) => text.trim() === '';
const isQuote = (text: string) => text === '>' || text.startsWith('> ');
const isWordChar = (ch: string | undefined) => ch !== undefined && WORD_CHAR_RE.test(ch);
/** For `_`: an underscore inside a word (`snake_case`, `__init__`) never starts or ends italics. */
const isWordOrUnderscore = (ch: string | undefined) => ch === '_' || isWordChar(ch);
const isSpace = (ch: string | undefined) => ch === undefined || SPACE_RE.test(ch);

function startsBlock(text: string, depth: number): boolean {
  return (
    text.startsWith(FENCE) ||
    (depth < MAX_QUOTE_DEPTH && isQuote(text)) ||
    text.startsWith('- ') ||
    ORDERED_ITEM_RE.test(text) ||
    HEADING_RE.test(text)
  );
}

/** `lines` is owned by this call (a fence's closing line may be replaced by its remainder). */
function parseBlocks(lines: Line[], depth: number, mentions: MentionMap): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as Line;
    const text = line.text;

    if (isBlank(text)) {
      i++;
    } else if (text.startsWith(FENCE)) {
      // Like the shared CODE_RE: the fence closes at the next ``` anywhere, or runs to the end.
      const parts: string[] = [];
      let j = i;
      let from = FENCE.length;
      let rest: Line | undefined;
      for (; j < lines.length; j++, from = 0) {
        const current = lines[j] as Line;
        const close = current.text.indexOf(FENCE, from);
        if (close === -1) {
          parts.push(current.text.slice(from));
          continue;
        }
        parts.push(current.text.slice(from, close));
        const after = close + FENCE.length;
        if (!isBlank(current.text.slice(after))) {
          rest = { text: current.text.slice(after), at: current.at + after };
        }
        break;
      }
      const first = (parts[0] as string).trim();
      if (parts.length > 1 && (first === '' || FENCE_LANGUAGE_RE.test(first))) parts.shift();
      if (parts.length > 1 && isBlank(parts[parts.length - 1] as string)) parts.pop();
      blocks.push({ type: 'codeBlock', text: parts.join('\n') });
      if (rest) {
        lines[j] = rest;
        i = j;
      } else {
        i = j + 1;
      }
    } else if (depth < MAX_QUOTE_DEPTH && isQuote(text)) {
      const inner: Line[] = [];
      for (; i < lines.length && isQuote((lines[i] as Line).text); i++) {
        const current = lines[i] as Line;
        const cut = current.text.startsWith('> ') ? 2 : 1;
        inner.push({ text: current.text.slice(cut), at: current.at + cut });
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner, depth + 1, mentions) });
    } else if (HEADING_RE.test(text)) {
      const cut = (HEADING_RE.exec(text) as RegExpExecArray)[0].length;
      blocks.push({
        type: 'heading',
        level: (cut - 1) as 1 | 2 | 3,
        children: parseInline([{ text: text.slice(cut), at: line.at + cut }], mentions),
      });
      i++;
    } else if (text.startsWith('- ')) {
      const items: Inline[][] = [];
      for (; i < lines.length && (lines[i] as Line).text.startsWith('- '); i++) {
        const current = lines[i] as Line;
        items.push(parseInline([{ text: current.text.slice(2), at: current.at + 2 }], mentions));
      }
      blocks.push({ type: 'list', ordered: false, start: 1, items });
    } else if (ORDERED_ITEM_RE.test(text)) {
      const items: Inline[][] = [];
      const start = Number((ORDERED_ITEM_RE.exec(text) as RegExpExecArray)[1]);
      for (let m; i < lines.length && (m = ORDERED_ITEM_RE.exec((lines[i] as Line).text)); i++) {
        const current = lines[i] as Line;
        const cut = m[0].length;
        items.push(
          parseInline([{ text: current.text.slice(cut), at: current.at + cut }], mentions),
        );
      }
      blocks.push({ type: 'list', ordered: true, start, items });
    } else {
      const paragraph: Line[] = [line];
      for (i++; i < lines.length; i++) {
        const next = (lines[i] as Line).text;
        if (isBlank(next) || startsBlock(next, depth)) break;
        paragraph.push(lines[i] as Line);
      }
      blocks.push({ type: 'paragraph', children: parseInline(paragraph, mentions) });
    }
  }
  return blocks;
}

function parseInline(lines: Line[], mentions: MentionMap): Inline[] {
  const text = lines.map((l) => l.text).join('\n');
  // Body offset of each character (-1 for the joining newlines).
  const offsets = new Int32Array(text.length);
  let k = 0;
  lines.forEach((line, n) => {
    if (n > 0) offsets[k++] = -1;
    for (let c = 0; c < line.text.length; c++) offsets[k++] = line.at + c;
  });
  return new InlineParser(text, offsets, mentions).parse(0, text.length);
}

/** Code spans, mentions, links and bare URLs, found in one left-to-right pass. */
type LinkAtom = { kind: 'link'; end: number; href: string; textStart: number; textEnd: number };
type Atom = { kind: 'node'; end: number; node: Inline } | LinkAtom;

type MarkType = 'bold' | 'strike' | 'italic';

class InlineParser {
  private readonly atoms = new Map<number, Atom>();
  /** Characters inside code spans, mentions, URLs and a link's `](url)` part: no mark closes there. */
  private readonly protectedChars: Uint8Array;
  private readonly nextCloser: Record<MarkType, Int32Array>;
  private readonly searchCache = new Map<string, { from: number; found: number }>();

  constructor(
    private readonly text: string,
    private readonly offsets: Int32Array,
    private readonly mentions: MentionMap,
  ) {
    this.protectedChars = new Uint8Array(text.length);
    this.findAtoms();
    this.nextCloser = {
      bold: this.closerTable((i) => this.isPairCloser(i, '*')),
      strike: this.closerTable((i) => this.isPairCloser(i, '~')),
      italic: this.closerTable(
        (i) =>
          text[i] === '_' &&
          !this.protectedChars[i] &&
          !isSpace(text[i - 1]) &&
          text[i - 1] !== '_' &&
          !isWordOrUnderscore(text[i + 1]),
      ),
    };
  }

  parse(start: number, end: number): Inline[] {
    const out: Inline[] = [];
    let textFrom = start;
    const flush = (to: number) => {
      if (to > textFrom) pushText(out, this.text.slice(textFrom, to));
    };
    let i = start;
    while (i < end) {
      const atom = this.atoms.get(i);
      if (atom && atom.end <= end) {
        flush(i);
        out.push(
          atom.kind === 'node'
            ? atom.node
            : { type: 'link', href: atom.href, children: this.parse(atom.textStart, atom.textEnd) },
        );
        i = textFrom = atom.end;
        continue;
      }
      if (this.text[i] === '\n') {
        flush(i);
        out.push({ type: 'break' });
        i = textFrom = i + 1;
        continue;
      }
      const mark = this.matchMark(i, end);
      if (mark) {
        flush(i);
        out.push({ type: mark.type, children: this.parse(mark.from, mark.to) });
        i = textFrom = mark.end;
        continue;
      }
      i++;
    }
    flush(end);
    return out;
  }

  private matchMark(
    i: number,
    end: number,
  ): { type: MarkType; from: number; to: number; end: number } | null {
    const { text } = this;
    const ch = text[i];
    if ((ch === '*' || ch === '~') && text[i + 1] === ch && !isSpace(text[i + 2])) {
      const type = ch === '*' ? 'bold' : 'strike';
      const close = this.closerAt(type, i + 3);
      if (close !== -1 && close + 2 <= end) return { type, from: i + 2, to: close, end: close + 2 };
    } else if (
      ch === '_' &&
      !isWordOrUnderscore(text[i - 1]) &&
      !isSpace(text[i + 1]) &&
      text[i + 1] !== '_'
    ) {
      const close = this.closerAt('italic', i + 2);
      if (close !== -1 && close + 1 <= end) {
        return { type: 'italic', from: i + 1, to: close, end: close + 1 };
      }
    }
    return null;
  }

  private closerAt(type: MarkType, from: number): number {
    const table = this.nextCloser[type];
    return from < table.length ? (table[from] as number) : -1;
  }

  private isPairCloser(i: number, ch: string): boolean {
    const { text } = this;
    return (
      text[i] === ch &&
      text[i + 1] === ch &&
      !this.protectedChars[i] &&
      !this.protectedChars[i + 1] &&
      !isSpace(text[i - 1])
    );
  }

  /** `table[p]` = the first position >= p where `isCloser` holds, or -1. */
  private closerTable(isCloser: (i: number) => boolean): Int32Array {
    const table = new Int32Array(this.text.length + 1);
    table[this.text.length] = -1;
    for (let i = this.text.length - 1; i >= 0; i--) {
      table[i] = isCloser(i) ? i : (table[i + 1] as number);
    }
    return table;
  }

  /** `indexOf` for forward-moving searches: a repeated search reuses the previous answer. */
  private nextIndex(needle: string, from: number): number {
    const cached = this.searchCache.get(needle);
    if (cached && from >= cached.from && (cached.found === -1 || from <= cached.found)) {
      return cached.found;
    }
    const found = this.text.indexOf(needle, from);
    this.searchCache.set(needle, { from, found });
    return found;
  }

  private protect(from: number, to: number) {
    this.protectedChars.fill(1, from, to);
  }

  private findAtoms() {
    const { text } = this;
    let linkTextEnd = -1;
    let linkEnd = -1;
    let i = 0;
    while (i < text.length) {
      if (i === linkTextEnd) {
        i = linkEnd;
        linkTextEnd = -1;
        continue;
      }
      const ch = text[i] as string;
      if (ch === '`') {
        const end = this.codeSpanAt(i);
        if (end > 0) {
          i = end;
          continue;
        }
        while (text[i] === '`') i++;
        continue;
      }
      if (ch === '<') {
        const id = this.mentions.get(this.offsets[i] as number);
        if (id !== undefined) {
          const end = i + tokenOf(id).length;
          const node: Inline =
            id === 'all' ? { type: 'mentionAll' } : { type: 'mention', userId: id };
          this.atoms.set(i, { kind: 'node', end, node });
          this.protect(i, end);
          i = end;
          continue;
        }
      }
      if (linkTextEnd === -1) {
        if (ch === '[') {
          const link = this.linkAt(i);
          if (link) {
            this.atoms.set(i, link);
            this.protect(link.textEnd, link.end);
            linkTextEnd = link.textEnd;
            linkEnd = link.end;
            i++;
            continue;
          }
        } else if (!isWordChar(text[i - 1])) {
          const next = this.afterBareUrl(i);
          if (next > 0) {
            i = next;
            continue;
          }
        }
      }
      i++;
    }
  }

  /** A code span at `i` (``` … ``` may span lines, ` … ` may not); returns its end, or -1. */
  private codeSpanAt(i: number): number {
    const { text } = this;
    let close: number;
    let open: number;
    if (text.startsWith(FENCE, i)) {
      open = FENCE.length;
      close = this.nextIndex(FENCE, i + open);
    } else if (text[i + 1] !== '`') {
      open = 1;
      close = this.nextIndex('`', i + 1);
      const newline = this.nextIndex('\n', i + 1);
      if (newline !== -1 && newline < close) close = -1;
    } else {
      return -1;
    }
    if (close <= i + open) return -1;
    const end = close + open;
    this.atoms.set(i, {
      kind: 'node',
      end,
      node: { type: 'code', text: text.slice(i + open, close) },
    });
    this.protect(i, end);
    return end;
  }

  /** `[text](url)` with a safe url; the text has no `[`, `` ` `` or newline. */
  private linkAt(i: number): LinkAtom | null {
    const { text } = this;
    const textEnd = this.nextIndex(']', i + 1);
    if (textEnd <= i + 1 || text[textEnd + 1] !== '(') return null;
    for (const stop of ['[', '`', '\n']) {
      const at = this.nextIndex(stop, i + 1);
      if (at !== -1 && at < textEnd) return null;
    }
    const urlStart = textEnd + 2;
    let depth = 0;
    for (let j = urlStart; j < text.length; j++) {
      const c = text[j] as string;
      if (c === '(') {
        if (depth === 1) return null;
        depth = 1;
      } else if (c === ')') {
        if (depth === 0) {
          const href = safeHref(text.slice(urlStart, j));
          return href ? { kind: 'link', end: j + 1, href, textStart: i + 1, textEnd } : null;
        }
        depth = 0;
      } else if (isUrlStop(c)) {
        return null;
      }
    }
    return null;
  }

  /**
   * A bare http(s)/mailto URL at `i`, without trailing punctuation. Returns where scanning goes
   * on: the URL's end, or (for a candidate that is invalid or too long, which stays text) the end
   * of the whole candidate, so no character is scanned twice. -1 when no URL starts here.
   */
  private afterBareUrl(i: number): number {
    const { text } = this;
    const head = text.slice(i, i + 8).toLowerCase();
    if (
      !head.startsWith('http://') &&
      !head.startsWith('https://') &&
      !head.startsWith('mailto:')
    ) {
      return -1;
    }
    let end = i;
    let opens = 0;
    let closes = 0;
    while (end < text.length && !isUrlStop(text[end] as string)) {
      if (text[end] === '(') opens++;
      else if (text[end] === ')') closes++;
      end++;
    }
    const candidateEnd = end;
    if (end - i > MAX_URL_LENGTH) return candidateEnd;
    while (end > i) {
      const last = text[end - 1] as string;
      if (URL_TRAILING.includes(last)) {
        end--;
      } else if (last === ')' && closes > opens) {
        closes--;
        end--;
      } else {
        break;
      }
    }
    const url = text.slice(i, end);
    const href = safeHref(url);
    if (!href || !/^(?:https?:\/\/|mailto:)./i.test(url)) return candidateEnd;
    this.atoms.set(i, {
      kind: 'node',
      end,
      node: { type: 'link', href, children: [{ type: 'text', text: url }] },
    });
    this.protect(i, end);
    return end;
  }
}

function isUrlStop(c: string): boolean {
  return c === '<' || c === '>' || c === '`' || SPACE_RE.test(c);
}

function pushText(out: Inline[], text: string) {
  const last = out[out.length - 1];
  if (last?.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
}
