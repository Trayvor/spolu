# Phase 20 — Admin Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin lands on a dashboard (assigned tasks, upcoming reminders, unread mentions) beside a live client sidebar, gets a yellow "assigned to me" pill on the Úlohy tab, and has a global task board across clients filtered by default to the clients they manage.

**Architecture:**
- A new read-only server module `modules/home` holds the sidebar, dashboard and global board queries: one SQL statement per card, sidebar and board page. It reads the tasks, chat and groups tables directly (the documented read-only exception that `listGroups` and `selectTasks` already use) and writes nothing. Reminders come through a registration slot (`registerReminderSource`), so Phases 17 and 20 merge in either order.
- Live updates: a tiny `admin:activity { groupId, kind }` event goes to Phase 18's `admins` room, sent from the existing `emitMessage`, `emitTask` and `emitTaskDeleted`. The web refetches the one affected query, debounced by 2 s, only while the page is visible. `chat:read` in the user room triggers the same refetch.
- On the web there are three lazy chunks: `admin-shell` (the sidebar, mounted by the already lazy authed layout for admins at ≥ 1024 px), `admin-home` (the `/` dashboard) and `global-board` (`/tasks`). Their texts are one lazy namespace, `adminHome`, loaded with `loadNamespace`. The only eager additions are the two routes, the header links, `AssignedPill`, the `mine-count` query and their copy.

**Tech Stack:** Fastify 5, Drizzle + drizzle-kit, PostgreSQL 17, Socket.IO, React 19, TanStack Router and Query, radix-ui, i18next (lazy namespaces), zod, Vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-phase-20-admin-home-design.md`, with the rulings in `docs/superpowers/specs/2026-10-16-phases-17-20-brief.md` (no drag and drop on the global board, and the attention yellow is `#FFCE3A`). Builds on the Phase 18 plan (`docs/superpowers/plans/2026-10-16-phase-18-client-managers.md`) and the Phase 17 plan (`docs/superpowers/plans/2026-10-16-phase-17-knowledge-base.md`).

## Global Constraints

- Branch `phase-20`, cut from `main` **after Phase 18 has merged**. Each task runs on its own branch cut from `phase-20` once its dependencies have merged into it.
- Phase 18 names used as they are: `managedGroupIds(db, userId)`, `managedGroupsSql(userId)` (a parenthesized subquery for `x in ${…}`), `listGroups(db, viewerId)` with `GroupSummary.managedByMe`, `ADMINS_ROOM = 'admins'` in `infra/realtime/rooms.ts`, and `GroupEvents.managers = 'group:managers'`.
- **Phase 17 may or may not be on `main`.** Check with `git ls-files apps/server/src/modules/reminders apps/web/src/components/client-filter.tsx apps/web/src/components/ui/sheet-dialog.tsx`.
  - Reminders: Phase 20 never imports `modules/reminders` outside the registration in Task 5. Whichever of Phases 17 and 20 merges second wires `listUpcomingForUser` into `registerReminderSource` in `app.ts` and adds its test.
  - `ClientFilter` (`apps/web/src/components/client-filter.tsx`) and `SheetDialog` (`apps/web/src/components/ui/sheet-dialog.tsx`): reuse them when present. When they are absent, build them exactly as the Phase 17 plan's Task 12 (`ClientFilter`) and Task 2 (`SheetDialog`, the frame only) describe them, at those paths, and Phase 17 reuses them.
- **One migration**, the next free number, generated with `pnpm --filter @spolu/server db:generate --name admin_home` in Task 1. If Phase 17 merges in between, regenerate and renumber.
- English everywhere in the repo. Every UI string is an i18n key with copy in **both** `en` and `sk`.
  - Phase 20 strings go in the lazy namespace `adminHome`, at `apps/web/src/features/admin-home/locales/{en,sk}.json`, loaded with `loadNamespace('adminHome')` by the shell, the `/` route and the `/tasks` route.
  - Each task writes only its own top-level section: `shell`, `sidebar`, `home`, `cards`, `board`. The skeleton is created in Task 1.
  - Only `nav.home`, `nav.tasks` and the pill's label `tasks.assignedToYou` go into the eager locale files, next to the existing `nav.*` and `tasks.unreadTasks`.
- **Performance first.**
  - One SQL statement per card, sidebar and global board page (reminders: two, one for the list and one for the count). Each query has a `*Sql` builder exported beside it, so the `EXPLAIN` test runs exactly what the endpoint runs.
  - The eager JS stays **≤ 200 kB gzip**, and this phase adds at most **0.6 kB gzip** to it. Every web task runs `pnpm --filter @spolu/web build` and checks it. The sidebar (`admin-shell`), the dashboard (`admin-home`) and the global board (`global-board`) are three lazy chunks.
- **Reuse:** `UnreadPill`, `GroupLogo`, `Card`, `Badge`, `Button`, `Avatar`, `TaskCard`/`TaskCardMeta`, `TaskPanel` and `BucketSelect`, `useGroupRoom`, `useMediaQuery`, `useDocumentVisible`, `useUpdateSearch`, `plainExcerpt`, `formatDue`/`isOverdue`, `ClientFilter`, `SheetDialog`.
- Every UI task starts by invoking `frontend-design:frontend-design` on the egrant.sk tokens (`docs/design/tokens.md`, `components/ui/*`). No fancy effects: no shimmer, no animation and no decorative icons.
- The yellow: token `--attention: #FFCE3A` (Tailwind `attention`) with `ink` text. It is used only for "assigned to me" pills and dots, never for a larger fill.
- **Test-first** (`superpowers:test-driven-development`): every code step follows a failing test.
- Tests share `spolu_test` and `spolu_e2e`. Use unique emails (`${randomUUID()}@example.com`) and new groups per test. Never truncate a table, and never assume one is empty or that an admin manages nothing. Assert on the rows of the test's own groups. A test that needs volume (the `EXPLAIN` checks) seeds inside a transaction that it rolls back.
- Errors are `{ error: '<code>' }`. There is one new code, `invalid_filter` (400). `forbidden` (403) and `not_found` (404) are reused.
- Docs ship in the same commit as the code they describe (the `update-kb` skill). Run `rtk proxy pnpm exec prettier --check <changed files>` before each commit.
- Every commit message ends with exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- Commands:
  - server: `pnpm --filter @spolu/server exec vitest run <path>`;
  - web: `pnpm --filter @spolu/web exec vitest run <path>`;
  - e2e: `pnpm test:e2e -- <spec>`;
  - everything: `bash scripts/ci.sh`.

## Waves

| wave | tasks (parallel within a wave) |
|---|---|
| 1 | Task 1 |
| 2 | Task 2, Task 3, Task 7 |
| 3 | Task 4, Task 5, Task 6, Task 8 |
| 4 | Task 9, Task 10 |
| 5 | Task 11 |

The web tasks (8–10) mock HTTP with the Task 1 schemas, so they do not wait for the server endpoints.

## Review Focus

- **Reading a chat must clear its counts.** When the admin reads a group chat or a thread (here or on another device), the sidebar's black pill and the mention on the dashboard must go away. `admin:activity` is sent only for writes, so `chat:read` (user room) must trigger the same refetch. Test in Task 8: `chat:read invalidates the sidebar and the mentions keys after the debounce`.
- **One message, two reasons.** A message that names me and also says @all in a group I manage must be listed and counted once. Test in Task 4: `a message with a name mention and @all in a managed group is one item`.
- **A mention never marks older replies read.** If I am already one of a thread's people and have unread replies there, a new reply that names me must not move my read mark forward. Test in Task 2: `a reply naming someone already in the thread keeps their older unread replies unread`.
- **"Overdue" and "this week" follow Bratislava's date, not UTC.** Between 00:00 and 02:00 Bratislava time the UTC date is still yesterday. Test in Task 6: `due filters use the Bratislava date at 00:30 local time`.
- **Paging through equal sort keys.** Two clients with the same name, same urgency, same deadline and tasks created in the same millisecond: "Show 50 more" must never skip or repeat a card. Test in Task 6: `keyset pages never skip or repeat tasks with equal sort keys across same-named groups`.

---

### Task 1: Contracts, indexes and the attention token

Depends on: none. Wave 1.

**Files:**
- Create: `packages/shared/src/home.ts`, `packages/shared/src/home.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/users.ts` (`ErrorCodes.invalidFilter`)
- Modify: `apps/server/src/modules/chat/schema.ts`, `apps/server/src/modules/tasks/schema.ts` (indexes)
- Create: `apps/server/src/infra/db/migrations/00NN_admin_home.sql` (generated) and its `meta/` snapshot
- Create: `apps/server/src/modules/home/schema.test.ts` (the indexes exist)
- Modify: `apps/web/src/styles/theme.css` (`--attention`, `--attention-foreground`)
- Create: `apps/web/src/features/admin-home/locales/{en,sk}.json` (skeleton), and register the `adminHome` namespace the way the i18n split registers feature namespaces
- Docs: `docs/architecture/data-model.md` (the three indexes), `docs/design/tokens.md` (`attention`)

**Interfaces:**
- Produces (`packages/shared/src/home.ts`, its own module so `sideEffects: false` keeps it out of the entry chunk):
  - `SidebarClientSchema = z.object({ groupId, name, hasLogo: z.boolean(), updatedAt, managed: z.boolean(), unread: z.number().int(), assigned: z.number().int() })`, `SidebarSchema = z.array(SidebarClientSchema)`.
  - `AssignedTaskSchema = { id, groupId, groupName, title, urgent, dueDate: string|null, bucketKind: BucketKindSchema }`, `AssignedTasksSchema = { total, urgent, items: AssignedTask[] }`.
  - `MentionItemSchema = { messageId, channelId, taskId: string|null, parentId: string|null, groupId, groupName, authorName, excerpt, createdAt }`, `MentionsSchema = { total, items }`.
  - `HomeReminderSchema = { id, at, title, groupId, groupName, target: discriminatedUnion('kind', [{ kind: 'knowledge', itemId }, { kind: 'task', taskId }]) }`. This is the spec's `UpcomingReminder` contract under a name that does not collide with Phase 17's `UpcomingReminder` in `reminders.ts` (which is assignable to it).
  - `HomeRemindersSchema = z.union([{ available: z.literal(false) }, { available: z.literal(true), nextWeek, items: HomeReminder[], error: z.boolean().optional() }])`.
  - `BoardColumnKinds = ['todo', 'other', 'egrant_review', 'client_review', 'done'] as const`, and `type BoardColumnKind`.
  - `GlobalTaskDtoSchema = TaskDtoSchema.extend({ groupName, groupHasLogo, groupUpdatedAt, bucketKind: BucketKindSchema, bucketName: string|null })`.
  - `GlobalBoardSchema = { columns: { kind: BoardColumnKind; total: number; items: GlobalTaskDto[]; next: string|null }[], people: TaskPerson[] }`. `people` are the distinct assignees of the tasks in scope, for the assignee menu.
  - `GlobalBoardFilterSchema` (parses the query string; every field optional):
    - `clients`: comma-separated ids, at most 200, each matching `^[A-Za-z0-9_-]{1,64}$`;
    - `assignee`: `'me' | 'anyone' | 'none' | <id>` (default `anyone`);
    - `urgent`: `'1'`;
    - `due`: `'overdue' | 'week' | 'none'`;
    - `q`: trimmed, 2–100 characters, or ignored when shorter than 2;
    - `completed`: `'1'`;
    - `column`: a `BoardColumnKind`, and `after`: an opaque cursor (both or neither).
  - `MineCountSchema = z.object({ open: z.number().int() })`.
  - `AdminEvents = { activity: 'admin:activity' } as const`, and `type AdminActivityEvent = { groupId: string; kind: 'chat' | 'task' }`.
  - `HOME_LIMITS = { tasks: 20, mentions: 20, mentionCap: 100, mentionDays: 90, reminders: 10, columnPage: 50, completedDays: 30, excerpt: 80 }`.
- Produces: `ErrorCodes.invalidFilter = 'invalid_filter'`.
- Produces (indexes, in Drizzle):
  - `message_mentions_user_message_idx` on `message_mentions (user_id, message_id)`;
  - `messages_mentions_all_top_idx` on `messages (channel_id, created_at)` where `mentions_all and deleted_at is null and parent_id is null`;
  - `messages_mentions_all_reply_idx`, the same with `parent_id is not null`;
  - `tasks_open_group_idx` on `tasks (group_id, completed_at)`.
- Produces: the CSS tokens `--attention: #FFCE3A` and `--attention-foreground` = the `ink` value, exposed as Tailwind `bg-attention text-attention-foreground`.
- Produces: the locale skeleton `{ "shell": {}, "sidebar": {}, "home": {}, "cards": {}, "board": {} }` in en and sk.

- [ ] **Step 1: Write the failing tests.**
  - `home.test.ts`:
    - `filter: unknown due fails`;
    - `filter: 201 clients fails`;
    - `filter: a malformed client id fails`;
    - `filter: column without after fails`;
    - `filter: q of one character is dropped`;
    - `HomeReminderSchema accepts a knowledge and a task target`.
  - `schema.test.ts`: `the admin home indexes exist`. Query `pg_indexes` for the four names and assert the partial predicates contain `mentions_all`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/shared exec vitest run src/home.test.ts` and `pnpm --filter @spolu/server exec vitest run src/modules/home`. Expected: FAIL (module missing, indexes missing).
- [ ] **Step 3: Implement** the shared module, the error code, the indexes, `db:generate --name admin_home`, the tokens and the locale skeleton.
- [ ] **Step 4: Run the tests,** then `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Docs.** Add the indexes to `data-model.md` and `attention` to `tokens.md`, with its one rule (only "assigned to me" pills and dots, ink text, contrast about 13:1).
- [ ] **Step 6: Commit.** `feat(home): admin home contracts, indexes and the attention token`.

---

### Task 2: A mention in a reply joins the thread, and `admin:activity`

Depends on: Task 1. Wave 2.

**Files:**
- Modify: `apps/server/src/modules/chat/service.ts` (`recordReplyReads`), `apps/server/src/modules/chat/messages.ts` (`sendMessage`), `messages.test.ts`, `unread.test.ts`
- Modify: `apps/server/src/infra/realtime/rooms.ts` (`emitAdminActivity`), `apps/server/src/modules/chat/events.ts`, `apps/server/src/modules/tasks/events.ts`, `apps/server/src/infra/realtime/socket.test.ts`
- Docs: `docs/product/chat.md` (a name mention in a reply makes you one of the thread's people), `docs/architecture/realtime.md` (`admin:activity`)

**Interfaces:**
- Consumes: `ADMINS_ROOM` (Phase 18); `AdminEvents`, `AdminActivityEvent` (Task 1).
- Produces:
  - `recordReplyReads(tx, reply, root, mentionedIds: string[] = [])`. Each mentioned id, other than the reply's author, gets a row with `lastReadAt` = the reply's `created_at` minus 1 ms and `lastReplyAt` = latest. **On conflict, `lastReadAt` is never changed for these rows** (only `lastReplyAt` = greatest). The existing replier and root rules are unchanged.
  - `sendMessage` passes `mentions.userIds` (names only, never @all) for replies. Its `threadPeople` result gains the mentioned users who are still group people (minus the author), so `emitThreadReply` gives them the live thread dot. The `chat.thread_reply` notification still goes only to the old thread people (the mentioned ones already get `chat.mention`).
  - `emitAdminActivity(io, event: AdminActivityEvent): void` sends to `ADMINS_ROOM`.
  - `emitMessage` sends `{ groupId: channel.groupId, kind: 'chat' }`. `emitTask` and `emitTaskDeleted` send `{ groupId, kind: 'task' }`. Each is sent right after the existing group-room emit, so every call site (send, edit, delete, create, edit, move, delete) is covered without touching the routes.

- [ ] **Step 1: Write the failing tests.**
  - `messages.test.ts`, with a new group, client C and admins A and B:
    - `a reply naming A adds A's thread row and counts as unread for A`: `unreadThreads(db, A, channel)` contains the root, and `unreadCount` grows by 1.
    - `opening the thread clears it`: `markThreadRead(A, root)` brings the count back.
    - `a reply naming someone already in the thread keeps their older unread replies unread` (Review Focus): B replies, then C replies twice, then C replies naming B; B's unread replies in the thread are 3.
    - `an @all reply adds no thread rows`.
    - `a self-mention adds nothing`.
    - `the named user gets chat.mention and no chat.thread_reply`.
  - `socket.test.ts`:
    - `admin:activity reaches admins only`: an admin socket that has not joined the group room receives `{ groupId, kind: 'chat' }` after a send. The group's client and another group's client receive nothing.
    - `a task move sends kind task`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/chat src/infra/realtime`. Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces block.
- [ ] **Step 4: Run** the same command. Expected: PASS, and all existing chat and realtime tests still pass.
- [ ] **Step 5: Docs.**
  - `product/chat.md`: naming someone in a reply makes them one of the thread's people; @all does not.
  - `realtime.md`: `admin:activity` (room, payload, when it is sent, clients never get it, the web debounces it by 2 s).
- [ ] **Step 6: Commit.** `feat(chat): a name mention in a reply joins the thread; admin activity signal`.

---

### Task 3: Home module, sidebar and assigned tasks, and the `EXPLAIN` harness

Depends on: Task 1. Wave 2.

**Files:**
- Create: `apps/server/src/modules/home/{sidebar.ts, assigned.ts, routes.ts}`, `sidebar.test.ts`, `assigned.test.ts`, `routes.test.ts`
- Create: `apps/server/src/modules/home/explain.test.ts`, `apps/server/src/modules/home/test-volume.ts` (the seeding helper)
- Modify: `apps/server/src/modules/chat/service.ts` (export `unreadByGroupSql`, and make `unreadByGroup` use it), `apps/server/src/app.ts` (register `homeRoutes`)
- Docs: `docs/architecture/overview.md` (`modules/home`: read-only, one statement per block), `docs/architecture/permissions.md` (the admin-only home endpoints)

**Interfaces:**
- Consumes: `managedGroupsSql` (Phase 18); `requireAdmin`; the Task 1 schemas.
- Produces:
  - `unreadByGroupSql(userId: string): SQL` in `chat/service.ts`. It selects `(group_id, n)` for every group chat. `unreadByGroup` becomes `select … from (${unreadByGroupSql(userId)}) where n > 0 [and group_id = …]`, with its behavior unchanged.
  - `sidebarSql(userId: string): SQL` and `getSidebar(db: Db, userId: string): Promise<SidebarClient[]>`.
    - Groups left-joined with `unreadByGroupSql`, with `(select t.group_id, count(*) from task_assignees ta join tasks t … where ta.user_id = $me and t.completed_at is null group by t.group_id)`, and with `groups.id in managedGroupsSql($me)` as `managed`.
    - `order by managed desc, (unread > 0) desc, (assigned > 0) desc, name, id`.
  - `assignedSql(userId: string): SQL` and `getAssignedTasks(db: Db, userId: string): Promise<AssignedTasks>`.
    - `task_assignees ⋈ tasks ⋈ groups ⋈ buckets`, where it is my assignment and `completed_at is null`.
    - `count(*) over ()` and `count(*) filter (where t.urgent) over ()`.
    - `order by t.urgent desc, t.due_date asc nulls last, t.created_at asc, t.id limit 20`.
    - With 0 rows, `{ total: 0, urgent: 0, items: [] }`.
  - `homeRoutes` plugin (prefix `/api`), every route behind `requireAdmin`:
    - `GET /me/home/sidebar` → `SidebarClient[]`;
    - `GET /me/home/tasks` → `AssignedTasks`.
    Tasks 4–6 add their routes to this file.
  - `test-volume.ts`: `withVolume(db, fn: (tx, ids: { adminId, groupIds }) => Promise<void>): Promise<void>`.
    - It opens a transaction and seeds with `generate_series`: 100 groups with channels and the five buckets, 20 000 tasks (a third assigned to the admin, a tenth completed), 200 000 messages (5 % mentioning the admin, 1 % `mentions_all`, 10 % replies), read states, and the admin managing 10 groups.
    - It runs `analyze` on the touched tables, calls `fn`, then throws a sentinel to roll back and swallows it.
  - `expectIndexed(tx, query: SQL, tables: string[]): Promise<void>` in `explain.test.ts`.
    - It runs `explain (analyze, format json)`.
    - It asserts that no `Seq Scan` node has a `Relation Name` in `tables`, and that `Execution Time < 50`.

- [ ] **Step 1: Write the failing tests.**
  - `sidebar.test.ts`, with new groups G1–G4 and admin A managing G1 and G2:
    - `managed first, then others`.
    - `inside a section: unread, then assigned, then the rest, by name`.
    - `unread equals unreadByGroup for each group`.
    - `assigned excludes Completed and other users' tasks`.
    - `a disabled manager's group is under Other clients`: B manages G3, B is deactivated, and for B (re-enabled after) G3 is `managed: false` while disabled.
    - `one statement` (the counting logger pattern from `chat/messages.test.ts`).
  - `assigned.test.ts`:
    - `exact order`, with tasks: urgent and due 20 Oct, urgent with no date, overdue 1 Oct, due 25 Oct, two with no date (older first). The result is in that order.
    - `totals and urgent count; Completed excluded`.
    - `first 20 only, total counts all`.
  - `routes.test.ts`:
    - `a client gets 403 on /me/home/sidebar and /me/home/tasks`.
    - `an admin gets 200 with the shapes`.
  - `explain.test.ts`: `sidebar and assigned use indexes under 50 ms`, inside `withVolume`, with tables `['messages', 'message_mentions', 'tasks', 'task_assignees']`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/home src/modules/chat/unread.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces block. Keep the explain test in the default run. If it takes over 20 s locally, mark it with the repo's existing slow-test convention and say so in the commit body.
- [ ] **Step 4: Run** the same command. Expected: PASS, and `unread.test.ts` is unchanged and green.
- [ ] **Step 5: Docs.** `overview.md`: `modules/home` and its read-only exception. `permissions.md`: `/api/me/home/*` is admins only.
- [ ] **Step 6: Commit.** `feat(home): client sidebar and assigned tasks queries`.

---

### Task 4: Unread mentions

Depends on: Task 2, Task 3. Wave 3.

**Files:**
- Create: `apps/server/src/modules/home/mentions.ts`, `mentions.test.ts`
- Modify: `apps/server/src/modules/home/routes.ts`, `routes.test.ts`, `explain.test.ts`

**Interfaces:**
- Consumes: `managedGroupsSql`; `plainExcerpt` (`@spolu/shared`); `HOME_LIMITS`; Task 2's thread rows for named mentions in replies.
- Produces:
  - `mentionsSql(userId: string): SQL` and `getMentions(db: Db, userId: string): Promise<Mentions>`. One statement:
    - The candidate ids are the `union` (not `union all`, so a message counts once) of:
      - (a) `message_mentions mm` where `mm.user_id = $me`;
      - (b) `messages m join channels c` where `m.mentions_all` and `c.group_id in managedGroupsSql($me)`.
    - Then join `messages m`, `channels c` and `groups g`, keeping `m.author_id <> $me`, `m.deleted_at is null` and `m.created_at > now() - interval '90 days'`.
    - Unread test:
      - top-level: `m.created_at > coalesce(rs.last_read_at, '-infinity')`, with `rs` = my `read_states` row for `c.id`;
      - reply: `m.created_at > coalesce(trs.last_read_at, rs.last_read_at, '-infinity')`, with `trs` = my `thread_read_states` row for `m.parent_id`.
    - The newest 100 (`limit 100` subquery), then `count(*) over ()` as `total`, and the first 20 by `created_at desc, id desc`.
    - Each row carries `author_name`, `group_name`, `c.task_id`, `m.parent_id`, `m.body` and `mention_names` (a `json_object_agg` subquery over the message's mentions joined to `user`, as `getSourceMessage` does).
  - The excerpt is made in code: `plainExcerpt(body, (id) => mentionNames[id], 80)`.
  - Route `GET /me/home/mentions` → `Mentions`.

- [ ] **Step 1: Write the failing tests** in `mentions.test.ts`. Use a new managed group GM and an unmanaged group GO, admin A managing GM, and client C:
  - `a name mention by C is listed with author, group and excerpt`.
  - `@all in GM is listed; @all in GO is not`.
  - `a message with a name mention and @all in a managed group is one item` (Review Focus).
  - `own messages, deleted messages and read messages are excluded` (read = `markRead` after it).
  - `a mention in a reply is listed with parentId and disappears after markThreadRead`.
  - `an @all reply counts until the channel read mark passes it`.
  - `a task chat mention carries taskId`.
  - `older than 90 days is excluded`: set `created_at` to 91 days ago.
  - `total caps at 100 and items at 20`: 105 mentions give `total: 100` and `items.length === 20`, newest first.
  - `one statement`.
  - `routes.test.ts`: `a client gets 403 on /me/home/mentions`.
  - `explain.test.ts`: `mentions uses indexes under 50 ms` (no seq scan on `messages` or `message_mentions`).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/home`. Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces block. If the plan shows a seq scan on `messages` for part (b), drive it from `channels` of the managed groups through `messages_mentions_all_*_idx` (a lateral join per channel).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(home): unread mentions for the dashboard`.

---

### Task 5: The reminder source slot

Depends on: Task 3. Wave 3.

**Files:**
- Create: `apps/server/src/modules/home/reminder-source.ts`, `reminder-source.test.ts`
- Modify: `apps/server/src/modules/home/routes.ts`, `routes.test.ts`
- Only if Phase 17 is on `main`: modify `apps/server/src/modules/reminders/service.ts` (`countUpcomingForUser`), `apps/server/src/app.ts` (registration), and create `apps/server/src/modules/home/reminder-source-phase17.test.ts`
- Docs: `docs/architecture/overview.md` (the slot, and who registers it)

**Interfaces:**
- Consumes: `HomeReminder`, `HomeReminders` (Task 1). If Phase 17 is present, also `listUpcomingForUser(db, actor, { from, limit })`.
- Produces:
  - ```ts
    type ReminderSource = {
      upcoming(db: Db, actor: SessionUser, opts: { from: Date; limit: number }): Promise<HomeReminder[]>;
      countNextWeek(db: Db, actor: SessionUser, from: Date): Promise<number>; // capped at 100
    };
    ```
    The source takes `actor`, not the spec's `userId`, because `listUpcomingForUser` needs the actor for its readability check.
  - `registerReminderSource(source: ReminderSource | null): void` and `getReminderSource(): ReminderSource | null` (module state; `null` resets it in tests).
  - Route `GET /me/home/reminders`:
    - no source: `{ available: false }`;
    - otherwise: `{ available: true, nextWeek, items }`, running `upcoming(…, { from: now, limit: 10 })` and `countNextWeek(…, now)` in parallel;
    - if either throws: log it and answer `{ available: true, nextWeek: 0, items: [], error: true }` with status 200.
  - If Phase 17 is present:
    - `countUpcomingForUser(db, actor, { from: Date; to: Date }): Promise<number>` in `reminders/service.ts`: one query over `reminder_recipients ⋈ reminder_times` where the time is unfired and `from <= at < to`, capped at 100.
    - In `app.ts`: `registerReminderSource({ upcoming: (db, actor, o) => listUpcomingForUser(db, actor, o), countNextWeek: (db, actor, from) => countUpcomingForUser(db, actor, { from, to: addDays(from, 7) }) })`.
    - If Phase 17 is not present, this part is not done here: the Phase 17 merge does it, with the same code and test.

- [ ] **Step 1: Write the failing tests.**
  - `reminder-source.test.ts` (`afterEach(() => registerReminderSource(null))`):
    - `no source answers available false`;
    - `a fake source gives items and nextWeek`;
    - `a throwing source answers error true with 200`;
    - `a client gets 403`.
  - If Phase 17 is present, `reminder-source-phase17.test.ts`: `the registered source lists my knowledge reminder and counts the next 7 days` (create a reminder item through the Phase 17 service with times in 2 and 9 days; `nextWeek` is 1 and `items` has 2).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/home`. Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces block.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Docs.** In `overview.md`, describe the slot, the rule that the second of Phases 17 and 20 to merge registers it, and that Phase 19's task reminders arrive through the same source.
- [ ] **Step 6: Commit.** `feat(home): upcoming reminders through a registered source`.

---

### Task 6: Global task board query

Depends on: Task 3. Wave 3.

**Files:**
- Create: `apps/server/src/modules/home/global-board.ts`, `global-board.test.ts`
- Modify: `apps/server/src/modules/home/routes.ts`, `routes.test.ts`, `explain.test.ts`
- Docs: `docs/architecture/permissions.md` (`GET /api/tasks/global`)

**Interfaces:**
- Consumes: `managedGroupIds`, `GlobalBoardFilterSchema`, `GlobalBoard`, `HOME_LIMITS`; the `selectTasks` column shapes (assignees and file count as subqueries).
- Produces:
  - `type GlobalBoardQuery = { clientIds: string[]; viewerId: string; assignee: 'me'|'anyone'|'none'|string; urgent: boolean; due?: 'overdue'|'week'|'none'; q?: string; completed: boolean; column?: BoardColumnKind; after?: string; today: string /* Bratislava YYYY-MM-DD */ }`.
  - `globalBoardSql(query: GlobalBoardQuery): SQL` and `getGlobalBoard(db: Db, query: GlobalBoardQuery): Promise<GlobalBoard>`. One statement, returning one row `{ columns json, people json }`:
    - `scope`: `tasks t ⋈ buckets b ⋈ groups g`, where `t.group_id = any($clients)`. With `completed` it also keeps `t.completed_at > now() - interval '30 days'`; without it, `t.completed_at is null`.
    - `filtered` = scope plus the assignee filter:
      - `me`: `exists` my assignment;
      - `none`: `not exists` any assignment;
      - an id: `exists` that assignment.
    - Further filters on `filtered`:
      - `urgent`: `t.urgent`;
      - `due = overdue`: `t.due_date < $today`;
      - `due = week`: `t.due_date between $today and $today + 6`;
      - `due = none`: `t.due_date is null`;
      - `q`: `t.title ilike '%' || $q || '%'`, with `%`, `_` and `\` escaped.
    - Column kind: `case b.kind when 'custom' then 'other' else b.kind end` (`done` stays `done`).
    - Sort key, all ascending, also the keyset: `(not t.urgent, coalesce(t.due_date, 'infinity'::date), g.name, t.created_at, t.id)`.
    - `row_number() over (partition by kind order by <key>)` and `count(*) over (partition by kind)`. Keep `rn <= 50`, or, with `column` + `after`, only that column and `<key> > <cursor tuple>`, limit 50.
    - `next` is the cursor of the 50th row when `total` is larger.
    - The cursor is base64url JSON of the five key values. A cursor that does not parse gives `invalid_filter`.
    - `people`: the distinct assignees (`id`, `name`, by name) of `scope`, before the assignee filter.
    - Every column of `BoardColumnKinds` is present, even when empty. `done` is present only with `completed`.
  - Route `GET /tasks/global` (in `homeRoutes`; prefix `/api`), `requireAdmin`:
    - It parses `GlobalBoardFilterSchema`; a failure is 400 `invalid_filter`.
    - `clients` absent gives `managedGroupIds(viewer)`, or every group id when that is empty.
    - `assignee=me` uses the viewer's id.
    - `today` is `new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(now)`. `now` is injectable for tests through the plugin options.

- [ ] **Step 1: Write the failing tests** in `global-board.test.ts`, with new groups and admin A managing G1 only:
  - `default scope is the managed groups`, and `default scope is all groups for an admin who manages none` (assert that the test's groups are included).
  - `columns by kind: custom buckets land in other with bucketName`.
  - `Completed only with completed=1 and within 30 days`: a task completed 31 days ago is absent.
  - One test per filter alone: `assignee me`, `assignee none`, `assignee by id`, `urgent`, `due overdue`, `due week`, `due none`, `q is case-insensitive and escapes %`.
  - `filters combine`: `assignee=me&urgent=1&due=week` gives exactly the matching task.
  - `cards sort urgent, deadline, no deadline, then client name`.
  - `per-column paging with keyset`: 120 to-do tasks give 50, 50, 20, and the union equals all ids.
  - `keyset pages never skip or repeat tasks with equal sort keys across same-named groups` (Review Focus): two groups both named "Obec", 60 tasks with the same urgency, the same deadline and the same `created_at`.
  - `due filters use the Bratislava date at 00:30 local time` (Review Focus): `now` = `2026-10-20T22:30:00Z`. A task due `2026-10-20` is overdue and one due `2026-10-21` is not.
  - `people lists the distinct assignees of the scope`.
  - `one statement`.
  - `routes.test.ts`:
    - `a client gets 403`;
    - `unknown due is 400 invalid_filter`;
    - `a bad cursor is 400 invalid_filter`.
  - `explain.test.ts`: `global board uses tasks_open_group_idx under 50 ms` for the managed 10 groups (no seq scan on `tasks`).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/home`. Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces block.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Docs.** In `permissions.md`, add `/api/tasks/global` (admins only; no permission filter is needed, because admins read every group).
- [ ] **Step 6: Commit.** `feat(home): global task board query with filters and keyset paging`.

---

### Task 7: The Úlohy tab's yellow pill

Depends on: Task 1. Wave 2.

**Files:**
- Modify: `apps/server/src/modules/tasks/service.ts` (`countMyOpenTasks`), `apps/server/src/modules/tasks/routes.ts`, `routes.test.ts`, `service.test.ts`
- Create: `apps/web/src/components/assigned-pill.tsx`, `assigned-pill.test.tsx`
- Create: `apps/web/src/features/tasks/mine-count.ts`
- Modify: `apps/web/src/features/tasks/tasks-tab-badge.tsx`, and a new `tasks-tab-badge.test.tsx`
- Modify: the eager locales (`tasks.assignedToYou`, next to `tasks.unreadTasks`)
- Docs: `docs/product/task-board.md` (the yellow dot), `docs/architecture/permissions.md` (`mine-count`), `docs/design/tokens.md` (`AssignedPill`)

**Interfaces:**
- Consumes: `MineCountSchema`, the `attention` token (Task 1); `canOpenGroup` inside `tasksRoutes`; `BoardEvents`.
- Produces:
  - `countMyOpenTasks(db: Db, userId: string, groupId: string): Promise<number>`: one `count(*)` over `task_assignees ⋈ tasks`, where it is my assignment, `t.group_id = $g` and `completed_at is null`.
  - `GET /api/groups/:id/tasks/mine-count` → `{ open }`, for any reader (`canOpenGroup`), else 404.
  - `AssignedPill({ count, label }: { count: number; label?: string })`: `UnreadPill`'s shape in `bg-attention text-attention-foreground` (unchanged inside the active tab), `99+` above 99, and nothing at 0. Its screen reader text is `label`. It is eager and about 10 lines.
  - `mineCountQuery(groupId)`: key `['tasks', groupId, 'mine']`, `apiGet(…/tasks/mine-count, MineCountSchema)`.
  - `TasksTabBadge` renders `UnreadPill` and then `AssignedPill`. On `board:task` or `board:task_deleted` for this group it invalidates `mineCountQuery` after a 500 ms debounce, and it invalidates on rejoin (`useGroupRoomJoins() > 1`).
  - Copy: `tasks.assignedToYou` = "{{count}} tasks assigned to you" (sk plural forms). Together with the unread label, a screen reader says "2 tasks with unread messages, 4 tasks assigned to you".

- [ ] **Step 1: Write the failing tests.**
  - Server:
    - `countMyOpenTasks counts my open tasks in the group only`;
    - `mine-count: a client of the group gets their count, a client of another group gets 404`.
  - `assigned-pill.test.tsx`:
    - `renders nothing at 0`;
    - `shows 99+ above 99`;
    - `has the attention classes and the label`.
  - `tasks-tab-badge.test.tsx`:
    - `shows both pills with their screen reader text`;
    - `a board:task event refetches mine-count once after 500 ms` (fake timers; three events give one request).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/tasks` and `pnpm --filter @spolu/web exec vitest run src/components/assigned-pill.test.tsx src/features/tasks/tasks-tab-badge.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Design pass.** Invoke `frontend-design:frontend-design` for the pill pair inside the inactive and the active tab (both legible; yellow stays yellow on the ink tab).
- [ ] **Step 4: Implement** the Interfaces block.
- [ ] **Step 5: Run** both commands and `pnpm --filter @spolu/web build`. Expected: PASS, and record the eager delta in the commit body (budget 0.6 kB for the whole phase).
- [ ] **Step 6: Docs.** Update `task-board.md`, `permissions.md` and `tokens.md`.
- [ ] **Step 7: Commit.** `feat(tasks): yellow assigned-to-me pill on the Úlohy tab`.

---

### Task 8: Admin shell, client sidebar, routes and live refetch

Depends on: Task 1, Task 7. Wave 3.

**Files:**
- Create: `apps/web/src/features/admin-home/{api.ts, admin-shell.tsx, client-sidebar.tsx, use-admin-activity.ts, sidebar-collapse.ts}`, with `client-sidebar.test.tsx`, `admin-shell.test.tsx` and `use-admin-activity.test.tsx`
- Modify: `apps/web/src/features/auth/authed-layout.tsx` (the two-column frame), `apps/web/src/router.tsx` (`/` and `/tasks`), `apps/web/src/components/app-header.tsx`, `apps/web/src/features/auth/user-menu.tsx`, and their tests
- Modify: the eager locales (`nav.home`, `nav.tasks`), and the `shell` and `sidebar` sections of `adminHome`
- Create (placeholders replaced in Tasks 9 and 10): `apps/web/src/features/admin-home/home-page.tsx` exporting `HomePage`, and `apps/web/src/features/global-board/global-board.tsx` exporting `GlobalBoardPage`, each rendering only its `h1`
- Docs: `docs/design/tokens.md` (the sidebar), `docs/architecture/performance.md` (the `admin-shell` chunk)

**Interfaces:**
- Consumes: `SidebarSchema`, `AdminEvents`, `AdminActivityEvent` (Task 1); `AssignedPill` (Task 7); `UnreadPill`, `GroupLogo`, `useMediaQuery`, `useDocumentVisible`, `getSocket`, `ChatEvents.read`, `loadNamespace`, `isAdmin`.
- Produces:
  - `api.ts`:
    - `homeKeys = { sidebar: ['home','sidebar'], tasks: ['home','tasks'], mentions: ['home','mentions'], reminders: ['home','reminders'] } as const`;
    - `sidebarQuery`, `assignedQuery`, `mentionsQuery`, `remindersQuery`: `queryOptions` over `/me/home/*` with the Task 1 schemas and `refetchOnWindowFocus: true`.
  - `useAdminActivityRefetch(keys: QueryKey[]): void`.
    - On `admin:activity` (any group) and on `chat:read`, it starts or extends a 2 s timer. When the timer fires it invalidates `keys` if `useDocumentVisible()` is true; otherwise it marks them stale and invalidates once the page becomes visible.
    - It is one listener per mounted consumer and cleans up on unmount.
  - `ClientSidebarList({ clients, currentGroupId, rowHeight, collapsed }: { clients: SidebarClient[]; currentGroupId?: string; rowHeight: 40 | 48; collapsed?: boolean })`.
    - A search field (client-side, case- and accent-insensitive with `normalize('NFD')`).
    - The sections "Managed by you" and "Other clients" (`text-micro`, `muted-foreground`, a hairline between them). With no managed client there is one unlabelled list.
    - Rows link to `/groups/$groupId/chat`, with a 24 px `GroupLogo`, the truncated name, `UnreadPill(unread)` and `AssignedPill(assigned)`. The current row is `bg-secondary font-semibold`, and hover is `accent`.
    - Collapsed: logos only, with an 8 px dot on the logo corner (ink if unread, else attention if assigned) and the name as the tooltip and accessible name.
    - Empty search: `adminHome:sidebar.noMatch`.
  - `AdminSidebar()` (exported from `admin-shell.tsx`, the `admin-shell` chunk): a 232 px or 56 px sticky column (`sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto`).
    - It contains `sidebarQuery`, `useAdminActivityRefetch([homeKeys.sidebar])`, the `«`/`»` collapse button (`aria-expanded`) and `ClientSidebarList`.
    - Loading shows a title and three static grey rows. An error shows `adminHome:shell.loadError` ("Could not load this. Try again.") with a retry button.
  - `readCollapsed(): boolean` and `writeCollapsed(v: boolean): void` in `sidebar-collapse.ts`, with key `spolu.sidebar.collapsed` and every storage access in try/catch.
  - `AuthedLayout`: for an admin at `(min-width: 1024px)` it renders `<div className="flex gap-6"><Suspense fallback={<SidebarPlaceholder/>}><LazyAdminSidebar/></Suspense><div className="min-w-0 flex-1"><Outlet/></div></div>`; otherwise it renders `<Outlet/>` in the same wrapper.
    - The `Outlet` keeps its position in the tree, so the page never remounts when the sidebar loads.
    - `LazyAdminSidebar = lazy(() => loadNamespace('adminHome').then(() => import('@/features/admin-home/admin-shell')).then((m) => ({ default: m.AdminSidebar })))`, so clients and phones never download it.
  - Router:
    - `homeRoute` keeps redirecting clients (to the group, or to `/settings`). For admins it renders `lazyRouteComponent(() => import('@/features/admin-home/home-page'), 'HomePage')`, with `loader: () => loadNamespace('adminHome')`.
    - `globalBoardRoute` at `/tasks`, with the `/admins`-style admin guard (`notFound()` for clients), `validateSearch` = the URL subset of `GlobalBoardFilterSchema` plus `task?: string`, and the lazy `GlobalBoardPage`.
  - Header: for admins, "Home" (`/`, active only when exact) and "Tasks" go before "Groups" and "Admins". Under 641 px they are in the user menu in the same order. If Phase 17 has merged, "Knowledge" stays above "Groups".
  - Copy (en; sk to match):
    - `nav.home` "Home", `nav.tasks` "Tasks";
    - `adminHome:sidebar.title` "Clients", `sidebar.find` "Find a client", `sidebar.managed` "Managed by you", `sidebar.others` "Other clients", `sidebar.collapse` "Collapse the client list", `sidebar.expand` "Expand the client list", `sidebar.noMatch` "No client matches.";
    - `adminHome:shell.loadError` "Could not load this. Try again.", `shell.retry` "Try again".

- [ ] **Step 1: Write the failing tests.**
  - `client-sidebar.test.tsx`:
    - `two sections in server order`;
    - `one unlabelled list when nothing is managed`;
    - `search filters both sections and ignores accents` ("luky" finds "Obec Lúky");
    - `black and yellow pills, hidden at 0`;
    - `the current client is marked with aria-current`;
    - `collapsed shows logos with an ink dot for unread, else a yellow dot for assigned`.
  - `admin-shell.test.tsx`:
    - `collapse is remembered`;
    - `localStorage throwing still renders expanded`;
    - `an error shows the retry line only in the sidebar`.
  - `use-admin-activity.test.tsx` (fake timers, a mocked socket):
    - `three activity events within 2 s give one invalidation`;
    - `chat:read invalidates the sidebar and the mentions keys after the debounce` (Review Focus);
    - `a hidden page invalidates once when it becomes visible`.
  - `authed-layout.test.tsx`:
    - `the sidebar shows for an admin at 1024 px`;
    - `not under 1024 px`;
    - `never for a client` (assert that the lazy module was not imported).
  - `app-header.test.tsx` / `user-menu.test.tsx`: `admins see Home, Tasks, Groups, Admins in that order`.
  - `router.test.tsx` (or the existing route tests):
    - `/ renders the dashboard for an admin and redirects a client to their group`;
    - `/tasks is not found for a client`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/admin-home src/features/auth src/components`. Expected: FAIL.
- [ ] **Step 3: Design pass.** Invoke `frontend-design:frontend-design` for the sidebar:
  - the 40 px rows, the section headings and the hairline;
  - the collapsed rail with dots;
  - the focus rings;
  - how the sidebar sits beside the 1152 px main column, beside the group header and tabs.
- [ ] **Step 4: Implement** the Interfaces block.
- [ ] **Step 5: Run** the tests and `pnpm --filter @spolu/web build`. Expected: PASS, a separate `admin-shell` chunk, and the eager delta for this task recorded in the commit body.
- [ ] **Step 6: Docs.** `tokens.md`: the sidebar (row, sections, pills, rail). `performance.md`: the `admin-shell` chunk, loaded only for admins at ≥ 1024 px.
- [ ] **Step 7: Commit.** `feat(web): admin shell with a live client sidebar; Home and Tasks routes`.

---

### Task 9: The dashboard

Depends on: Task 8. Wave 4.

**Files:**
- Modify: `apps/web/src/features/admin-home/home-page.tsx`
- Create: `apps/web/src/features/admin-home/{count-card.tsx, count-tile.tsx, cards.tsx, greeting.ts}`, with `home-page.test.tsx`, `count-card.test.tsx` and `greeting.test.ts`
- Create, only if absent: `apps/web/src/components/ui/sheet-dialog.tsx` (per the Phase 17 plan, Task 2, the frame only)
- Modify: the `home` and `cards` sections of `adminHome`
- Docs: `docs/design/tokens.md` (the count card and the tiles), `docs/glossary.md` (dashboard, assigned to me), `docs/product/admin-home.md` (the dashboard as built), `docs/architecture/performance.md` (the `admin-home` chunk)

**Interfaces:**
- Consumes: `assignedQuery`, `mentionsQuery`, `remindersQuery`, `sidebarQuery`, `homeKeys`, `useAdminActivityRefetch`, `ClientSidebarList` (Task 8); `Card`, `Badge` (`destructive` for Urgent), `formatDue`, `isOverdue`, `SheetDialog`, `useMediaQuery`, `useSession`.
- Produces:
  - `CountCard({ title, count, caption, subline, rows, showAll, state, onRetry, wide })`:
    - `count: number` (shown capped as `99+`), `caption: string`, `subline?: ReactNode`;
    - `rows: { key: string; to: LinkOptions; content: ReactNode; tall?: boolean }[]`;
    - `showAll?: { label: string; to: LinkOptions }`;
    - `state: 'loading' | 'error' | 'ready'`.
    - Layout:
      - the title line;
      - a 112 px count column (`text-large` 36 px, weight 600, `tabular-nums`, with the caption under it);
      - the list, with 44 px rows (56 px when `tall`), hairlines between rows, and each whole row a link.
    - Loading shows three static grey rows. An error shows `adminHome:shell.loadError` and a retry.
  - `CountTile({ count, caption, subline, onOpen })`: at least 44 px tall, the count at `text-large`, and a button that opens a `SheetDialog` with the same rows and a back button.
  - Cards (`cards.tsx`), each with a `use…Card()` hook that returns `CountCard` props:
    - **Assigned to me** (wide):
      - caption `cards.assigned.caption` "assigned", subline `cards.assigned.urgent` "{{count}} urgent" with the `destructive` dot when above 0;
      - row: the Urgent badge, the title, the client name (`muted-foreground`), and the due date on the right (`formatDue`; `error-ink` when `isOverdue(dueDate, bucketKind, today)`; `cards.assigned.noDate` "no date" muted);
      - a row links to `/groups/$groupId/tasks/$taskId`;
      - `showAll` when `total > 20`: `cards.assigned.showAll` "Show all {{count}}" → `/tasks?assignee=me&clients=<every group id from sidebarQuery>`;
      - empty: `cards.assigned.empty` "Nothing is assigned to you.".
    - **Upcoming reminders** (half; not rendered when `available: false`):
      - caption `cards.reminders.caption` "next 7 days";
      - row: `Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bratislava' })`, the title and the client;
      - a knowledge target → `/groups/$groupId/knowledge?k=<itemId>`, a task target → the task route;
      - `error: true` shows the error line;
      - empty: `cards.reminders.empty` "No reminders coming up.".
    - **Mentions** (half; full width when reminders are absent):
      - caption `cards.mentions.caption` "unread";
      - a tall row: "Author · Client" on line 1 and the excerpt on line 2;
      - target: a group chat message → `/groups/$groupId/chat?message=<id>`, or with `thread=<parentId>` for a reply (the Phase 5 thread link params); a task chat message → `/groups/$groupId/tasks/$taskId?tab=chat&message=<id>`;
      - empty: `cards.mentions.empty` "No unread mentions.".
  - `HomePage()`:
    - `h1` greeting (`text-medium`): `greetingKey(now: Date): 'morning' | 'afternoon' | 'evening'` by the Bratislava hour (04–11 morning, 12–17 afternoon, otherwise evening), copy `home.greeting.<key>` "Good morning, {{name}}" with the first word of the session name;
    - `useAdminActivityRefetch([homeKeys.tasks, homeKeys.mentions, homeKeys.reminders])`;
    - from 1024 px: the wide Assigned card, then a two-column row of Reminders and Mentions;
    - under 1024 px: a row of `CountTile`s (three, or two without reminders), then `ClientSidebarList` at `rowHeight={48}` from `sidebarQuery`.

- [ ] **Step 1: Write the failing tests.**
  - `count-card.test.tsx`:
    - `count, caption and subline render in the left column`;
    - `every row is one link to its target`;
    - `loading shows three placeholders`;
    - `error shows the retry line in this card only`.
  - `home-page.test.tsx` (mocked HTTP):
    - `assigned rows link to the task; overdue date uses error ink; Show all 37 links to the global board with assignee=me and all clients`;
    - `mentions link to the message, with the thread for a reply and the task chat for a task message`;
    - `reminders card absent with available false; mentions spans the row`;
    - `one failing card does not hide the others`;
    - `under 1024 px: three tiles, a tile opens its sheet, and the client list follows`;
    - `two tiles without reminders`;
    - `an admin:activity refetches the cards after 2 s`.
  - `greeting.test.ts`: `03:59 evening, 04:00 morning, 12:00 afternoon, 18:00 evening` (Bratislava, across the DST date 2026-10-25).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/admin-home`. Expected: FAIL.
- [ ] **Step 3: Design pass.** Invoke `frontend-design:frontend-design` for the count card (the one bold element is the number), the 44 and 56 px rows, the tiles, the sheet list and the placeholders.
- [ ] **Step 4: Implement** the Interfaces block.
- [ ] **Step 5: Run** the tests and `pnpm --filter @spolu/web build`. Expected: PASS, with a separate `home-page` chunk and no eager growth from this task.
- [ ] **Step 6: Docs.** `tokens.md`, the glossary, `product/admin-home.md` and `performance.md`.
- [ ] **Step 7: Commit.** `feat(web): admin dashboard with assigned tasks, reminders and mentions`.

---

### Task 10: The global task board

Depends on: Task 8. Wave 4.

**Files:**
- Modify: `apps/web/src/features/global-board/global-board.tsx`
- Create: `apps/web/src/features/global-board/{api.ts, board-filters.tsx, global-column.tsx, global-task-panel.tsx, use-global-search.ts}`, with `global-board.test.tsx` and `board-filters.test.tsx`
- Create, only if absent: `apps/web/src/components/client-filter.tsx` + test (per the Phase 17 plan, Task 12), and `apps/web/src/components/ui/sheet-dialog.tsx` (if Task 9 has not added it)
- Modify: `apps/web/src/features/tasks/task-card.tsx` (`groupLine`, `link`), `task-panel.tsx` and `panel-parts.tsx` (`onExit`), and their tests
- Modify: the `board` section of `adminHome`
- Docs: `docs/product/task-board.md` (the global board), `docs/design/tokens.md` (the client line on a card, the filter row), `docs/glossary.md` (global board), `docs/architecture/performance.md` (the `global-board` chunk)

**Interfaces:**
- Consumes: `GlobalBoardSchema`, `BoardColumnKinds` (Task 1); `useAdminActivityRefetch`, `sidebarQuery` (Task 8); `groupsQuery` (`managedByMe`, Phase 18); `ClientFilter({ groups, managedIds, value, onChange })`; `TaskCard`, `TaskPanel`, `GroupLogo`, `useGroupRoom`, `GroupRoomProvider`, `taskQuery`, `SheetDialog`, `useUpdateSearch`.
- Produces:
  - `globalBoardQuery(filters)`: key `['tasks', 'global', filters]`, `GET /tasks/global`. `fetchColumnPage(filters, column, after)` is used for "Show 50 more", and its pages are appended in local state per column. A 400 `invalid_filter` resets the URL to the defaults (`replace: true`).
  - `useGlobalSearch()` reads and writes `clients`, `assignee`, `urgent`, `due`, `q` (300 ms debounce), `completed` and `task` through `useUpdateSearch`.
    - On a visit without `clients` it restores the last explicit value from `localStorage['spolu.globalBoard.clients']`, and it writes there on change. Every storage access is in try/catch.
    - `null` means the default (managed, or all).
  - `BoardFilters`:
    - the pills `ClientFilter`, Assignee (Me, Anyone, Unassigned, then `people`), Urgent (toggle), Due (Any, Overdue, Next 7 days, No deadline), the search field and "Show completed";
    - "Clear filters" when anything differs from the defaults;
    - under 641 px one "Filters (n)" pill opens a `SheetDialog` with the same controls.
  - `TaskCard` gains:
    - `groupLine?: ReactNode`, rendered first in the card;
    - `link?: { to: string; search?: Record<string, unknown>; params?: Record<string, string> }`, defaulting to the group task route.
    The board passes neither, so it is unchanged.
  - Global card: the `groupLine` is a 16 px `GroupLogo` plus the client name (`text-micro` muted), and, in "Other steps", the bucket name under it. It has no `onToggleDone` and no drag props. The link is `{ to: '/tasks', search: { ...current, task: id } }`.
  - Columns: the Phase 8 look (288 px columns on `muted`, horizontal scroll, scroll-snap under 641 px).
    - Headings `board.columns.<kind>`: "To do", "Other steps", "eGrant review", "Client review", "Completed", each with its `total`.
    - "Show 50 more" (`board.more`) when `next` is set.
    - There is no "+ Add task".
  - `TaskPanel` and `PanelShell` gain `onExit?: (opts: { replace: boolean }) => void`. When it is set, close, Escape, back and the gone case call it instead of navigating to the group board (the gone case shows no board notice). The unsaved-changes blocker also fires when `next.search.task !== current.search.task`, and since group routes never set `task`, the group board's behavior is unchanged.
  - `GlobalTaskPanel({ taskId })` reads `taskQuery(taskId)`, joins `useGroupRoom(task.groupId)` inside a `GroupRoomProvider`, and renders `TaskPanel` with `onExit` removing `task` from the search and invalidating `['tasks', 'global']`. Moving a task is done with the panel's bucket select (no drag and drop).
  - `GlobalBoardPage()`:
    - `h1` "Tasks";
    - `useAdminActivityRefetch([['tasks', 'global']])`;
    - empty with filters: `board.emptyFiltered` "No tasks match these filters." plus Clear filters;
    - errors: `adminHome:shell.loadError`.
  - Copy (en; sk to match): `board.title` "Tasks", `board.assignee.*` ("Assignee: {{name}}", "Me", "Anyone", "Unassigned"), `board.urgent` "Urgent", `board.due.*` ("Due", "Overdue", "Next 7 days", "No deadline"), `board.search` "Search tasks", `board.completed` "Show completed", `board.clear` "Clear filters", `board.filters` "Filters ({{count}})", `board.more` "Show 50 more".

- [ ] **Step 1: Write the failing tests.**
  - `board-filters.test.tsx`:
    - `every filter round-trips through the URL`;
    - `Clear filters appears only off-default and resets`;
    - `under 641 px the filters collapse into one pill and a sheet`;
    - `an invalid_filter answer resets the URL`.
  - `global-board.test.tsx` (mocked HTTP):
    - `five columns with Completed only when shown`;
    - `cards show the client line, and the bucket name in Other steps`;
    - `the default client scope comes from localStorage when the URL has none, and storage errors are ignored`;
    - `Show 50 more appends the next page of that column only`;
    - `a card opens the panel over the board at /tasks?…&task=id and closing returns to the same filtered URL`;
    - `cards are not draggable` (no `aria-roledescription` from dnd-kit, and the dnd-kit chunk is not imported);
    - `admin:activity refetches the board after 2 s`.
  - `task-card.test.tsx`: `groupLine renders first and link overrides the target`.
  - `task-panel.test.tsx`: `with onExit, Escape and Close call it and do not navigate to the group board`, and `the unsaved draft blocks a task search change`.
  - If `ClientFilter` was built here: the Phase 17 plan's `client-filter.test.tsx` cases.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/global-board src/features/tasks src/components`. Expected: FAIL.
- [ ] **Step 3: Design pass.** Invoke `frontend-design:frontend-design` for the filter row (it wraps), the phone filter sheet, the client line on a card and the column headers with counts.
- [ ] **Step 4: Implement** the Interfaces block.
- [ ] **Step 5: Run** the tests and `pnpm --filter @spolu/web build`. Expected: PASS, with a separate `global-board` chunk that does not contain `@dnd-kit` (check the build output), and the existing board tests unchanged and green.
- [ ] **Step 6: Docs.** Update `task-board.md`, `tokens.md`, the glossary and `performance.md`.
- [ ] **Step 7: Commit.** `feat(web): global task board across clients`.

---

### Task 11: End-to-end, budget and phase docs

Depends on: Tasks 2, 4, 5, 6, 9, 10. Wave 5.

**Files:**
- Create: `e2e/admin-home.spec.ts`
- Docs: `docs/product/admin-home.md` (status: built in Phase 20; reminders appear once Phase 17 is merged), `docs/architecture/performance.md` (the measured eager size, the three lazy chunks, the `adminHome` bundle), `docs/architecture/overview.md` (confirm the `modules/home` section matches the code)

**Interfaces:**
- Consumes: everything above, and the `e2e/fixtures` helpers. Use unique emails, two new groups and a new admin per run.

- [ ] **Step 1: Write the e2e test** `admin home: dashboard, sidebar, Úlohy and global board`:
  1. Through the API: admin A manages G1 (`PUT /api/groups/G1/managers/me`) and not G2. Client C is in G1, and a task in G1 is assigned to A. A task in G2 exists.
  2. C sends "@A can you check" in G1's chat.
  3. A opens `/`. The Mentions card shows C's message, and the Assigned card shows the task. In the sidebar G1 is under "Managed by you" with a black and a yellow pill, and G2 is under "Other clients".
  4. A clicks the mention. The chat opens at the message, and back on `/` the mention is gone (wait up to 3 s).
  5. A opens G1's Úlohy tab, which shows the yellow pill "1".
  6. A opens `/tasks`. Only G1's task shows. A adds G2 in the client filter, and G2's task shows.
  7. At a 390 px viewport, `/` shows three tiles (two without Phase 17) and the client list.
- [ ] **Step 2: Run it.** Run `pnpm test:e2e -- e2e/admin-home.spec.ts`. Expected: PASS. If it fails, fix the owning task's code on this branch with a test first.
- [ ] **Step 3: Run the whole suite.** Run `bash scripts/ci.sh` and `pnpm --filter @spolu/web build`. Expected: all PASS, and the eager JS ≤ 200 kB gzip with the phase's growth ≤ 0.6 kB.
- [ ] **Step 4: Docs.**
  - `performance.md`: the measured eager size, the entry and the router chunks, and the sizes of `admin-shell`, `home-page` (the spec's `admin-home`) and `global-board`.
  - `product/admin-home.md`: the status.
  - The controller adds the `roadmap.md` row.
- [ ] **Step 5: Commit.** `test(e2e): admin home, sidebar, Úlohy pill and global board`.

---

## Self-review notes

- **Spec coverage:**
  - routes and header: Task 8;
  - shell and sidebar: Task 8;
  - the dashboard cards and phones: Task 9;
  - the Úlohy pill and `mine-count`: Task 7;
  - the assigned order: Task 3;
  - mentions, including the reply rule: Tasks 2 and 4;
  - the reminder slot, both merge orders: Task 5;
  - the global board, server and web: Tasks 6 and 10;
  - indexes and `EXPLAIN`: Tasks 1, 3, 4 and 6;
  - `admin:activity`: Task 2, consumed in Tasks 8–10;
  - the error handling (per-block errors, 403, `invalid_filter`, the reminders error): Tasks 3–6 and 8–10;
  - lazy chunks and the budget: Tasks 7–11;
  - every doc in the spec's list: assigned to a task.
- **Deviations from the spec, each on purpose:**
  - The reminder contract is named `HomeReminder` (not `UpcomingReminder`), so it does not collide with Phase 17's export.
  - `ReminderSource` methods take `actor: SessionUser`, because `listUpcomingForUser` needs it.
  - The count needs a new `countUpcomingForUser` in the reminders module.
  - The global board response adds `people` for the assignee menu.
  - The phone tile and filter sheets use `SheetDialog`, the one dialog frame, instead of the task panel's `PanelShell`. Between 641 and 1023 px they are a centred 720 px dialog.
