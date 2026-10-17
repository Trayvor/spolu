import { CODE_RE, MENTION_ALL_TOKEN, MENTION_RE, mentionToken } from '@spolu/shared';

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
/** Code spans, fences and mention tokens: never converted. */
const KEEP_RE = new RegExp(`${CODE_RE.source}|${MENTION_RE.source}`, 'g');

/**
 * The typed mentions of a draft, made tokens on send: `allLabel` becomes `<@all>`, and `@Name` of
 * a person already picked in the draft (a pill) becomes their token (longest names first, so
 * "@Jana Nováková" wins over "@Jana"; people who share a name take turns in pick order). Only at
 * word edges; code spans, fences and existing tokens stay untouched.
 */
export function toStored(text: string, picked: PickedPerson[], allLabel: string): string {
  const queues = new Map<string, string[]>();
  for (const p of picked) queues.set(p.name, [...(queues.get(p.name) ?? []), p.id]);
  const labels = [...queues.keys()].map((name) => `@${name}`);
  labels.push(allLabel);
  labels.sort((a, b) => b.length - a.length);
  // No lookbehind (Safari before 16.4 throws on it): the character before the label is matched
  // as group 1 and put back.
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(${labels.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );

  const convert = (chunk: string) =>
    chunk.replace(re, (_match, before: string, label: string) => {
      if (label === allLabel) return before + MENTION_ALL_TOKEN;
      const ids = queues.get(label.slice(1));
      if (!ids?.length) return before + label;
      // A person picked once keeps matching; several people with one name take turns.
      const id = ids.length > 1 ? (ids.shift() as string) : (ids[0] as string);
      return before + mentionToken(id);
    });

  let result = '';
  let at = 0;
  for (const m of text.matchAll(KEEP_RE)) {
    result += convert(text.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return result + convert(text.slice(at));
}
