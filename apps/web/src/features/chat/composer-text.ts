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
