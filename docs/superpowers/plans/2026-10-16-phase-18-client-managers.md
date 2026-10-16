# Phase 18 — Client Managers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can become a manager of a client group (and stop) from the Groups page. Only clients and managers are offered in pickers and reached by @all, and becoming a manager switches that group's notifications to All.

**Architecture:**
- A `group_managers` table (many-to-many) and the helpers in `modules/groups/managers.ts` are the cross-module API that Phases 17 and 20 call.
- People in a group come in two sets. **Readers** (`listGroupPeople`, unchanged meaning, plus `isManager`) read, write and get `chat.message`. **Pickable people** (`isPickable` = client or manager) are the only ones offered in pickers, accepted as new mentions and assignees, reached by @all, and offered to the AI split.
- The notification mode is stored, not computed. Becoming a manager inserts an `all` row with `origin 'manager'` unless the admin already has a row, and stopping deletes only `manager` rows. The delivery decision (`effectiveGroupMode`, `decideEvent`) is unchanged.

**Tech Stack:** Fastify 5, Drizzle + drizzle-kit, PostgreSQL, Socket.IO, React 19, TanStack Router and Query, i18next with lazy namespaces (`loadNamespace(name)`), Vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-phase-18-client-managers-design.md`. The rulings at the end of `docs/superpowers/specs/2026-10-16-phases-17-20-brief.md` override it: a seed in the migration, self-service only, and the helper name `managedGroupIds(db, userId)`.

## Global Constraints

- Branch `phase-18`, cut from `main` **after Phases 9 and 6 have merged**. Each task below runs on its own branch cut from `phase-18` once its dependencies are merged into it.
- **One migration**, the next free number (expected `0011_group_managers.sql`, after 0009 and 0010). It is generated in Task 1 with `pnpm --filter @spolu/server db:generate --name group_managers`, and the seed is appended to it by hand. Phase 17 also adds a migration in parallel; whichever phase merges second regenerates its own and renumbers.
- **Seed, not "no backfill"** (brief ruling, overrides the spec). The migration makes an active admin or superadmin a manager of a group when they are an assignee of an open task there (`tasks.completed_at is null`), or wrote a non-deleted message in any channel of that group (the group chat or a task chat) in the last 60 days. The seed **does not** touch `group_notification_settings`. Log it in the deploy notes.
- **Self-service only.** The routes act only on the caller (`/managers/me`). There is no endpoint that takes another user id.
- **Helper name:** `managedGroupIds(db, userId)`. If Phase 17 has already merged, Task 1 points its `managedGroupIdsOf` seam at `managedGroupIds`. If not, Phase 17 does it when it merges.
- Modules talk through exported service functions (CLAUDE.md). `groups/managers.ts` changes notification rows only through `notifications/modes.ts` functions.
- Who counts as a manager: an admin or superadmin with `disabled_at is null` and a `group_managers` row. Every helper filters on this; a disabled admin's row stays but counts as nobody.
- Errors are `{ error: '<code>' }`. There are no new codes: `invalid_mention` (400), `invalid_assignee` (400), `forbidden` (403), `not_found` (404) and `rate_limited` (429) are reused.
- English everywhere in the repo. Every UI string is an i18n key in **both** en and sk, in the feature's lazy namespace file (`groups`, `chat`, `tasks`, `notifications`), loaded with `loadNamespace(name)` as the i18n split task set up. Add keys only.
- Performance first. The eager JS stays **≤ 200 kB gzip**. All Phase 18 UI lives in already-lazy chunks: the groups page, the group layout, the task form, the authed layout. Each web task runs `pnpm --filter @spolu/web build` and checks the eager size.
- No fancy effects. The manager toggle swaps state with no animation; the toast reuses `@/components/ui/toast`.
- Reuse what exists: `Avatar`, `Badge`, `Button size="sm"`, `Toast`, `useGroupPeople`, `GroupBell`/`ModeMenu` (Phase 6), `AssigneeSelect`, `MentionPicker`.
- Every UI task starts by invoking `frontend-design:frontend-design` on the egrant.sk tokens (`docs/design/tokens.md`, `components/ui/*`).
- Test-first (`superpowers:test-driven-development`): every code step follows a failing test.
- Tests share `spolu_test` and `spolu_e2e`. Use unique emails (`${randomUUID()}@example.com`) and new groups per test. Never truncate, and never assume a table is empty or that an admin is a non-manager of a group the test did not create.
- Docs are updated in the same commit as the code they describe (the `update-kb` skill). Run `rtk proxy pnpm exec prettier --check <changed files>` per task.
- Every commit message ends with exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Waves

| wave | tasks (parallel within a wave) |
|---|---|
| 1 | Task 1 |
| 2 | Task 2, Task 3 |
| 3 | Task 4, Task 5, Task 6, Task 7 |
| 4 | Task 8 |

## Review Focus

- **Thread replies still reach non-manager admins.** A non-manager admin who wrote in a thread must still get `chat.thread_reply` and the live thread badge. If someone swaps the whole people list for the pickable one, this breaks silently. Test in Task 4: `a non-manager admin in a thread still gets chat.thread_reply`.
- **A disabled manager disappears everywhere and comes back on re-enable.** The avatars, `managedByMe`, the pickers, @all and `managedGroupIds` must all agree. Tests in Task 1 (`managedGroupIds and isGroupManager ignore a disabled admin and see them again when re-enabled`) and Task 3 (`a disabled manager is not in managers`).
- **A superadmin is an admin.** A `role = 'admin'` check would quietly leave the superadmin out. Test in Task 1: `a superadmin can become a manager and counts as one`.
- **The AI review submits a stale assignee.** The review dialog posts drafts through `createTasksFromMessage`. A proposed non-manager must answer 400 `invalid_assignee`, and the dialog must say so instead of failing quietly. Tests in Task 5: `createTasksFromMessage refuses a non-pickable assignee` and `the review dialog shows the assignee error and refetches people`.
- **A rapid double click on the toggle.** Two quick clicks must end in the state of the last click on both the screen and the server, with no flicker back. Test in Task 6: `a second click while the first is pending is applied after it, and the final state matches the last click`.

---

### Task 1: Managers table, seed, helpers and the mode origin

Depends on: none. Wave 1.

**Files:**
- Modify: `apps/server/src/modules/groups/schema.ts` (add `groupManagers`)
- Modify: `apps/server/src/modules/notifications/schema.ts` (add `origin` to `groupNotificationSettings`)
- Create: `apps/server/src/infra/db/migrations/00NN_group_managers.sql` (generated) and its `meta/` snapshot
- Create: `apps/server/src/modules/groups/managers.ts`, `managers.test.ts`, `seed-managers.test.ts`
- Modify: `apps/server/src/modules/groups/policy.ts`, `policy.test.ts`
- Modify: `apps/server/src/modules/notifications/modes.ts`, `modes.test.ts`
- Modify: `packages/shared/src/groups.ts` (`GroupManagerSchema`), `packages/shared/src/notifications.ts` (`managerSet`)
- Docs: `docs/architecture/data-model.md`, `docs/architecture/overview.md` (the helpers as the cross-module API), `docs/product/notifications.md` (the manager rule and origin), `docs/glossary.md` (manager), `docs/runbooks/deploy.md` (the seed note)

**Interfaces:**
- Consumes: `groupNotificationSettings`, `effectiveGroupMode`, `getModeSettings`, `setGroupMode` (Phase 6); `isAdmin` (`users/policy.ts`); `Tx` (`tasks/service.ts`, or the same `Parameters<Parameters<Db['transaction']>[0]>[0]` type).
- Produces:
  - Table `group_managers`: `group_id` (FK groups, cascade), `user_id` (FK user, cascade), `created_at` timestamptz default now; PK (`group_id`, `user_id`); index `group_managers_user_id_idx` on (`user_id`).
  - Column `group_notification_settings.origin text not null default 'user'`, CHECK `group_notification_settings_origin_check` `origin in ('user','manager')`.
  - Shared: `GroupManagerSchema = z.object({ id: z.string(), name: z.string() })`, `type GroupManager`. `NotificationModesSchema` gains `managerSet: z.array(z.string())`.
  - `canBeManager(actor: SessionUser): boolean` in `groups/policy.ts`.
  - In `groups/managers.ts`:
    - `isGroupManager(db: Db, groupId: string, userId: string): Promise<boolean>`
    - `managedGroupIds(db: Db, userId: string): Promise<string[]>`
    - `managedGroupsSql(userId: string): SQL`, a parenthesized `(select gm.group_id from group_managers gm join "user" u … where gm.user_id = $1 and u.role in ('admin','superadmin') and u.disabled_at is null)` fragment, usable as `x in ${managedGroupsSql(id)}`
    - `listGroupManagers(db: Db, groupId: string): Promise<GroupManager[]>`, ordered by name, then id
    - `addManager(db: Db, groupId: string, userId: string): Promise<{ changed: boolean; managers: GroupManager[] }>`
    - `removeManager(db: Db, groupId: string, userId: string): Promise<{ changed: boolean; managers: GroupManager[] }>`
    - `class NotAnAdminError extends Error` (thrown by `addManager` for a client, a disabled user or an unknown id)
  - In `notifications/modes.ts`:
    - `startManagerMode(tx: Db, userId: string, groupId: string): Promise<void>`: insert `(userId, groupId, 'all', 'manager')` on conflict do nothing.
    - `stopManagerMode(tx: Db, userId: string, groupId: string): Promise<void>`: delete where `origin = 'manager'`.
    - `getEffectiveGroupMode(db: Db, actor: SessionUser, groupId: string): Promise<GroupMode>`.
    - `setGroupMode` writes `origin: 'user'` in both the insert and the conflict `set`.
    - `getModeSettings` returns `managerSet` (the group ids whose row has `origin = 'manager'`).
    - `setDefaultMode` is unchanged: it still deletes every row, manager rows included.

- [ ] **Step 1: Write the failing tests.**
  - `policy.test.ts`: `canBeManager: admin and superadmin yes, client no`.
  - `managers.test.ts`, with a new group and new admins per test:
    - `addManager is idempotent`: the second call gives `changed: false` and the same `managers`.
    - `a group has many managers and an admin manages many groups`: `managedGroupIds(a)` contains both groups, and `listGroupManagers(g)` returns both admins sorted by name.
    - `addManager refuses a client`: rejects with `NotAnAdminError`, and no row exists.
    - `a superadmin can become a manager and counts as one`.
    - `managedGroupIds and isGroupManager ignore a disabled admin and see them again when re-enabled` (use `deactivateUser`/`reactivateUser`).
    - `managedGroupsSql matches managedGroupIds`: `db.select({ id: groups.id }).from(groups).where(sql\`${groups.id} in ${managedGroupsSql(a)}\`)` gives the same ids.
    - The notification rule, row by row:
      - `no row: becoming manager inserts all/manager`;
      - `an existing user row (mentions) is kept` (mode and origin unchanged);
      - `stopping deletes a manager row`: `getModeSettings` has no override and the group is not in `managerSet`;
      - `stopping keeps a user row`;
      - `a bell change after becoming manager flips origin to user and survives stopping`: `setGroupMode(…, 'off')`, then `removeManager`, and the override stays `off`;
      - `setDefaultMode removes manager rows, and becoming manager again re-inserts all`;
      - `a manager with an all-groups default of off gets all for that group`: `getEffectiveGroupMode` returns `'all'`.
  - `modes.test.ts`: `getModeSettings returns managerSet with only manager-origin groups`.
  - `seed-managers.test.ts`:
    - Read the migration file and take the SQL between `-- seed group_managers: start` and `-- seed group_managers: end`.
    - Inside `db.transaction`, build the fixtures: an admin assigned to an open task; an admin assigned only to a completed task; an admin who wrote in a task chat 10 days ago; an admin whose only message is 61 days old (set `created_at`); a disabled admin assigned to an open task; a client who wrote today.
    - Run the SQL and assert that exactly the first and third admins are managers of the group, and that `group_notification_settings` has no row for any of them.
    - Throw at the end so the transaction rolls back, and catch it (other test files never see the rows).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/groups src/modules/notifications/modes.test.ts`. Expected: FAIL (`managers.js` not found, and `managerSet` is missing).
- [ ] **Step 3: Schema and migration.** Add `groupManagers` and `origin`, then run `pnpm --filter @spolu/server db:generate --name group_managers`. The existing rows default to `user`. Append the seed to the generated file after a `--> statement-breakpoint`, between the two marker comments:

  ```sql
  -- seed group_managers: start
  insert into "group_managers" ("group_id", "user_id")
  select t."group_id", ta."user_id"
    from "task_assignees" ta
    join "tasks" t on t."id" = ta."task_id"
    join "user" u on u."id" = ta."user_id"
   where t."completed_at" is null
     and u."role" in ('admin', 'superadmin') and u."disabled_at" is null
  union
  select c."group_id", m."author_id"
    from "messages" m
    join "channels" c on c."id" = m."channel_id"
    join "user" u on u."id" = m."author_id"
   where m."created_at" > now() - interval '60 days' and m."deleted_at" is null
     and u."role" in ('admin', 'superadmin') and u."disabled_at" is null
  on conflict do nothing;
  -- seed group_managers: end
  ```
- [ ] **Step 4: Implement** the shared schemas, `canBeManager`, `managers.ts` and the `modes.ts` changes from the Interfaces block.
  - `addManager` and `removeManager` each run one transaction.
  - `addManager` reads the user's `role` and `disabled_at` inside the transaction, so a client, a disabled user or an unknown id throws `NotAnAdminError`. It then inserts the row on conflict do nothing (`changed` = a row was inserted) and calls `startManagerMode` only when `changed`.
  - `removeManager` deletes the row and calls `stopManagerMode` only when a row was deleted.
  - Both return `listGroupManagers` read in the same transaction.
  - If Phase 17 is already on `main`, point its `managedGroupIdsOf` seam at `managedGroupIds`.
- [ ] **Step 5: Run the tests and the typecheck.** Run the vitest command from Step 2 and `pnpm --filter @spolu/server typecheck`. Expected: PASS.
- [ ] **Step 6: Docs.**
  - `data-model.md`: `group_managers` and `origin`.
  - `overview.md`: the helper table as the cross-module API.
  - `product/notifications.md`: the origin rule.
  - Glossary: "manager".
  - `runbooks/deploy.md`: a Phase 18 note. The migration seeds managers from open-task assignees and 60-day chat authors, and leaves their modes alone.
- [ ] **Step 7: Commit.** `feat(groups): group managers table, seed, helpers and manager mode origin`.

---

### Task 2: Readers and pickable people

Depends on: Task 1. Wave 2.

**Files:**
- Modify: `apps/server/src/modules/groups/service.ts` (`listGroupPeople`, new `listPickablePeople`, `isPickablePerson`), `service.test.ts`
- Modify: `apps/server/src/modules/groups/routes.test.ts` (`/people` carries `isManager`)
- Modify: `packages/shared/src/groups.ts` (`GroupPersonSchema.isManager`, `isPickable`)
- Docs: `docs/architecture/permissions.md` (readers vs pickable people), `docs/product/roles-and-access.md` (managers are a per-group flag, not a role), `docs/glossary.md` (pickable people)

**Interfaces:**
- Consumes: `groupManagers` (Task 1).
- Produces:
  - `GroupPersonSchema` gains `isManager: z.boolean()`. It is always `false` for clients.
  - `isPickable(person: GroupPerson): boolean` = `!person.isAdmin || person.isManager` (in `packages/shared/src/groups.ts`).
  - `listGroupPeople(db, groupId): Promise<GroupPerson[]>`: still the readers, with `isManager` from a left join on `group_managers` for this group. Still one query.
  - `listPickablePeople(db: Db, groupId: string): Promise<GroupPerson[]>` = `(await listGroupPeople(db, groupId)).filter(isPickable)`.
  - `isPickablePerson(db: Db, groupId: string, userId: string): Promise<boolean>`: one query. The user is a named, active member of the group, or an active admin with a `group_managers` row for it.
  - `isGroupPerson` is unchanged (readers). Phase 6's deliverer keeps using it.

- [ ] **Step 1: Write the failing tests** in `service.test.ts`, each with a new group, a named verified client, manager admin M (via `addManager`) and non-manager admin N:
  - `listGroupPeople returns readers with isManager`: the client has `isManager: false`, M has `true` and N has `false`, and N is still listed.
  - `listPickablePeople is the clients and the active managers`: the client and M only. After M is disabled, only the client.
  - `isPickablePerson`: client true, M true, N false, a client of another group false, disabled M false.
  - `a manager of another group is not pickable here`.
  - Route test: `GET /api/groups/:id/people` items carry `isManager`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/groups`. Expected: FAIL.
- [ ] **Step 3: Implement** the shared changes and the three service functions above.
- [ ] **Step 4: Run** the vitest command and `pnpm -r typecheck`. Expected: PASS. Web fixtures that build `GroupPerson` literals may need `isManager: false` to pass the typecheck; add it there and change nothing else.
- [ ] **Step 5: Docs.** Update `permissions.md`, `roles-and-access.md` and the glossary.
- [ ] **Step 6: Commit.** `feat(groups): pickable people (clients and managers) beside readers`.

---

### Task 3: Manager endpoints, groups list data and realtime

Depends on: Task 1. Wave 2.

**Files:**
- Modify: `apps/server/src/modules/groups/routes.ts`, `routes.test.ts`
- Modify: `apps/server/src/modules/groups/service.ts` (`listGroups` signature and query), `service.test.ts`
- Create: `apps/server/src/modules/groups/events.ts` (`emitManagers`)
- Modify: `apps/server/src/infra/realtime/rooms.ts` (`ADMINS_ROOM`), `socket.ts`, `socket.test.ts`
- Modify: `packages/shared/src/groups.ts` (`GroupSummarySchema`, `ManagersResponseSchema`, `GroupEvents`, `GroupManagersEvent`)
- Docs: `docs/architecture/realtime.md` (the `admins` room and `group:managers`), `docs/architecture/permissions.md` (the two routes and the policy)

**Interfaces:**
- Consumes: `addManager`, `removeManager`, `listGroupManagers`, `NotAnAdminError`, `canBeManager`, `getEffectiveGroupMode` (Task 1); `requireAdmin` (`auth/session.ts`); `createRateLimiter`.
- Produces:
  - `GroupSummarySchema` gains `managers: z.array(GroupManagerSchema)` and `managedByMe: z.boolean()`.
  - `ManagersResponseSchema = z.object({ managers: z.array(GroupManagerSchema), managedByMe: z.boolean(), mode: GroupModeSchema })` and `type ManagersResponse`.
  - `GroupEvents = { managers: 'group:managers' } as const`, and `type GroupManagersEvent = { groupId: string; managers: GroupManager[] }`.
  - `listGroups(db: Db, viewerId: string): Promise<GroupSummary[]>`.
  - `ADMINS_ROOM = 'admins'` in `rooms.ts`. Every socket whose user `isAdmin` joins it in the handshake, alongside the user and session rooms.
  - `emitManagers(io, event: GroupManagersEvent): void` sends to `groupRoom(groupId)` and `ADMINS_ROOM` in one `io.to([...]).emit` (each socket gets it once).
  - `PUT /api/groups/:id/managers/me` and `DELETE /api/groups/:id/managers/me`:
    - `requireAdmin`, then `canBeManager`, then a per-user rate limit of `createRateLimiter({ windowMs: 60_000, max: 120 })`.
    - An unknown group answers 404.
    - 200 `ManagersResponse` (`mode` from `getEffectiveGroupMode`).
    - `emitManagers` runs only when `changed`.

- [ ] **Step 1: Write the failing tests.**
  - `service.test.ts`:
    - `listGroups returns managers by name and managedByMe for the viewer`.
    - `two managers do not change memberCount` (guards against row multiplication).
    - `a disabled manager is not in managers`.
    - `listGroups is one statement`: use the counting `drizzle(client, { logger: { logQuery } })` pattern from `chat/messages.test.ts` and expect `statements === 1`.
  - `routes.test.ts`:
    - `PUT managers/me makes the caller a manager and answers mode all`, then `GET /api/groups` shows `managedByMe: true`.
    - `PUT twice is 200 both times`.
    - `DELETE answers managedByMe false and mode mentions`.
    - `a client gets 403 on both`.
    - `an unknown group gets 404`.
  - `socket.test.ts`:
    - `an admin socket joins the admins room, a client socket does not`.
    - `group:managers reaches the group room and the admins room, not a client of another group`. Connect an admin, the group's client and another group's client, call PUT, and assert who received the event and its payload.
    - `an unchanged PUT emits nothing`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/groups src/infra/realtime`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `listGroups` keeps its member-count join. It adds a left join to a pre-aggregated subquery over `group_managers ⋈ user` (active admins only), grouped by `group_id`, that yields `json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name, u.id)` and `bool_or(gm.user_id = ${viewerId})`. Use `coalesce(…, '[]')` and `coalesce(…, false)`. Aggregating first keeps the member count correct.
  - `GET /groups` passes `request.user!.id`.
  - Add the routes, `emitManagers` and the admins room join.
- [ ] **Step 4: Run** the vitest command and `pnpm -r typecheck`. Expected: PASS. Web fixtures building `GroupSummary` may need `managers: [], managedByMe: false` to pass; add only that.
- [ ] **Step 5: Docs.** Update `realtime.md` (the room, the event, its payload and when it is sent) and `permissions.md` (the routes).
- [ ] **Step 6: Commit.** `feat(groups): become or stop being a manager, managers in the groups list, admins room`.

---

### Task 4: Chat mentions and @all use pickable people

Depends on: Task 2. Wave 3.

**Files:**
- Modify: `apps/server/src/modules/chat/messages.ts` (`sendMessage`, `editMessage`), `messages.test.ts`, `routes.test.ts`
- Docs: `docs/product/chat.md` (@all and the picker list)

**Interfaces:**
- Consumes: `listGroupPeople`, `isPickable` (Task 2), `addManager` (Task 1, in tests).
- Produces: no new exports. Behavior:
  - `sendMessage` calls `listGroupPeople` once.
    - The pickable subset (`people.filter(isPickable)`) validates new mentions and is the @all recipient list.
    - `chat.message` and the `threadPeople` filter keep every reader.
    - `nameById` (excerpts) keeps every reader.
  - `editMessage` accepts the pickable ids plus the mentions already stored on the message.

- [ ] **Step 1: Write the failing tests** in `messages.test.ts`, with a group, a named client C, manager M and non-manager N:
  - `mentioning a non-manager admin throws InvalidMentionError`. In `routes.test.ts`: `POST answers 400 invalid_mention`.
  - `mentioning a manager works`.
  - `editing a message that mentions a former manager keeps working`: M is mentioned, then `removeManager`, then the edit keeps the M mention and the text changes.
  - `editing to add a non-manager mention throws`.
  - `@all records chat.mention for clients and managers only`: when C sends `@all`, M has a `chat.mention` event and N does not.
  - `chat.message still reaches every reader`: N has a `chat.message` event for a top-level message.
  - `a non-manager admin in a thread still gets chat.thread_reply` (Review Focus).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/chat`. Expected: FAIL on the non-manager mention and @all cases.
- [ ] **Step 3: Implement** the behavior in the Interfaces block. Update the `editMessage` doc comment ("validated against the pickable people").
- [ ] **Step 4: Run** the chat tests. Expected: PASS, and all existing chat tests still pass.
- [ ] **Step 5: Docs.** In `product/chat.md`: @all reaches clients and managers, and the picker lists clients and managers.
- [ ] **Step 6: Commit.** `feat(chat): mentions and @all reach clients and managers only`.

---

### Task 5: Task assignees and the AI split use pickable people

Depends on: Task 2. Wave 3.

**Files:**
- Modify: `apps/server/src/modules/tasks/task-service.ts` (`checkAssignees`), `task-service.test.ts`, `task-routes.test.ts`
- Modify: `apps/server/src/modules/ai/split.ts` (`buildSplitRequest`), `split.test.ts`
- Modify: `apps/web/src/features/task-split/review-dialog.tsx`, `review-dialog.test.tsx` (the `invalid_assignee` answer)
- Modify: the `tasks` namespace (en, sk)
- Docs: `docs/product/task-board.md` (assignees), `docs/product/ai-task-split.md` (the people list)

**Interfaces:**
- Consumes: `isPickablePerson`, `listPickablePeople` (Task 2); `addManager`, `removeManager` (Task 1, in tests).
- Produces:
  - `checkAssignees` uses `isPickablePerson`. `updateTask` already checks only ids not on the task, so an existing assignment is kept.
  - `buildSplitRequest` uses `listPickablePeople`, so `people` and `allowed.peopleIds` hold only pickable people.
  - Copy: `tasks.form.errors.assigneeNotAllowed` = "Someone you chose can't be assigned here any more."

- [ ] **Step 1: Write the failing tests.**
  - `task-service.test.ts`:
    - `assigning a non-manager admin throws InvalidAssigneeError`.
    - `assigning a manager works`.
    - `editing a task whose assignee is no longer a manager keeps them`: assign M, then `removeManager`, then `updateTask` with a new title and the same `assigneeIds` succeeds.
    - `re-adding a former manager after removing them throws`.
    - `createTasksFromMessage refuses a non-pickable assignee` (Review Focus).
    - In `task-routes.test.ts`: `POST with a non-manager assignee answers 400 invalid_assignee`.
  - `split.test.ts`:
    - `the prompt lists pickable people only`: `buildSplitRequest(...).people` has C and M, not N.
    - `a proposal naming a non-manager admin is dropped`.
    - `the message text still names a mentioned non-manager`: `text` contains `@N's name`, because `withNames` falls back to the user lookup.
  - `review-dialog.test.tsx`: `the review dialog shows the assignee error and refetches people` (Review Focus). On 400 `invalid_assignee`, the dialog shows `tasks.form.errors.assigneeNotAllowed` and invalidates `['groups', groupId, 'people']`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/tasks src/modules/ai` and `pnpm --filter @spolu/web exec vitest run src/features/task-split`. Expected: FAIL.
- [ ] **Step 3: Implement.** Swap the two server calls and update `checkAssignees`'s doc comment. In the review dialog, map `invalid_assignee` to the copy and invalidate the people query.
- [ ] **Step 4: Run** both commands. Expected: PASS.
- [ ] **Step 5: Docs.** Update `task-board.md` (assignees are clients and managers; existing assignments are kept) and `ai-task-split.md`.
- [ ] **Step 6: Commit.** `feat(tasks): assignees and AI split limited to clients and managers`.

---

### Task 6: Groups page manager toggle, avatars, live updates and the bell line

Depends on: Task 3. Wave 3.

**Files:**
- Create: `apps/web/src/features/groups/manager-toggle.tsx`, `manager-toggle.test.tsx`, `manager-avatars.tsx`, `use-manager-events.ts`, `use-manager-events.test.tsx`
- Modify: `apps/web/src/features/groups/api.ts` (`becomeManager`, `stopManaging`), `groups-page.tsx`, `groups-page.test.tsx`
- Modify: `apps/web/src/features/auth/authed-layout.tsx` (mount `useManagerEvents()`)
- Modify: `apps/web/src/features/notifications/mode-menu.tsx` (or `GroupBell`) and its test, for the manager line
- Modify: the `groups` and `notifications` namespaces (en, sk)
- Docs: `docs/design/tokens.md` (the manager toggle and the avatar stack)

**Interfaces:**
- Consumes: `GroupSummary.managers` / `managedByMe`, `ManagersResponseSchema`, `GroupEvents`, `GroupManagersEvent` (Task 3); `NotificationModes.managerSet` (Task 1); `notificationModesQuery`, `GroupBell` (Phase 6); `Toast`; `useSession`.
- Produces:
  - `becomeManager(groupId: string): Promise<ManagersResponse>` (PUT) and `stopManaging(groupId: string): Promise<ManagersResponse>` (DELETE), at `/groups/:id/managers/me`.
  - `ManagerToggle({ group }: { group: GroupSummary })`.
    - A `Button size="sm"`, `aria-pressed={managedByMe}`, accessible name `groups.managers.toggleLabel` ("Manage {{name}}") in both states.
    - The visible text is "Manage" (secondary pill) or "Managing" with a check (filled ink pill).
    - It sits outside the row's `Link` and calls `stopPropagation`.
    - Optimistic: patch the `['groups']` entry (`managedByMe`, and add or remove me in `managers`), and set `['notifications','modes']` to the answer's `mode` for that group (an `override`, plus `managerSet` updated).
    - Clicks are serialized per group: a click while a request is pending is queued and sent after it, and only the last answer sets the state.
    - On any non-2xx it rolls back to the state before the first queued click and shows `groups.managers.error`.
    - Toast:
      - start: `groups.managers.started` ("You manage {{name}} now.") plus `groups.managers.startedMode` ("Notifications: all messages.") when the mode changed;
      - stop: `groups.managers.stopped` ("You no longer manage {{name}}.") plus `groups.managers.stoppedMode` ("Notifications: {{mode}}") when the mode changed, with `{{mode}}` the mode's label from `notifications.mode.*`.
  - `ManagerAvatars({ managers, groupName })`: up to 3 overlapping 24 px `Avatar`s, then `+N` (`groups.managers.more`), and a visually hidden list labelled `groups.managers.listLabel` ("Managers of {{name}}"). It renders nothing when the list is empty.
  - `useManagerEvents(): void`, mounted once in the authed layout. On `group:managers` it:
    - invalidates `['groups', groupId, 'people']`;
    - patches `managers` and recomputes `managedByMe` from the session id in the `['groups']` cache, if it is loaded;
    - invalidates `['notifications','modes']` when the session user was added or removed.
  - Bell: when `managerSet` contains the group, the mode menu shows one muted line under the options: `notifications.mode.managerNote` ("All messages, because you manage this client.").
  - The groups page shows the hint `groups.managers.noManagerHint` ("Clients with no manager: only their own people can be mentioned or assigned.") under the list.
- Copy (en; sk to match). The keys above, plus `groups.managers.manage` "Manage", `groups.managers.managing` "Managing", `groups.managers.error` "Could not change it. Try again.".

- [ ] **Step 1: Write the failing tests.**
  - `manager-toggle.test.tsx`:
    - `shows Manage with aria-pressed false and Managing with aria-pressed true`.
    - `clicking does not navigate`.
    - `the click updates at once while PUT is pending` (hold the response).
    - `a failed PUT rolls back and shows the error`.
    - `a second click while the first is pending is applied after it, and the final state matches the last click` (Review Focus): two clicks lead to PUT then DELETE in that order, and `aria-pressed` ends false.
    - `becoming manager sets the bell to all and toasts with the notifications line`.
    - `stopping with an own mode toasts without the notifications line`.
  - `groups-page.test.tsx`:
    - `rows show up to 3 manager avatars and +N`.
    - `a row with no managers shows no avatars`.
    - `the no-manager hint is shown`.
  - `use-manager-events.test.tsx`:
    - `an event patches the groups list and invalidates the people query`.
    - `an event naming me invalidates modes`.
  - Mode menu test: `shows the manager line when the group is in managerSet, not otherwise`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/groups src/features/notifications`. Expected: FAIL.
- [ ] **Step 3: Design pass.** Invoke `frontend-design:frontend-design` for the toggle (both states, focus ring, ≥ 44 px hit area on phones), the avatar stack and the row wrap under 641 px. On a phone the row has two lines: logo, name and unread on the first; avatars, toggle, bell and members on the second.
- [ ] **Step 4: Implement** the Interfaces block. The row stays a `Link` with sibling controls, as Phase 6 laid out for the bell.
- [ ] **Step 5: Run** the web tests and `pnpm --filter @spolu/web build`. Expected: PASS, and the eager JS ≤ 200 kB gzip (the new code is in the groups page and authed-layout chunks).
- [ ] **Step 6: Docs.** Add the toggle and the avatar stack to `tokens.md`.
- [ ] **Step 7: Commit.** `feat(web): become a client's manager from the groups page`.

---

### Task 7: Pickers, the "not a manager" chip, error recovery and the Members tab

Depends on: Task 2. Wave 3.

**Files:**
- Modify: `apps/web/src/features/chat/composer.tsx`, `mention-picker.tsx`, `composer.test.tsx`
- Modify: `apps/web/src/features/chat/use-channel-messages.ts` and `message-item.tsx` (a failed send's reason), with their tests
- Modify: `apps/web/src/features/tasks/assignee-select.tsx`, `task-form.test.tsx` (or a new `assignee-select.test.tsx`), `task-panel.tsx`, `task-create-panel.tsx`
- Create: `apps/web/src/features/groups/managers-section.tsx`, `managers-section.test.tsx`
- Modify: `apps/web/src/features/groups/members-tab.tsx`
- Modify: the `chat`, `tasks` and `groups` namespaces (en, sk)

**Interfaces:**
- Consumes: `GroupPerson.isManager`, `isPickable` (Task 2); `useGroupPeople`; `useSession`/`isAdmin`.
- Produces:
  - The composer passes `people.filter(isPickable)` to `MentionPicker`. `nameOf` and the message list keep the full readers list.
  - `MentionPicker`'s "Everyone" row gains the hint `chat.mention.everyoneHint` ("The group's clients and its eGrant managers").
  - Failed sends: the pending row gets `failReason?: 'invalid_mention'`, set when the POST answers 400 `invalid_mention`.
    - The failed row shows `chat.composer.mentionNotAllowed` ("Someone you mentioned can't be mentioned here any more.") instead of the generic failure line. The row's text stays, and so do the existing failed-row actions.
    - The people query is invalidated.
  - Edit mode: on `invalid_mention` the composer keeps the text, shows the same line and invalidates the people query.
  - `AssigneeSelect`:
    - The options are `people.filter(isPickable)`.
    - A chosen id that is a reader but not pickable keeps its chip (name, avatar, "eGrant" pill) plus a muted `tasks.assignee.notManager` ("not a manager"), and it can be removed.
    - The "(removed)" case is unchanged.
    - When there are no options and the viewer is a non-manager admin, the empty line is `tasks.form.noPickablePeople` ("Only clients and the client's managers can be assigned.").
  - The task panel and the create panel map `invalid_assignee` to `tasks.form.errors.assigneeNotAllowed` (the key from Task 5; add it here too if Task 5 has not merged yet) and invalidate the people query.
  - `ManagersSection({ groupId })` sits above the members list.
    - Title `groups.managers.title` ("eGrant managers"), then avatar and name per manager, from `useGroupPeople` filtered on `isManager`.
    - Empty: `groups.managers.none` ("No eGrant manager yet.").
    - Admins also get the link `groups.managers.changeLink` ("Change on the Groups page") to `/groups`.

- [ ] **Step 1: Write the failing tests.**
  - `composer.test.tsx`:
    - `the mention picker lists clients and managers, not other admins`.
    - `the Everyone row shows the clients-and-managers hint`.
    - `an edit refused with invalid_mention keeps the text, shows the line and refetches people`.
  - `use-channel-messages.test.tsx`: `a send refused with invalid_mention marks the row failed with that reason and refetches people`.
  - `message-list.test.tsx`: `a failed row with reason invalid_mention shows the mention line`.
  - Assignee tests:
    - `the list offers clients and managers only`.
    - `an existing non-manager assignee shows a chip with not a manager and can be removed, and is not offered again`.
    - `a non-manager admin with an empty list sees the only-clients-and-managers line`.
    - `invalid_assignee on save shows the line and refetches people`.
  - `managers-section.test.tsx`:
    - `lists managers with avatars`.
    - `shows No eGrant manager yet`.
    - `admins see the Groups page link, clients do not`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/chat src/features/tasks src/features/groups`. Expected: FAIL.
- [ ] **Step 3: Design pass.** Invoke `frontend-design:frontend-design` for the "not a manager" note in the chip and the managers section, reusing the members list's row style.
- [ ] **Step 4: Implement** the Interfaces block.
- [ ] **Step 5: Run** the web tests and `pnpm --filter @spolu/web build`. Expected: PASS, and the eager JS ≤ 200 kB gzip.
- [ ] **Step 6: Docs.** In `docs/product/chat.md` and `task-board.md`, add one line each on the picker hints. Merge it with Task 4's and Task 5's lines if those are already on the branch.
- [ ] **Step 7: Commit.** `feat(web): pickers list clients and managers; managers on the Members tab`.

---

### Task 8: End-to-end check and phase close

Depends on: Tasks 4, 5, 6, 7. Wave 4.

**Files:**
- Create: `e2e/managers.spec.ts`
- Docs: `docs/product/client-managers.md` (status: built in Phase 18; note the seed), `docs/architecture/overview.md` (confirm the helper table matches the code)

**Interfaces:**
- Consumes: everything above. Use the e2e fixtures in `e2e/fixtures` to create two admins and a client with unique emails.

- [ ] **Step 1: Write the e2e test** `admin A manages a client; pickers, @all and live updates follow`, in two browser contexts:
  1. A opens Groups, clicks "Manage" on a new group, and sees "Managing" and the bell at All.
  2. B (not a manager) opens that group's chat and types `@`. The picker shows the client and A, not B.
  3. B sends `@all`. Query `notification_events` in `spolu_e2e` for this message: A has `chat.mention`, and B has no `chat.mention`.
  4. The client has the chat open. A clicks "Managing" to stop, and the client's next `@` picker no longer shows A, without a reload.
  5. A task assigned to B earlier (created through the API before step 1) still shows B on the board.
- [ ] **Step 2: Run it.** Run `pnpm test:e2e -- e2e/managers.spec.ts`. Expected: PASS. If it fails, fix the owning task's code on this branch with a test first.
- [ ] **Step 3: Run the whole suite.** Run `pnpm -r typecheck`, `pnpm test`, `pnpm --filter @spolu/web build` (eager ≤ 200 kB) and `pnpm test:e2e`. Expected: all PASS.
- [ ] **Step 4: Docs.** Set the status in `product/client-managers.md`. The controller adds the `roadmap.md` row.
- [ ] **Step 5: Commit.** `test(e2e): client managers across two admins`.
