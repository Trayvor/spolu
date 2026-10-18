# Global search and quick switcher (Cmd/Ctrl+K)

Date: 2026-10-18. Status: built (branch `feat/global-search`). Source: UX review batch 10 (finding X1, F1). Product description: [product/search.md](../../product/search.md). Decision record: [ADR 0046](../../decisions/0046-global-search-module-functions-and-fold-index.md).

## Goal

One place to find anything by typing: "open #4821", "open Obec Lúky", "find the task about VAT". Admins jump between ~3 000 clients by keyboard; clients and žiadatelia find their own things.

## Owner decision

Search is for everyone. Admins search everything they can read; clients and žiadatelia only what they can read: their groups, their tickets, the knowledge shared with them.

## Decisions taken (autonomously, 2026-10-18)

1. **Types.** Groups (clients and, for admins, the admin group "eGrant tím"), tickets (`#number` or subject), tasks (title), knowledge items (title, text, URL, file names; no chat files), projects and events (name), people (name or email).
2. **People are admins only** (`canSearchPeople` in `users/policy.ts`). A client never gets a directory across clients; inside a group they already see its members. A person's hit leads to `/admins` (an admin) or the Members tab of their first group (a client or žiadateľ); a person with no group is left out of the palette.
3. **Chat messages are not searched.** No index serves free text over `messages.body`, and Phase 16 owns message search; when it lands, the chat module exports `searchMessages` and the search module adds one type.
4. **Finance is never in the global search**, for finance admins either: the finance module stays the only reader of its tables (its own screens have their own search). A later `searchFinance` for finance holders would be one more type, gated by `canSeeFinance`.
5. **Ranking per type:** the whole query first, then a name starting with it, then a word starting with it, then any fragment (`rankSql`); ties: a ticket's exact number first; open before resolved or done; newest first (tickets, tasks), latest change (knowledge), by name (groups, people), active projects before archived, projects before events.
6. **Diacritics and case never matter.** The query is normalized like `normalizeSearch`; the columns go through `spolu_fold`, an immutable PL/pgSQL function (migration 0062) that does the same in SQL, with a trigram GIN index on the folded expression. Its high `COST` keeps the planner on the index: with an inlined expression it read the 3 000 groups whole (13 ms instead of 1 ms).
7. **Limits.** `q` 2–100 characters (each term from 2 characters, at most 5 terms, all must match); 5 hits per type by default, at most 20 (`limit`); 120 searches a minute per user (`429 rate_limited`).
8. **Queries.** One query per type, run in parallel, plus one memberships read for a non-admin: at most six (counted in `routes.test.ts`).
9. **Permissions.** Each module exports its search function and scopes its one query by its own policy (`canReadGroup`, `canUseBoard`, `canReadTicket`, `canReadItem`, `canReadProjects`), then checks every returned row with the same policy. The search module (`modules/search/`) only composes them and never touches another module's tables.
10. **MCP:** a `search` tool through the same route (allowlisted `GET /api/search`).

## API

`GET /api/search?q=&types=&limit=` (any signed-in user). `types` is a comma list of `groups,tickets,tasks,knowledge,projects,people` (default all; an unknown type is `400`). The answer has one list per asked type (`SearchResults` in `packages/shared/src/search.ts`); `people` is absent for non-admins.

## Web

- **Trigger (eager, +0.40 kB gzip):** `components/search-trigger.tsx`, a 38 px icon button in the header before the account menu, and a window listener for Cmd+K / Ctrl+K. The label `nav.search` is the only eager text.
- **Palette (lazy chunk `command-palette`, 3.9 kB gzip, `search` namespace):** a modal native `<dialog>`; a 640 px panel 12 vh from the top from 641 px, a full-screen sheet on phones with a Cancel button. The input is an ARIA combobox over a listbox grouped by type. Empty: recently opened items (per browser and user, `localStorage`, 8) and quick actions (the person's header sections, Settings, and "New task in this group" inside a group). From 2 characters: matching actions and the hits, 150 ms after typing pauses. Up/Down move (wrapping), Enter opens, Escape, Back or the backdrop close. Opening an item replaces the palette's history entry, so Back returns to where the search started.
- **Design:** egrant.sk tokens only: white card, `shadow-lift`, 2 px `border` dividers, sentence-case section names in `muted`, the active row on the `secondary` pill colour (as the header's current section), a 16 px outline glyph per type (the typed-menu rule), a ticket's `#number` as a small `secondary` chip with tabular figures. A key legend under the list on computers only. No motion beyond `animate-menu-in`.

## Not done (later)

- Message search (Phase 16) as a seventh type.
- A "show all" page per type (the route already takes `types` and `limit`).
- Free-text search and sort in the ticket list itself (X10): the ticket list keeps its existing `q` (number, subject, start of the body).
