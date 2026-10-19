/** Search text helpers (Phase 17), shared by the knowledge base and the finance documents (Phase 32). */
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { plainExcerpt, SEARCH_LIMITS } from '@spolu/shared';

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

export { foldSql } from '../db/fold.js';

/** A global search query, prepared once: its terms, its whole normalized text, a ticket number. */
export type SearchText = {
  /** The normalized terms (2+ characters, the first 5); every one must match. */
  terms: string[];
  /** The whole query normalized, for the rank. */
  key: string;
  /** `123` or `#123`: a ticket number. */
  number: number | null;
};

export function prepareSearch(q: string): SearchText {
  const number = /^#?(\d{1,9})$/.exec(q.trim());
  return {
    terms: searchTerms(q),
    key: normalizeSearch(q),
    number: number ? Number(number[1]) : null,
  };
}

/**
 * Whether a query has a term the trigram index can serve (message search, 2026-10-19: at least
 * 3 characters); shorter terms alone would read every message.
 */
export function hasIndexableTerm(
  text: SearchText,
  min: number = SEARCH_LIMITS.minMessageTerm,
): boolean {
  return text.terms.some((term) => term.length >= min);
}

/** Every term is a fragment of `folded` (an already folded, trigram-indexed expression). */
export function matchesAllSql(folded: SQL | AnyColumn, terms: string[]): SQL {
  if (terms.length === 0) return sql`false`;
  return sql.join(
    terms.map((term) => sql`${folded} like ${`%${escapeLike(term)}%`} escape '\\'`),
    sql` and `,
  );
}

/**
 * The rank of a hit by its folded name: 0 the whole query, 1 it starts with the query, 2 a word
 * starts with it, 3 anything else. Lower is better.
 */
export function rankSql(folded: SQL | AnyColumn, key: string): SQL<number> {
  const like = escapeLike(key);
  return sql<number>`(case when ${folded} = ${key} then 0
    when ${folded} like ${`${like}%`} escape '\\' then 1
    when ${folded} like ${`% ${like}%`} escape '\\' then 2 else 3 end)`;
}
