# 0057 Message search: a stored folded column with a trigram index

Date: 2026-10-19
Status: accepted

## Context
Phase 16 left "search over group messages" open, and the global search (ADR 0046, #143) covers every type but chat messages. `messages` is the biggest table (hundreds of thousands of rows, growing with every chat), so folding the body at query time (`spolu_fold(body)` per row) is out of the question, and a functional index on `spolu_fold(regexp_replace(body, …))` would have to be matched exactly by every query. The other types search fragments of folded text through trigram indexes; a message search must behave the same in the same palette ([spec](../superpowers/specs/2026-10-19-chat-message-search-design.md)).

## Decision
- **A stored generated column** `messages.search_text = spolu_fold(regexp_replace(body, '<@[A-Za-z0-9_-]+>', ' ', 'g'))` (migration 0063, after 0062 created `spolu_fold`). The database keeps it on every send, edit and delete: no service code to forget (unlike `knowledge_items.search_text`, ADR 0015) and no backfill job, since the migration computes it for existing rows. Mention tokens become a space, so a user id is never a match.
- **A partial trigram GIN index** `messages_search_text_trgm_idx` on it, `where deleted_at is null and search_text <> ''`: deleted and attachment-only messages are not in it, and every search repeats the predicate.
- **Guard rails:** a term of at least 3 characters (`SEARCH_LIMITS.minMessageTerm`, a trigram cannot serve shorter ones), at most 5 terms, pages of at most 20, and a `2s` statement timeout in a transaction (`set local`); PostgreSQL's `57014` becomes `tooBroad: true` ("Príliš veľa správ. Spresnite hľadanie.").
- **Rank tiers, then newest:** 0 the whole query at a word start, 1 anywhere, 2 only the terms separately; then `created_at desc, id desc`. Keyset cursor `[rank, createdAt, id]`.
- **Scope in SQL, then the policy per row:** the readable channels as SQL (admins none; a client's groups; a žiadateľ's own ticket chats through the tickets module's `requesterTicketIdsSql`), then `canReadChannel` for group and task chats and `readableTicketLabels` (`canReadTicket`) for ticket chats. A deactivated group's messages are out for everyone, admins too (the join filters `groups.deactivated_at is null`).
- The message reads (`selectMessages`, `getMessage`) leave the column out, so loading a chat does not carry the body twice.

## Why not `tsvector`
- A `tsvector` matches words and prefixes; every other section of the palette matches fragments (`rozpo` finds "rozpočet"). One query would behave differently per section.
- PostgreSQL ships no Slovak text search configuration; `simple` gives no stemming, so it would add a second tokenizer without better recall.
- Folding is solved once by `spolu_fold` in the column; `unaccent` (not immutable) is not needed.

## Consequences
- The migration rewrites `messages` once under an `ACCESS EXCLUSIVE` lock: seconds at today's size, during the deploy's migration step.
- One more GIN index on `messages` (2–3 times larger than a `tsvector` one) and one more computed column on insert and edit; negligible at chat rates.
- Names in mentions and author names are not searchable (an `authorId` filter is the cheaper follow-up); Markdown stays in the text, so link URLs stay findable.
- A very common word matches many rows; bounded by the guard rails and checked on a 400 000-message volume (`modules/chat/explain.test.ts`). **Fallback:** if a common-word admin search exceeds 300 ms with `RUN_BENCH=1` on that volume, or production shows the same, add `to_tsvector('simple', search_text)` with a GIN index on the same column; no data migration.
