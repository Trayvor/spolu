# Phase 5 — Group chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each group gets a realtime Slack-like chat (messages, threads with in-thread replies, @mentions and @all, files with image previews, edit/delete own messages, unread counts, catch-up after a lost connection), built as one reusable `<Conversation>` component.

**Architecture:** A new server module `modules/chat` (tables `channels`, `messages`, `message_mentions`, `message_attachments`, `read_states`; a per-channel `last_seq` counter stamped on every change as `change_seq`), HTTP writes that emit `chat:message` / `chat:read` after commit and record notification events in the same transaction, and a lazy web feature `features/chat` (own Markdown-subset parser rendering React elements, a windowed message list kept in a pure reducer, composer, thread panel). It consumes the Phase 4 foundation (files, notifications, group people, avatars, group rooms) and edits nothing outside chat.

**Tech Stack:** existing only (Fastify 5, Drizzle, PostgreSQL 17, Socket.IO 4, React 19, TanStack Router/Query, Tailwind 4, zod 4, Vitest, Playwright). No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-15-phase-5-group-chat-design.md` (builds on `docs/superpowers/specs/2026-10-15-phase-4-shared-foundation-design.md`).

## Global Constraints

- Branch `phase-5` (cut from `phase-4`), built **in parallel with Phase 8**. Touch only: `apps/server/src/modules/chat/`, `apps/web/src/features/chat/`, the chat migration, chat i18n keys (`chat.*`) in `en.json` and `sk.json`, `packages/shared/src/chat.ts` + its line in `packages/shared/src/index.ts` + new `ErrorCodes` entries, the `chatRoutes` line in `apps/server/src/app.ts`, and the docs. Never edit groups, files, tasks or notifications code; if something there seems needed, stop and report it to the controller.
- English everywhere (code, comments, docs, commits). Every UI string is an i18n key with EN and SK values in both locale files (the locales test fails on differing key sets); only add keys, never reformat the files.
- Readable code and performance first; no fancy effects (no animations, no transitions beyond the existing ones). Any UI task starts by invoking `frontend-design:frontend-design`; use the egrant.sk tokens (`docs/design/tokens.md`) and `components/ui/*`.
- The chat is a lazy route chunk; the initial JS budget stays **200 kB gzip** (check `pnpm --filter @spolu/web build` output). Nothing in `features/chat` may be imported eagerly by the router; the unread badges live in a tiny separate file (`unread.tsx`) that imports only `api.ts`.
- The message formatter builds React elements, **never `innerHTML`/`dangerouslySetInnerHTML`**; links only `http:`, `https:`, `mailto:`, opened with `target="_blank" rel="noreferrer noopener"`.
- Limits: body max **10 000** characters, max **10** attachments, pages of **50**, catch-up max **500**, at most ~**300** top-level messages in memory per chat, send rate limit **30/min per user**, notification excerpt **140** chars, reply strip excerpt **80** chars, grouping window **5 minutes**, highlight **2 s**, thread panel **400 px** from **1024 px** up.
- Permissions only through `modules/chat/policy.ts` (which calls `canReadGroup`); an unreadable channel or message answers **404 `not_found`**, someone else's message on edit/delete answers **403 `forbidden`**. Errors are `{ error: '<code>' }`; codes used: `validation_failed` 400, `invalid_mention` 400 (new), `invalid_attachment` 400 (Phase 4), `unauthorized` 401, `forbidden` 403, `not_found` 404, `rate_limited` 429.
- Sockets only push, after commit, via `emitToGroup` (Phase 4) or `userRoom`; writes only over HTTP.
- Server tests share the `spolu_test` DB in parallel: unique emails (`${randomUUID()}@example.com`) and eGrant URLs per test, never truncate, never assume an empty table; use `buildTestApp`, `loginAs`.
- Mutations are never retried automatically on the web (only the user's "Retry").
- Prettier: `rtk proxy pnpm exec prettier --check <changed files>` before each commit. Each commit updates the docs it affects.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Two messages in the same millisecond, or a page boundary falling between them: Postgres keeps microseconds but JS dates keep milliseconds, so a `(created_at, id)` cursor built from the DTO would skip or repeat rows. `created_at` columns are `precision: 3` and the cursor test sends 60 messages and pages through all of them with no gap or duplicate (Task 2 and Task 6 tests).
- A client sends with a `clientId`, the network drops after the server committed, the user clicks Retry: exactly one message, one socket event, one set of notification events (Task 4 test `repeated clientId returns the existing message and records nothing`).
- A socket event arrives before the POST response (or the same message arrives again via catch-up): no duplicate row and the optimistic row disappears (Task 9 reducer tests `event with my clientId replaces the pending row`, `older changeSeq never overwrites newer`).
- `snake_case_name`, `2*3*4`, a URL containing `_` or `)`, and `[x](javascript:alert(1))` in a message: none turn into marks or links they should not; the unsafe link renders as literal text (Task 8 tests).
- A user opens a chat with 1 000 old messages they never read (a new client): unread shows `99+`, the "New messages" line sits above the first unread message on the loaded page, and opening at the bottom marks the chat read (Task 3, Task 10 and Task 12 tests).


## Controller rulings (2026-10-15, after all three plans were written)

These override any conflicting text below.

1. **Unread badges:** this branch adds the two one-line usages of `<ChatUnreadBadge>` (Chat tab in the Phase 4 group layout) and `<GroupUnreadCount>` (groups list). Phase 8 does not touch those lines.
2. **`NotificationKind`:** Phase 4 already defines all five kinds (`chat.message`, `chat.mention`, `chat.thread_reply`, `task.moved`, `task.assigned`). Do not edit `packages/shared/src/notifications.ts`.
3. **People list:** Phase 4 exports `listGroupPeople(db, groupId)` from the groups service. Use it for mention validation and notification recipients.
4. **Catch-up after rejoin:** Phase 4 exports `useGroupRoomJoins(): number` (grows after every acknowledged `group:join`, including the client's implicit room on connect). Run catch-up when it changes, not on raw socket `connect`.
5. **Shared files edited by both parallel branches:** new error codes go at the end of `ErrorCodes` under a `// Phase 5 — chat` comment; `router.tsx` and `en.json`/`sk.json` only get additions. The branch merged second resolves these trivial conflicts and regenerates its migration and renumbers its ADR if needed.

---

### Task 1: Shared chat types, error code and mention helpers

**Files:**
- Create: `packages/shared/src/chat.ts`, `packages/shared/src/chat.test.ts`
- Modify: `packages/shared/src/index.ts` (`export * from './chat.js';`), `packages/shared/src/users.ts` (`ErrorCodes.invalidMention: 'invalid_mention'`)

**Interfaces:**
- Consumes (Phase 4, by these names): shared `FileInfoSchema`/`FileInfo` `{ id, name, mime, size, width, height, hasPreview }`, `NotificationKind`, `ErrorCodes.invalidAttachment`; server `attachFiles(tx, groupId, fileIds, userId)`, `getFilesForGroup(db, groupId, ids)`, `deleteFiles(deps, ids)`, `recordNotifications(tx, { kind, groupId, recipients, payload })`, `isGroupPerson(db, groupId, userId)`, the service function behind `GET /api/groups/:id/people` (assumed `listGroupPeople(db, groupId): Promise<{ id, name, isAdmin }[]>`), `emitToGroup(io, groupId, event, payload)` in `infra/realtime/rooms.ts`; web `uploadFile(groupId, file, onProgress)`, `<FileChip>`, `<ImagePreview>` (`features/files/`), `useGroupPeople(groupId)`, `useGroupRoom(groupId)` (`features/groups/`), `<Avatar userId name size />` (`components/avatar.tsx`), `features/chat/chat-tab.tsx` placeholder (route `/groups/$groupId/chat`).
- Produces (`packages/shared/src/chat.ts`):
  - Constants: `MESSAGE_MAX_LENGTH = 10_000`, `MESSAGE_MAX_FILES = 10`, `MESSAGE_PAGE_SIZE = 50`, `CHANGES_MAX = 500`, `MENTION_ALL_TOKEN = '<@all>'`, `mentionToken(userId: string): string` (`<@${userId}>`).
  - `ChatAuthorSchema { id, name, isAdmin: boolean }`.
  - `MessageSchema` / `MessageDto { id, channelId, parentId: string|null, replyToId: string|null, author: ChatAuthor, body: string, mentions: string[], mentionsAll: boolean, attachments: FileInfo[], clientId: string|null, replyCount: number, lastReplyAt: string|null, editedAt: string|null, deletedAt: string|null, createdAt: string, changeSeq: number }`.
  - `SendMessageInputSchema { body: string max 10 000, parentId?: string, replyToId?: string, fileIds?: string[] max 10 (unique), clientId: string 1..64 }`, refined: `body.trim()` non-empty or `fileIds` non-empty; `replyToId` requires `parentId`.
  - `EditMessageInputSchema { body: string max 10 000 }`; `MarkReadInputSchema { at: ISO datetime }`.
  - `GroupChannelSchema { id, lastSeq: number, lastReadAt: string|null, unread: number }`.
  - `MessagePageSchema { messages: MessageDto[], hasMore: boolean, lastSeq: number, lastReadAt: string|null }` (for `before`: newest first; for `after`: oldest first).
  - `AroundPageSchema { messages: MessageDto[] (oldest first), hasOlder, hasNewer, targetId: string (the top-level id), lastSeq, lastReadAt }`.
  - `ChangesSchema { messages: MessageDto[], lastSeq: number, truncated: boolean }`; `ThreadSchema { root: MessageDto, replies: MessageDto[] }`; `UnreadByGroupSchema = z.record(z.string(), z.number())`.
  - `ChatEvents = { message: 'chat:message', read: 'chat:read' } as const`; `ChatMessageEvent { channelId, message: MessageDto, isNew: boolean }`; `ChatReadEvent { channelId, lastReadAt: string }`.
  - `extractMentions(body: string): { userIds: string[]; all: boolean }` (unique ids, order of first appearance; ignores tokens inside `` ` `` code spans and ``` fences).
  - `plainExcerpt(body: string, nameOf: (id: string) => string | undefined, max: number, allLabel = '@all'): string` — tokens replaced by `@Name` (unknown id → `@?`), whitespace collapsed to single spaces, cut to `max` chars with `…` when longer.

- [ ] **Step 1: Verify the Phase 4 names.** `grep -rn` each consumed name above in `apps/server/src`, `apps/web/src`, `packages/shared/src`. Write down the real name and signature of each; wherever a name or signature differs from this plan, follow the actual code in every later task (and say so in the task report). If `listGroupPeople` (or equivalent people-list service export) does not exist, or `NotificationKind` lacks `chat.message | chat.mention | chat.thread_reply`, stop and report to the controller (see NOTE 2 and 3).
- [ ] **Step 2: Failing tests** in `chat.test.ts`: `extractMentions finds users and @all, deduplicated`; `extractMentions ignores tokens inside code spans and fences`; `plainExcerpt replaces tokens with names and cuts at 140 with an ellipsis`; `SendMessageInputSchema rejects an empty body without files, 10 001 chars, 11 files, replyToId without parentId`; `SendMessageInputSchema accepts an empty body with one file`.
- [ ] **Step 3: Run** `pnpm --filter @spolu/shared test` — FAIL.
- [ ] **Step 4: Implement** `chat.ts`, the index export and the error code.
- [ ] **Step 5: Run** `pnpm --filter @spolu/shared test && pnpm typecheck` — PASS.
- [ ] **Step 6: Commit** `feat(shared): chat schemas, events and mention helpers`.

### Task 2: Chat tables, migration and policy

**Files:**
- Create: `apps/server/src/modules/chat/schema.ts`, `policy.ts`, `policy.test.ts`, generated migration in `apps/server/src/infra/db/migrations/`
- Modify: `docs/architecture/data-model.md`, `docs/architecture/permissions.md`

**Interfaces:**
- Produces:
  - Tables exactly as the spec's Data table, plus: all timestamps `timestamp(..., { withTimezone: true, precision: 3 })`; `bigint(..., { mode: 'number' })` for `last_seq` and `change_seq`; `channels_kind_check` (`kind in ('group','task')`); partial unique index `channels_group_unique` on `group_id` where `kind = 'group'`; `messages_author_client_unique` on (`author_id`, `client_id`); indexes `messages_channel_parent_created_idx` (`channel_id`, `parent_id`, `created_at`), `messages_channel_seq_idx` (`channel_id`, `change_seq`), `message_attachments` index on `file_id`. `messages.parent_id` and `reply_to_id` reference `messages.id` on delete cascade. `message_attachments.file_id` references the Phase 4 `files.id` on delete cascade (importing another module's table for an FK is allowed, as groups does with `user`).
  - `policy.ts`: `canReadChannel(actor: SessionUser, channel: { groupId: string }, actorGroupId: string | null): boolean` (= `canReadGroup`); `canEditMessage(actor: SessionUser, message: { authorId: string; deletedAt: Date | null }): boolean`; `canDeleteMessage(...)` same rule (author, not deleted).

- [ ] **Step 1: Failing `policy.test.ts`** (`it.each`): `canReadChannel` for superadmin/admin (any group) → true, client own group → true, client other group → false, client without group → false; `canEditMessage`/`canDeleteMessage`: author → true, other user (incl. superadmin) → false, author of a deleted message → false.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server exec vitest run src/modules/chat` — FAIL.
- [ ] **Step 3: Implement** `schema.ts` and `policy.ts`; `pnpm --filter @spolu/server db:generate`; read the SQL (partial index `WHERE kind = 'group'`, CHECK, precision 3, cascades).
- [ ] **Step 4: Run** the chat tests and `pnpm --filter @spolu/server test` (migrations apply in global setup) — PASS.
- [ ] **Step 5: Docs** (data-model: Channel, Message, Mention, Attachment, ReadState → built, columns; ReadState is `last_read_at`, not a seq; permissions: chat policy). **Commit** `feat(server): chat tables and policy`.

### Task 3: Channels, sequence and read state service

**Files:**
- Create: `apps/server/src/modules/chat/service.ts`, `service.test.ts`

**Interfaces:**
- Consumes: Task 2 tables.
- Produces (`service.ts`, the module's public API; `Tx` = the drizzle transaction type, `Db | Tx` accepted where noted):
  - `type ChannelRow = typeof channels.$inferSelect`.
  - `ensureGroupChannel(db: Db, groupId: string): Promise<ChannelRow>` — `insert … on conflict do nothing` against the partial index, then select; safe under concurrent first reads.
  - `getChannel(db: Db, id: string): Promise<ChannelRow | null>`.
  - `nextSeq(tx: Tx, channelId: string): Promise<number>` — `UPDATE channels SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq` (also serialises writers of one channel).
  - `markRead(db: Db, userId: string, channelId: string, at: Date): Promise<Date>` — upsert; stored value is `greatest(existing, least(at, now()))`; returns the stored value.
  - `getLastReadAt(db: Db, userId: string, channelId: string): Promise<Date | null>`.
  - `unreadCount(db: Db, userId: string, channelId: string): Promise<number>` and `unreadByGroup(db: Db, userId: string, onlyGroupId: string | null): Promise<Record<string, number>>` — one grouped query over group channels: top-level, not deleted, `author_id <> userId`, `created_at > coalesce(last_read_at, '-infinity')`; `onlyGroupId` limits to a client's group.

- [ ] **Step 1: Failing tests** (create groups with the groups service and users directly, unique per test): `ensureGroupChannel creates once; 5 parallel calls return the same id`; `nextSeq increments by one per call`; `markRead never moves backwards and never past now`; `unreadCount ignores own messages, thread replies and deleted messages, counts messages after last_read_at` (insert message rows directly via the chat schema); `unreadCount with no read state counts every message`; `unreadByGroup returns per-group counts, only the client's group for a client`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** chat tests — PASS.
- [ ] **Step 5: Commit** `feat(server): chat channels, sequence and read state`.

### Task 4: Send a message (mentions, attachments, threads, notifications)

**Files:**
- Create: `apps/server/src/modules/chat/messages.ts`, `messages.test.ts`, `dto.ts`

**Interfaces:**
- Consumes: Task 3 (`nextSeq`, `getChannel`), Phase 4 `attachFiles`, `getFilesForGroup`, `recordNotifications`, `listGroupPeople`.
- Produces:
  - `dto.ts`: `selectMessages(db, where: SQL, orderBy: SQL[], limit?: number): Promise<MessageWithAuthor[]>` — selects messages joined read-only with `user` for `author { id, name, isAdmin: role in ('admin','superadmin') }` (deliberate read-only exception, documented in Task 12 like the groups one); `toMessageDtos(db, groupId: string, rows: MessageWithAuthor[]): Promise<MessageDto[]>` — exactly two extra queries for any number of rows (mentions by `message_id in (...)`, attachments by `message_id in (...)` then one `getFilesForGroup`), attachments in `position` order; a deleted message has `body ''`, no mentions, no attachments.
  - `messages.ts`: errors `InvalidMentionError`, `InvalidThreadError` (route → 400 `validation_failed`), Phase 4's attachment error (route → 400 `invalid_attachment`).
  - `sendMessage(deps: AppDeps, input: { channel: ChannelRow; author: SessionUser; data: SendMessageInput }): Promise<{ message: MessageDto; parent: MessageDto | null; created: boolean }>`:
    1. existing row with (`author_id`, `client_id`) → return it with `created: false` (no writes); a unique violation during insert re-reads the same way.
    2. `parentId`: must be a top-level message of the same channel, else `InvalidThreadError`; `replyToId`: must be the parent itself or a reply whose `parent_id = parentId`, else `InvalidThreadError`.
    3. mentions from `extractMentions`; each id must be in `listGroupPeople(channel.groupId)`, else `InvalidMentionError`.
    4. one transaction: `seq = nextSeq`; insert message (`change_seq = seq`, `mentions_all`); insert `message_mentions`; `attachFiles(tx, groupId, fileIds, author.id)` and insert `message_attachments` with `position`; for a reply update the parent `reply_count + 1`, `last_reply_at = created_at`, `change_seq = seq`; `recordNotifications` (below).
  - Notifications (never to the author; payload `{ channelId, messageId, groupId, authorName, excerpt: plainExcerpt(body, nameOf, 140) }`): `chat.message` → every group person; `chat.mention` → mentioned ids, or every group person for `@all`; `chat.thread_reply` (replies only) → root author plus distinct authors of earlier replies in the thread.

- [ ] **Step 1: Failing tests** (`messages.test.ts`, service level, own group/users per test): `sends a top-level message with change_seq = channel last_seq`; `stores mentions and mentions_all`; `a mention of another group's client → InvalidMentionError and nothing written`; `attaches files in order and returns FileInfo`; `a file of another group → invalid_attachment and nothing written (no message row)`; `a reply bumps the parent's reply_count, last_reply_at and change_seq to the reply's seq`; `parentId that is itself a reply → InvalidThreadError`; `replyToId from another thread → InvalidThreadError`; `repeated clientId returns the existing message, created false, and records nothing` (count notification rows for the message id); `notification events: chat.message to all people except the author, chat.mention to the mentioned, @all to everyone but the author, chat.thread_reply to root author and earlier repliers`; `toMessageDtos runs a fixed number of queries for 50 messages` (count via a wrapped db or a query logger).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** chat tests, typecheck — PASS.
- [ ] **Step 5: Commit** `feat(server): send chat messages with mentions, files and threads`.

### Task 5: Edit and delete

**Files:**
- Modify: `apps/server/src/modules/chat/messages.ts`, `messages.test.ts`

**Interfaces:**
- Produces:
  - `getMessage(db, id): Promise<MessageRow | null>`.
  - `editMessage(deps, input: { message: MessageRow; channel: ChannelRow; body: string }): Promise<MessageDto>` — one transaction: `nextSeq`; mentions re-parsed and validated (`InvalidMentionError`), `message_mentions` replaced, `mentions_all`, `body`, `edited_at = now()`, `change_seq`. An empty trimmed body is allowed only when the message has attachments, else `validation_failed`. No notification events on edit.
  - `deleteMessage(deps, input: { message: MessageRow; channel: ChannelRow }): Promise<MessageDto>` — one transaction: `nextSeq`; `deleted_at = now()`, `body = ''`, `mentions_all = false`, delete its mentions and attachment rows (keep the file ids); after commit `deleteFiles(deps, fileIds)`. Replies stay; the parent's `reply_count` is not decreased when a reply is deleted.

- [ ] **Step 1: Failing tests:** `edit re-parses mentions (old mention gone, new one stored) and sets edited_at and a higher change_seq`; `edit with a foreign mention → InvalidMentionError, nothing changed`; `delete keeps the row as deleted, clears body and mentions, keeps replies`; `delete removes the message's files (getFilesForGroup returns none and storage objects are gone)`; `deleting a reply leaves the root's reply_count unchanged`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): edit and delete chat messages`.

### Task 6: Read queries — pages, around, thread, changes

**Files:**
- Create: `apps/server/src/modules/chat/reads.ts`, `reads.test.ts`

**Interfaces:**
- Consumes: Task 4 `selectMessages`, `toMessageDtos`; Task 3 `getLastReadAt`.
- Produces:
  - Cursor: `encodeCursor(m: { createdAt: string; id: string }): string` = `${createdAt},${id}`; `parseCursor(s: string): { createdAt: Date; id: string } | null`.
  - `pageBefore(db, channel, userId, cursor | null, limit = 50): Promise<MessagePage>` — top-level, `(created_at, id) < cursor`, newest first; `hasMore` by fetching `limit + 1`; `lastSeq` read **before** the messages; `lastReadAt` of the caller.
  - `pageAfter(db, channel, userId, cursor, limit = 50): Promise<MessagePage>` — `(created_at, id) > cursor`, oldest first.
  - `pageAround(db, channel, userId, messageId, limit = 50): Promise<AroundPage | null>` — resolves a reply to its root; 25 older + target + up to 24 newer, oldest first; null when the message is not in this channel.
  - `getThread(db, channel, messageId): Promise<Thread | null>` — a reply id resolves to its root; replies oldest first.
  - `changesAfter(db, channel, afterSeq: number): Promise<Changes>` — every message (top-level and replies) with `change_seq > afterSeq`, ascending by `change_seq`, max 500 (`truncated` when more), `lastSeq` = channel `last_seq`.

- [ ] **Step 1: Failing tests:** `paging 60 messages with before cursors returns each once, newest first, hasMore false at the end` (send them in a tight loop so several share a millisecond); `after cursor pages forward`; `around returns the page containing a reply's root with hasOlder/hasNewer`; `thread returns root and replies oldest first; a reply id gives the same thread`; `changes after N returns new, edited and deleted messages and the parent with its new reply count, ascending`; `changes truncates at 500` (bump `last_seq`/insert 501 rows directly); `deleted messages appear as deleted in pages and threads`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): chat pages, threads and catch-up`.

### Task 7: Chat API, realtime events and registration

**Files:**
- Create: `apps/server/src/modules/chat/routes.ts`, `routes.test.ts`, `events.ts`
- Modify: `apps/server/src/app.ts` (`await app.register(chatRoutes, { prefix: '/api', deps });`), `docs/architecture/realtime.md`, `docs/architecture/overview.md`

**Interfaces:**
- Consumes: Tasks 3–6; `getMembershipGroupId`, `canReadGroup` via `canReadChannel`; `createRateLimiter({ windowMs: 60_000, max: 30 })` keyed by user id.
- Produces: every endpoint of the spec's Endpoints table, plus `GET /api/channels/:id/messages?after=<cursor>` (forward paging; `before` and `after` are mutually exclusive, a bad cursor → 400). Status codes: send 201 (repeated `clientId` → 200 with the existing message, no emit); edit 200; delete 204; read 204. Every route: `requireUser`, load channel (or message → channel), `canReadChannel` else 404, then the 403 policy for edit/delete.
  - `events.ts`: `emitMessage(io, groupId, message: MessageDto, isNew: boolean)` → `emitToGroup(io, groupId, ChatEvents.message, { channelId, message, isNew })`; `emitRead(io, userId, event: ChatReadEvent)` → `io.to(userRoom(userId))`. Send emits the message (`isNew: true`) and, for a reply, the parent (`isNew: false`); edit and delete emit `isNew: false`; all after commit.

- [ ] **Step 1: Failing tests** (`routes.test.ts`, listening app + `socket.io-client` like `groups/routes.test.ts`): `GET /api/groups/:id/chat creates the channel lazily and returns { id, lastSeq, lastReadAt: null, unread }`; `client of another group gets 404 on: group chat, messages, changes, thread, around, send, edit, delete, read`; `admin sends, a client socket in the group room receives chat:message with isNew true`; `a reply emits the reply and the parent`; `send with an invalid mention → 400 invalid_mention; with another group's file → 400 invalid_attachment; with a too-long body → 400 validation_failed`; `edit/delete someone else's message → 403 forbidden`; `delete → 204, then GET thread shows Message deleted root with replies`; `POST read emits chat:read to the user's other socket and unread becomes 0`; `GET /api/chat/unread returns all groups with a channel for an admin and only the own group for a client`; `31st send in a minute → 429 rate_limited`; `messages before/after, around and changes return the shared shapes` (parse with the shared schemas).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** and register in `app.ts`. **Step 4: Run** `pnpm --filter @spolu/server test`, `pnpm typecheck`, `pnpm lint` — PASS.
- [ ] **Step 5: Docs** (realtime: `chat:message` / `chat:read`, catch-up by `change_seq` replacing the planned per-message `seq`; remove the "per group channel" assumption rows; overview: chat module, rate limit). **Commit** `feat(server): chat API and realtime events`.

### Task 8: Web — message formatting parser and renderer

**Files:**
- Create: `apps/web/src/features/chat/format/parse.ts`, `parse.test.ts`, `render.tsx`, `render.test.tsx`

**Interfaces:**
- Produces:
  - `type Inline = { type: 'text'; text: string } | { type: 'bold' | 'italic' | 'strike'; children: Inline[] } | { type: 'code'; text: string } | { type: 'link'; href: string; children: Inline[] } | { type: 'mention'; userId: string } | { type: 'mentionAll' } | { type: 'break' }`.
  - `type Block = { type: 'paragraph'; children: Inline[] } | { type: 'codeBlock'; text: string } | { type: 'quote'; children: Block[] } | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }`.
  - `parseMessage(body: string): Block[]` — block rules: ```` ``` ```` fences (unclosed fence runs to the end), lines starting `> `, `- ` items, `N. ` items (start from the first number), blank line ends a block. Inline rules in this precedence: `` `code` `` (no marks inside), `<@id>` / `<@all>`, `[text](url)`, bare `http(s)://…` / `mailto:…` (trailing `.,;:!?)` not part of the URL unless the `)` closes a `(` inside it), `**bold**`, `~~strike~~`, `_italic_` (only when `_` is at a word boundary on the outside). A link whose URL scheme is not `http:`, `https:` or `mailto:` stays literal text.
  - `<MessageBody body: string; nameOf: (id: string) => string | undefined />` in `render.tsx` — renders the blocks to React elements (`strong`, `em`, `s`, `code`, `pre`, `blockquote`, `ul`/`ol`, `a target="_blank" rel="noreferrer noopener"`, mention pills `bg-secondary`, `@all` pill with `t('chat.mention.all')`, unknown id → `t('chat.mention.unknown')`).

- [ ] **Step 1: Failing tests** (`parse.test.ts`, table-driven): every mark alone; nesting (`**bold _italic_**`, `_italic **bold**_`); code span keeps `**` literal; fenced block keeps lines and marks literal; quote with a list inside; ordered list starting at 3; bare URL with trailing period; URL with `_` and balanced `)`; `snake_case_name` and `2*3*4` stay text; `[x](javascript:alert(1))` and `[x](data:…)` stay literal text; mention and @all tokens; `<b>hi</b>` and `<img src=x onerror=…>` come back as plain text. `render.test.tsx`: `renders no HTML from the body` (container has no `b`/`img`, text content equals the source), `links open in a new tab with rel noreferrer noopener`, `mentions show names`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web exec vitest run src/features/chat/format` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `grep -rn "dangerouslySetInnerHTML\|innerHTML" apps/web/src/features/chat` → no output.
- [ ] **Step 5: Commit** `feat(web): chat message formatting`.

### Task 9: Web — chat API, message window and live updates

**Files:**
- Create: `apps/web/src/features/chat/api.ts`, `channel-window.ts`, `channel-window.test.ts`, `use-channel-messages.ts`, `use-channel-messages.test.tsx`, `use-thread.ts`, `use-chat-search.ts`

**Interfaces:**
- Consumes: Task 1 schemas; Task 7 endpoints; `getSocket()` (`lib/socket.ts`), `apiGet`/`apiSend`.
- Produces:
  - `api.ts`: `groupChatQuery(groupId)` (`['chat', 'group', groupId]`), `chatUnreadQuery` (`['chat', 'unread']`), `fetchPage(channelId, { before?: string; after?: string })`, `fetchAround(messageId)`, `fetchChanges(channelId, afterSeq)`, `threadQuery(rootId)` (`['chat', 'thread', rootId]`), `sendMessage(channelId, input)`, `editMessage(id, body)`, `deleteMessage(id)`, `markRead(channelId, at)`.
  - `channel-window.ts` (pure): `type Pending = { clientId: string; input: SendMessageInput; status: 'sending' | 'failed' }`; `type ChannelWindow = { messages: MessageDto[] (top-level, oldest first); hasOlder: boolean; hasNewer: boolean; lastSeq: number; lastReadAt: string | null; pending: Pending[] }`; `windowReducer(state, action)` with actions `loadedLatest(page)`, `loadedOlder(page)`, `loadedNewer(page)`, `loadedAround(page)`, `upsert(messages: MessageDto[])` (replies ignored; a top-level message older than the window while `hasOlder`, or newer while `hasNewer`, ignored; never replaces a row with a lower `changeSeq`; removes a pending row with the same `clientId`; `lastSeq = max`), `pendingAdded`, `pendingFailed(clientId)`, `pendingRetried(clientId)`; constant `MAX_IN_MEMORY = 300` — older pages beyond it drop the newest rows and set `hasNewer`, new rows at the bottom drop the oldest and set `hasOlder`.
  - `useChannelMessages(channelId: string, opts: { aroundMessageId?: string })` → `{ window, loadOlder(), loadNewer(), jumpToLatest(), send(input), retry(clientId), isLoading, error }` — initial load (latest or around), subscribes to `ChatEvents.message` filtered by `channelId` (dispatch `upsert`; replies also `setQueryData` on `threadQuery(parentId)` if cached), on socket `connect` (not the first) fetches `changes?afterSeq=window.lastSeq` and dispatches `upsert`, or reloads latest when `truncated`. `send` dispatches `pendingAdded` with `clientId = crypto.randomUUID()`, then the POST; failure → `pendingFailed`; `retry` resends the same `clientId`.
  - `useThread(rootId)` → `useQuery(threadQuery(rootId))`.
  - `useChatSearch()` → `{ thread?: string; message?: string; setThread(id?: string): void; clearMessage(): void }` over the current route's search params (no `router.tsx` change; read with `useLocation`, write with `useNavigate({ search: (prev) => … })`, typed by a local cast).

- [ ] **Step 1: Failing tests** (`channel-window.test.ts`): `upsert appends a new message at the bottom`; `upsert with an older changeSeq never overwrites newer`; `event with my clientId replaces the pending row`; `messages outside the window are ignored while hasOlder/hasNewer`; `loading older past 300 drops the newest and sets hasNewer`; `new rows past 300 drop the oldest and set hasOlder`; `replies are ignored but lastSeq moves`. `use-channel-messages.test.tsx` (mock fetch and `@/lib/socket` with an emitter): `loads the latest page`; `a chat:message event appears without refetch`; `reconnect fetches changes after the highest seq and applies an edit and a deletion without duplicates`; `truncated catch-up reloads the latest page`; `send shows a pending row, failure marks it failed, retry sends the same clientId`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web exec vitest run src/features/chat` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(web): chat data layer with catch-up`.

### Task 10: Web — message list and message item

**Files:**
- Create: `apps/web/src/features/chat/message-rows.ts`, `message-rows.test.ts`, `message-item.tsx`, `message-list.tsx`, `message-list.test.tsx`, `icons.tsx`
- Modify: `apps/web/src/locales/en.json`, `sk.json`, `docs/design/tokens.md`

**Interfaces:**
- Consumes: Task 8 `<MessageBody>`, Task 9 window; `<Avatar>`, `<FileChip>`, `<ImagePreview>`, `useGroupPeople`.
- Produces:
  - `buildRows(messages: MessageDto[], opts: { lastReadAt: string | null; meId: string; now: Date }): Row[]` where `Row = { kind: 'day'; date: string } | { kind: 'new' } | { kind: 'message'; message: MessageDto; showHeader: boolean; mentionsMe: boolean }` — day divider on day change (local time), `new` line before the first message by someone else with `createdAt > lastReadAt` (when `lastReadAt` is null: before the first message by someone else), `showHeader` false when the same author wrote the previous message within 5 minutes and no divider/new line sits between, `mentionsMe` when `mentions` has `meId` or `mentionsAll`, and the author is not me.
  - `type MessageAction = { id: string; label: string; icon: ReactNode; onSelect(message: MessageDto): void }` (exported from `message-item.tsx`, re-exported by `conversation.tsx`).
  - `<MessageItem message showHeader mentionsMe inThread meId nameOf messageActions renderMessageFooter onReply onOpenThread onQuoteClick highlighted quote? />` — row layout per spec (Avatar 32, name 600, `eGrant` pill for `author.isAdmin`, time, `(edited)`), mention highlight (`bg-muted` + 2 px `border-l` `brand-purple`), deleted → `t('chat.deleted')` only, attachments (images via `<ImagePreview>`, others `<FileChip>`), thread summary link, quote above a thread reply, `renderMessageFooter?.(message)` under the content; hover toolbar (`group-hover`/`focus-within`; on `(pointer: coarse)` an always-visible More button) with Reply in thread / Reply, then each `messageActions` entry, then More (Edit, Delete for own, not deleted); inline edit via `<Composer mode="edit">` (Task 11; until then a plain textarea is fine) and inline delete confirm. Every action has `aria-label` and `title`. Rows use `content-visibility: auto; contain-intrinsic-size: auto 64px`.
  - `<MessageList window meId groupId onLoadOlder onLoadNewer onJumpToLatest highlightId ... />` — the only scrolling element; loads older at top (keeps scroll position via `scrollHeight` diff in `useLayoutEffect`), loads newer at bottom when `hasNewer`, sticks to bottom when at bottom, shows the `t('chat.jumpToLatest')` pill when not at bottom and new messages arrive, pending rows muted with `t('chat.notSent')` + `t('chat.retry')` link on failure, empty state.
  - i18n (EN / SK): `chat.empty` "No messages yet. Write the first one to start the conversation." / "Zatiaľ tu nie sú žiadne správy. Napíšte prvú a začnite konverzáciu."; `chat.today` "Today" / "Dnes"; `chat.yesterday` "Yesterday" / "Včera"; `chat.newMessages` "New messages" / "Nové správy"; `chat.jumpToLatest` "New messages ↓" / "Nové správy ↓"; `chat.edited` "(edited)" / "(upravené)"; `chat.deleted` "Message deleted" / "Správa bola odstránená"; `chat.egrant` "eGrant" / "eGrant"; `chat.notSent` "Not sent." / "Neodoslané."; `chat.retry` "Retry" / "Skúsiť znova"; `chat.mention.all` "@all" / "@all"; `chat.mention.unknown` "@unknown" / "@neznámy"; `chat.actions.replyInThread` "Reply in thread" / "Odpovedať vo vlákne"; `chat.actions.reply` "Reply" / "Odpovedať"; `chat.actions.more` "More" / "Viac"; `chat.actions.edit` "Edit" / "Upraviť"; `chat.actions.delete` "Delete" / "Odstrániť"; `chat.confirmDelete` "Delete this message?" / "Odstrániť túto správu?"; `chat.cancel` "Cancel" / "Zrušiť"; `chat.thread.summary_one` / `_few` / `_many` / `_other` "{{count}} reply, last at {{time}}" / "{{count}} replies, last at {{time}}" (EN: `_one` singular, `_few`/`_many`/`_other` plural) and SK "{{count}} odpoveď, posledná o {{time}}" (`_one`), "{{count}} odpovede, posledná o {{time}}" (`_few`), "{{count}} odpovedí, posledná o {{time}}" (`_many`, `_other`) — both files carry all four suffixes so the key sets match. Dates via `Intl.DateTimeFormat(i18n.language, …)`.

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the message rows, hover toolbar, mention highlight, eGrant pill, dividers and jump pill.
- [ ] **Step 1: Failing tests:** `message-rows.test.ts`: `same author within 5 minutes hides the header`; `6 minutes apart or another author shows it`; `day divider between days`; `new line before the first unread message by someone else`; `mentionsMe for @all and for my id, not for my own message`. `message-list.test.tsx`: `eGrant pill only on admins`; `deleted message shows Message deleted`; `own message offers Edit and Delete in More, others' do not`; `delete asks inline and calls the API on confirm`; `messageActions entries render with labels and call onSelect with the message`; `renderMessageFooter output appears under the message`; `pending failed row shows Not sent. Retry`; `images render ImagePreview, other files FileChip`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** web tests and `pnpm --filter @spolu/web exec vitest run src/i18n` — PASS.
- [ ] **Step 5: Docs** (tokens: chat rows as built). **Commit** `feat(web): chat message list`.

### Task 11: Web — composer, mention picker and file uploads

**Files:**
- Create: `apps/web/src/features/chat/composer.tsx`, `composer.test.tsx`, `composer-text.ts`, `composer-text.test.ts`, `mention-picker.tsx`
- Modify: `apps/web/src/features/chat/message-item.tsx` (inline edit uses `<Composer mode="edit">`), locales, `docs/design/tokens.md`

**Interfaces:**
- Consumes: `uploadFile`, `<FileChip>`, `useGroupPeople`, `<Avatar>`, Task 1 `mentionToken`/`MENTION_ALL_TOKEN`.
- Produces:
  - `composer-text.ts` (pure): `applyFormat(value: string, start: number, end: number, kind: 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'bulletList' | 'numberedList' | 'quote'): { value: string; start: number; end: number }` (wraps the selection, or inserts the marks with the caret between; list/quote prefix each selected line; link → `[text](https://)` with `https://` selected); `mentionQueryAt(value: string, caret: number): { start: number; query: string } | null` (`@` at line start or after whitespace, no space in the query); `toStored(text: string, picked: { id: string; name: string }[], allLabel: string): string` (`@Name` of picked people and `allLabel` → tokens, longest names first); `toEditable(body: string, nameOf, allLabel): { text: string; picked: { id; name }[] }`.
  - `<Composer mode="new" | "edit" | "thread" groupId initialBody? replyTo?: { message: MessageDto; onCancel(): void } onSubmit(input: { body: string; fileIds: string[]; replyToId?: string }): void onCancel? />` — textarea (2 px input border, grows to 8 lines), toolbar (Bold, Italic, Strikethrough, Link, Bulleted list, Numbered list, Quote, Code; each with `aria-label` + `title`), Cmd/Ctrl+B, Cmd/Ctrl+I, Cmd/Ctrl+Shift+X; Enter sends / Shift+Enter newline (on `(pointer: coarse)` Enter is a newline); Esc cancels in edit mode; paperclip, drop on the conversation (prop `dropTarget` ref from `Conversation`), paste of images; chips with progress, send disabled while uploading or when empty; reply strip "Replying to {{name}}: {{excerpt}}" (80 chars via `plainExcerpt`) with × ; length counter only above 9 000 chars.
  - `<MentionPicker query people onPick onClose />` — "Everyone in this group" first, then people filtered by name (case- and diacritics-insensitive, `localeCompare`/`normalize('NFD')`), avatar, name, eGrant pill; ArrowUp/Down, Enter/Tab picks, Esc closes; `role="listbox"`/`option`, `aria-activedescendant`.
  - i18n (EN / SK): `chat.composer.placeholder` "Message the group…" / "Napíšte správu skupine…"; `chat.composer.threadPlaceholder` "Reply…" / "Odpovedať…"; `chat.composer.send` "Send" / "Odoslať"; `chat.composer.save` "Save" / "Uložiť"; `chat.composer.attach` "Attach files" / "Priložiť súbory"; `chat.composer.removeFile` "Remove file" / "Odstrániť súbor"; `chat.composer.replyingTo` "Replying to {{name}}: {{excerpt}}" / "Odpoveď pre {{name}}: {{excerpt}}"; `chat.composer.cancelReply` "Cancel reply" / "Zrušiť odpoveď"; `chat.composer.tooLong` "{{count}} / 10 000 characters" / "{{count}} / 10 000 znakov"; `chat.composer.tooManyFiles` "At most 10 files per message." / "Najviac 10 súborov v jednej správe."; `chat.format.bold` "Bold" / "Tučné"; `chat.format.italic` "Italic" / "Kurzíva"; `chat.format.strike` "Strikethrough" / "Prečiarknuté"; `chat.format.link` "Link" / "Odkaz"; `chat.format.bulletList` "Bulleted list" / "Odrážkový zoznam"; `chat.format.numberedList` "Numbered list" / "Číslovaný zoznam"; `chat.format.quote` "Quote" / "Citácia"; `chat.format.code` "Code" / "Kód"; `chat.mention.everyone` "Everyone in this group" / "Všetci v tejto skupine". Upload errors reuse the `features/files` messages.

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the composer, toolbar, file chips row, reply strip and mention list.
- [ ] **Step 1: Failing tests:** `composer-text.test.ts`: `applyFormat wraps a selection and inserts empty marks at the caret` (each kind); `numberedList numbers each selected line`; `mentionQueryAt finds @ja after a space and not inside an email`; `toStored/toEditable round-trip names and @all`. `composer.test.tsx`: `Enter sends, Shift+Enter adds a line`; `Cmd+B wraps the selection in **`; `typing @ja shows Jana, ArrowDown + Enter inserts @Jana Nováková and sends <@id>`; `Everyone in this group inserts @all and sends <@all>`; `attaching a file shows a chip and send is disabled until the upload resolves`; `11th file shows At most 10 files`; `reply strip shows the name and excerpt and × removes it`; `edit mode: Esc cancels, Enter saves`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Docs** (tokens: composer as built). **Commit** `feat(web): chat composer with mentions and files`.

### Task 12: Web — Conversation, thread panel, chat tab and unread badges

**Files:**
- Create: `apps/web/src/features/chat/conversation.tsx`, `conversation.test.tsx`, `thread-panel.tsx`, `unread.tsx`, `unread.test.tsx`
- Modify: `apps/web/src/features/chat/chat-tab.tsx` (replace the Phase 4 placeholder), locales, `docs/design/tokens.md`, `docs/architecture/performance.md` (bundle numbers)

**Interfaces:**
- Consumes: Tasks 9–11, `useGroupPeople`, `useSession`.
- Produces:
  - `<Conversation channelId: string groupId: string messageActions?: MessageAction[] renderMessageFooter?: (message: MessageDto) => ReactNode />` — exactly this prop contract (Phase 9 depends on it); knows nothing about group vs task. Layout: card panel with `MessageList` + `Composer`, `ThreadPanel` on the right (400 px) from 1024 px, full-width with a back button below. Reads `?thread=` / `?message=` via `useChatSearch`: `message` → `useChannelMessages(channelId, { aroundMessageId })`, scroll to it, highlight 2 s (`bg-muted`, no animation), then `clearMessage()`; with `thread` too, the thread opens and the reply is highlighted there. Marks read: when the list is at the bottom, `!hasNewer`, `document.visibilityState === 'visible'`, and the newest message's `createdAt` > `lastReadAt` → `markRead(channelId, newest.createdAt)` debounced 1 s.
  - `<ThreadPanel rootId groupId meId messageActions renderMessageFooter onClose />` — root, divider `t('chat.thread.replies', { count })`, replies (each with "Reply" → reply strip in the thread composer), quote click scrolls to and highlights the quoted reply, own composer (`mode="thread"`, sends `parentId = rootId`, `replyToId`); deleted root shows `t('chat.deleted')` and keeps replies.
  - `chat-tab.tsx`: `ChatTab` reads `groupChatQuery(groupId)` and renders `<Conversation channelId={data.id} groupId={groupId} />` filling the height below the tabs.
  - `unread.tsx` (imports only `api.ts`, `useSession`, `getSocket`): `<ChatUnreadBadge groupId />` (ink pill, `99+` cap, hidden at 0; listens to `chat:message` with `isNew`, top-level, not mine, matching the group's channel id → increment `groupChatQuery` cache; `chat:read` for that channel → invalidate) and `<GroupUnreadCount groupId />` (reads `chatUnreadQuery`, same pill).
  - i18n (EN / SK): `chat.thread.title` "Thread" / "Vlákno"; `chat.thread.close` "Close thread" / "Zavrieť vlákno"; `chat.thread.back` "Back to chat" / "Späť na chat"; `chat.thread.replies_one` / `_few` / `_many` / `_other` "{{count}} reply" / "{{count}} replies" — SK "{{count}} odpoveď" / "{{count}} odpovede" / "{{count}} odpovedí" / "{{count}} odpovedí" (all four suffixes in both files); `chat.unread` "{{count}} unread messages" / "Neprečítané správy: {{count}}" (badge `aria-label`); `chat.loadError` "The chat could not be loaded." / "Chat sa nepodarilo načítať."; reuse `errors.retry`.
  - **NOTE for controller** (do not do it in this task): the Chat tab link (Phase 4 group tabs) and the groups list rows (`features/groups/groups-page.tsx`) each need one line, `<ChatUnreadBadge groupId={id} />` and `<GroupUnreadCount groupId={group.id} />`. They are groups files; the controller decides whether this branch adds them or a follow-up commit after the merge does.

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the conversation layout, thread panel (desktop and < 1024 px), highlight and badges.
- [ ] **Step 1: Failing tests:** `conversation.test.tsx` (mock fetch + socket): `opens at the newest page and marks read at the bottom`; `does not mark read while scrolled up`; `?thread=<id> opens the thread panel and survives remount`; `Reply in a thread shows the strip and the sent reply carries replyToId`; `clicking a quote highlights the quoted reply`; `?message=<id> loads around it and highlights it`; `messageActions and renderMessageFooter reach the thread panel messages too`; `a message deleted while its thread is open shows Message deleted and keeps replies`. `unread.test.tsx`: `badge shows the count, 99+ above 99, nothing at 0`; `a new message from someone else increments it, my own does not`; `chat:read clears it`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm --filter @spolu/web test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @spolu/web build` — PASS; initial JS ≤ 200 kB gzip, chat chunk reported (< ~100 kB gzip).
- [ ] **Step 5: Docs** (tokens: chat screen as built; performance: bundle numbers). **Commit** `feat(web): conversation, thread panel and unread badges`.

### Task 13: End-to-end

**Files:**
- Create: `e2e/chat.spec.ts`
- Modify: `e2e/login.ts` or `e2e/groups.spec.ts` helpers only if a shared helper is extracted (no behavior change)

**Interfaces:**
- Consumes: the whole stack; UI is Slovak in e2e. Production rate limits apply (code requests, joins): one serial test, one new client.

- [ ] **Step 1: Write** one serial test: the superadmin creates a group (as in `groups.spec.ts`), a client joins by invite in a second context and lands on the Chat tab; admin writes "Ahoj" → client sees it without reload; client replies in a thread → admin sees "1 odpoveď" and the reply in the panel; admin mentions the client via the picker (`@` + name, Enter) → client sees a highlighted row; client uploads `e2e/fixtures/logo.png` → admin sees the image preview loaded (`naturalWidth > 0`); client edits ("(upravené)") and deletes ("Správa bola odstránená") → both visible on the admin side; `clientContext.setOffline(true)`, admin writes "Počas výpadku", assert the client does not show it within 2 s, `setOffline(false)` → the message appears on the client without reload. If Chromium's offline emulation does not drop the WebSocket, report it to the controller instead of weakening the assertion.
- [ ] **Step 2: Run** `pnpm test:e2e` — PASS.
- [ ] **Step 3: Commit** `test(e2e): group chat between an admin and a client`.

### Task 14: Docs sweep and full CI

**Files:** as listed in the spec "Documentation updates in this phase": `docs/architecture/data-model.md`, `realtime.md`, `permissions.md`, `overview.md` (chat module; the read-only `user` join as the third deliberate exception; `modules/chat` in "Where code lives"), `docs/design/tokens.md`, `docs/glossary.md` (thread, mention, @all), `docs/product/chat.md` if behavior details changed; `.claude/skills/new-module/SKILL.md` only if chat adds a pattern it lacks (per-channel seq + catch-up, idempotent `clientId`).

- [ ] **Step 1:** Run the `update-kb` skill over `git diff phase-4...HEAD`; fix every stale statement; do not mark Phase 5 done in the roadmap (the controller does after the owner's walkthrough).
- [ ] **Step 2:** `bash scripts/check-docs.sh phase-4` and `bash scripts/ci.sh` — PASS. **Commit** `docs: phase 5 knowledge base sweep`.

---

## Interfaces for Phase 9

Phase 9 (task chat, "Turn into tasks") builds on these exact names; changing them breaks Phase 9:

- `apps/web/src/features/chat/conversation.tsx`: `export function Conversation(props: { channelId: string; groupId: string; messageActions?: MessageAction[]; renderMessageFooter?: (message: MessageDto) => ReactNode })`. `messageActions` appear in every message's hover toolbar (main list and thread panel) after Reply; `renderMessageFooter` renders under every message's content. `export type MessageAction = { id: string; label: string; icon: ReactNode; onSelect(message: MessageDto): void }`.
- Link format to a message: `<chat route>?message=<id>`, and `?thread=<rootId>&message=<id>` for a reply; works on any route that mounts `<Conversation>`.
- Server: `channels.kind` accepts `'task'`, `channels.task_id` is a nullable text column without FK (Phase 9 adds the FK and an `ensureTaskChannel`); `canReadChannel(actor, { groupId }, actorGroupId)`; `getMessage(db, id)`, `getChannel(db, id)`, `toMessageDtos(db, groupId, rows)`; events `chat:message` go to the channel's group room whatever the kind.
- Shared: `MessageDto`, `MessageSchema`, `ChatEvents`, `extractMentions`, `plainExcerpt`.

## NOTEs for controller

1. **Unread badges in groups files.** "Done when" needs the Chat tab badge and the groups-list counts; both mount points are Phase 4 / groups files. Task 12 produces `<ChatUnreadBadge>` and `<GroupUnreadCount>`; adding the two one-line usages needs your decision (this branch or after merge).
2. **`NotificationKind`.** Ask the Phase 4 plan to define all Phase 5 and 8 kinds up front (`chat.message`, `chat.mention`, `chat.thread_reply`, `task.moved`, `task.assigned`), so neither parallel branch edits the notifications file.
3. **People list service export.** Chat needs the server function behind `GET /api/groups/:id/people` exported from the groups service (one query, used for mention validation and notification recipients). If Phase 4 only exports `isGroupPerson`, please have Phase 4 export the list function too.
4. **Admin catch-up timing.** Admins join the group room by `group:join` after `connect`; chat runs catch-up on `connect`. A message written in that gap can be missed until the next change. If `useGroupRoom` can expose an "after (re)join" callback or state, chat should run catch-up on it; ask Phase 4 for it.
5. **Migration order.** Whichever of `phase-5` / `phase-8` merges second regenerates its drizzle migration (`db:generate`) on top of the other.
