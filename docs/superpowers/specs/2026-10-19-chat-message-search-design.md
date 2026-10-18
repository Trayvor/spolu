# Search in chat messages

Date: 2026-10-19, aligned with the owner's decisions of the same day. Status: designed, not built. Builds on the global search (merged on `main` with #143: [spec](2026-10-18-global-search-design.md), [ADR 0046](../../decisions/0046-global-search-module-functions-and-fold-index.md), [product/search.md](../../product/search.md)) and closes the "Search over group messages" item of Phase 16 ([roadmap](../../roadmap.md)). Decision record: ADR-XXXX (placeholder, "Message search: a stored folded column with a trigram index"). Migration: `00XX_chat-message-search` (placeholder; the orchestrator assigns the number: `main`'s newest is `0062_night_integration` and #113 takes `0063`).

**Sequencing (owner decision):** implementation starts after the current phases are done. This is one of seven specs of 2026-10-19 (#169–#175); the final e2e pass runs once, after all seven are implemented.

## Goal

Find a message by typing a few words of it, wherever it was written: a group chat, a thread, a task chat or a ticket chat. "What did the mayor write about the VAT invoice?", "where did we send the link to the call?". The hits appear in the existing Cmd/Ctrl+K palette as a seventh section, **Správy**, with a short snippet and the matched words highlighted; Enter opens the chat at that message (a reply opens its thread). AI assistants get the same through the MCP `search` tool and a paged `search_messages` tool.

## Users and roles

Search finds exactly what the person can already read in the chat; nothing more.

| role     | messages found                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| admin    | every channel of every live group: client group chats, the admin group "eGrant tím", task chats, ticket chats; replies in threads                                             |
| client   | the group chat, task chats and ticket chats of the groups where they are an active `client` member                                                                            |
| žiadateľ | only the ticket chats of the tickets they started (`tickets.requester_user_id = me`), in groups where they are an active `ziadatel` member; never a group chat or a task chat |

Always excluded, for admins too:

- **Deactivated groups** (owner decision, confirmed 2026-10-19: the global search hides everything of a deactivated group, admins included). No message of any channel of a deactivated group (group chat, thread, task chat, ticket chat) is ever a hit, for anyone, through `/api/search`, `/api/search/messages` (also with `groupId` of that group: an empty page) or MCP. The query joins `groups` and filters `deactivated_at is null`; `groupAccessOf` already drops memberships of a deactivated group. This matches what #143 does for the other types (`product/search.md`): people stay findable, but a person hit never links into the deactivated group (`groupId: null` for a person whose only group is deactivated). Message search adds no people hits of its own, so the author of a message in a deactivated group is found only through the people section, under that rule. Reactivating the group brings its messages back (the index row never left).
- **Deleted messages** (`deleted_at is not null`; the delete also clears `body`). A message deleted after it was found is gone from the next search; opening a stale hit shows the chat's usual "Správa bola vymazaná".
- **Tickets without a client** have no chat (Phase 21), so nothing to exclude.

## UX

The `frontend-design` skill is the first step of the web task (CLAUDE.md). Only egrant.sk tokens; no motion beyond `animate-menu-in`.

### The palette (lazy `command-palette` chunk)

- The placeholder grows: "Hľadať skupinu, tiket, úlohu, správu…".
- A new section **Správy**, the last one (after Ľudia), up to 5 hits.
- One hit is two lines with a 16 px outline speech-bubble glyph (the typed-menu rule):
  - line 1: the snippet, up to 160 characters, the matched fragments in `<mark>` styled as `font-semibold` on the `secondary` pill colour (no yellow);
  - line 2, `muted`: "{author} · {where} · {date}", where _where_ is "{group}" for a group chat, "{group} · Úloha: {task title}" for a task chat, "{group} · Tiket #{number}" for a ticket chat, and the suffix " · vo vlákne" for a reply. The date is the chat's short relative date (today's time, "včera", or the date).
- Under the five hits a row **Zobraziť ďalšie správy** loads the next 20 into the same section (keyset cursor); it is an option of the listbox, so Up/Down reach it and Enter runs it. After the last page the row disappears.
- Messages need a term of at least 3 characters (the trigram index cannot serve shorter ones on the biggest table). With only 1–2 character terms the section shows one quiet line: "V správach sa hľadá od 3 znakov."
- If the server answered `tooBroad` (the query hit the 2 s limit): "Príliš veľa správ. Spresnite hľadanie."
- The other sections keep coming from `GET /api/search`; messages come from their own request in parallel (`GET /api/search/messages`), so a slow message search never delays the groups and tickets. Each section renders as soon as its answer is in.
- Opening a hit navigates with `chatMessageLocation` (`features/chat/links.ts`): the group's Chat tab, the task panel's Chat tab or the ticket page, with `?message=<id>&c=<channel>` (and `thread=<root>` for a reply). The chat already opens around the message and highlights it for 2 s.
- Message hits are **not** remembered among "Naposledy otvorené" (a snippet of a private conversation should not sit in `localStorage` of a shared device).

### Texts (Slovak is the source; the other eight in the plan, Task 7)

| key (`search` namespace) | sk                                     |
| ------------------------ | -------------------------------------- |
| `placeholder`            | Hľadať skupinu, tiket, úlohu, správu…  |
| `sections.messages`      | Správy                                 |
| `messages.more`          | Zobraziť ďalšie správy                 |
| `messages.minLength`     | V správach sa hľadá od 3 znakov.       |
| `messages.tooBroad`      | Príliš veľa správ. Spresnite hľadanie. |
| `messages.task`          | Úloha: {{title}}                       |
| `messages.ticket`        | Tiket #{{number}}                      |
| `messages.thread`        | vo vlákne                              |
| `messages.deletedAuthor` | Odstránený používateľ                  |

Italian and Slovenian use the formal register (Lei, Vi), as the rest of the `search` namespace.

## Data model

One column and one index on `messages` (chat module, `modules/chat/schema.ts`), migration `00XX_chat-message-search`:

```sql
alter table messages add column search_text text
  generated always as (spolu_fold(regexp_replace(body, '<@[A-Za-z0-9_-]+>', ' ', 'g'))) stored;
create index messages_search_text_trgm_idx on messages using gin (search_text gin_trgm_ops)
  where deleted_at is null and search_text <> '';
```

- **Stored generated column, not service-written.** It reuses `spolu_fold` (migration `0062_night_integration`, on `main`) so SQL and the query's `normalizeSearch` fold the same way; every send, edit and delete updates it with no code path to forget (unlike `knowledge_items.search_text`, ADR 0015), and there is no backfill job: the migration computes it for existing rows. The table rewrite takes an `ACCESS EXCLUSIVE` lock for the migration's duration; at today's size (well under a million rows) that is seconds during the deploy's migration step.
- **Mentions are removed** from the indexed text (`<@id>` becomes a space): a user id is never a match. Names in mentions are therefore not searchable (see open question 2).
- Markdown stays in the text (`**`, `[text](url)`): fragments still match, and URLs inside links stay findable.
- **Partial index**: deleted and empty (attachment-only) messages are not in it, and every query repeats the predicate `deleted_at is null and search_text <> ''` so the planner can use it.
- No other table changes. The existing `messages_channel_parent_created_idx` (channel first) lets the planner `BitmapAnd` a client's few channels with the trigram index.

### Why trigram, not `tsvector`

Decided: trigram (`pg_trgm`, already installed, migration 0012) on the folded column, as ADR 0015 and ADR 0046 did for every other type.

- **Same semantics as the rest of the palette.** Every term is a fragment (`rozpo` finds "rozpočet", `final` finds `budget-2026-final.xlsx`); a `tsvector` would match words and prefixes only, so one query would behave differently per section.
- **No Slovak text search configuration** ships with PostgreSQL; `simple` gives no stemming, so `tsvector` would add a second tokenizer without better recall.
- **Folding is solved once** by `spolu_fold` in the generated column; `unaccent` (not immutable) is not needed.
- **Cost:** a trigram GIN index is 2–3 times larger than a `tsvector` one and a very common word matches many rows. Bounded by: terms of 3+ characters only, the partial index, a 2 s statement timeout (`tooBroad`), and the EXPLAIN checks on a 400 000-message volume (below). If production ever outgrows this (a common-word admin search over 300 ms with `RUN_BENCH=1` on the volume), the ADR records `to_tsvector('simple', search_text)` with a GIN index as the fallback, same column, no data migration.

## API

Shared types in `packages/shared/src/search.ts`:

```ts
SearchTypes = [..., 'people', 'messages']           // messages is a seventh type
type SearchMessageHit = {
  id: string; channelId: string; channelKind: 'group' | 'task' | 'ticket';
  parentId: string | null;                         // a reply: its thread's root
  groupId: string; groupName: string;
  taskId: string | null; taskTitle: string | null;
  ticketId: string | null; ticketNumber: number | null;
  authorName: string | null;                        // null: a deleted account
  createdAt: string;                                // ISO
  snippet: string;                                  // plain text, ≤ 160 chars (+ "…")
  highlights: [start: number, end: number][];       // offsets into snippet, sorted, disjoint
};
SearchResults.messages?: SearchMessageHit[]
MessageSearchQuerySchema = { q (2–100), cursor? (≤ 200 chars), limit (1–20, default 20), groupId? }
type MessageSearchPage = { hits: SearchMessageHit[]; nextCursor: string | null; tooBroad: boolean };
SEARCH_LIMITS.minMessageTerm = 3
```

- `GET /api/search?types=…` accepts `messages` (default `types` now includes it): the first `limit` hits, no cursor. A `tooBroad` search yields `messages: []` here.
- `GET /api/search/messages?q=&cursor=&limit=&groupId=` (any signed-in user): one page and the next cursor. `groupId` narrows to one group (used by MCP now and by an in-chat search later); a group the caller does not read gives an empty page, not 403 (no existence oracle). An invalid cursor is `400 validation_failed`.
- Both share the search routes' rate limiter (120 a minute per user; the palette sends two requests per pause, so 60 pauses a minute). `429 rate_limited` as today.
- **Ranking:** rank 0 when the whole normalized query appears at a word start (`search_text like key% or like % key%`), 1 when it appears anywhere, 2 when only all terms appear separately; then newest first (`created_at desc, id desc`). Rank is computed on the folded column per matching row (cheap `like`).
- **Cursor:** `base64url(JSON [rank, createdAtIso, id])`; the next page is `(rank, created_at desc, id desc)` after it, in SQL `rank > r or (rank = r and (created_at, id) < (c, i))`. A message edited between pages may move; acceptable for search.
- **Snippet and highlights** are built on the server from the page's rows only (`modules/chat/snippet.ts`): the body with mentions as `@Name`, Markdown emphasis markers (`* _ ~ \``), heading and quote markers removed, links as `text (url)`, whitespace collapsed; a window of 160 characters starting about 40 characters before the first match (snapped to a word start, `…` on cut sides); every term's occurrences inside it as offsets, found by folding character by character so "luky" highlights "Lúky". The client never receives HTML.

## Server structure

- `modules/chat/search.ts` exports `messageSearchSql(db, actor, access, text, opts)` (for EXPLAIN) and `searchMessages(db, actor, access, text, opts): Promise<MessageSearchPage>` where `opts = { limit, cursor?: MessageCursor, groupId?: string }`. One query scoped by the readable-channel SQL; then the policy check per row; then labels. The search module calls it (ADR 0046's pattern: one function per module, `modules/search/service.ts` only composes).
- **Readable channels as SQL** (`readableChannelsSql`): admin, no filter; otherwise `channels.group_id in (client groups)` (all three kinds: a client reads every chat and ticket of their group) or `channels.kind = 'ticket' and channels.ticket_id in (<tickets the žiadateľ started in their ziadatel groups>)`. The ticket part comes from the tickets module, `requesterTicketIdsSql(actorId, groupIds)` in `tickets/search.ts` (the tickets module renders SQL over its own table, as `liveGroupSql` does for groups); no role gives null and an empty page without a query.
- **Policy on every row**: group and task chats with `canReadChannel(actor, channel, clientIdsOf(access))`; ticket chats through `readableTicketLabels(db, actor, access, ticketIds)` (new, `tickets/service.ts`, one query: the readable ids with number and subject; `canReadTicket` decides). Rows that fail are dropped.
- **Labels**: task titles via the existing `getTaskTitles(db, ids)` (tasks module), ticket numbers from `readableTicketLabels`; both in parallel, each only when such rows exist. Author and mention names in the same query (read-only join on `user`, the exception `selectMessages` already documents).
- **Timeout**: the search query runs in a transaction with `set local statement_timeout = '2s'`; PostgreSQL error `57014` becomes `{ hits: [], nextCursor: null, tooBroad: true }`.
- **Queries**: per message search at most begin, `set local`, the search, commit, ticket labels, task titles: 6 statements. The full `GET /api/search` with every type stays bounded (counted in `search/routes.test.ts`, 12).

## Permissions

No new policy function: channel reading is `canReadChannel` (chat) and `canReadTicket` (tickets), each module's own. `docs/architecture/permissions.md` gets a "Message search" row. The leak matrix in `modules/search/routes.test.ts` gets messages for each role: admin, client of A (not B), žiadateľ of ticket T1 (not T2, not A's group chat or task chats), a deactivated group (no message for anybody, admins included, on both routes and with `groupId`; its client still found under people with `groupId: null`; reactivation brings the messages back), a deleted message (nobody), an edited message (found by its new text only), a removed member (nothing of the group).

## Notifications and realtime

None. Search only reads; no event, no push, no digest. Results are not live: a new message appears on the next search (the palette's 30 s `staleTime` per query string). Writes are untouched (HTTP writes, socket push after, as today).

## Performance

- **Index:** `messages_search_text_trgm_idx`, partial GIN trigram on the stored folded column; no folding at query time.
- **Guard rails:** at least one term of 3+ characters (`SEARCH_LIMITS.minMessageTerm`), else no query; at most 5 terms; page size ≤ 20; 2 s statement timeout; the palette's separate request.
- **EXPLAIN on a seeded volume** (ADR 0040): a fifth template volume `messages` (`modules/chat/test-volume.ts`, fixed ids `messageVolumeIds()`): 3 000 groups with a group chat, 6 000 task chats, 10 000 ticket chats (a fifth of them started by a žiadateľ), 400 000 messages (60 % group, 25 % task, 15 % ticket; 10 % replies; 2 % deleted; 5 % with a mention; bodies from a Slovak word list with a number, a common phrase "dobrý deň" in 30 %). Checks (`modules/chat/explain.test.ts`): a rare term (`zmluva 12345`) for the admin, the client of five groups and the žiadateľ reads `messages_search_text_trgm_idx` (no `Seq Scan` on `messages`); a common term for the client and the žiadateľ has no sequential scan of `messages`; a common term for the admin is bounded by time only (a sequential scan can be the right plan there): under 30 ms for the rare terms and 300 ms for the common admin search with `RUN_BENCH=1`.
- **Web:** no eager change: the section, its texts and the second query live in the lazy `command-palette` chunk and the lazy `search` namespace. Expected chunk growth well under 1 kB gzip; measured and recorded in `performance.md`.
- **Writes:** one more GIN index on `messages` (fast update, pending list), and the generated column on insert and edit; negligible at chat rates.

## Security and privacy

- Scope by SQL and re-check by policy (defence in depth), as every other search type.
- No HTML from the server: snippets are text plus offsets; the client renders text nodes and `<mark>` elements, no `dangerouslySetInnerHTML`, so the enforced CSP (ADR 0044) needs no change.
- `q` is in the request URL, which Fastify's request log prints. Message text is more sensitive than a group name, so the search routes' request log lines drop the query string (open question 4).
- The MCP tools go through the same routes (allowlist), so an assistant finds only what its user reads.
- Message hits are not stored in the palette's recent list.

## i18n

Nine `search/<code>.json` files get the keys of the table above (Task 7 has every string). No eager text. Server: none (no emails or notifications). `docs/design/wording.md` terms: tiket/tikety (sk), zahtevek (sl), pöördumine (et), тікет (uk), as the namespace already uses.

## MCP

- `search`: its description and `types` hint list `messages`.
- New `search_messages` tool: `q`, optional `groupId`, `cursor`, `limit`; calls `GET /api/search/messages` (allowlisted). Documented in `docs/integrations/mcp.md`.

## Open questions (with the recommended answer)

1. **Rank or newest first?** Recommended: rank tiers then newest, as above; a "Najnovšie" toggle only if people ask.
2. **Search mention names and author names** ("from:Peter")? Recommended: not in v1. A person filter (`authorId`) on `GET /api/search/messages` is the cheaper follow-up than putting names into the indexed text (they change with renames).
3. **In-chat search** (a magnifier inside a group chat that searches only that group)? Recommended: later; the API's `groupId` already serves it, and the UI is one input in the chat header.
4. **Strip `q` from the request log** of `/api/search*`? Recommended: yes, in this change (Task 6): a message search is closer to message content than any other log line.
5. **Attachments' file names** in message search? Recommended: no; files stay with their message (as the global search decided) and the knowledge base is where documents are searched.
6. **Statement timeout value**: recommended 2 s; the palette would rather say "spresnite" than spin.
