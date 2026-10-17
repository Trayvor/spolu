/** Search text helpers (Phase 17), shared by the knowledge base and the finance documents (Phase 32). */
import { plainExcerpt } from '@spolu/shared';

const MAX_TERMS = 5;
const MIN_TERM = 2;

/** NFD, combining marks removed, lower-cased, whitespace collapsed: "Rozpočet" → "rozpocet". */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The normalized query split on spaces: terms of 2+ characters, the first 5. */
export function searchTerms(q: string): string[] {
  return normalizeSearch(q)
    .split(' ')
    .filter((term) => term.length >= MIN_TERM)
    .slice(0, MAX_TERMS);
}

/** Escapes the `LIKE` wildcards and the escape character itself (used with `escape '\'`). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The `search_text` column: title, body as plain text (mentions as names), URL and file names,
 * normalized. The service writes it on every create and update.
 */
export function buildSearchText(input: {
  title: string;
  body: string;
  url: string | null;
  fileNames: string[];
  nameOf: (id: string) => string | undefined;
  /** More text of the type (a meeting's links and summary). */
  extra?: string[];
}): string {
  const body = plainExcerpt(input.body, input.nameOf, Number.POSITIVE_INFINITY);
  return normalizeSearch(
    [input.title, body, input.url ?? '', ...input.fileNames, ...(input.extra ?? [])].join(' '),
  );
}
