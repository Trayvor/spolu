import { mentionToken, MENTION_ALL_TOKEN, CODE_RE, splitMentionTokens } from '@spolu/shared';

export type FormatKind =
  'bold' | 'italic' | 'strike' | 'code' | 'link' | 'bulletList' | 'numberedList' | 'quote';

export interface TextEdit {
  value: string;
  start: number;
  end: number;
}

const WRAP: Record<'bold' | 'italic' | 'strike' | 'code', string> = {
  bold: '**',
  italic: '_',
  strike: '~~',
  code: '`',
};
const LINE_PREFIX: Record<'bulletList' | 'numberedList' | 'quote', (index: number) => string> = {
  bulletList: () => '- ',
  numberedList: (index) => `${index + 1}. `,
  quote: () => '> ',
};
const LINK_URL = 'https://';

/**
 * Applies a Markdown format to the selection `[start, end)`. Inline kinds wrap the selection (or
 * insert empty marks with the caret between); a link becomes `[text](https://)` with the URL
 * selected; list and quote kinds prefix every line the selection touches.
 */
export function applyFormat(value: string, start: number, end: number, kind: FormatKind): TextEdit {
  if (kind === 'link') {
    const text = value.slice(start, end);
    const urlStart = start + text.length + 3;
    return {
      value: `${value.slice(0, start)}[${text}](${LINK_URL})${value.slice(end)}`,
      start: urlStart,
      end: urlStart + LINK_URL.length,
    };
  }
  if (kind === 'bold' || kind === 'italic' || kind === 'strike' || kind === 'code') {
    const mark = WRAP[kind];
    return {
      value: `${value.slice(0, start)}${mark}${value.slice(start, end)}${mark}${value.slice(end)}`,
      start: start + mark.length,
      end: end + mark.length,
    };
  }
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = value.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const prefix = LINE_PREFIX[kind];
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const block = lines.map((line, i) => prefix(i) + line).join('\n');
  // A collapsed caret keeps its place in the text (after the mark when it was at line start);
  // a longer selection ends with the caret after the whole block. Nothing stays selected.
  let caret = lineStart + block.length;
  if (start === end) {
    const index = value.slice(lineStart, start).split('\n').length - 1;
    caret = start + prefix(index).length;
  }
  return {
    value: value.slice(0, lineStart) + block + value.slice(lineEnd),
    start: caret,
    end: caret,
  };
}

/** The `@query` being typed at `caret`: `@` at line start or after whitespace, no space inside. */
export function mentionQueryAt(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i] as string;
    if (ch === '@') {
      const before = value[i - 1];
      if (before !== undefined && !/\s/.test(before)) return null;
      return { start: i, query: value.slice(i + 1, caret) };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

export interface PickedPerson {
  id: string;
  name: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turns the typed text into the stored body: `@Name` of picked people and `allLabel` become mention
 * tokens (longest names first, so "@Jana Nováková" wins over "@Jana"). People who share a name are
 * told apart by pick order, one occurrence each; code spans and fences stay untouched.
 */
export function toStored(text: string, picked: PickedPerson[], allLabel: string): string {
  const queues = new Map<string, string[]>();
  for (const p of picked) queues.set(p.name, [...(queues.get(p.name) ?? []), p.id]);
  const labels = [...queues.keys()].map((name) => `@${name}`);
  labels.push(allLabel);
  labels.sort((a, b) => b.length - a.length);
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${labels.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );

  const convert = (chunk: string) =>
    chunk.replace(re, (label) => {
      if (label === allLabel) return MENTION_ALL_TOKEN;
      const ids = queues.get(label.slice(1));
      if (!ids?.length) return label;
      // The same person picked twice keeps matching; several people take turns.
      const id = ids.length > 1 ? (ids.shift() as string) : (ids[0] as string);
      return mentionToken(id);
    });

  let result = '';
  let at = 0;
  for (const m of text.matchAll(CODE_RE)) {
    result += convert(text.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return result + convert(text.slice(at));
}

/** The inverse of `toStored`: tokens become `@Name` / `allLabel` and the picked people are returned. */
export function toEditable(
  body: string,
  nameOf: (id: string) => string | undefined,
  allLabel: string,
): { text: string; picked: PickedPerson[] } {
  const picked: PickedPerson[] = [];
  let text = '';
  for (const part of splitMentionTokens(body)) {
    if (part.type === 'text') text += part.text;
    else if (part.id === 'all') text += allLabel;
    else {
      const name = nameOf(part.id);
      if (name === undefined) text += mentionToken(part.id);
      else {
        text += `@${name}`;
        picked.push({ id: part.id, name });
      }
    }
  }
  return { text, picked };
}
