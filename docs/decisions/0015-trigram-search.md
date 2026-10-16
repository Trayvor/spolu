# 0015 Trigram search for the knowledge base

Date: 2026-10-16
Status: accepted

## Context
The knowledge base (Phase 17) searches items by title, description, file name and URL, in Slovak and English. People often type without diacritics, search for fragments of file names and URLs, and expect results while they are still typing a word. An installation has hundreds to a few thousand items.

## Decision
- Search uses the `pg_trgm` extension and `ILIKE` on one precomputed column, `knowledge_items.search_text`, with a GIN `gin_trgm_ops` index. Not PostgreSQL full-text search.
- The knowledge service writes `search_text` on every create and update (`buildSearchText` in `modules/knowledge/search.ts`): the title, the body as plain text (mentions as names), the URL and the attached files' names, joined and normalized by `normalizeSearch` (NFD, combining marks removed, lower-cased, whitespace collapsed). It is recomputed when files are added or removed.
- A query is normalized the same way and split on spaces into at most 5 terms of at least 2 characters (`searchTerms`). Each term adds `search_text ilike '%' || term || '%' escape '\'`, ANDed, with `%`, `_` and `\` escaped (`escapeLike`). Results stay newest first.
- The migration runs `create extension if not exists pg_trgm`; it is a trusted extension since PostgreSQL 13, so the database owner can create it (production runs PostgreSQL 17 as the owner role).

Why not full-text search:
- **No Slovak configuration ships with PostgreSQL.** It would be the `simple` configuration: no stemming, so "rozpočtu" still would not find "rozpočet". Tokenizing without language support adds nothing.
- **File names and URLs are not words.** The full-text parser splits `budget-2026-final.xlsx` and `opvai.sk/vyzvy/2026-03` in ways users do not expect, and fragments such as "vyzvy" or "final" inside them fail to match. Trigram `ILIKE '%term%'` finds any substring.
- **Prefixes work as people type.** "rozpo" matches with trigrams; full-text needs `:*` prefix queries per word.
- **Diacritics.** Stripping them once in the stored column (and in the query) handles typing without them, without the `unaccent` extension and its non-immutable function.
- **Size.** At this size a GIN trigram index keeps a search well under 10 ms (measured: under 1 ms on 20 000 seeded items).

## Consequences
- No relevance ranking: matches are listed newest first, which is how the list is read anyway.
- The trigram index is larger than a full-text one; at this size that does not matter.
- Terms of 2 characters get no help from the index, but they are filtered by group and type first, which is cheap.
- Any new searchable field must be added to `buildSearchText`, since the column is written by the service, not by a trigger.
