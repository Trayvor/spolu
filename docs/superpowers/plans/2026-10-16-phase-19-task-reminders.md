# Phase 19 — Task Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone working on a task can set their own reminder times on it, for themselves and the people they add, others can subscribe, and the deadline plus the custom times export as one `.ics`, while the Phase 6 automatic deadline and urgent reminders stay unchanged.

**Architecture:**
- The tasks module registers a `task` subject with Phase 17's reminders registry. The reminders module learns three things: a stand-alone `PUT` that replaces the times of a subject with `baseTimeIds` protection, "editors become recipients", and an all-day deadline event in `buildIcs`.
- The fire job is unchanged apart from a post-commit hook that pushes `reminders:task` to the group room, so the board's card bell follows. Task reminder pushes use the URL and the tag `task:<taskId>` of the automatic task reminders.
- On the web, a reminders section in the task panel's Details tab saves each change on its own (not through `TaskDraft`). It is built from Phase 17's `ReminderPanel`, `RecipientsField` and `localToIso`. The board card shows a 14 px bell from one new aggregate in the existing board query.

**Tech Stack:** Fastify 5, Drizzle + drizzle-kit, PostgreSQL 17, pg-boss 12, Socket.IO, React 19, TanStack Router and Query, i18next, zod, Vitest, Playwright. There are no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-phase-19-task-reminders-design.md`, with the rulings in `docs/superpowers/specs/2026-10-16-phases-17-20-brief.md`. Where they conflict, the rulings win. Phase 17's names come from `docs/superpowers/plans/2026-10-16-phase-17-knowledge-base.md`.

## Global Constraints

- Branch `phase-19`, cut from `main` **after Phase 17 has merged**. It is independent of Phase 18.
- **Rulings that override the spec:**
  - Explicit reminder recipients (the author, people added, self-subscribers) get `reminder.due` **even when their group mode is Off**. Phase 17's `passesMode` already does this; this phase does not change it. Every task reminder recipient is explicit.
  - The automatic deadline and urgent reminders **cannot be turned off** in this phase. No setting, no flag, no UI for it.
- **One migration**, created in Task 1 with `pnpm --filter @spolu/server db:generate --name task_reminders`. It takes the next free number. No later task changes a `schema.ts`.
- English everywhere in code, comments, docs and commits. Every UI string is an i18n key with copy in **both** `en` and `sk`.
  - Reminder strings live in the lazy namespace `reminders` (`apps/web/src/features/reminders/locales/{en,sk}.json`). Task 5 adds the section `row`, Task 6 the section `task`. Each task adds keys only inside its own section.
  - The card bell label goes into the tasks locale files (`apps/web/src/features/tasks/locales/{en,sk}.json`, beside `card.files`).
  - Nothing goes into the eager locale files.
- Server copy for push and `.ics` goes in `modules/notifications/texts.ts`, in sk and en.
- **Performance first.** The eager JS budget is **200 kB gzip**, and this phase may add at most **0.2 kB gzip** to it.
  - The reminders section is in the lazy task panel chunk. The shared reminder components come from the chunk Phase 17 split out.
  - The board stays one task query: the reminder count is a correlated aggregate on indexed columns. No per-card fetch.
- **Reuse Phase 17's pieces:** `ReminderPanel`, `RecipientsField`, `localToIso`/`isoToLocal`, `formatReminderDate`, `CalendarLeaf`, `subscribeReminder`/`unsubscribeReminder`/`reminderCalendarUrl`, `replaceReminderSet`, `getReminderSet`, `buildIcs`/`buildIcsText`, `fireDueReminders`, `listUpcomingForUser`, `loadNamespace`. No second panel, picker, `.ics` writer or fire job.
- **UI tasks start by invoking `frontend-design:frontend-design`**, on the egrant.sk tokens in `docs/design/tokens.md` and `components/ui/*`. No fancy effects. Phones: every control at least 44 px.
- **Test-first** (`superpowers:test-driven-development`). Every code step follows a failing test.
- **Tests share the databases** `spolu_test` and `spolu_e2e`. Use unique emails (`${randomUUID()}@example.com`) and unique group URLs. Never truncate a table and never assume one is empty. Calls to `fireDueReminders` always pass `setIds`.
- Modules talk only through exported service functions. Permissions are checked server-side, only through policy functions (`canUseBoard`). Writes go through HTTP. Sockets push only after the commit.
- Errors are `{ error: '<code>' }`, with Phase 17's codes only: `invalid_reminder`, `reminder_in_past`, `invalid_recipient`, `author_recipient`.
- **Docs ship in the same commit** as the code they describe (`update-kb` skill). Run `pnpm exec prettier --check <files>` before each commit.
- Every commit message ends with exactly this line:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- Test commands:
  - server: `pnpm --filter @spolu/server exec vitest run <path>`;
  - shared: `pnpm --filter @spolu/shared exec vitest run <path>`;
  - web: `pnpm --filter @spolu/web exec vitest run <path>`;
  - e2e: `pnpm test:e2e -- <spec>`;
  - everything: `bash scripts/ci.sh`.

## Review Focus

- **Someone removes a time while another person adds one.** B's `PUT` still lists the time A just removed (same id, in B's `baseTimeIds`). The save must succeed, the removed time must not come back, and B's new time is kept. Test in Task 2: `a time removed by someone else is neither re-created nor an error`.
- **Adding a time while someone else changes the recipients.** A `PUT` that only adds a time must not undo a recipient another person added a second earlier. The panel omits `recipientIds` unless the recipients changed. Test in Task 2: `a PUT without recipientIds keeps the added recipients`.
- **A deadline on the last day of a month or year.** The all-day event must end on the next calendar day: 2026-12-31 gives `DTEND;VALUE=DATE:20270101`. Test in Task 2: `the deadline event ends the next day across a year end`.
- **A reminder late in the evening of the deadline day.** "after the deadline" compares local calendar dates, not UTC: 23:30 on the deadline day is not tagged, 00:30 the next day is. Test in Task 6: `the after-the-deadline tag compares local dates`.
- **A task renamed after the reminder was set.** The push must show the current title, as the automatic task reminders do. Test in Task 3: `a renamed task's reminder push shows the current title`.

---

## Waves

| wave | tasks (run in parallel) |
|---|---|
| 1 | Task 1 (contracts, migration, board count) |
| 2 | Task 2 (reminders service and `.ics`), Task 5 (shared reminder components), Task 7 (card bell) |
| 3 | Task 3 (task subject, push, fire job, realtime hook), Task 6 (task panel section) |
| 4 | Task 4 (HTTP routes) |
| 5 | Task 8 (e2e, budget, phase docs) |

Web tasks 5–7 mock the HTTP layer and the socket, so they do not wait for the server routes.

---

### Task 1: Shared contracts, migration and the board's reminder count

Depends on: none

**Files:**
- Modify: `packages/shared/src/reminders.ts`, `packages/shared/src/reminders.test.ts` (create if missing), `packages/shared/src/tasks.ts`
- Modify: `apps/server/src/modules/reminders/schema.ts`, `apps/server/src/modules/reminders/schema.test.ts` (create if missing)
- Create: `apps/server/src/infra/db/migrations/<next>_task_reminders.sql` (generated)
- Modify: `apps/server/src/infra/db/client.ts` (`onQuery` option), `apps/server/src/modules/tasks/service.ts` (`selectTasks`), `apps/server/src/modules/tasks/service.test.ts`
- Create: `apps/server/test/query-counter.ts`
- Modify: every `TaskDto` fixture in server and web tests (`grep -rn "fileCount:" apps/*/src apps/*/test`), adding `upcomingReminders: 0`
- Docs: `docs/architecture/data-model.md` (`reminder_sets.task_id`, the widened CHECK), `docs/roadmap.md` (Phase 19 row "in progress" linking the spec and this plan, and its section)

**Interfaces:**
- Consumes: Phase 17's `reminderSets`, `reminderTimes`, `ReminderSetDtoSchema`, `ReminderDuePayload` (it already has `taskId?`), `UpcomingReminder`; the tasks table `tasks`.
- Produces (`packages/shared/src/reminders.ts`):
  - `ReminderSubjectKind = 'knowledge' | 'task'`.
  - `ReminderPutSchema = z.object({ times: z.array(z.object({ id: z.string().optional(), at: z.iso.datetime({ offset: true }) })).max(20), recipientIds: z.array(z.string()).max(50).transform(unique).optional(), baseTimeIds: z.array(z.string()).max(20).default([]) })`, `ReminderPut = z.output<…>`. Zero times is valid. `recipientIds` omitted means "recipients unchanged".
  - `UpcomingReminder.target` becomes `{ kind: 'knowledge'; itemId: string } | { kind: 'task'; taskId: string }`.
  - `RemindersEvents = { task: 'reminders:task' } as const` and `TaskRemindersEvent = { groupId: string; taskId: string; upcomingReminders: number }`.
- Produces (`packages/shared/src/tasks.ts`): `TaskDtoSchema` gains `upcomingReminders: z.number().int()`. `TaskDraftSchema`, `TaskCreateSchema` and `TaskPatchSchema` do not change.
- Produces (schema): `reminderSets.taskId`, column `task_id`, the same type as `tasks.id`, nullable, `unique()`, FK `tasks.id` `onDelete: 'cascade'`. Phase 17's CHECK on `reminder_sets` becomes `num_nonnulls(knowledge_item_id, task_id) = 1` (same constraint name). No backfill.
- Produces (`client.ts`): `createDb(databaseUrl: string, opts?: { onQuery?: (query: string) => void })`, passing postgres-js `debug: (_conn, query) => opts.onQuery?.(query)` only when set.
- Produces (`test/query-counter.ts`): `createCountingDb(): { db: Db; count(): number; reset(): void; close(): Promise<void> }` on the test database URL.
- Produces (`selectTasks`): a new column, with a comment that it is the same read-only exception as the `user` join:
  ```sql
  (select count(*)::int from reminder_sets s join reminder_times t on t.set_id = s.id
   where s.task_id = tasks.id and t.fired_at is null) as upcoming_reminders
  ```
  This uses the unique index on `task_id` and `reminder_times_set_at_idx`.

- [ ] **Step 1: Write the failing tests.**
  - `reminders.test.ts` (shared):
    - `ReminderPutSchema accepts zero times and no recipientIds` (`recipientIds` is `undefined`, `baseTimeIds` is `[]`);
    - `ReminderPutSchema refuses 21 times`.
  - `reminders/schema.test.ts`:
    - `a reminder set with both a knowledge item and a task violates the check`;
    - `a reminder set with neither violates the check`;
    - `deleting a task deletes its reminder set and times`.
  - `tasks/service.test.ts`:
    - `the board counts unfired custom reminders per task`: a task with 2 unfired times and 1 fired gives `upcomingReminders` 2, a task without a set gives 0;
    - `the board query count does not change with reminders`: with `createCountingDb`, `getBoard` on a group without reminders and on one with reminders issue the same number of queries.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/shared exec vitest run src/reminders.test.ts` and `pnpm --filter @spolu/server exec vitest run src/modules/reminders/schema.test.ts src/modules/tasks/service.test.ts`. Expected: FAIL (`task_id` and `upcomingReminders` do not exist).
- [ ] **Step 3: Implement** the contracts, the column and CHECK, then run `pnpm --filter @spolu/server db:generate --name task_reminders`. Add `onQuery`, the counter helper and the `selectTasks` column. Add `upcomingReminders: 0` to the `TaskDto` fixtures.
- [ ] **Step 4: Run the tests again,** plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(reminders): task subject column and board reminder count`.

---

### Task 2: Reminders service — stand-alone edits, editors as recipients, deadline event

Depends on: Task 1

**Files:**
- Modify in `apps/server/src/modules/reminders/`: `subjects.ts`, `service.ts`, `service.test.ts`, `ics.ts`, `ics.test.ts`
- Modify: `apps/server/src/modules/notifications/texts.ts` (`deadlineEvent`)
- Docs: `docs/product/reminders.md` (who becomes a recipient on a task; concurrent edits; the deadline in the calendar file)

**Interfaces:**
- Consumes: Phase 17's `replaceReminderSet`, `getReminderSet`, `subscribe`, `buildIcs`, `buildIcsText`, `icsFilename`, `listUpcomingForUser`, `registerReminderSubject`, `getReminderSubject`; `ReminderPut` (Task 1).
- Produces (`subjects.ts`):
  - `SubjectInfo` gains `dueDate?: string | null` (`YYYY-MM-DD`; set by subjects that have a deadline).
  - `ReminderSubject` gains three optional fields, all absent for knowledge:
    - `standaloneEdit?: boolean`: the subject's times are edited through `PUT …/reminders` (Task 4);
    - `addEditorsAsRecipients?: boolean`;
    - `onTimesChanged?: (deps: { db: Db; io: SocketIOServer }, ids: string[]) => Promise<void>` (used by Task 3).
  - `subjectColumn('task')` returns `reminderSets.taskId`.
- Produces (`service.ts`):
  - `replaceReminderSet(tx, subject, input: { times: { id?: string; at: string }[]; recipientIds?: string[]; baseTimeIds?: string[] }, actor, now = new Date())`. The signature is otherwise Phase 17's. New rules:
    - `baseTimeIds` set: only unfired times whose id is in `baseTimeIds` and missing from `times` are deleted. An unfired time not in `baseTimeIds` is kept.
    - `baseTimeIds` set: an input id in `baseTimeIds` that no longer exists is dropped silently (someone else removed it). An id that never was in `baseTimeIds` and does not exist is still `InvalidReminderError`.
    - `baseTimeIds` undefined: Phase 17's behaviour, unchanged (knowledge).
    - `recipientIds` undefined: the `added` rows are left as they are.
    - The 20-time limit counts the unfired times after the merge, including ones others added.
    - When the subject's adapter has `addEditorsAsRecipients` and the input adds a new time: an actor who is not the author and has no recipient row gets `source 'added'`, `added_by` = actor. This runs after the `recipientIds` replacement, so it is not undone by it.
    - On a subject with no set and no input times, it writes nothing.
  - `getSetAuthorId(db: Db, subject: ReminderSubjectRef): Promise<string | null>`: the set's `created_by`, or null when there is no set.
  - `emptyReminderSet(canEdit: boolean): ReminderSetDto` returns `{ times: [], recipients: [], subscribed: false, canEdit }`.
  - `subscribe` on a subject with no set throws `InvalidReminderError` (there is nothing to subscribe to).
  - `buildIcs(db, subject, actor, publicUrl, now = new Date(), lang: UserLanguage = 'en')`. When `info.dueDate` is set it adds, before the timed events, the event `{ uid: 'task-<id>-deadline@spolu', date: info.dueDate, title: texts(lang).deadlineEvent(info.title), description: <plain body, first 1000 characters>, url: <publicUrl + info.link> }`. It returns null only when there is no deadline event and no upcoming time.
  - `listUpcomingForUser` sets `target` from the subject kind: `{ kind: 'task', taskId }` for tasks.
- Produces (`ics.ts`): the event type becomes `IcsEvent = { uid: string; title: string; description: string; url: string } & ({ start: Date } | { date: string })`. A `date` event writes `DTSTART;VALUE=DATE:YYYYMMDD`, `DTEND;VALUE=DATE:<date + 1 day>` and no `VALARM`. A `start` event is unchanged.
- Produces (`texts.ts`): `deadlineEvent(title)`: "Deadline: {title}" / "Termín: {title}".

- [ ] **Step 1: Write the failing tests.** In `service.test.ts`, register a stub `task` subject over real `tasks` rows inserted through the table (unique group, admin and client per test), with `standaloneEdit` and `addEditorsAsRecipients` true.
  - `ics.test.ts`:
    - `a date event is all-day with the next day as end and no alarm`: `2026-10-20` gives `DTSTART;VALUE=DATE:20261020` and `DTEND;VALUE=DATE:20261021`;
    - `the deadline event ends the next day across a year end`: `2026-12-31` gives `DTEND;VALUE=DATE:20270101`.
  - `service.test.ts`:
    - `the first time creates the set with the actor as author`;
    - `a second editor who adds a time becomes added, by themselves`;
    - `an editor who only removes a time does not become a recipient`;
    - `fired times are kept`;
    - `times added concurrently by others survive a PUT that did not know them`;
    - `a time removed by someone else is neither re-created nor an error`;
    - `a PUT without recipientIds keeps the added recipients`;
    - `the 21st unfired time counts others' times` (`InvalidReminderError`);
    - `zero times on a task without a set writes nothing`;
    - `knowledge without baseTimeIds still deletes missing unfired times` (the Phase 17 rule is unchanged);
    - `subscribe without a set is invalid_reminder`;
    - `buildIcs for a task has the deadline event then the timed events`;
    - `buildIcs with a deadline and no times is not null`; `with neither it is null`;
    - `the deadline summary follows the requester's language` (`Termín: …` for `sk`);
    - `listUpcomingForUser gives task targets`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/reminders`. Expected: FAIL on the new cases; Phase 17's cases still pass.
- [ ] **Step 3: Implement** the changes above. `replaceReminderSet` stays at most five statements: upsert the set, read the times, write the diff, replace the `added` rows when `recipientIds` is given, add the editor row.
- [ ] **Step 4: Run the tests again,** the whole `src/modules/reminders` and `src/modules/knowledge` folders. Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(reminders): stand-alone edits, editors as recipients and deadline event`.

---

### Task 3: The task subject, task reminder pushes and the fire job's realtime hook

Depends on: Task 1, Task 2

**Files:**
- Create: `apps/server/src/modules/tasks/reminder-subject.ts`, `reminder-subject.test.ts`
- Create: `apps/server/src/modules/reminders/realtime.ts`
- Modify: `apps/server/src/modules/reminders/jobs.ts`, `jobs.test.ts` (task cases)
- Modify: `apps/server/src/modules/notifications/push-content.ts`, `push-content.test.ts`, `texts.ts`, `deliver.ts` (pass `now`)
- Modify: `apps/server/src/deps.ts`, `apps/server/src/app.ts` (register the subject; attach realtime)
- Create: `apps/server/src/modules/tasks/reminders-coexist.test.ts`
- Docs: `docs/product/notifications.md` (task reminder notifications, shared tag), `docs/architecture/overview.md` (the task reminder subject), `docs/architecture/permissions.md` (task reminders follow `canUseBoard`), `docs/architecture/realtime.md` (`reminders:task`)

**Interfaces:**
- Consumes: `registerReminderSubject`, `SubjectInfo`, `fireDueReminders`, `REMINDERS_FIRE_JOB` (Phase 17); `canUseBoard` (tasks policy); `emitToGroup`; `recordDeadlineReminders` (Phase 6); `TaskRemindersEvent`, `RemindersEvents` (Task 1).
- Produces (`modules/tasks/reminder-subject.ts`):
  - `registerTaskReminderSubject(): void` registers `{ kind: 'task', routePrefix: 'tasks', standaloneEdit: true, addEditorsAsRecipients: true, loadMany, onTimesChanged }`. It is called in `deps.ts` and in `app.ts`, next to `registerKnowledgeReminderSubject()`.
  - `loadMany` is one query over `tasks`. Each `SubjectInfo` is:
    - `groupId`, `title`, `body` (the description), `dueDate`, `authorId` (`created_by`), and `link` `/groups/<g>/tasks/<id>`;
    - `adminsOnly: false` and `active: completed_at is null`;
    - `canRead: (actor, actorGroupId) => canUseBoard(actor, groupId, actorGroupId)`;
    - `canEdit: () => true`. Reading the task implies editing it, and every route checks `canRead` first.
  - `countUpcomingReminders(db: Db, taskIds: string[]): Promise<Map<string, number>>` is one grouped query.
  - `onTimesChanged` emits `RemindersEvents.task` with `TaskRemindersEvent` per task to the group room, using `countUpcomingReminders`.
- Produces (`modules/reminders/realtime.ts`):
  - `attachRemindersRealtime(io: SocketIOServer | null): void`, called in `buildApp` after `app.io` exists, and with null in `onClose`;
  - `notifyTimesChanged(db: Db, refs: ReminderSubjectRef[]): Promise<void>` groups the refs by kind and calls each adapter's `onTimesChanged`. It does nothing when no io is attached, and logs and swallows errors.
- Produces (`jobs.ts`): after each batch commits, `fireDueReminders` calls `notifyTimesChanged` with the subjects of the times it processed, fired or silent.
- Produces (`push-content.ts`):
  - `PushContentInput` gains `now?: Date`, and `deliver.ts` passes it.
  - In the `reminder.` branch, `p.subjectKind === 'task'` gives:
    - `url` `/groups/<groupId>/tasks/<taskId>`;
    - `tag` `task:<taskId>`;
    - `title` from the existing `taskTitle ?? p.title` rule;
    - `body` `reminderDue(formatReminderClock(p.at, lang))` ("Reminder for 14:00"). When `now - at > 5 minutes` it uses `reminderDue(formatReminderTime(p.at, lang))` ("Reminder for Thu 16 Oct, 14:00").
  - Knowledge pushes are unchanged.
- Produces (`texts.ts`): `formatReminderClock(iso: string, lang: UserLanguage): string`, `HH:mm` in `Europe/Bratislava`.

- [ ] **Step 1: Write the failing tests.**
  - `reminder-subject.test.ts`:
    - `active is false for a task in Completed`;
    - `read follows canUseBoard`: the group's client and any admin read, another group's client does not;
    - `a deleted task is absent from loadMany`.
  - `push-content.test.ts`:
    - `a task reminder push has the task URL and tag task:<id>`;
    - `on time the body is "Reminder for 14:00"`; `ten minutes late it names the day`.
  - `jobs.test.ts` (task subjects, through `replaceReminderSet` and moving `at` into the past through the table; always `setIds`):
    - `fires for an open task`;
    - `is silent for a task in Completed and sets fired_at`;
    - `fires again normally for a task reopened before the time`;
    - `a deleted task's times are gone`;
    - `a task recipient in mode Off still gets the push`;
    - `a renamed task's reminder push shows the current title`: rename through the table after the event is recorded, then `deliverPending`; the fake push title starts with the new title;
    - `firing emits reminders:task with the remaining count`: a socket client in the group room receives `{ groupId, taskId, upcomingReminders: 0 }`.
  - `reminders-coexist.test.ts`: `a deadline reminder and a custom reminder at 09:00 both deliver with tag task:<id>`. On a task due tomorrow with one assignee who is also a custom recipient:
    1. run `recordDeadlineReminders(deps, <09:00 Bratislava>)` and `fireDueReminders` for a custom time at the same instant;
    2. `notification_events` has one `task.deadline` and one `reminder.due` for that user;
    3. after `deliverPending`, the fake sender has two pushes for the user, both with tag `task:<id>`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/tasks/reminder-subject.test.ts src/modules/tasks/reminders-coexist.test.ts src/modules/reminders/jobs.test.ts src/modules/notifications/push-content.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the adapter, the realtime hook, the job call and the push branch, and wire them in `deps.ts` and `app.ts`.
- [ ] **Step 4: Run the tests again,** plus `src/modules/tasks/reminders.test.ts` (Phase 6, untouched) and `src/app.test.ts`. Expected: PASS, with the Phase 6 deadline and urgent tests unchanged.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(tasks): task reminder subject, pushes and live reminder counts`.

---

### Task 4: Task reminder HTTP routes

Depends on: Task 2, Task 3

**Files:**
- Modify: `apps/server/src/modules/reminders/routes.ts`, `routes.test.ts`
- Create: `apps/server/src/modules/tasks/reminder-routes.test.ts`
- Docs: `docs/architecture/realtime.md` (`reminders:task` after a `PUT`), `docs/product/task-board.md` (status: server built)

**Interfaces:**
- Consumes: `ReminderPutSchema` (Task 1); `replaceReminderSet`, `getSetAuthorId`, `emptyReminderSet`, `buildIcs` with `lang` (Task 2); `notifyTimesChanged`, `registerTaskReminderSubject` (Task 3); `getNotificationProfiles` (users service, for the language); Phase 17's reminders rate limiter (120 writes/min/user).
- Produces, in the reminders plugin, for every registered subject (`/api/tasks/...` comes from `routePrefix 'tasks'`):
  - `GET /api/<prefix>/:id/reminders`: 404 when the subject is missing or `canRead` is false. Otherwise the set, or `emptyReminderSet(canEdit)` when there is none (a change for every kind; knowledge reminder items always have a set).
  - `PUT /api/<prefix>/:id/reminders`, registered only when the adapter has `standaloneEdit`:
    - the body is `ReminderPutSchema`;
    - 404 unless `canRead && canEdit`;
    - in one transaction: `replaceReminderSet(tx, { kind, id, groupId, adminsOnly, authorId: (await getSetAuthorId(tx, ref)) ?? actor.id }, body, actor)`;
    - after the commit: `notifyTimesChanged(db, [ref])`, then answer 200 with `getReminderSet` (or the empty set);
    - error mapping is Phase 17's: zod issues on `times` → `invalid_reminder`, on `recipientIds` → `invalid_recipient`; `ReminderInPastError` → 400 `reminder_in_past`;
    - rate limited by the reminders limiter.
  - `GET …/calendar.ics` passes the requester's language from `getNotificationProfiles`.

- [ ] **Step 1: Write the failing tests** in `reminder-routes.test.ts` (`buildTestApp`, an admin and the group's client, a task made through `POST /api/groups/:id/tasks`):
  - `GET with no set answers the empty set`;
  - `PUT creates the set with the caller as author and answers the set`;
  - `PUT with a past time is 400 reminder_in_past`; `the 21st time is 400 invalid_reminder`; `a recipient from another group is 400 invalid_recipient`;
  - `another group's client gets 404 on GET, PUT, subscription and calendar.ics`;
  - `PUT on a deleted task is 404`;
  - `subscribe then unsubscribe answers 204`; `the author's unsubscribe is 400 author_recipient`;
  - `PUT emits reminders:task with the upcoming count`; `removing the last time emits upcomingReminders 0`;
  - `calendar.ics for a task with only a deadline has one VALUE=DATE event`; `a task with neither deadline nor upcoming time is 404`;
  - `PUT writes over 120/min answer 429`.
  - In `routes.test.ts`: `PUT on a knowledge item is 404` (no `standaloneEdit`).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/tasks/reminder-routes.test.ts src/modules/reminders/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the `PUT` route, the empty `GET` and the `.ics` language.
- [ ] **Step 4: Run the whole server suite** with `pnpm --filter @spolu/server test`. Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(reminders): task reminder endpoints`.

---

### Task 5: Shared reminder components for stand-alone editing

Depends on: Task 1

**Files:**
- Modify in `apps/web/src/features/reminders/`: `api.ts`, `reminder-panel.tsx`, `reminder-panel.test.tsx`, `recipients-field.tsx`, `recipients-field.test.tsx`
- Create: `apps/web/src/features/reminders/add-reminder-row.tsx`, `add-reminder-row.test.tsx`
- Modify: `apps/web/src/features/reminders/locales/{en,sk}.json` (section `row`)
- Docs: `docs/design/tokens.md` (`ReminderPanel` options, the add row)

**Interfaces:**
- Consumes: Phase 17's `ReminderPanel`, `RecipientsField`, `localToIso`, `CalendarLeaf`, `formatReminderDate`, `apiGet`/`apiSend`; `ReminderPut`, `ReminderSubjectKind` (Task 1).
- Produces (`api.ts`):
  - `REMINDER_PREFIX: Record<ReminderSubjectKind, string> = { knowledge: 'knowledge', task: 'tasks' }`;
  - `reminderSetQuery(kind: ReminderSubjectKind, id: string)`, a `queryOptions` with key `['reminders', kind, id]`;
  - `putReminderSet(kind, id, body: ReminderPut): Promise<ReminderSetDto>`.
- Produces (`ReminderPanel`), with new optional props whose defaults keep Phase 17's rendering exactly:
  - `hideFired?: boolean`;
  - `timeTag?: (iso: string) => string | null`, rendered as a `text-micro text-muted-foreground` tag after the date;
  - `onRemoveTime?: (id: string) => void` adds a 32 px × button per upcoming time, labelled `row.remove` (44 px hit area below 641 px);
  - `children?: ReactNode`, rendered under the time list (the add row);
  - `recipientsAction?: ReactNode`, rendered at the end of the "Reminded:" line;
  - `calendarAvailable?: boolean` overrides the "nothing upcoming" disabled state of "Add to calendar".
- Produces (`RecipientsField`): optional `suggestion?: { label: string; ids: string[] }`. It renders a ghost small button on top that adds the ids not yet in `value`, and is hidden when none are missing.
- Produces (`AddReminderRow({ defaultDate, onAdd, onCancel, error }: { defaultDate: string; onAdd: (iso: string) => void; onCancel: () => void; error?: string })`):
  - a native date input (default `defaultDate`), a time input (default `09:00`), and primary small "Add" and ghost "Cancel";
  - Enter adds; `onAdd(localToIso(date, time))`;
  - `error` shows under the row (`aria-describedby`).
- Copy (`row`): `add` "Add reminder" / "Pridať pripomienku", `confirm` "Add" / "Pridať", `cancel` "Cancel" / "Zrušiť", `remove` "Remove reminder" / "Odstrániť pripomienku", `date` "Date" / "Dátum", `time` "Time" / "Čas".

- [ ] **Step 0:** Invoke `frontend-design:frontend-design` (the panel with remove buttons and tags, the add row at 390 px and 1280 px).
- [ ] **Step 1: Write the failing tests.**
  - `reminder-panel.test.tsx`:
    - `hideFired hides fired times`;
    - `onRemoveTime adds a Remove reminder button per upcoming time`;
    - `timeTag renders its text`;
    - `calendarAvailable enables Add to calendar without upcoming times`;
    - Phase 17's cases pass untouched.
  - `recipients-field.test.tsx`: `the suggestion adds only missing ids and hides when none are missing`.
  - `add-reminder-row.test.tsx`: `defaults to the given date and 09:00`; `Enter calls onAdd with localToIso`; `shows the error`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/reminders`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the props, the suggestion, the row, the API functions and the copy.
- [ ] **Step 4: Run the tests again,** plus `src/features/knowledge`. Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(reminders): panel options and add row for stand-alone editing`.

---

### Task 6: The reminders section in the task panel

Depends on: Task 5

**Files:**
- Create: `apps/web/src/features/tasks/task-reminders.tsx`, `task-reminders.test.tsx`
- Modify: `apps/web/src/features/tasks/task-form.tsx` (`remindersSlot`), `task-panel.tsx`, `task-create-panel.tsx`, `apps/web/src/router.tsx` (the tasks route loader also loads `reminders`)
- Modify: `apps/web/src/features/reminders/locales/{en,sk}.json` (section `task`)
- Docs: `docs/product/task-board.md` (custom reminders beside the automatic ones, built), `docs/design/tokens.md` (the reminders section)

**Interfaces:**
- Consumes:
  - `ReminderPanel`, `RecipientsField` with `suggestion`, `AddReminderRow`, `reminderSetQuery`, `putReminderSet`, `isoToLocal` (Task 5 and Phase 17);
  - `RemindersEvents`, `TaskRemindersEvent` (Task 1);
  - `getSocket`, `useSession`, `useGroupPeople`, `showBoardNotice`, `TaskDetailDto`.
- Produces:
  - `TaskForm` gains `remindersSlot?: ReactNode`, rendered between `UrgentSwitch` and the files field, after a 2 px `border` rule. The AI review dialog does not pass it.
  - `automaticReminderLine(task: { dueDate: string | null; urgent: boolean }): 'deadline' | 'deadlineUrgent' | 'urgent' | null`.
  - `isAfterDeadline(iso: string, dueDate: string | null): boolean` compares `isoToLocal(iso).date > dueDate`.
  - `defaultReminderDate(dueDate: string | null, now = new Date()): string`: the deadline when it is after today (local), else today.
  - `TaskReminders({ task, onTaskGone }: { task: TaskDetailDto; onTaskGone: () => void })`:
    - It fetches `reminderSetQuery('task', task.id)` and reads the automatic line from the saved `task`.
    - Each change sends one `putReminderSet`, then writes the answer into the query and shows "Saved" for 2 s (`aria-live="polite"`):
      - add: `times` = loaded upcoming times + the new one, `baseTimeIds` = loaded upcoming ids, no `recipientIds`;
      - remove: the same without that time;
      - recipients Done: the times unchanged, plus `recipientIds`.
    - `reminder_in_past` puts `task.inPast` on the add row and keeps it open. 404 calls `onTaskGone`. Other errors show `task.saveFailed`.
    - On `reminders:task` for this task it invalidates the query.
    - With no upcoming time it shows only the line, "+ Add reminder" and "Add to calendar". "Add to calendar" is disabled when there is no deadline and no upcoming time (`calendarAvailable = !!task.dueDate`).
    - "Change" shows `RecipientsField` with the suggestion `{ label: task.addAssignees, ids: task.assignees ids }` and Done. "(set them)" marks the author. "Remind me" is `ReminderPanel`'s toggle.
  - `TaskPanel` passes `remindersSlot={<TaskReminders task={base} onTaskGone={…the existing deleted path} />}`. `TaskCreatePanel` passes the muted hint `task.createHint`.
- Copy (`task`):
  - `title`: "Reminders" / "Pripomienky".
  - `autoDeadline`: "Assignees are reminded automatically 3, 2 and 1 days before the deadline." / "Riešiteľom automaticky pripomenieme termín 3, 2 a 1 deň vopred."
  - `autoDeadlineUrgent`: "Assignees are reminded automatically 3, 2 and 1 days before the deadline, and every 3 hours while urgent." / "Riešiteľom automaticky pripomenieme termín 3, 2 a 1 deň vopred a každé 3 hodiny, kým je úloha urgentná."
  - `autoUrgent`: "Assignees are reminded automatically every 3 hours while urgent." / "Riešiteľom automaticky pripomíname každé 3 hodiny, kým je úloha urgentná."
  - `afterDeadline`: "after the deadline" / "po termíne".
  - `reminded`: "Reminded:" / "Pripomenieme:".
  - `setThem`: "(set them)" / "(nastavil/a ich)".
  - `change`: "Change" / "Zmeniť"; `done`: "Done" / "Hotovo"; `addAssignees`: "Add assignees" / "Pridať riešiteľov".
  - `saved`: "Saved" / "Uložené"; `saveFailed`: "Could not save. Try again." / "Nepodarilo sa uložiť. Skúste znova."
  - `inPast`: "This time has passed. Pick a later one." / "Tento čas už uplynul. Vyberte neskorší."
  - `createHint`: "Add reminders after creating the task" / "Pripomienky pridáte po vytvorení úlohy".

- [ ] **Step 0:** Invoke `frontend-design:frontend-design` (the section under the urgent switch at 1280 px and in the full-screen phone panel).
- [ ] **Step 1: Write the failing tests** (`task-reminders.test.tsx`, HTTP mocked):
  - `the automatic line per deadline and urgent state` (four cases, none for neither);
  - `add sends times, baseTimeIds and no recipientIds`;
  - `remove sends the times without it`;
  - `the after-the-deadline tag compares local dates`: `localToIso(dueDate, '23:30')` is not tagged, `localToIso(<dueDate + 1>, '00:30')` is;
  - `fired times are hidden`;
  - `Add assignees adds the missing assignees and Done sends recipientIds`;
  - `Remind me toggles the subscription`;
  - `Add to calendar is disabled with no deadline and no upcoming time`;
  - `reminder_in_past keeps the row with the message`;
  - `a 404 calls onTaskGone`;
  - `a reminders:task event refetches`;
  - in `task-form.test.tsx`: `remindersSlot renders between the urgent switch and the files`;
  - in the create panel test: `create mode shows the hint and no section`.
  - The existing `task-form`, `task-panel` and `review-dialog` tests pass untouched.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/tasks`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run the tests again,** then `pnpm --filter @spolu/web build`. Expected: PASS, and `task-reminders` is not in the eager entry chunk.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(tasks): reminders section in the task panel`.

---

### Task 7: The board card bell

Depends on: Task 1

**Files:**
- Modify in `apps/web/src/features/tasks/`: `icons.tsx` (`BellIcon`), `task-card.tsx`, `board-cache.ts`, `board-cache.test.ts`, `use-board-events.ts`, `use-board-events.test.tsx`, `board.test.tsx`
- Modify: `apps/web/src/features/tasks/locales/{en,sk}.json` (`card.reminders`)
- Docs: `docs/design/tokens.md` (the card bell)

**Interfaces:**
- Consumes: `TaskDto.upcomingReminders`, `RemindersEvents`, `TaskRemindersEvent` (Task 1).
- Produces:
  - `BellIcon()`: 14 px, `currentColor`, `aria-hidden`.
  - `TaskCardMeta` gains `hasReminders: boolean`. The bell sits before the paperclip in `text-muted-foreground`, with an sr-only `card.reminders`: "Has reminders" / "Má pripomienky". The icons group renders when `fileCount > 0 || hasChat || hasReminders`.
  - `setUpcomingReminders(board: BoardDto, taskId: string, count: number): BoardDto` returns the same object when the task is absent or the count is unchanged.
  - `useBoardEvents` handles `RemindersEvents.task` for its group with `setUpcomingReminders`.

- [ ] **Step 0:** Invoke `frontend-design:frontend-design` (the meta row with the bell, at card width).
- [ ] **Step 1: Write the failing tests.**
  - `board.test.tsx`: `the bell shows when upcomingReminders > 0, before the paperclip, labelled Has reminders`; `no bell at 0`.
  - `board-cache.test.ts`: `setUpcomingReminders updates one task and keeps identity when unchanged`.
  - `use-board-events.test.tsx`: `reminders:task updates the card's count`; `another group's event is ignored`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/tasks/board.test.tsx src/features/tasks/board-cache.test.ts src/features/tasks/use-board-events.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Docs, then commit.** Commit message: `feat(tasks): reminder bell on board cards`.

---

### Task 8: E2E, eager budget and phase docs

Depends on: Task 4, Task 6, Task 7

**Files:**
- Create: `e2e/task-reminders.spec.ts`
- Docs:
  - `docs/roadmap.md`: Phase 19 done (local);
  - `docs/glossary.md`: automatic reminders, custom reminders;
  - `docs/architecture/performance.md`: the eager size before and after;
  - `docs/product/reminders.md`: tasks built.

**Interfaces:**
- Consumes: `e2e/push-log.ts` (`fakeSubscription`, `waitForPush`), `e2e/db.ts` (`withDb`, Phase 17), `logInWithCode`, the group and invite setup of `e2e/tasks.spec.ts`.

- [ ] **Step 1: Write the test** `custom task reminder reaches the client, shows on the card and exports with the deadline`. It uses two browser contexts: the superadmin, and a client who joined by invite.
  1. The admin creates a task with a deadline 3 days ahead, opens it, and adds a reminder 2 minutes ahead.
  2. Under "Change", the admin adds the client and clicks Done.
  3. The client's board shows the bell on that card live, without a reload.
  4. The client subscribes a `fakeSubscription()`.
  5. The test moves the time into the past with `withDb`, then `waitForPush(endpoint, p => p.url === '/groups/<g>/tasks/<id>' && p.tag === 'task:<id>', 90_000)` resolves while the every-minute cron fires (`test.setTimeout(150_000)`).
  6. The client's bell disappears live.
  7. The admin clicks "Add to calendar". The downloaded text has exactly one `DTSTART;VALUE=DATE:` and one `UID:reminder-` event.
- [ ] **Step 2: Run it.** Run `pnpm test:e2e -- e2e/task-reminders.spec.ts`. Expected: PASS. Any failure is fixed in the task that owns the code, not in the test.
- [ ] **Step 3: Measure the eager size.** Run `pnpm --filter @spolu/web build`, and gzip (level 9) the scripts `index.html` loads, as `performance.md` describes. Expected: at most 0.2 kB above the number recorded before this phase, and under 200 kB. Record both numbers.
- [ ] **Step 4: Run the full gate.** Run `bash scripts/ci.sh`. Expected: PASS, including the unchanged Phase 6 and Phase 17 suites.
- [ ] **Step 5: Docs, then commit.** Commit message: `test(e2e): task reminders; phase 19 docs`.

---

## Self-review notes

- **Spec coverage:**
  - migration, `task_id`, CHECK, cascade: Task 1;
  - board `upcomingReminders` in one query: Task 1;
  - adapter (`active`, `canUseBoard`), push URL and tag, Completed silence, coexistence: Task 3;
  - author on the first time, editors as recipients, `baseTimeIds`, the 20-time limit, the deadline `.ics` event: Task 2;
  - endpoints, 404s, error codes, rate limit, `reminders:task` after a `PUT`: Task 4;
  - `reminders:task` after the fire job: Task 3;
  - the panel section, automatic line, add/remove, after-the-deadline tag, Add assignees, Remind me, calendar state, create-mode hint, "Saved": Tasks 5 and 6;
  - the card bell: Task 7;
  - e2e, budget and the remaining docs: Task 8.
  - The documentation list of the spec is spread over the tasks that change the code each doc describes.
- **Deviations and decisions**, each recorded so the reviewer checks them on purpose:
  - Off does not block task reminders (the ruling). Phase 17 already implements it, and Task 3 tests it for tasks.
  - The automatic reminders have no off switch (the ruling).
  - Phase 17 has no `PUT`, so Task 4 adds it to the generic reminders plugin, gated by the adapter flag `standaloneEdit`.
  - `recipientIds` is optional in the `PUT` (see Review Focus).
  - An id in `baseTimeIds` that no longer exists is dropped, not an error.
  - Subscribing to a task with no set is `invalid_reminder`. The UI hides "Remind me" until a time exists.
  - `TaskRemindersEvent` carries `groupId` too, like every board event.
  - The fire job reaches Socket.IO through `attachRemindersRealtime`, because jobs are built before the app.
  - The "Reminder for 14:00" vs "Reminder for Thu 16 Oct, 14:00" rule uses a 5-minute lateness threshold, and only for task pushes. Knowledge pushes keep Phase 17's format.
  - The `.ics` deadline title uses the requester's saved language.
  - The `PUT` uses the reminders limiter. It has the same limit as the tasks module's: 120 writes per minute per user.
  - `ReminderTimesField` is a form field for knowledge items. The task section saves each change at once, so it reuses `localToIso` and the new `AddReminderRow` instead of the field itself.
  - The spec's "query counter used by the board tests" does not exist yet. Task 1 adds it (`createCountingDb`).
