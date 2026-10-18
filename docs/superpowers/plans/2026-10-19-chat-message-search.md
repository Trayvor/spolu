# Search in chat messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat messages (group chats, threads, task chats, ticket chats) become a seventh type of the global search: in the Cmd/Ctrl+K palette with highlighted snippets and paging, and in the MCP `search` and new `search_messages` tools, within what each person reads.

**Architecture:** A stored generated column `messages.search_text = spolu_fold(body without mention tokens)` with a partial trigram GIN index. The chat module exports `searchMessages` (one scoped query, policy re-check per row, labels from the tasks and tickets modules); the search module composes it into `GET /api/search` and serves pages at `GET /api/search/messages`. The palette asks for messages in a second, parallel request.

**Tech Stack:** Fastify, drizzle-orm, PostgreSQL 17 (`pg_trgm`, `spolu_fold`), Vitest, React + TanStack Query, i18next, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-19-chat-message-search-design.md](../specs/2026-10-19-chat-message-search-design.md)

Branch: `feat/chat-message-search` from a fresh `origin/main`. One pull request. Server tests with an own database: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_msgsearch`. Do not run `pnpm test:e2e` or `scripts/ci.sh` in parallel with other agents.

**Sequencing (owner decision, 2026-10-19):** start this plan only after the current phases are done. It is one of seven plans of 2026-10-19 (#169–#175); the final e2e pass runs once, after all seven are implemented, by whoever merges. Prerequisites already on `main`: the global search (#143, with the `search` module, `spolu_fold` and the deactivated-group rule), the notification centre (#155), mentions (#162) and recurring calls (#165).

## Global Constraints

- English in code, comments, docs and commits; UI texts in all nine locales (sk, en, cs, sl, bg, et, it, hr, uk); it and sl formal (Lei, Vi).
- New UI texts only in the lazy `search` namespace (`apps/web/src/locales/search/<code>.json`), never in the eager `locales/<code>.json`; no eager JS change (initial JS budget 200 kB gzip).
- Permissions only through policy functions: `canReadChannel` (chat), `canReadTicket` (tickets). The chat module never reads the `tickets` or `tasks` tables; it calls `requesterTicketIdsSql`, `readableTicketLabels`, `getTaskTitles`.
- Nothing of a deactivated group, for admins too (owner decision): no message of any of its channels on either route, with or without `groupId`, nor through MCP. People stay findable in the people section, but never linked into the deactivated group (`groupId: null`, as #143 already does); message search adds no people hits. No deleted message (`deleted_at is null`).
- Migration placeholder name `00XX_chat-message-search` (the orchestrator renumbers; `main`'s newest is `0062_night_integration`, #113 takes `0063`); ADR placeholder `ADR-XXXX` (file `docs/decisions/XXXX-message-search-stored-fold-column-trigram.md`).
- Query `q` 2–100 characters, at most 5 terms; messages need a term of at least 3 characters (`SEARCH_LIMITS.minMessageTerm = 3`); page size 1–20 (default 20 on `/api/search/messages`, the global `limit` on `/api/search`); snippet ≤ 160 characters plus `…`.
- Statement timeout of the message search: `2s`; PostgreSQL code `57014` becomes `tooBroad: true`.
- Rate limit shared with the global search: `SEARCH_RATE` (120 a minute per user).
- Snippets are plain text plus offsets; the web never uses `dangerouslySetInnerHTML` (CSP, ADR 0044).
- Any design work starts with the `frontend-design` skill; egrant.sk tokens only.
- Every task updates the docs it affects (`update-kb`), in the same commit.
- Do not edit `docs/roadmap.md` (the orchestrator links plans).

## Review Focus

1. **A žiadateľ and another person's ticket chat in the same group:** the žiadateľ must never see it, also when a word matches both; pinned in Task 5 (`ziadatel finds only their own ticket chat`) and Task 6's leak matrix.
2. **A client removed from a group, or a group deactivated after messages were written:** nothing of that group comes back, admins included for the deactivated group; Task 5 (`nothing of a deactivated group, for admins too`, `a removed member finds nothing`).
3. **Diacritics and case in both directions:** "luky" finds "Lúky" and highlights the right characters, also when NFD changes the string length ("Ľ", "ô"); Task 3 (`highlights the original characters of a folded match`).
4. **Paging stability:** page 2 never repeats a hit of page 1, even with equal `created_at`; Task 5 (`pages without repeats on equal timestamps`).
5. **LIKE wildcards in the query** (`50%`, `a_b`, `\`): they match literally, never everything; Task 5 (`treats % and _ as text`).

---

### Task 1: Shared types and the query schema

**Files:**

- Modify: `packages/shared/src/search.ts`
- Test: `packages/shared/src/search.test.ts`

**Interfaces:**

- Produces:
  - `SearchTypes` = `['groups','tickets','tasks','knowledge','projects','people','messages']`
  - `SEARCH_LIMITS.minMessageTerm = 3`, `SEARCH_LIMITS.messagesPage = 20`
  - `type SearchMessageHit = { id; channelId; channelKind: 'group'|'task'|'ticket'; parentId: string|null; groupId; groupName; taskId: string|null; taskTitle: string|null; ticketId: string|null; ticketNumber: number|null; authorName: string|null; createdAt: string; snippet: string; highlights: [number, number][] }`
  - `SearchResults.messages?: SearchMessageHit[]`
  - `MessageSearchQuerySchema` (zod): `q` trimmed 2–100, `cursor` optional string ≤ 200, `limit` coerced int 1–20 default 20, `groupId` optional string ≤ 64
  - `type MessageSearchQuery = z.infer<typeof MessageSearchQuerySchema>`
  - `type MessageSearchPage = { hits: SearchMessageHit[]; nextCursor: string | null; tooBroad: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
it('accepts messages as a type and includes it by default', () => {
  expect(SearchQuerySchema.parse({ q: 'ab', types: 'messages' }).types).toEqual(['messages']);
  expect(SearchQuerySchema.parse({ q: 'ab' }).types).toContain('messages');
});
it('message search query: limits and defaults', () => {
  expect(MessageSearchQuerySchema.parse({ q: ' zmluva ' })).toEqual({ q: 'zmluva', limit: 20 });
  expect(MessageSearchQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
  expect(MessageSearchQuerySchema.safeParse({ q: 'ab', limit: '21' }).success).toBe(false);
  expect(MessageSearchQuerySchema.safeParse({ q: 'ab', cursor: 'x'.repeat(201) }).success).toBe(
    false,
  );
});
```

- [ ] **Step 2: Run** `pnpm --filter @spolu/shared test -- search` — Expected: FAIL (`MessageSearchQuerySchema` not exported).
- [ ] **Step 3: Implement** the types above in `packages/shared/src/search.ts`; export from the package index if `search.ts` is re-exported there.
- [ ] **Step 4: Run** the same command — Expected: PASS. Run `pnpm typecheck`: the `SEARCHERS` record in `apps/server/src/modules/search/service.ts` now fails to type-check (missing `messages`); add a temporary `messages: async () => []` entry with a `// Task 6` comment so the tree compiles.
- [ ] **Step 5: Commit** `feat(shared): message search types`.

### Task 2: The folded column, its index and the ADR

**Files:**

- Modify: `apps/server/src/modules/chat/schema.ts` (`messages` table)
- Create: `apps/server/src/infra/db/migrations/00XX_chat-message-search.sql` (+ `meta/` snapshot and journal via `db:generate`)
- Create: `apps/server/src/modules/chat/search-text.test.ts`
- Create: `docs/decisions/XXXX-message-search-stored-fold-column-trigram.md`; Modify: `docs/decisions/README.md`, `docs/architecture/data-model.md`

**Interfaces:**

- Produces: column `messages.search_text` (drizzle `searchText`), `generatedAlwaysAs(sql\`spolu_fold(regexp_replace(${t.body}, '<@[A-Za-z0-9_-]+>', ' ', 'g'))\`)`; index `messages_search_text_trgm_idx` `using gin (search_text gin_trgm_ops) where deleted_at is null and search_text <> ''`.

- [ ] **Step 1: Write the failing tests** (`search-text.test.ts`, real test database, messages created through `sendMessage`/`editMessage`/`deleteMessage` of `chat/messages.ts`):

```ts
it('stores the body folded, without mention tokens', async () => {
  // body: 'Dobrý deň <@u1>, ROZPOČET je v prílohe'
  expect(row.searchText).toBe('dobry den  , rozpocet je v prilohe');
});
it('follows an edit and empties on delete', async () => {
  // after edit to 'Faktúra' → 'faktura'; after delete → ''
});
it('the index exists with its predicate', async () => {
  // select indexdef from pg_indexes where indexname = 'messages_search_text_trgm_idx'
  expect(def).toContain('gin_trgm_ops');
  expect(def).toContain('(deleted_at IS NULL)');
});
```

- [ ] **Step 2: Run** `rtk proxy pnpm --filter @spolu/server exec vitest run src/modules/chat/search-text.test.ts` — Expected: FAIL (no column).
- [ ] **Step 3: Implement** the column and index in `schema.ts`; check the latest migration number on `origin/main`, run `pnpm --filter @spolu/server db:generate`, rename the file to `00XX_chat-message-search.sql` (keep the journal tag consistent), and check the SQL is `add column "search_text" text generated always as (...) stored` plus `create index ... using gin ... where`. The migration depends on `spolu_fold` (`0062_night_integration`) — add a comment line saying so.
- [ ] **Step 4: Run** the test — Expected: PASS. Run `src/infra/db/foreign-key-indexes.test.ts` — Expected: PASS.
- [ ] **Step 5: Write ADR-XXXX** ("Message search: a stored folded column with a trigram index"): context (biggest table, Phase 16), decision (generated column reusing `spolu_fold`, partial trigram GIN, 3-character terms, 2 s timeout, rank tiers), why not `tsvector` (from the spec), consequences (table rewrite on migrate, index size, mentions not searchable, the `tsvector` fallback with its trigger: common-word admin search over 300 ms with `RUN_BENCH=1`). Add its row to `docs/decisions/README.md`; `data-model.md` gets the column and index under `messages`.
- [ ] **Step 6: Commit** `feat(chat): folded search column on messages`.

### Task 3: Snippet and highlight builder

**Files:**

- Create: `apps/server/src/infra/text/highlight.ts`, `apps/server/src/infra/text/highlight.test.ts`
- Create: `apps/server/src/modules/chat/snippet.ts`, `apps/server/src/modules/chat/snippet.test.ts`

**Interfaces:**

- Produces:
  - `foldWithMap(text: string): { folded: string; map: number[] }` — `folded` as `normalizeSearch` without the whitespace collapse/trim; `map[i]` = index in `text` of the character that produced `folded[i]`.
  - `findRanges(text: string, terms: string[]): [number, number][]` — every occurrence of every (already folded) term in `text`, in original offsets, sorted and merged.
  - `messageSnippet(body: string, nameOf: (id: string) => string | undefined, terms: string[], max = 160): { snippet: string; highlights: [number, number][] }`

- [ ] **Step 1: Write the failing tests**

```ts
it('highlights the original characters of a folded match', () => {
  expect(findRanges('Obec Lúky a Ľubica', ['luky', 'lubica'])).toEqual([
    [5, 9],
    [12, 18],
  ]);
  // NFD-decomposed input keeps original offsets
  const nfd = 'Lúky';
  expect(findRanges(nfd, ['luky'])).toEqual([[0, 5]]);
});
it('merges overlapping ranges', () => {
  expect(findRanges('rozpocet', ['rozpo', 'pocet'])).toEqual([[0, 8]]);
});
it('plain text: mentions as names, markdown markers out, links kept', () => {
  const s = messageSnippet('**Ahoj** <@u1>, pozri [výzvu](https://x.sk/v)', () => 'Peter', [
    'vyzvu',
  ]);
  expect(s.snippet).toBe('Ahoj @Peter, pozri výzvu (https://x.sk/v)');
  expect(s.highlights).toEqual([[19, 24]]);
});
it('windows around the first match with ellipses', () => {
  const body = `${'slovo '.repeat(60)}zmluva ${'koniec '.repeat(60)}`;
  const s = messageSnippet(body, () => undefined, ['zmluva']);
  expect(s.snippet.startsWith('…')).toBe(true);
  expect(s.snippet.endsWith('…')).toBe(true);
  expect(s.snippet.length).toBeLessThanOrEqual(162);
  const [[a, b]] = s.highlights;
  expect(s.snippet.slice(a, b)).toBe('zmluva');
});
it('no match in the text (it came from a URL cut away or a mention): the start, no highlights', () => {
  expect(messageSnippet('Krátka správa', () => undefined, ['xyz'])).toEqual({
    snippet: 'Krátka správa',
    highlights: [],
  });
});
```

- [ ] **Step 2: Run** `rtk proxy pnpm --filter @spolu/server exec vitest run src/infra/text/highlight.test.ts src/modules/chat/snippet.test.ts` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** `foldWithMap` walks the text by code point: `ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`, pushing the source index once per output character. `messageSnippet`: mentions via `MENTION_RE` (`@Name`, `@all` for `all`, `@?` unknown), links `[t](u)` → `t (u)`, strip `**`, `__`, `~~`, `` ` ``, single `*`/`_` around words, leading `#`/`>` markers, collapse whitespace; window starts 40 characters before the first range, moved forward to the next word start; `…` on each cut side; highlights shifted into the window and clipped.
- [ ] **Step 4: Run** the tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(chat): message search snippets with highlights`.

### Task 4: Ticket helpers for the chat's search

**Files:**

- Modify: `apps/server/src/modules/tickets/search.ts`, `apps/server/src/modules/tickets/service.ts`
- Test: `apps/server/src/modules/tickets/search-helpers.test.ts`

**Interfaces:**

- Consumes: `GroupAccess` (`groups/memberships.ts`), `canReadTicket` (`tickets/policy.ts`).
- Produces:
  - `requesterTicketIdsSql(actorId: string, groupIds: string[]): SQL` — `select id from tickets where requester_user_id = $actorId and group_id in (...)` as a subquery for `in (...)`.
  - `readableTicketLabels(db: Db, actor: SessionUser, access: GroupAccess, ids: string[]): Promise<Map<string, { number: number; subject: string | null }>>` — one query (none for an empty list); only tickets `canReadTicket` allows with the role from `access`.

- [ ] **Step 1: Write the failing tests**

```ts
it("requesterTicketIdsSql lists only the actor's own tickets in the given groups", async () => {
  // tickets T1 (requester z, group A), T2 (requester other, group A), T3 (requester z, group B)
  // select id from tickets where id in (requesterTicketIdsSql(z, [A]))
  expect(ids).toEqual([T1]);
});
it('readableTicketLabels: client all of the group, ziadatel own only, admin all, one query', async () => {
  expect([...(await readableTicketLabels(db, ziadatel, accessZ, [T1, T2])).keys()]).toEqual([T1]);
  expect((await readableTicketLabels(db, client, accessC, [T1, T2])).size).toBe(2);
  expect((await readableTicketLabels(db, admin, NO_ACCESS, [T1, T2, T3])).get(T1)).toEqual({
    number: t1.number,
    subject: t1.subject,
  });
  // createCountingDb: count() === 1
});
```

- [ ] **Step 2: Run** `rtk proxy pnpm --filter @spolu/server exec vitest run src/modules/tickets/search-helpers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both functions (select `id, number, subject, groupId, requesterUserId`, filter with `canReadTicket(actor, row, row.groupId ? access.roles.get(row.groupId) ?? null : null)`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tickets): readable labels and requester tickets for message search`.

### Task 5: `searchMessages` in the chat module

**Files:**

- Create: `apps/server/src/modules/chat/search.ts`, `apps/server/src/modules/chat/search.test.ts`
- Modify: `apps/server/src/infra/text/search.ts` (add `hasIndexableTerm`)

**Interfaces:**

- Consumes: Task 1 types; `matchesAllSql`, `escapeLike`, `SearchText` (`infra/text/search.ts`); `canReadChannel` (`chat/policy.ts`); `clientIdsOf`, `GroupAccess` (`groups/memberships.ts`); `groups` schema (join for name and `deactivated_at`); `user` schema (read-only names); Task 3 `messageSnippet`; Task 4 helpers; `getTaskTitles` (`tasks/task-service.ts`).
- Produces:
  - `hasIndexableTerm(text: SearchText, min = SEARCH_LIMITS.minMessageTerm): boolean`
  - `type MessageCursor = { rank: number; createdAt: string; id: string }`
  - `encodeMessageCursor(c: MessageCursor): string`, `decodeMessageCursor(s: string): MessageCursor | null` (base64url JSON array; null on anything malformed)
  - `type MessageSearchOptions = { limit: number; cursor?: MessageCursor; groupId?: string; timeoutMs?: number }` (`timeoutMs` default 2000; tests only change it)
  - `messageSearchSql(db: Db, actor: SessionUser, access: GroupAccess, text: SearchText, opts: MessageSearchOptions)` — the drizzle query (selects `limit + 1` rows), or null when the actor reads no channel or no term is indexable
  - `searchMessages(db, actor, access, text, opts): Promise<MessageSearchPage>`
  - `rankMessageSql(text: SearchText): SQL<number>` — 0: `search_text like key% or like '% key%'`; 1: `like %key%`; 2: otherwise

- [ ] **Step 1: Write the failing tests** (`search.test.ts`; fixtures: groups A, B and deactivated D; admin; client of A; žiadateľ z of A with ticket T1, another ticket T2 in A by someone else; messages in A's group chat, a task chat of A, T1's and T2's chats, a reply in a thread, a deleted message, one in B, one in D; all contain a unique word `w` from `word()`):

```ts
it('admin finds every live channel kind and the reply, newest first within a rank', ...)
  // hits' channelKind set equals {'group','task','ticket'}; the reply has parentId = root id
it('client of A finds A\'s group, task and ticket chats, never B', ...)
it('ziadatel finds only their own ticket chat', ...)
  // hits.map(h => h.ticketId) toEqual [T1]
it('nothing of a deactivated group, for admins too', ...)
  // messages in D's group chat, a task chat, a ticket chat and a thread reply (seeded before the
  // deactivation): admin and D's former client get no hit; admin with groupId = D gets an empty page
it('a reactivated group\'s messages are found again', ...)
  // setGroupDeactivated(D, false) → admin finds the four messages; back to true in finally
it('a removed member finds nothing of the group', ...)
it('never a deleted message; an edited one by its new text only', ...)
it('labels: task title, ticket number, author name, group name', ...)
  // { taskTitle: 'Úloha X', ticketNumber: t1.number, authorName: 'Klient A', groupName: 'A' }
it('ranks a word start before a fragment, then newest', ...)
  // bodies 'zmluvaxx …' (older) and 'prezmluvaxx' (newer) for q 'zmluvaxx' → older first
it('pages without repeats on equal timestamps', ...)
  // 7 messages with the same created_at, limit 3 → 3+3+1 hits, all ids distinct, last nextCursor null
it('treats % and _ as text', ...)
  // q `${w} 50%` finds only the message with '50%'
it('no query without a term of 3 characters', ...)
  // q 'ab cd' → { hits: [], nextCursor: null, tooBroad: false }, counting db count() === 0
it('groupId narrows; an unread group gives an empty page', ...)
it('a statement over the timeout resolves to TOO_BROAD', ...)
  // withStatementTimeout(db, 10, (tx) => tx.execute(sql`select pg_sleep(0.2)`)) resolves to TOO_BROAD
  // (assert the outcome, not wall time)
it('one message search is at most six statements', ...)
  // createCountingDb, admin with group+task+ticket hits: count() <= 6
```

- [ ] **Step 2: Run** `rtk proxy pnpm --filter @spolu/server exec vitest run src/modules/chat/search.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** in `chat/search.ts`:
  - readable SQL: admin `undefined`; else parts `inArray(channels.groupId, clientIdsOf(access))` and, for the `ziadatel` group ids, `and(eq(channels.kind, 'ticket'), sql\`${channels.ticketId} in (${requesterTicketIdsSql(actor.id, ids)})\`)`; no part → null.
  - where: `matchesAllSql(messages.searchText, text.terms)`, `isNull(messages.deletedAt)`, `sql\`${messages.searchText} <> ''\``, `isNull(groups.deactivatedAt)`, readable, optional `eq(channels.groupId, groupId)`, and the cursor condition `rank > r or (rank = r and (created_at, id) < (c, i))`.
  - select: message id, channel id/kind/task id/ticket id, parent id, group id/name, author name (left join `user`), body, created_at, rank, mention names (`json_object_agg` subquery as in `getSourceMessage`).
  - order: rank, `created_at desc`, `id desc`; `limit + 1` to know `nextCursor`.
  - `export async function withStatementTimeout<T>(db: Db, ms: number, run: (tx: Db) => Promise<T>): Promise<T | typeof TOO_BROAD>` — a transaction with `set local statement_timeout = ${ms}` (literal integer, validated), catching code `57014`.
  - re-check: group/task rows with `canReadChannel(actor, row, clientIdsOf(access))`; ticket rows kept only if in `readableTicketLabels(...)`; labels from that map and `getTaskTitles` in parallel (skip either when no ids).
  - hits mapped with `messageSnippet(body, nameOf, text.terms)`; `createdAt` ISO.
- [ ] **Step 4: Run** the tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(chat): searchMessages scoped by channel access`.

### Task 6: Routes, global search wiring, log redaction

**Files:**

- Modify: `apps/server/src/modules/search/service.ts`, `apps/server/src/modules/search/routes.ts`, `apps/server/src/app.ts` (logger `serializers.req`)
- Create: `apps/server/src/infra/http/log-redact.ts`, `apps/server/src/infra/http/log-redact.test.ts`
- Test: `apps/server/src/modules/search/routes.test.ts`
- Docs: `docs/product/search.md`, `docs/architecture/permissions.md`, `docs/architecture/overview.md` (search module line)

**Interfaces:**

- Consumes: Task 5 `searchMessages`, `decodeMessageCursor`, `encodeMessageCursor`; Task 1 schema.
- Produces:
  - `SEARCHERS.messages = (db, actor, access, text, limit) => searchMessages(db, actor, access, text, { limit }).then((p) => p.hits)`
  - `searchMessagePage(db: Db, actor: SessionUser, query: MessageSearchQuery): Promise<MessageSearchPage | 'invalid_cursor'>` in `search/service.ts`
  - `GET /api/search/messages` (any user, `SEARCH_RATE` limiter shared with `/api/search`: one `allow` instance for both)
  - `redactSearchQuery(url: string): string` — for paths starting `/api/search`, drops everything after `?`; other URLs unchanged

- [ ] **Step 1: Write the failing tests** (extend `routes.test.ts`):

```ts
it('messages: the leak matrix per role', ...)
  // for admin, client A, client B, ziadatel z, removed member: the sets of found message ids
  // equal the expected sets, through both /api/search?types=messages and /api/search/messages
it('messages page: nextCursor walks every hit once; a broken cursor is 400', ...)
  // cursor 'abc' → 400 { error: 'validation_failed' }
it('a deactivated group: no message for the admin, its people never linked into it', ...)
  // extends the existing describe('a deactivated group') of #143: seed a group-chat message, a
  // task-chat message and a ticket-chat message with w before setGroupDeactivated(g, true);
  // as admin: /api/search?q=w (all types) → messages [] and people [[client.id, null]];
  // /api/search/messages?q=w and ?q=w&groupId=g → { hits: [], nextCursor: null };
  // MCP search (types=messages) and search_messages → no hit; the client's cookie → nothing;
  // after reactivation (in the existing try/finally) the three messages are among the ids
it('messages share the search rate limit', ...)
  // 120 mixed calls ok, the 121st on either route → 429 rate_limited
it('takes at most twelve statements with every type, for an admin and for a client', ...)
  // replaces 'takes at most six queries'; comment lists: memberships 1, five or six types 1 each,
  // messages ≤ 6 (begin, set local, search, commit, ticket labels, task titles)
it('the MCP search tool finds messages', ...)  // callTool(..., 'search', { q: w, types: 'messages' })
```

`log-redact.test.ts`:

```ts
expect(redactSearchQuery('/api/search/messages?q=tajne')).toBe('/api/search/messages');
expect(redactSearchQuery('/api/search?q=x&types=messages')).toBe('/api/search');
expect(redactSearchQuery('/api/groups?q=x')).toBe('/api/groups?q=x');
```

- [ ] **Step 2: Run** `rtk proxy pnpm --filter @spolu/server exec vitest run src/modules/search src/infra/http/log-redact.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the searcher, the page function (decode cursor → `'invalid_cursor'` → 400), the route, and the logger: `serializers: { req: (req) => ({ method: req.method, url: redactSearchQuery(req.url), host: req.host, remoteAddress: req.ip }) }` in both `logger` objects of `buildApp`. Remove Task 1's placeholder.
- [ ] **Step 4: Run** — Expected: PASS. Run the whole server suite once: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_msgsearch rtk proxy pnpm --filter @spolu/server test` — Expected: PASS.
- [ ] **Step 5: Docs.** `product/search.md`: a "messages" row in the table (admins every chat; clients their groups' chats; žiadatelia their tickets' chats), the 3-character rule, "Zobraziť ďalšie správy", that hits are not remembered; drop "Chat messages are not searched yet". `permissions.md`: message search row (rules and functions). The global search spec's "Not done" item gets "done, see 2026-10-19 spec".
- [ ] **Step 6: Commit** `feat(search): messages in the global search and a paged route`.

### Task 7: The palette's Správy section (web)

**Files:**

- Modify: `apps/web/src/features/search/model.ts`, `apps/web/src/features/search/command-palette.tsx`
- Create: `apps/web/src/features/search/message-hit.tsx`
- Modify: `apps/web/src/locales/search/{sk,en,cs,sl,bg,et,it,hr,uk}.json`
- Test: `apps/web/src/features/search/command-palette.test.tsx`, `apps/web/src/features/search/model.test.ts` (create if absent)

**Interfaces:**

- Consumes: `SearchMessageHit`, `MessageSearchPage` (Task 1); `chatMessageLocation` (`features/chat/links.ts`).
- Produces:
  - `PaletteKind` gains `'message'` and `'more'`; `PaletteItem` gains `highlights?: [number, number][]` and `onSelect?: () => void` (for the more row)
  - `RESULT_ORDER` gains `'messages'` (last)
  - `messageItems(hits: SearchMessageHit[], t: TFunction): PaletteItem[]` — label = snippet, detail = `author · group[ · Úloha: …| · Tiket #…][ · vo vlákne] · date`, link = `chatMessageLocation(groupId, { messageId, channelId, taskId, ticketId, parentId })`
  - `rememberRecent` ignores items of kind `message`
  - `<Highlighted text highlights />` in `message-hit.tsx`: text nodes and `<mark className="rounded-sm bg-secondary font-semibold text-inherit">`
  - `/search` request now sends `types=groups,tickets,tasks,knowledge,projects,people`; a second `useInfiniteQuery` (`['search','messages',term]`) asks `/search/messages?q=&limit=5` for the first page and `limit=20&cursor=` for the next ones, enabled only when a folded term has 3+ characters

- [ ] **Step 1: Invoke the `frontend-design` skill** for the hit row and the more row (egrant.sk tokens; two-line row, 16 px speech-bubble outline glyph, `muted` second line, no new motion).
- [ ] **Step 2: Write the failing tests**

```ts
it('lists message hits last with highlighted fragments; Enter opens the chat at the message', ...)
  // mock /api/search/messages → one hit with highlights [[0, 6]]; expect <mark> text 'Zmluva';
  // Enter → navigate({ to: '/groups/$groupId/chat', search: { message: 'm1', c: 'c1' } })
it('a reply opens its thread; a task chat hit opens the task panel chat tab', ...)  // model test
it('"Zobraziť ďalšie správy" loads the next page into the section', ...)
it('says "V správach sa hľadá od 3 znakov." for two-letter terms and sends no message request', ...)
it('says "Príliš veľa správ. Spresnite hľadanie." on tooBroad', ...)
it('the other sections render while messages are still loading', ...)
it('message hits are not remembered among recent items', ...)
```

- [ ] **Step 3: Run** `pnpm --filter @spolu/web test -- search` — Expected: FAIL.
- [ ] **Step 4: Implement** the model, the row, the second query and the texts. Locale keys (add to every file; `placeholder` replaces the old value):

| key                    | sk                                     | en                                         | cs                                     | sl                                              | bg                                          | et                                           | it                                             | hr                                       | uk                                            |
| ---------------------- | -------------------------------------- | ------------------------------------------ | -------------------------------------- | ----------------------------------------------- | ------------------------------------------- | -------------------------------------------- | ---------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| placeholder            | Hľadať skupinu, tiket, úlohu, správu…  | Search for a group, ticket, task, message… | Hledat skupinu, tiket, úkol, zprávu…   | Poiščite skupino, zahtevek, nalogo, sporočilo…  | Търсете група, тикет, задача, съобщение…    | Otsi gruppi, pöördumist, ülesannet, sõnumit… | Cerchi un gruppo, ticket, attività, messaggio… | Potražite grupu, tiket, zadatak, poruku… | Шукайте групу, тікет, завдання, повідомлення… |
| sections.messages      | Správy                                 | Messages                                   | Zprávy                                 | Sporočila                                       | Съобщения                                   | Sõnumid                                      | Messaggi                                       | Poruke                                   | Повідомлення                                  |
| messages.more          | Zobraziť ďalšie správy                 | Show more messages                         | Zobrazit další zprávy                  | Prikažite več sporočil                          | Покажи още съобщения                        | Näita rohkem sõnumeid                        | Mostri altri messaggi                          | Prikaži još poruka                       | Показати більше повідомлень                   |
| messages.minLength     | V správach sa hľadá od 3 znakov.       | Messages are searched from 3 characters.   | Ve zprávách se hledá od 3 znaků.       | Sporočila se iščejo od 3 znakov naprej.         | Съобщенията се търсят от 3 знака.           | Sõnumitest otsitakse alates 3 märgist.       | Nei messaggi si cerca da 3 caratteri.          | Poruke se pretražuju od 3 znaka.         | Повідомлення шукаються від 3 символів.        |
| messages.tooBroad      | Príliš veľa správ. Spresnite hľadanie. | Too many messages. Narrow your search.     | Příliš mnoho zpráv. Upřesněte hledání. | Preveč sporočil. Natančneje opredelite iskanje. | Твърде много съобщения. Уточнете търсенето. | Liiga palju sõnumeid. Täpsustage otsingut.   | Troppi messaggi. Restringa la ricerca.         | Previše poruka. Suzite pretragu.         | Забагато повідомлень. Уточніть пошук.         |
| messages.task          | Úloha: {{title}}                       | Task: {{title}}                            | Úkol: {{title}}                        | Naloga: {{title}}                               | Задача: {{title}}                           | Ülesanne: {{title}}                          | Attività: {{title}}                            | Zadatak: {{title}}                       | Завдання: {{title}}                           |
| messages.ticket        | Tiket #{{number}}                      | Ticket #{{number}}                         | Tiket #{{number}}                      | Zahtevek #{{number}}                            | Тикет #{{number}}                           | Pöördumine #{{number}}                       | Ticket #{{number}}                             | Tiket #{{number}}                        | Тікет #{{number}}                             |
| messages.thread        | vo vlákne                              | in a thread                                | ve vlákně                              | v niti                                          | в нишка                                     | lõimes                                       | in una discussione                             | u niti                                   | у гілці                                       |
| messages.deletedAuthor | Odstránený používateľ                  | Deleted user                               | Odstraněný uživatel                    | Izbrisan uporabnik                              | Изтрит потребител                           | Kustutatud kasutaja                          | Utente eliminato                               | Izbrisani korisnik                       | Видалений користувач                          |

- [ ] **Step 5: Run** `pnpm --filter @spolu/web test` (locale tests included) — Expected: PASS. Build and measure as in `performance.md` "How to check": initial JS unchanged (± 0.05 kB), `command-palette` chunk growth recorded.
- [ ] **Step 6: Docs.** `performance.md`: the measurement, the index, the guard rails, the query count. Commit `feat(web): messages in the command palette`.

### Task 8: EXPLAIN volume and checks

**Files:**

- Create: `apps/server/src/modules/chat/test-volume.ts`, `apps/server/src/modules/chat/explain.test.ts`
- Modify: `apps/server/test/setup-explain-db.ts` (`VOLUMES` gets `messages`), ADR 0040 (dated line for the fifth volume)

**Interfaces:**

- Consumes: Task 5 `messageSearchSql`.
- Produces: `seedMessageVolume(tx: Db): Promise<void>`, `MESSAGE_VOLUME_TABLES` (`user, groups, group_members, buckets, tasks, tickets, channels, messages`), `messageVolumeIds(): { adminId; clientId; ziadatelId; groupIds: string[] }` (prefix `svmsg0000`).

- [ ] **Step 1: Write the seed** with `generate_series` as `search/test-volume.ts`: 3 000 groups with a group channel; client `c1` of groups 1–5; a žiadateľ member of group 1 who started a fifth of group 1's tickets; 6 000 tasks with task channels; 10 000 tickets with ticket channels (a fifth started by the žiadateľ where the group is 1, others by the group's client); 400 000 messages: 60 % group, 25 % task, 15 % ticket, 10 % replies (`parent_id` an earlier message of the same channel), 2 % deleted (`deleted_at` set, `body ''`), 5 % with `<@…>`, body `'<Word> ' || i || ' …'` from `array['rozpočet','žiadosť','kontrola','zmluva','faktúra','výzva','audit']`, and `'Dobrý deň, '` prefixed on `i % 10 < 3`. `client_id` and `change_seq` filled (`'v' || i`, `i`).
- [ ] **Step 2: Write the checks** (`explain.test.ts`, same `expectIndexed` helper as `search/explain.test.ts`, moved to `apps/server/test/explain.ts` and imported by both):

```ts
it('a rare term reads the trigram index for admin, client and ziadatel', ...)
  // q 'zmluva 123457' → expectIndexed(..., ['messages'], 30)
it('a common term for a client and a ziadatel never scans messages', ...)
  // q 'dobry den' → expectIndexed(..., ['messages'], 100)
it('a common term for the admin stays under 300 ms with RUN_BENCH=1', ...)
  // time only; no seq-scan assertion (a sequential scan can be the right plan)
it('page two (cursor) reads the index too', ...)
```

- [ ] **Step 3: Run** `rtk proxy pnpm --filter @spolu/server test:explain` — Expected: PASS; with `RUN_BENCH=1` record the times in `performance.md`. If the common-word admin search exceeds 300 ms, stop and report (the ADR's `tsvector` fallback is the owner's call).
- [ ] **Step 4: Commit** `test(chat): EXPLAIN checks of message search on a 400 000-message volume`.

### Task 9: MCP tools

**Files:**

- Modify: `apps/server/src/modules/mcp/tools/search.ts`, `apps/server/src/modules/mcp/allowlist.ts`
- Test: `apps/server/src/modules/mcp/tools.test.ts`, `apps/server/src/modules/mcp/leaks.test.ts`
- Docs: `docs/integrations/mcp.md`

**Interfaces:**

- Consumes: `GET /api/search/messages` (Task 6).
- Produces: tool `search_messages` (`q` 2–100, `groupId?`, `cursor?`, `limit?` 1–20), description "Finds chat messages (group chats, threads, task and ticket chats) the user may read, best match first, with a snippet; page with nextCursor; nothing of a deactivated client or a deleted message."; `search`'s description and `types` hint mention `messages`; allowlist `{ method: 'GET', path: '/api/search/messages' }`.

- [ ] **Step 1: Write the failing tests:** `it('search_messages pages through a user\'s messages', ...)` (two pages via `nextCursor`); in `leaks.test.ts` a client's token never gets another group's message through `search_messages` or `search`, and an admin's token gets no message of a deactivated group through either (also with its `groupId`).
- [ ] **Step 2: Run** `rtk proxy pnpm --filter @spolu/server exec vitest run src/modules/mcp` — Expected: FAIL.
- [ ] **Step 3: Implement** the tool and the allowlist entry; update `mcp.md`'s search row.
- [ ] **Step 4: Run** — Expected: PASS. Commit `feat(mcp): search_messages tool`.

### Task 10: e2e spec, final checks, PR

**Files:**

- Modify: `e2e/search.spec.ts`

- [ ] **Step 1: Add** `test('Ctrl+K finds a chat message and opens the chat at it', ...)`: send a message with a unique word in a group chat, open the palette, type the word without diacritics, expect the Správy section with a `mark`, Enter, expect the URL to contain `message=` and the message highlighted. Do not run e2e here; it runs in the final e2e pass after all seven plans of 2026-10-19 are implemented (owner instruction).
- [ ] **Step 2: Run** `pnpm prettier --check` on changed files, `pnpm lint`, `pnpm typecheck`, `pnpm build`, the server suite with the own database and `pnpm --filter @spolu/web test` — Expected: all PASS.
- [ ] **Step 3:** `update-kb` skill; `bash scripts/check-docs.sh origin/main` — Expected: no warning.
- [ ] **Step 4: Commit, push** `feat/chat-message-search`, open the PR (body: summary, owner checks on help.egrant.sk: as an admin Ctrl+K "dobry den" lists Správy with highlights, Enter opens the chat at the message; as a žiadateľ only their ticket's messages; a deactivated client's messages never appear, also for an admin, while its people are still listed without a link into it).
