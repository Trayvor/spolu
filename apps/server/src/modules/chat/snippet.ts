import { MENTION_RE } from '@spolu/shared';
import { findRanges } from '../../infra/text/highlight.js';

/** How far before the first match a snippet's window starts. */
const LEAD = 40;

/**
 * A message body as one line of plain text (message search, 2026-10-19): mentions as `@Name`
 * (`@all`, `@?` for an unknown id), links `[text](url)` as `text (url)`, Markdown emphasis,
 * code, heading and quote markers removed, whitespace collapsed.
 */
export function plainMessageText(body: string, nameOf: (id: string) => string | undefined): string {
  return body
    .replace(MENTION_RE, (_, id: string) => (id === 'all' ? '@all' : `@${nameOf(id) ?? '?'}`))
    .replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/^[ \t]*(?:#{1,6}|>+)[ \t]+/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s.,;:!?)]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The snippet of a message hit: its plain text (`plainMessageText`), cut to a window of `max`
 * characters that starts about 40 characters before the first match (at a word start), with `…`
 * on each cut side, and every term's occurrences in it as offsets (`findRanges`, so a folded
 * term marks the original letters). Plain text only: the client renders it as text nodes.
 */
export function messageSnippet(
  body: string,
  nameOf: (id: string) => string | undefined,
  terms: string[],
  max = 160,
): { snippet: string; highlights: [number, number][] } {
  const text = plainMessageText(body, nameOf);
  const ranges = findRanges(text, terms);
  if (text.length <= max) return { snippet: text, highlights: ranges };
  const first = ranges[0]?.[0] ?? 0;
  // A match near the end keeps the window full: start no later than `length - max`.
  let start = Math.max(0, Math.min(first - LEAD, text.length - max));
  // Snap forward to a word start, never past the first match.
  if (start > 0 && text[start - 1] !== ' ') {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < first) start = space + 1;
  }
  const end = Math.min(text.length, start + max);
  const lead = start > 0 ? '…' : '';
  const shift = lead.length - start;
  const highlights = ranges
    .filter(([a, b]) => b > start && a < end)
    .map(([a, b]): [number, number] => [Math.max(a, start) + shift, Math.min(b, end) + shift]);
  return {
    snippet: `${lead}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
    highlights,
  };
}
