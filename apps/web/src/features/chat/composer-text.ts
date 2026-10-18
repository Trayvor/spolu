import { CODE_RE, MENTION_ALL_TOKEN, MENTION_RE, mentionToken } from '@spolu/shared';

export type FormatKind =
  'bold' | 'italic' | 'strike' | 'code' | 'link' | 'bulletList' | 'numberedList' | 'quote';

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

/**
 * F7: the `/query` being typed at `caret` (a canned reply's name): a `/` at the start of the text
 * or after whitespace, then no whitespace. A path or a URL (`a/b`, `https://`) never opens it.
 */
export function slashQueryAt(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i] as string;
    if (ch === '/') {
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
