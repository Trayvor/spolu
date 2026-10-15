# Phase 8 — Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every group gets a live Kanban board: four fixed buckets plus admin-managed custom buckets, task cards (title, description, creator, assignees, deadline, urgent, files), drag and drop, and a task panel built around a reusable `<TaskForm>`.

**Architecture:** A new `tasks` module (tables `buckets`, `tasks`, `task_assignees`, `task_attachments`; policy, service, routes) following the `new-module` skill. The board is created lazily on first read. Positions are fractional-index strings that only the server computes, with the bucket rows locked per write. Every write records notification events in its transaction and emits into the group room after commit. The web `features/tasks/` replaces the Phase 4 Tasks tab placeholder with a lazy board chunk (dnd-kit), a task panel route and the controlled `<TaskForm>`.

**Tech Stack:** Fastify 5, Drizzle, Socket.IO, React 19, TanStack Router/Query, Tailwind v4, zod 4, Vitest, Playwright. New, pinned exactly: `fractional-indexing@4.0.0` (server and web), `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0` (web, Tasks chunk only).

**Spec:** `docs/superpowers/specs/2026-10-15-phase-8-task-board-design.md` (builds on `docs/superpowers/specs/2026-10-15-phase-4-shared-foundation-design.md`).

## Global Constraints

- Branch `phase-8`, cut from `phase-4`, built **in parallel with Phase 5**. Touch only: `apps/server/src/modules/tasks/`, `apps/web/src/features/tasks/`, the tasks migration, `tasks.*` i18n keys, `packages/shared/src/tasks.ts` + its line in `index.ts` + new `ErrorCodes`, the `NotificationKind` union (one line, see NOTE in Task 1), `apps/server/src/app.ts` registration, the `/groups/$groupId/tasks/$taskId` entry in `router.tsx`, `e2e/tasks.spec.ts`, and docs. Never edit groups, files, notifications or chat code; if something there seems needed, stop and report it to the controller.
- English everywhere; every UI string is an i18n key with values in **both** `en.json` and `sk.json`; only add keys (no reformatting).
- Readable code and performance first; no fancy effects (no animations beyond dnd-kit's own transform while dragging; the lifted card uses `shadow-lift`).
- Any UI task starts by invoking `frontend-design:frontend-design`; use the tokens in `docs/design/tokens.md` and `components/ui/*`; inline forms and inline confirmations, no modals.
- Initial JS budget 200 kB gzip unchanged: dnd-kit, fractional-indexing and all board code live only in the lazy Tasks chunk; the task panel is its own lazy chunk and does not import dnd-kit.
- Permissions only through `modules/tasks/policy.ts` (which builds on `canReadGroup`); an unreadable group, task or bucket answers **404 `not_found`**; 403 only for a readable resource the caller may not change.
- Errors are `{ error: '<code>' }`. Codes in this phase: `validation_failed` 400, `fixed_bucket` 400, `invalid_assignee` 400, `invalid_attachment` 400 (Phase 4), `unauthorized` 401, `forbidden` 403, `not_found` 404, `task_changed` 409, `rate_limited` 429 (120 writes/min per user over all tasks/buckets write routes).
- Writes over HTTP only; sockets only push, after commit, via `emitToGroup`.
- Notification events (`task.moved`, `task.assigned`) are recorded in the write's transaction and never for the actor.
- Server tests share `spolu_test` in parallel: unique emails/URLs per test, never truncate, never assume an empty table; use `buildTestApp`, `loginAs`.
- Prettier is checked per task: `rtk proxy pnpm exec prettier --check <changed files>`.
- Each commit updates the docs it affects. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The last task runs the `update-kb` skill and `bash scripts/ci.sh`.

## Review Focus

- **Position sort order in Postgres.** Fractional keys like `a0V` and `a0l` must sort byte-wise; a locale collation (`en_US.utf8`) sorts them the other way. The `position` columns use collation `"C"` and the web compares with `<`, never `localeCompare` (Task 1 test `positions sort byte-wise in SQL`, Task 5 test `byPosition compares code units`).
- **`updatedAt` round trip.** Postgres keeps microseconds, JSON has milliseconds: a client that PATCHes with the exact `updatedAt` it just received must not get `409 task_changed` (Task 3 test `PATCH twice with the returned updatedAt succeeds both times`).
- **Assignee removed from the group.** Editing the title of a task whose assignee was removed later must succeed and keep that assignee; only newly added ids are checked (Task 3 test `a removed assignee stays and does not block edits`).
- **Overdue at midnight.** At 23:30 UTC on 17 Oct it is already 18 Oct in Bratislava; a task due 17 Oct is overdue then and a task due 18 Oct is not (Task 5 test `isOverdue uses the Bratislava date`).
- **Drop on the same place.** Dropping a card where it already is (after the card above it, same bucket) keeps the order, keeps `updatedAt` and records no `task.moved` (Task 4 test `moving to the current place is a no-op`).


## Controller rulings (2026-10-15, after all three plans were written)

These override any conflicting text below.

1. **Group layout and groups list** are not touched by this branch (Phase 5 adds its unread badges there).
2. **`NotificationKind`:** Phase 4 already defines all five kinds (`chat.message`, `chat.mention`, `chat.thread_reply`, `task.moved`, `task.assigned`). Do not edit `packages/shared/src/notifications.ts` (the plan's NOTE in Task 1 about adding them is void).
3. **People list:** Phase 4 exports `listGroupPeople(db, groupId)` from the groups service. `isGroupPerson` validates assignees.
4. **Catch-up after rejoin:** Phase 4 exports `useGroupRoomJoins(): number` (grows after every acknowledged `group:join`, including the client's implicit room on connect). `useBoardEvents` refetches the board when it changes (after the first value), not on raw socket `connect`.
6. **Foreign events:** every live socket handler ignores payloads whose `groupId` is not the group currently open (a socket can briefly sit in two group rooms during navigation).
5. **Shared files edited by both parallel branches:** new error codes go at the end of `ErrorCodes` under a `// Phase 8 — tasks` comment; `router.tsx` and `en.json`/`sk.json` only get additions. The branch merged second resolves these trivial conflicts and regenerates its migration and renumbers its ADR if needed.

---

### Task 1: Shared types, tables, policy and positions

**Files:**
- Create: `packages/shared/src/tasks.ts`, `packages/shared/src/tasks.test.ts`, `apps/server/src/modules/tasks/{schema.ts,policy.ts,policy.test.ts,positions.ts,positions.test.ts}`, generated migration in `apps/server/src/infra/db/migrations/`
- Modify: `packages/shared/src/index.ts` (`export * from './tasks.js';`), `packages/shared/src/users.ts` (`ErrorCodes`), the Phase 4 `NotificationKind` union (NOTE below), `apps/server/package.json` (`"fractional-indexing": "4.0.0"`), `docs/architecture/data-model.md`, `docs/architecture/permissions.md`

**Interfaces:**
- Consumes (Phase 4 / Phase 3): `canReadGroup(actor, groupId, actorGroupId)` (`modules/groups/policy.ts`), `isAdmin` (`modules/users/policy.ts`), `files` table (`modules/files/schema.ts`), `FileInfoSchema` and `NotificationKind` (`packages/shared`).
- Produces (shared, `packages/shared/src/tasks.ts`):
  - `BucketKindSchema = z.enum(['todo','egrant_review','client_review','done','custom'])`, `BucketKind`.
  - `BucketDtoSchema { id, groupId, kind: BucketKind, name: string | null, position: string }`.
  - `TaskPersonSchema { id, name }`.
  - `TaskDraftSchema` (with defaults): `title` trimmed 1..200, `description` max 10 000 default `''`, `assigneeIds` string[] max 10 default `[]` (deduplicated by a transform), `dueDate` `/^\d{4}-\d{2}-\d{2}$/` valid calendar date or null, default null, `urgent` boolean default false, `fileIds` string[] max 20 default `[]`. `type TaskDraft = z.output<typeof TaskDraftSchema>`.
  - `TaskCreateSchema = TaskDraftSchema.extend({ bucketId: z.string().optional() })`.
  - `TaskPatchSchema`: every TaskDraft field optional **without defaults** (an omitted field stays unchanged) plus required `updatedAt: string`.
  - `TaskMoveSchema { bucketId: string, afterTaskId: string | null }`.
  - `BucketCreateSchema { name: trimmed 1..60 }`, `BucketPatchSchema { name?: trimmed 1..60, afterBucketId?: string }` (at least one).
  - `TaskDtoSchema { id, groupId, bucketId, position, title, urgent, dueDate: string | null, completedAt: string | null, createdBy: TaskPerson, assignees: TaskPerson[], fileCount: number, sourceMessageId: string | null, createdAt, updatedAt }`.
  - `SourceMessageSchema { id, authorName, excerpt }`; `TaskDetailDtoSchema = TaskDtoSchema.extend({ description: string, files: FileInfo[], sourceMessage: SourceMessage | null })`.
  - `BoardDtoSchema { buckets: BucketDto[], tasks: TaskDto[] }`.
  - `BoardEvents = { task: 'board:task', taskDeleted: 'board:task_deleted', buckets: 'board:buckets' } as const`; payload types `BoardTaskEvent { task: TaskDto, actor: TaskPerson }`, `BoardTaskDeletedEvent { groupId, taskId }`, `BoardBucketsEvent { groupId, buckets: BucketDto[] }`.
  - `TaskMovedPayload { taskId, groupId, title, fromBucket: BucketLabel, toBucket: BucketLabel, actorName }`, `TaskAssignedPayload { taskId, groupId, title, actorName }`, `BucketLabel { kind: BucketKind, name: string | null }` (custom name; the group name for `client_review`; null otherwise — Phase 6 translates the fixed names).
  - `ErrorCodes` gains `fixedBucket: 'fixed_bucket'`, `invalidAssignee: 'invalid_assignee'`, `taskChanged: 'task_changed'`.
- Produces (server):
  - Tables per spec. `buckets`: `id` text PK, `group_id` → groups cascade, `kind` (CHECK `buckets_kind_check`), `name` (CHECK `buckets_name_check`: `(kind = 'custom') = (name is not null)` and `char_length(name) <= 60`), `position` collated `"C"`, `created_at`; partial unique index `buckets_group_fixed_kind_unique` on (`group_id`,`kind`) where `kind <> 'custom'`; index (`group_id`, `position`). `tasks`: columns per spec; `bucket_id` FK **no action** (not restrict: a group delete cascades both tables in one statement); `position` collated `"C"`; `updated_at` and `created_at` are always written from JS `new Date()` (millisecond precision, see Review Focus); unique index (`bucket_id`,`position`); index (`group_id`); partial index (`due_date`) where `completed_at is null`; partial index (`urgent`) where `urgent`. `task_assignees` (PK both, cascade, index `user_id`), `task_attachments` (PK both, cascade to `tasks` and `files`).
  - The `"C"` collation: a Drizzle `customType<{ data: string }>({ dataType: () => 'text collate "C"' })` named `positionText` in `schema.ts`, so a regenerated migration keeps it.
  - `policy.ts`: `canUseBoard(actor: SessionUser, groupId: string, actorGroupId: string | null): boolean` (= `canReadGroup`); `canManageBuckets(actor: SessionUser): boolean` (admin); `canDeleteTask(actor: SessionUser, task: { createdBy: string }): boolean` (admin or creator).
  - `positions.ts`: `FIXED_POSITIONS: Record<Exclude<BucketKind,'custom'>, string> = { todo: 'a0', egrant_review: 'a3', client_review: 'a6', done: 'a9' }` (valid fractional-indexing keys; the spec's `z0` is not a valid key); `keyAfter(prev: string | null, next: string | null): string` (wraps `generateKeyBetween`); `keysAfter(prev: string | null, n: number): string[]` (wraps `generateNKeysBetween(prev, null, n)`); `isCustomBucketPosition(p: string): boolean` (`'a0' < p && p < 'a9'`, byte-wise).

> **NOTE for controller:** Phase 4 owns `NotificationKind`. This task adds `'task.moved' | 'task.assigned'` to that union (one line). Phase 5 adds its kinds to the same line, and both phases add to `ErrorCodes` in `users.ts`: expect a trivial merge conflict in both places.

- [ ] **Step 1: Verify the Phase 4 names.** Before writing code, confirm each of these exists with this name and shape, and wherever the code differs, follow the code and use the real name in every later task (tell the controller which names differed): `attachFiles(tx, groupId, fileIds, userId)`, `deleteFiles(deps, ids)`, `getFilesForGroup(db, groupId, ids)` (`modules/files/service.ts`); `FileInfo` / `FileInfoSchema` (`packages/shared`); `recordNotifications(tx, { kind, groupId, recipients, payload })` and `NotificationKind`; `isGroupPerson(db, groupId, userId)` (`modules/groups/service.ts`); `GET /api/groups/:id/people`; `emitToGroup(io, groupId, event, payload)` (`infra/realtime/rooms.ts`); web `uploadFile(groupId, file, onProgress)`, `<FileChip>`, `<ImagePreview>` (`features/files/`), `useGroupPeople(groupId)` and its item type, `useGroupRoom(groupId)` (`features/groups/`), `<Avatar userId name size />` (`components/avatar.tsx`), `features/tasks/tasks-tab.tsx` (its export name) and the Tasks tab route object in `router.tsx`. Run: `grep -rn "export" apps/server/src/modules/files/service.ts apps/server/src/infra/realtime/rooms.ts apps/web/src/features/files apps/web/src/components/avatar.tsx apps/web/src/features/tasks; grep -rn "isGroupPerson\|recordNotifications\|NotificationKind\|useGroupPeople\|useGroupRoom" apps packages --include=*.ts --include=*.tsx -l`.
- [ ] **Step 2: Failing tests.** Shared (`tasks.test.ts`): `TaskDraftSchema fills defaults from { title }`; `title '  ' is rejected and 201 chars rejected`; `11 assignees rejected; duplicate ids collapse`; `dueDate '2026-02-30' rejected, '2026-10-18' accepted, null accepted`; `TaskPatchSchema keeps omitted fields undefined`; `BucketPatchSchema rejects {}`. Policy (`policy.test.ts`, `it.each` over superadmin / admin / client of the group / client of another group / client without group): `canUseBoard`, `canManageBuckets`, `canDeleteTask` for own and someone else's task. Positions (`positions.test.ts`): `keyAfter(null, null)` is `'a0'`; `keyAfter('a0','a3')` sorts strictly between; `keysAfter('a0', 3)` is ascending; `isCustomBucketPosition` false for `'a0'` and `'a9'`, true for `'a5'`. Migration check (`positions.test.ts`, against the test DB): `positions sort byte-wise in SQL` — insert two custom buckets into a fresh group with positions `'a0l'` and `'a0V'`, select ordered by `position`: `['a0V', 'a0l']`.
- [ ] **Step 3: Run** `pnpm --filter @spolu/shared test && pnpm --filter @spolu/server test -- tasks` — FAIL.
- [ ] **Step 4: Implement**, `pnpm --filter @spolu/server add fractional-indexing@4.0.0 --save-exact`, then `pnpm --filter @spolu/server db:generate`; open the SQL and check the `collate "C"`, both CHECKs and the partial indexes are there.
- [ ] **Step 5: Run** the same tests, `pnpm typecheck`, `pnpm lint`, prettier on changed files — PASS.
- [ ] **Step 6: Docs** (data-model: Bucket, Task built with the real columns; TaskAssignee and TaskAttachment rows; Task loses priority and labels; permissions: task policy rows). **Commit** `feat(tasks): shared types, tables, policy and positions`.

### Task 2: Board and buckets (service, API, events)

**Files:**
- Create: `apps/server/src/modules/tasks/{service.ts,service.test.ts,routes.ts,routes.test.ts,events.ts}`
- Modify: `apps/server/src/app.ts` (`await app.register(tasksRoutes, { prefix: '/api', deps })`), `docs/architecture/overview.md`, `docs/architecture/realtime.md`

**Interfaces:**
- Consumes: Task 1; `getMembershipGroupId`, `getGroup` (groups service); `emitToGroup`; `createRateLimiter` (`infra/http/rate-limit.ts`).
- Produces:
  - `service.ts`: `ensureBoard(db, groupId): Promise<void>` (one `insert … values(4 fixed rows) on conflict do nothing`; safe under parallel first reads); `getBoard(db, groupId): Promise<BoardDto>` (calls `ensureBoard`; buckets by position; tasks by bucket then position, each with `createdBy`, `assignees` (by name) and `fileCount`, in at most three queries — no N+1); `listBuckets(db, groupId): Promise<BucketDto[]>`; `getBucket(db, id)`; `createBucket(db, groupId, name): Promise<BucketDto>` (position = `keyAfter(last custom ?? todo, next bucket after it)`); `updateBucket(db, id, { name?, afterBucketId? })` (throws `FixedBucketError` for a fixed bucket; `afterBucketId` must be a bucket of the same group, not itself and not `done`, else `InvalidPlacementError`; new position = `keyAfter(after.position, the next bucket's position excluding itself)`); `deleteBucket(db, id): Promise<{ groupId }>` (throws `FixedBucketError`; in one transaction moves its tasks, in their order, to the end of To do with `keysAfter`, then deletes the bucket). `lockBuckets(tx, ids: string[])` (`select … for update` ordered by id) is exported for Task 3/4 and used by every write that computes a position.
  - Names come from a read-only join on the `user` table inside `getBoard` and the task queries (the same documented read-only exception as `listGroups`; comment it).
  - `events.ts`: `emitBuckets(io, groupId, buckets)`, `emitTask(io, task, actor)`, `emitTaskDeleted(io, groupId, taskId)` — thin wrappers over `emitToGroup` with `BoardEvents`.
  - `routes.ts`: `tasksRoutes: FastifyPluginAsync<{ deps: AppDeps }>` with `GET /groups/:id/board`, `POST /groups/:id/buckets` (201 `BucketDto`), `PATCH /buckets/:id` (200 `BucketDto`), `DELETE /buckets/:id` (204). It owns one `createRateLimiter({ windowMs: 60_000, max: 120 })` keyed by `request.user.id` and exports the write preHandler list `writeGuard = [requireUser(app.auth), limitWrites]` that Task 3's `taskRoutes` (registered from here with `{ deps, writeGuard }`) reuses. Order per route: user, rate limit, body, resolve the group (task/bucket → its `groupId`), `canUseBoard` (404), `canManageBuckets` (403), service, emit after commit.
  - Every bucket change emits `board:buckets` with the full list.

- [ ] **Step 1: Failing tests** (`service.test.ts`): `ensureBoard creates exactly the four fixed buckets once`; `two parallel getBoard calls on a new group still give four buckets`; `createBucket places a new bucket after the last custom bucket, or right after To do`; `updateBucket moves a custom bucket after eGrant review and it stays before Completed`; `updateBucket with afterBucketId of Completed → InvalidPlacementError`; `updateBucket / deleteBucket on a fixed bucket → FixedBucketError`; `deleteBucket moves its tasks in order to the end of To do`; `deleting the group row removes buckets and tasks` (direct delete, proves the FK choice).
- [ ] **Step 2: Failing tests** (`routes.test.ts`, helpers like `groups/routes.test.ts`): `admin GET board → 4 buckets in order, no tasks`; `client of the group reads the board; client of another group gets 404 on GET board, POST/PATCH/DELETE bucket`; `client POST bucket → 403`; `admin creates, renames, reorders, deletes a custom bucket`; `PATCH a fixed bucket → 400 fixed_bucket`; `invalid name → 400 validation_failed`; `a client socket in the group receives board:buckets after a create`; `the 121st write within a minute → 429 rate_limited` (use 121 `POST /groups/:id/buckets` with an empty body as a client: each answers a 4xx other than 429 until the 121st, which answers 429).
- [ ] **Step 3: Run** `pnpm --filter @spolu/server test -- tasks` — FAIL.
- [ ] **Step 4: Implement** and register in `app.ts`.
- [ ] **Step 5: Run** tests, typecheck, lint, prettier — PASS.
- [ ] **Step 6: Docs** (overview: "Tasks API" paragraph for the board and buckets, rate limit; realtime: `board:buckets`, and a new row "group room carries board events" replacing the planned "per group (board)" row). **Commit** `feat(tasks): lazy board and custom buckets`.

### Task 3: Tasks — create, read, edit, delete

**Files:**
- Create: `apps/server/src/modules/tasks/{task-service.ts,task-service.test.ts,task-routes.ts,task-routes.test.ts}`
- Modify: `apps/server/src/modules/tasks/routes.ts` (register `taskRoutes`), `docs/architecture/overview.md`, `docs/architecture/realtime.md`

**Interfaces:**
- Consumes: Tasks 1–2 (`lockBuckets`, `writeGuard`, `emitTask`, `emitTaskDeleted`); `isGroupPerson`, `getMembershipGroupId`; `attachFiles`, `deleteFiles`, `getFilesForGroup`; `recordNotifications`.
- Produces:
  - `createTask(deps, actor: SessionUser, groupId, input: TaskDraft & { bucketId?: string }): Promise<TaskDetailDto>` — one transaction: `ensureBoard`, bucket = `bucketId` (must belong to the group, else `NotFoundError`) or To do; lock it; position = `keyAfter(last task, null)`; `completedAt` = now when the bucket is `done`; assignees validated; `attachFiles(tx, groupId, fileIds, actor.id)`; `task.assigned` to assignees minus actor. `sourceMessageId` is not accepted from the API in this phase (always null).
  - `getTask(db, id): Promise<TaskDetailDto | null>` (`sourceMessage` is always null in this phase).
  - `updateTask(deps, actor, id, patch: TaskPatch): Promise<TaskDetailDto>` — one transaction, one conditional `update … where id = $1 and updated_at = $2 returning`; zero rows → `TaskChangedError` if the task exists, else `NotFoundError`. `assigneeIds`/`fileIds` are the full new lists: only ids **not already on the task** are checked (`isGroupPerson`, `attachFiles`); removed attachments are unlinked in the transaction and their files deleted with `deleteFiles` after commit; `task.assigned` only to newly added assignees minus actor.
  - `deleteTask(deps, id): Promise<{ groupId }>` — deletes the row, then `deleteFiles` for its attachments after commit.
  - Errors: `InvalidAssigneeError` (not a group person, or more than 10 after merge) → 400 `invalid_assignee`; Phase 4's attachment error → 400 `invalid_attachment`; `TaskChangedError` → 409 `task_changed`.
  - `task-routes.ts`: `POST /groups/:id/tasks` (201 `TaskDetailDto`), `GET /tasks/:id` (200 `TaskDetailDto`), `PATCH /tasks/:id` (200 `TaskDetailDto`), `DELETE /tasks/:id` (204; `canDeleteTask` else 403). Every write emits `board:task` (`{ task: TaskDto, actor }`) or `board:task_deleted` after commit.

- [ ] **Step 1: Failing tests** (`task-service.test.ts` and `task-routes.test.ts`): `client creates a task with only a title → 201, in To do, at the end, creator = client`; `create with bucketId of Completed sets completedAt`; `create with a bucketId of another group → 404`; `assignee from another group → 400 invalid_assignee`; `active admin and a client of the group are valid assignees`; `create with a file uploaded by someone else → 400 invalid_attachment`; `GET /tasks/:id returns description and files (FileInfo)`; `PATCH twice with the returned updatedAt succeeds both times`; `PATCH with an older updatedAt → 409 task_changed and nothing changes`; `PATCH { title } keeps assignees, files, urgent`; `a removed assignee stays and does not block edits` (remove the client with the groups service, then PATCH the title → 200, assignee still listed); `PATCH removing a file unlinks it and deletes it from storage`; `task.assigned recorded for newly added assignees only, never for the actor`; `client deletes own task → 204, someone else's → 403; admin deletes any → 204; files gone from storage`; `another group's client gets 404 on GET, PATCH, DELETE`; `a client socket receives board:task with actor after PATCH and board:task_deleted after DELETE`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test -- tasks` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, typecheck, lint, prettier — PASS.
- [ ] **Step 5: Docs** (overview: task endpoints, `task_changed`, files lifecycle; realtime: `board:task`, `board:task_deleted`, reconnect = refetch the board, no `seq`). **Commit** `feat(tasks): create, edit and delete tasks`.

### Task 4: Moving tasks

**Files:**
- Modify: `apps/server/src/modules/tasks/{task-service.ts,task-service.test.ts,task-routes.ts,task-routes.test.ts}`, `docs/architecture/overview.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `moveTask(deps, actor, id, { bucketId, afterTaskId }): Promise<TaskDto>` — one transaction: lock the source and target buckets (`lockBuckets`, sorted ids, so two moves never deadlock); `bucketId` of another group → `NotFoundError`; `afterTaskId` not in the target bucket, or equal to `id` → `ValidationError` (400 `validation_failed`); new position = `keyAfter(after?.position ?? null, the next task after it excluding the moved one)`; if bucket and neighbours are unchanged, return the task untouched (no write, no event). Bucket change: set `completedAt` entering `done`, clear it leaving `done`; record `task.moved` to creator + assignees minus actor with `BucketLabel`s and `actorName`. A move does **not** change `updatedAt` (it guards the content edited in the form; a drag must not invalidate someone's unsaved description). Route `POST /tasks/:id/move` → 200 `TaskDto`, then `board:task`.

- [ ] **Step 1: Failing tests:** `move into eGrant review after task B lands between B and the next task`; `afterTaskId null puts it first`; `moving to the current place is a no-op` (same bucket, after the task above it: position and `updatedAt` unchanged, no `task.moved`, no event); `ten parallel moves after the same task give ten unique positions, all between that task and the next` (`Promise.all` of `moveTask`); `completedAt set entering Completed and cleared leaving it`; `task.moved goes to creator and assignees, not the actor, with bucket labels`; `afterTaskId from another bucket → 400`; `moving a deleted task → 404`; `client moves a task (200); another group's client → 404`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** tests, typecheck, lint, prettier — PASS.
- [ ] **Step 5: Docs** (overview: move endpoint, server-computed positions with bucket locks). **Commit** `feat(tasks): move tasks between and inside buckets`.

### Task 5: Web data layer and live updates

**Files:**
- Create: `apps/web/src/features/tasks/{api.ts,board-cache.ts,board-cache.test.ts,use-board-events.ts,use-board-events.test.tsx,dates.ts,dates.test.ts}`
- Modify: `apps/web/src/locales/en.json`, `apps/web/src/locales/sk.json` (`tasks.buckets.*`, `tasks.board.taskDeleted`)

**Interfaces:**
- Consumes: shared schemas (Task 1), endpoints (Tasks 2–4), `getSocket()`, `apiGet`, `apiSend`.
- Produces:
  - `api.ts`: `boardQuery(groupId)` (key `['tasks', groupId, 'board']`), `taskQuery(taskId)` (key `['tasks', 'task', taskId]`), `createTask(groupId, input: TaskDraft & { bucketId?: string }): Promise<TaskDetailDto>`, `updateTask(id, patch: TaskPatch)`, `moveTask(id, body: TaskMove): Promise<TaskDto>`, `deleteTask(id)`, `createBucket(groupId, name)`, `updateBucket(id, patch)`, `deleteBucket(id)`.
  - `board-cache.ts` (pure): `byPosition(a, b)` (code-unit compare with `<`); `upsertTask(board, task): BoardDto`; `removeTask(board, taskId): BoardDto`; `replaceBuckets(board, buckets): { board: BoardDto; removedBucket: boolean }`; `tasksByBucket(board): Map<string, TaskDto[]>` (sorted).
  - `use-board-events.ts`: `useBoardEvents(groupId)` — listens to the three `BoardEvents`, ignores payloads of another `groupId`, applies them with `queryClient.setQueryData`; refetches the board when `replaceBuckets` reports a removed bucket (its tasks moved) and on every socket `connect` after the first. It relies on Phase 4's `useGroupRoom` (already called by the group layout) for room membership.
  - `dates.ts`: `todayInBratislava(now?: Date): string` (`Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' })` → `YYYY-MM-DD`); `isOverdue(dueDate: string | null, bucketKind: BucketKind, today: string): boolean`; `formatDue(dueDate, language): string` (`{ day: 'numeric', month: 'short' }`, e.g. "18 Oct").
  - i18n (EN / SK): `tasks.buckets.todo` "To do" / "Na spracovanie"; `tasks.buckets.egrantReview` "eGrant review" / "Kontrola eGrant"; `tasks.buckets.clientReview` "{{group}} review" / "Kontrola {{group}}"; `tasks.buckets.done` "Completed" / "Hotové"; `tasks.board.taskDeleted` "This task was deleted." / "Táto úloha bola odstránená."

- [ ] **Step 1: Failing tests:** `upsertTask inserts a new task and re-sorts the bucket`; `upsertTask moves a task to another bucket`; `byPosition compares code units` (`'a0V'` before `'a0l'`); `removeTask`; `replaceBuckets reports a removed bucket`; `isOverdue uses the Bratislava date` (`todayInBratislava(new Date('2026-10-17T23:30:00Z'))` is `'2026-10-18'`; due `'2026-10-17'` overdue, `'2026-10-18'` not, any date in `done` not); `useBoardEvents applies board:task to the cache and ignores another group's event` (fake socket with `on`/`off`/emit helper, mocked `@/lib/socket`); `useBoardEvents refetches the board after a reconnect`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test -- tasks` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, typecheck, lint, prettier — PASS.
- [ ] **Step 5: Commit** `feat(web): task board data layer and live updates`.

### Task 6: `<TaskForm>`

**Files:**
- Create: `apps/web/src/features/tasks/{task-form.tsx,task-form.test.tsx,assignee-select.tsx,task-files-field.tsx,urgent-switch.tsx,icons.tsx}`
- Modify: locales (`tasks.form.*`)

**Interfaces:**
- Consumes: `TaskDraft`, `TaskDraftSchema`, `FileInfo` (shared); `useGroupPeople`, `<Avatar>`, `uploadFile`, `<FileChip>`, `<ImagePreview>` (Phase 4).
- Produces:
  - `TaskForm({ value, onChange, groupId, errors?, files?, knownPeople? }: { value: TaskDraft; onChange(next: TaskDraft): void; groupId: string; errors?: TaskFormErrors; files?: FileInfo[]; knownPeople?: TaskPerson[] })` — controlled only: no saving, no bucket select. `files` gives `FileInfo` for ids already in `value.fileIds` (the panel passes the task's files; new uploads are kept inside the form's file field). `knownPeople` names assignees that are no longer group people (the task's `assignees`), shown as "Name (removed)". Fields: title (required, max 200), description (textarea, max 10 000), assignees (`AssigneeSelect`: a combobox input filtering `useGroupPeople`, chosen people as removable chips with `<Avatar size={20}>` and an "eGrant" pill for admins, max 10), deadline (`<input type="date">`, empty = null), urgent (`UrgentSwitch`: `button role="switch" aria-checked`, label "Urgent"), files (`TaskFilesField`: upload via `uploadFile` with progress, chips with remove, image previews).
  - `type TaskFormErrors = Partial<Record<'title' | 'description' | 'assigneeIds' | 'form', string>>`; `validateTaskDraft(value: TaskDraft): TaskFormErrors` (i18n messages from `TaskDraftSchema` issues) — used by the panel before saving and by Phase 9.
  - `icons.tsx`: inline SVG `PaperclipIcon`, `MoreIcon`, `CloseIcon`, `BackIcon` (16 px, `currentColor`, `aria-hidden`).
  - i18n (EN / SK): `tasks.form.title` "Title" / "Názov"; `description` "Description" / "Popis"; `assignees` "Assignees" / "Riešitelia"; `searchPeople` "Search people" / "Hľadať ľudí"; `noPeople` "No one found." / "Nikto sa nenašiel."; `remove` "Remove {{name}}" / "Odobrať {{name}}"; `removedPerson` "{{name}} (removed)" / "{{name}} (odstránený)"; `deadline` "Deadline" / "Termín"; `urgent` "Urgent" / "Urgentné"; `files` "Files" / "Súbory"; `attach` "Attach a file" / "Priložiť súbor"; `errors.titleRequired` "Enter a title." / "Zadajte názov."; `errors.titleTooLong` "Use at most 200 characters." / "Použite najviac 200 znakov."; `errors.descriptionTooLong` "Use at most 10,000 characters." / "Použite najviac 10 000 znakov."; `errors.tooManyAssignees` "Choose at most 10 people." / "Vyberte najviac 10 ľudí."; `errors.invalidAssignee` "Someone you chose is no longer in this group." / "Niekto z vybraných už nie je v tejto skupine."

- [ ] **Step 1: Invoke `frontend-design:frontend-design`** for the form (fields, chips, switch, file list) on the egrant.sk tokens.
- [ ] **Step 2: Failing tests** (`task-form.test.tsx`, a stateful wrapper around `<TaskForm>`): `typing in title calls onChange with the new value and keeps the rest`; `choosing a person adds their id; the chip's Remove deletes it`; `an assignee not in useGroupPeople shows "Name (removed)"`; `the 11th person cannot be chosen`; `the urgent switch toggles value.urgent and aria-checked`; `clearing the date sets dueDate null`; `validateTaskDraft returns titleRequired for '  ' and titleTooLong for 201 chars`; `errors prop shows the message under the field with aria-describedby`; `removing a file removes its id from fileIds`.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** web tests, typecheck, lint, prettier — PASS.
- [ ] **Step 6: Commit** `feat(web): reusable task form`.

### Task 7: Board UI (columns, cards, inline add, bucket management)

**Files:**
- Create: `apps/web/src/features/tasks/{board.tsx,board.test.tsx,bucket-column.tsx,task-card.tsx,add-task-inline.tsx,add-bucket.tsx,bucket-menu.tsx}`
- Modify: `apps/web/src/features/tasks/tasks-tab.tsx` (replace the placeholder; keep its export name), locales (`tasks.board.*`, `tasks.card.*`)

**Interfaces:**
- Consumes: Tasks 5–6 (`boardQuery`, `tasksByBucket`, `useBoardEvents`, `isOverdue`, `formatDue`, `createTask`, bucket writes), `groupQuery` (for the client review name), `useSession`/`isAdmin` (cosmetic), `<Avatar>`.
- Produces:
  - `tasks-tab.tsx`: renders `<Board groupId>` and an `<Outlet />` (the task panel route renders there, over the board).
  - `Board({ groupId })`: horizontal scroll row; buckets in position order; `bucketTitle(bucket, groupName, t)` exported helper.
  - `BucketColumn`: 288 px, `bg-muted rounded-xl`, header with name, task count, the 8 px kind square (To do `ink` outline, eGrant review `brand-purple`, client review `brand-blue`, Completed `success`; none for custom) and, for admins on custom buckets, `BucketMenu` (Rename inline, Delete with inline confirm). Vertical scroll inside. Under 641 px: width `calc(100vw - 56px)` with `scroll-snap-type: x mandatory` on the row.
  - `TaskCard({ task, bucketKind, people })`: a link to `/groups/$groupId/tasks/$taskId`; `bg-card`; "Urgent" `destructive` pill above the title; title clamped to 3 lines (`muted-foreground` in Completed); meta row: up to 3 overlapping avatars then "+N", due date (`text-error-ink` when overdue), paperclip + count when `fileCount > 0`.
  - `AddTaskInline({ groupId, bucketId })`: "+ Add task" → title input; Enter creates (`createTask(groupId, { title, bucketId })`, then `upsertTask` into the cache), Esc cancels.
  - `AddBucket({ groupId })` (admins, after the last custom bucket): "+ Add bucket" → name input; Enter creates.
  - i18n (EN / SK): `tasks.board.addTask` "Add task" / "Pridať úlohu"; `taskTitle` "Task title" / "Názov úlohy"; `addBucket` "Add bucket" / "Pridať stĺpec"; `bucketName` "Bucket name" / "Názov stĺpca"; `empty` "Nothing here yet." / "Zatiaľ tu nič nie je."; `emptyBoard` "Add the first task for this group." / "Pridajte prvú úlohu pre túto skupinu."; `count` "{{count}} tasks" / "Počet úloh: {{count}}"; `more` "More" / "Viac"; `rename` "Rename" / "Premenovať"; `delete` "Delete" / "Odstrániť"; `deleteBucketConfirm` "Delete this bucket? Its tasks move to To do." / "Odstrániť tento stĺpec? Jeho úlohy sa presunú do Na spracovanie."; `cancel` "Cancel" / "Zrušiť"; `tasks.card.urgent` "Urgent" / "Urgentné"; `tasks.card.due` "Deadline {{date}}" / "Termín {{date}}"; `tasks.card.overdue` "Overdue" / "Po termíne"; `tasks.card.files` "Files: {{count}}" / "Súbory: {{count}}"; `tasks.card.moreAssignees` "+{{count}}" / "+{{count}}".

- [ ] **Step 1: Invoke `frontend-design:frontend-design`** for the board, column, card and bucket menu (wireframe in the spec, "Board" section).
- [ ] **Step 2: Failing tests** (`board.test.tsx`, fetch mocked, `@/lib/socket` mocked): `renders To do, custom, eGrant review, "Acme review", Completed in that order with task counts`; `empty To do on an empty board says "Add the first task for this group."`, other empty columns say "Nothing here yet."; `urgent card shows the Urgent pill`; `card due before today is error-ink and labelled overdue, the same card in Completed is not`; `four assignees show three avatars and +1`; `inline add: Enter posts { title, bucketId } and the card appears; Esc cancels without a request`; `admin sees Add bucket and the custom bucket menu; a client sees neither`; `delete bucket asks inline, then sends DELETE`.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** web tests, typecheck, lint, prettier — PASS.
- [ ] **Step 6: Commit** `feat(web): task board columns, cards and buckets`.

### Task 8: Drag and drop

**Files:**
- Create: `apps/web/src/features/tasks/{drop.ts,drop.test.ts,dnd-announcements.ts}`, `docs/decisions/0012-dnd-kit-and-fractional-indexing.md`
- Modify: `apps/web/package.json` (`"@dnd-kit/core": "6.3.1"`, `"@dnd-kit/sortable": "10.0.0"`, `"fractional-indexing": "4.0.0"`, exact), `board.tsx`, `bucket-column.tsx`, `task-card.tsx`, `board.test.tsx`, locales (`tasks.dnd.*`, `tasks.board.moveFailed`), `docs/decisions/README.md`, `docs/architecture/performance.md` (Tasks chunk size)

**Interfaces:**
- Consumes: Tasks 5 and 7 (`moveTask`, `updateBucket`, `upsertTask`, `tasksByBucket`).
- Produces:
  - `drop.ts` (pure): `computeTaskDrop(columns: Map<string, TaskDto[]>, activeId: string, overId: string, overBucketId: string): { bucketId: string; afterTaskId: string | null; optimisticPosition: string } | null` (null = no change; ids of droppable columns are `bucket:<id>`); `computeBucketDrop(buckets: BucketDto[], activeId: string, overId: string): { afterBucketId: string } | null` (only custom buckets move; the result always lies after To do and before Completed).
  - `board.tsx`: one `DndContext` with `PointerSensor` (`activationConstraint: { distance: 5 }`), `TouchSensor` (`{ delay: 250, tolerance: 5 }`), `KeyboardSensor` (`sortableKeyboardCoordinates`); `accessibility={{ announcements, screenReaderInstructions }}` from `dnd-announcements.ts` (i18n); a `SortableContext` (vertical) per column and a horizontal one for the custom bucket headers (fixed headers are not draggable). On task drop: snapshot the cache, `upsertTask` with `optimisticPosition`, call `moveTask`; success → `upsertTask` with the server task; 404 → `removeTask` and the notice "This task was deleted."; any other error → restore the snapshot and show "The task could not be moved." Bucket drop → `updateBucket(id, { afterBucketId })`, failure restores. The lifted card uses `shadow-lift`; the placeholder is the card's slot at reduced opacity. No other animation.
  - i18n (EN / SK): `tasks.dnd.instructions` "To pick up a task, press Space. Use the arrow keys to move it and press Space again to drop it. Press Escape to cancel." / "Úlohu zdvihnete medzerníkom. Šípkami ju presuniete a ďalším stlačením medzerníka ju položíte. Klávesom Escape presun zrušíte."; `pickedUp` "Picked up {{title}}." / "Úloha {{title}} je zdvihnutá."; `over` "{{title}} is over {{bucket}}." / "Úloha {{title}} je nad stĺpcom {{bucket}}."; `dropped` "{{title}} was dropped in {{bucket}}." / "Úloha {{title}} je položená v stĺpci {{bucket}}."; `cancelled` "Moving {{title}} was cancelled." / "Presun úlohy {{title}} je zrušený."; `tasks.board.moveFailed` "The task could not be moved." / "Úlohu sa nepodarilo presunúť."

- [ ] **Step 1: Invoke `frontend-design:frontend-design`** for the drag states (lifted card, placeholder, focus ring on a picked-up card).
- [ ] **Step 2: Failing tests:** `computeTaskDrop` — `drop on another card in another bucket → after the card above the target`, `drop on an empty column → afterTaskId null`, `drop at the top → afterTaskId null`, `drop where it already is → null`, `optimisticPosition sorts between the neighbours`; `computeBucketDrop` — `a custom bucket dropped after eGrant review`, `dropped on To do → after To do`, `dropped on Completed → after the last bucket before Completed`, `a fixed bucket as active → null`; `board.test.tsx`: `a refused move restores the card to its bucket and shows the notice` and `a 404 removes the card and shows "This task was deleted."` (call the exported `handleTaskDrop` with a mocked failing `moveTask`; keyboard dragging itself is covered by the e2e in Task 10, jsdom has no layout).
- [ ] **Step 3: Run** — FAIL. **Step 4:** `pnpm --filter @spolu/web add @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 fractional-indexing@4.0.0 --save-exact`; implement; write ADR 0012 (why dnd-kit: keyboard, touch, accessible announcements; rejected native HTML5 drag and drop; why fractional-indexing: server-computed order keys, ~1 kB; both only in the lazy Tasks chunk) and add it to the ADR index.
- [ ] **Step 5: Run** web tests, typecheck, lint, prettier, `pnpm --filter @spolu/web build` — PASS; in the build output confirm the initial JS stays under 200 kB gzip and dnd-kit appears only in the Tasks chunk; write the chunk size in `performance.md`.
- [ ] **Step 6: Commit** `feat(web): drag and drop on the task board`.

> **NOTE for controller:** Phase 5 may add an ADR too; whichever branch merges second renumbers its ADR.

### Task 9: Task panel

**Files:**
- Create: `apps/web/src/features/tasks/{task-panel.tsx,task-panel.test.tsx,source-message.tsx}`
- Modify: `apps/web/src/router.tsx` (one route), locales (`tasks.panel.*`)

**Interfaces:**
- Consumes: Tasks 5–7 (`taskQuery`, `updateTask`, `moveTask`, `deleteTask`, `boardQuery`, `bucketTitle`, `upsertTask`), `TaskForm`, `validateTaskDraft`, `canDeleteTask` mirrored cosmetically (admin or creator), `useBlocker` (TanStack Router).
- Produces:
  - Route: `taskRoute = createRoute({ getParentRoute: () => <Phase 4 Tasks tab route>, path: '$taskId', component: lazyRouteComponent(() => import('@/features/tasks/task-panel'), 'TaskPanelRoute') })`, added as that route's child. Full path `/groups/$groupId/tasks/$taskId`.
  - `TaskPanelRoute` / `TaskPanel({ groupId, taskId })`: `fixed` panel, 560 px on the right at ≥ 1024 px, full screen below with a Back button (Close button on desktop); both return to `/groups/$groupId/tasks`. Top: bucket `<select>` (moves the task to the end of the chosen bucket via `moveTask`, `afterTaskId` = last task there from the board cache) and, for admin or creator, a "More" menu with Delete (inline confirm, then `deleteTask` and back to the board). Body: `<SourceMessage>` when `task.sourceMessage` is set, then `<TaskForm>` with a draft state initialised from the task; `{children}` slot below the form (Phase 9 puts the task chat there). Footer: "Created by {name} on {date}" (`{ day: 'numeric', month: 'short', year: 'numeric' }`, current language).
  - Save: "Save changes" / "Cancel" only when the draft differs from the task; Save runs `validateTaskDraft`, then `updateTask(id, { ...draft, updatedAt })`; 400 `invalid_assignee` → `errors.assigneeIds`; 409 `task_changed` → notice "Changed by someone else." with "Reload" (the draft stays until Reload).
  - Live: on `board:task` for this task with a different `updatedAt` from someone else — not dirty: refetch `taskQuery` and reset the draft; dirty: notice "Changed by {actor.name} just now." with "Reload". `board:task_deleted` for this task → the board's "This task was deleted." notice and back to the board.
  - Leaving with unsaved changes (Close, Back, or any navigation): `useBlocker({ shouldBlockFn: () => dirty, withResolver: true })` shows an inline bar "You have unsaved changes." with "Discard" / "Keep editing".
  - `SourceMessage({ groupId, message })`: "Created from a message", author, first 140 characters, link "Open in chat" to `/groups/${groupId}/chat?message=${id}` (a plain `<a href>`; Phase 5 owns the `?message=` search param, Phase 9 may switch to a typed `<Link>`).
  - i18n (EN / SK): `tasks.panel.bucket` "Bucket" / "Stĺpec"; `close` "Close" / "Zavrieť"; `back` "Back to the board" / "Späť na nástenku"; `save` "Save changes" / "Uložiť zmeny"; `cancel` "Cancel" / "Zrušiť"; `more` "More" / "Viac"; `delete` "Delete" / "Odstrániť"; `deleteConfirm` "Delete this task? Its files are deleted too." / "Odstrániť túto úlohu? Odstránia sa aj jej súbory."; `createdBy` "Created by {{name}} on {{date}}" / "Vytvoril(a) {{name}} dňa {{date}}"; `changedBy` "Changed by {{name}} just now." / "{{name}} práve zmenil(a) túto úlohu."; `changedBySomeone` "Changed by someone else." / "Úlohu medzitým zmenil niekto iný."; `reload` "Reload" / "Načítať znova"; `unsaved` "You have unsaved changes." / "Máte neuložené zmeny."; `discard` "Discard" / "Zahodiť"; `keepEditing` "Keep editing" / "Pokračovať v úpravách"; `fromMessage` "Created from a message" / "Vytvorené zo správy"; `openMessage` "Open in chat" / "Otvoriť v chate".

- [ ] **Step 1: Invoke `frontend-design:frontend-design`** for the panel (desktop slide-over without animation, mobile full screen, header row, footer, notices).
- [ ] **Step 2: Failing tests** (`task-panel.test.tsx`, through `createAppRouter` with memory history at `/groups/g1/tasks/t1`, fetch and socket mocked): `shows the form filled from GET /tasks/t1 and the footer "Created by Jana Nováková on 15 Oct 2026"`; `Save changes appears only after an edit and sends PATCH with updatedAt`; `409 task_changed shows "Changed by someone else." and keeps the typed title until Reload`; `a board:task from someone else while dirty shows "Changed by Jana just now."; while clean it reloads silently`; `choosing Completed in the bucket select posts move with afterTaskId = last task there`; `Delete is shown to the creator and admins only; confirm sends DELETE and returns to the board`; `Close with unsaved changes asks first; Discard leaves`; `sourceMessage renders "Created from a message" with a link to /groups/g1/chat?message=m1`.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** web tests, typecheck, lint, prettier, web build (the panel chunk must not contain dnd-kit) — PASS.
- [ ] **Step 6: Commit** `feat(web): task panel`.

> **NOTE for controller:** `router.tsx` also changes on `phase-5` (chat routes); the Phase 8 change is one route object and one `addChildren` entry, so the merge conflict is mechanical.

### Task 10: End-to-end, docs and CI

**Files:**
- Create: `e2e/tasks.spec.ts`
- Modify: `docs/architecture/{data-model.md,realtime.md,permissions.md,overview.md}` (final pass), `docs/design/tokens.md` ("Task board" component section as built: column, card, urgent pill, kind squares, panel), `docs/glossary.md` (bucket, urgent), `docs/product/task-board.md` (Phase 8 built), `docs/roadmap.md` (Phase 8 status and plan link)

**Interfaces:**
- Consumes: everything above; e2e helpers `e2e/mailpit.ts` (`clearMailFor`, `latestLoginCode`).

- [ ] **Step 1: Write the e2e** (`e2e/tasks.spec.ts`, one serial test, Slovak UI). Setup through the API with the admin's `page.request`: `POST /api/groups` (unique URL by `Date.now()`), read `inviteUrl`; client in a new context: `POST /api/join/<token>`, `POST /api/auth/email-otp/send-verification-otp`, `POST /api/auth/sign-in/email-otp` with `latestLoginCode`, `PATCH /api/me { name: 'E2E Klient' }`. Flow: both open `/groups/<id>/tasks`; the client adds "Rozpočet" in Na spracovanie → the admin sees the card without reloading; the admin focuses the card, presses Space, ArrowRight, Space → the card is in Kontrola eGrant in both browsers; the client opens the card, marks it Urgentné, attaches `e2e/fixtures/logo.png`, saves → the admin sees the Urgentné pill and the paperclip; the admin opens the task and the file link answers 200 (`page.request.get(href)`); the admin adds a custom stĺpec "Moje", sees it in the client's browser, deletes it (confirm) and it disappears for both.
- [ ] **Step 2: Run** `pnpm test:e2e -- tasks` — PASS (fix issues in the owning code).
- [ ] **Step 3: Docs final pass** (list above; data-model: the "multiple assignees" and "priority, labels" changes; realtime: board events and reconnect refetch; permissions: task capabilities table rows; overview: Tasks API, web board and panel).
- [ ] **Step 4: Run the `update-kb` skill**, then `bash scripts/ci.sh` — all green; prettier clean on every changed file.
- [ ] **Step 5: Commit** `test(e2e): task board in two browsers; docs for phase 8`.

---

## Interfaces for Phase 9

- `<TaskForm value onChange groupId errors? files? knownPeople? />` (`apps/web/src/features/tasks/task-form.tsx`): controlled, value type `TaskDraft { title, description, assigneeIds, dueDate, urgent, fileIds }` from `packages/shared/src/tasks.ts`; `validateTaskDraft(value)` for Approve. No saving, no bucket select: the AI review screen renders one per proposed card with its own Approve / Reject.
- `POST /api/groups/:id/tasks` accepts exactly `TaskDraft & { bucketId? }` (`TaskCreateSchema`) and answers 201 `TaskDetailDto`; Phase 9 adds `sourceMessageId` to this schema and sets it server-side for tasks made from a message.
- `tasks.source_message_id` (nullable text, no FK yet): Phase 9 adds the FK to messages and fills it.
- `TaskDetailDto.sourceMessage: { id, authorName, excerpt } | null` and the `<SourceMessage>` block in the panel ("Created from a message", link `/groups/:id/chat?message=<id>`): always null in Phase 8; Phase 9 fills it in `getTask`.
- `TaskPanel` has a `children` slot below the form for the task chat.
- `board:task` / `board:task_deleted` / `board:buckets` in the group room; Phase 9's chat count on the card goes into `TaskDto` and the card's meta row.
