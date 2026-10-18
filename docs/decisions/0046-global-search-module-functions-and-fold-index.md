# 0046 Global search: one search function per module and an indexed fold function

Date: 2026-10-18
Status: accepted

## Context
The global search (Cmd/Ctrl+K, [spec](../superpowers/specs/2026-10-18-global-search-design.md)) reads groups, tickets, tasks, knowledge, projects and people at once, for every role. Two rules constrain it: permissions only through each module's policy functions, and no module touching another module's tables. It must also ignore diacritics ("luky" finds "Lúky") and stay on indexes with ~3 000 clients and hundreds of thousands of rows. Only knowledge (`search_text`) and projects (`name_key`) had a folded column; tickets and tasks had trigram indexes on the raw text, which match case-insensitively (`ilike`) but not without diacritics.

## Decision
- **Each module exports `search<Type>(db, actor, access, text, limit)`** (`groups/search.ts`, `tickets/search.ts`, `tasks/search.ts`, `knowledge/search.ts`, `projects/search.ts`, `users/search.ts`). It scopes its one query by its own policy and filters the returned rows with that policy again. `access` is the caller's active roles per group, one query (`groupAccessOf` in `groups/memberships.ts`; none for admins). `modules/search/service.ts` runs the asked types in parallel and composes the answer; it reads no table itself.
- **Folding in SQL is a database function, `spolu_fold(text)`** (migration 0055): `lower(regexp_replace(normalize(t, NFD), '[\u0300-\u036f]', '', 'g'))`, the same as `normalizeSearch` for Latin and Cyrillic. Written in PL/pgSQL, `IMMUTABLE STRICT PARALLEL SAFE COST 1000`: immutable so it can be indexed, PL/pgSQL so it is never inlined, and expensive to the planner so it prefers the trigram index to folding a whole table (an inlined expression costs almost nothing to it, and it scanned `groups` whole, 13 ms instead of 1 ms). `foldSql` (`infra/db/fold.ts`) renders the call for both the schema's indexes and the queries, so they always match.
- **New trigram GIN indexes on folded expressions:** `groups_name_fold_trgm_idx`, `tasks_title_fold_trgm_idx`, `tickets_subject_fold_trgm_idx`, `projects_name_fold_trgm_idx`, `project_events_name_fold_trgm_idx`, `user_search_fold_trgm_idx` (name and email). Knowledge keeps `knowledge_items_search_idx`. The existing raw-text indexes stay for the pickers that use them.
- **A deactivated group is out of every search function, for admins too** (owner decision of 2026-10-18): each one filters `groups.deactivated_at is null` on the group row it already joins (no extra query), and `groupAccessOf` skips memberships of a deactivated group. The MCP `search` tool follows, as it calls the same route.
- No new dependency; `pg_trgm` is already installed (migration 0012); `normalize` needs a UTF-8 database, which ours is.

## Consequences
- A new searchable type is one module function and one line in `SEARCHERS`; the leak matrix in `modules/search/routes.test.ts` covers each role.
- Writes to the six tables update one more GIN index each; at our write rates this is negligible.
- `spolu_fold` is not in drizzle's snapshot (drizzle-kit does not track functions); it lives in the hand-edited migration 0055 and must exist before any of the six indexes. A future migration that recreates those indexes must keep the function.
- Text folded in SQL and in JavaScript could drift for marks outside U+0300–U+036F; such marks are rare in Slovak, Czech and the other UI languages, and a miss only means a hit not found.
