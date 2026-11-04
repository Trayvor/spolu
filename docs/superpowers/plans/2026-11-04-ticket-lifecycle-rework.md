# Ticket Lifecycle Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tickets are assigned to the client's managers, tied to a project instead of a free-text programme, and finished by confirmation from both sides or after 5 silent days.

**Architecture:** Status stays `new | in_progress | resolved`; a nullable mark (`admin_done_at`) on `in_progress` carries the waiting state. New files `modules/tickets/manager-assign.ts` and `modules/tickets/lifecycle.ts` hold the rules; area rules and watch settings are deleted whole.

**Tech Stack:** TypeScript, Fastify, Drizzle, PostgreSQL, Socket.IO, React, TanStack Query/Router, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-ticket-lifecycle-rework-design.md`

## Global Constraints

- Branch `feat/ticket-lifecycle-rework`, worktree `.claude/worktrees/ticket-lifecycle-rework`. One pull request, one commit per task. Plain `git` may be blocked: use `/usr/bin/git`.
- `TICKET_CONFIRM_DAYS = 5` calendar days.
- Permissions only through `modules/tickets/policy.ts`; writes through HTTP; sockets only after commit.
- Code, comments and docs in English. Every new text in all nine languages (sk, en, cs, sl, bg, et, it, hr, uk), web texts in the lazy `locales/tickets/<code>.json` namespace, never in eager `locales/<code>.json`; server texts in all nine `apps/server/src/infra/i18n/<code>.ts`. Terms from `docs/design/wording.md`.
- Slovak labels: "Vyriešené z našej strany", "Vyriešené", "Áno, vyriešené", "Ešte nie je vyriešené", "Čaká na potvrdenie", "Bez zmeny".
- Run server tests as `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_lifecycle pnpm --filter @spolu/server exec vitest run --maxWorkers 2 <file>`.
- Before each `db:generate`, check the latest number on `origin/main` (0075 on 2026-11-04). The next ADR is 0075.
- No wall-clock budgets in tests: pass `now` in.
- `update-kb` and `rtk proxy pnpm exec prettier --check .` before every commit that touches docs or code.

## Review Focus

1. The author declines at the moment the job resolves: exactly one wins, and a declined ticket never ends resolved. Test in Task 9.
2. The author loses access while the mark is set (removed, disabled): the mark stays and the job ends the ticket after 5 days. Test in Task 9.
3. A marked ticket moves to another client: the mark and its timer go, the status stays `in_progress`. Test in Task 7.
4. Editing or deleting an old chat message, or a message by anyone but the author, keeps the mark. Test in Task 8.
5. A retried intake (`request_id` repeat), a disabled manager and more than 10 managers add no extra riešitelia. Test in Task 3.

---

### Task 1: Remove the programme from forms, API and MCP

**Files:**
- Modify: `packages/shared/src/tickets.ts:104,124,199,332`
- Modify: `apps/web/src/features/tickets/content-fields.tsx`, `ticket-fields.tsx`, `new-ticket-dialog.tsx`, `test-api.ts`, `ticket-page.test.tsx`
- Modify: `apps/server/src/modules/tickets/routes.ts:290,357`, `service.ts:81,422`, `apps/server/src/modules/mcp/tools/tickets.ts:65`
- Test: `apps/server/src/modules/tickets/routes.test.ts`, `apps/web/src/features/tickets/new-ticket-dialog.test.tsx`

**Interfaces:**
- Produces: `TicketDto` without `programme`. `tickets.programme`, the intake schema's `programme`, `linkTicketByProgramme` and the `ai/` readers stay.

- [ ] **Step 1: Write failing tests:** `POST /api/tickets` and `PATCH /api/tickets/:id` with `programme` store nothing (`row.programme` stays null); `POST /api/tickets/intake` with `programme: 'Culture 2026'` keeps it (`row.programme === 'Culture 2026'`); `GET /api/tickets/:id` has no `programme` key; the dialog has no element with label `tickets.fields.programme`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Remove the field** from `ticketContent`-based create and patch schemas, `TicketDto`, `toTicketDto`, the three web components and the MCP description. The intake schema keeps its own `programme: text(TICKET_LIMITS.programme)`. `ai/` reads from `TicketRow`, not the DTO: confirm it still compiles.
- [ ] **Step 4: Run** the two test files plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tickets): project replaces the grant programme in forms and API`.

### Task 2: Delete automatic assignees by area

**Files:**
- Delete: `apps/server/src/modules/tickets/area-rules.ts`, `area-rules-routes.ts`, `area-rules.test.ts`, `apps/web/src/features/tickets/area-rules-dialog.tsx`, `area-rules-dialog.test.tsx`, `packages/shared/src/ticket-areas.ts`, `ticket-areas.test.ts`, `e2e/ticket-area-autoassign.spec.ts`
- Modify: `apps/server/src/modules/tickets/routes.ts:77,175-208,515,555`, `schema.ts`, `policy.ts`, `policy.test.ts`, `apps/server/src/app.ts`, `apps/server/src/modules/mcp/tools/tickets.ts`, `mcp/allowlist.ts`, `packages/shared/src/index.ts`, `packages/shared/src/audit.ts`, `apps/web/src/features/tickets/tickets-page.tsx`, `api.ts`, `apps/web/src/features/audit/audit-filters.tsx`
- Create: migration dropping `ticket_area_rules`

- [ ] **Step 1: Run `pnpm dlx knip --reporter json > /private/tmp/claude-501/knip-before.json`** from the worktree root, before any deletion, and keep the file for Task 12.
- [ ] **Step 2: Delete the listed files, routes and calls.** Keep the audit entity label for `ticket_area_rules`, so old rows stay readable; `audit/coverage.test.ts` tells what must stay.
- [ ] **Step 3: Remove `tickets.areaRules.*` keys** from all nine web locales and any server i18n.
- [ ] **Step 4: Generate the migration** with `pnpm --filter @spolu/server db:generate`. Expected: one file with `DROP TABLE "ticket_area_rules"`.
- [ ] **Step 5: Run** `pnpm typecheck` and `pnpm test`. Expected: PASS. `PUT /api/egrant/ticket-areas` answers 404 (add this test to `routes.test.ts`).
- [ ] **Step 6: Commit** `feat(tickets)!: remove automatic assignees by area`.

### Task 3: Managers become riešitelia

**Files:**
- Create: `apps/server/src/modules/tickets/manager-assign.ts`, `manager-assign.test.ts`
- Modify: `apps/server/src/modules/tickets/routes.ts` (create, intake, group routes)

**Interfaces:**
- Produces: `assignManagers(db: Db, ticket: TicketRow, mode: 'created' | 'ifNone'): Promise<string[]>`, in the transaction given, returning the added user ids; `MANAGER_ASSIGN_ACTOR = 'tickets.manager-autoassign'`.
- Consumes: `listGroupManagers`, `addTicketAssignees` logic used by the old `autoAssignByArea` (recover its limit and audit handling from `git show HEAD~1:apps/server/src/modules/tickets/area-rules.ts`).

- [ ] **Step 1: Write failing tests** in `manager-assign.test.ts`:
  - `new ticket gets every active manager` (two managers: both in `ticket_assignees`, each with one `ticket.assigned` and one audit row by the system actor);
  - `the creating manager gets no notification about themselves`;
  - `ifNone adds nobody when the ticket has a riešiteľ`;
  - `a disabled manager is skipped`;
  - `11 managers add 10, earliest group_managers.created_at first`;
  - `a client without managers adds nobody`, `a ticket without a client adds nobody`;
  - `a repeated intake request_id adds no second row`.
- [ ] **Step 2: Run them.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `assignManagers`** and call it where `autoAssign` was: `'created'` on create and intake, `'ifNone'` in `PUT /tickets/:id/group`. Each added person runs `runTicketChange` with `kind: 'assigned'` after commit.
- [ ] **Step 4: Run** the new file and `routes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tickets): the client's managers become assignees of its tickets`.

### Task 4: A new manager picks up tickets nobody handles

**Files:**
- Modify: `apps/server/src/modules/groups/managers.ts:111-155`, `groups/substitutions.ts:79-170`, `apps/server/src/modules/tickets/manager-assign.ts`, the start-up that calls `registerTicketNotifications`
- Test: `manager-assign.test.ts`, `groups/substitutions.test.ts`

**Interfaces:**
- Produces in `groups/managers.ts`: `onManagerGained(handler: (tx: Db, groupId: string, userId: string) => Promise<void>): void`; `managerGained(tx, groupId, userId)` runs the handlers inside the caller's transaction. A registry, so groups never imports tickets.
- Produces: `assignNewManager(tx: Db, groupId: string, userId: string): Promise<void>`, registered once at start-up.

- [ ] **Step 1: Write failing tests:**
  - `a new manager becomes a riešiteľ of open tickets without one`, with `ticket.assigned` recorded;
  - `tickets with a riešiteľ and resolved tickets are left alone`;
  - `a derived substitute row counts the same`;
  - `removing a manager changes no ticket`;
  - `a riešiteľ removed by hand is not added back while nothing about managers changes`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Call `managerGained` in `addManager` when `changed`, and in `syncSubstitute` for each row it inserts. Record notifications inside the transaction (`recordNotifications`); the minute sweep delivers them, so no `requestDelivery`.
- [ ] **Step 4: Run** both test files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tickets): a new manager takes the client's unassigned tickets`.

### Task 5: Delete Watch tickets and simplify who hears what

**Files:**
- Delete: `apps/server/src/modules/tickets/watch.ts`
- Modify: `tickets/audience.ts`, `notify.ts:128-150`, `dashboard.ts:12-31`, `routes.ts`, `schema.ts`, `policy.ts`, `policy.test.ts`, `notify.test.ts`, `assignees.test.ts`, `dashboard.test.ts`, `apps/server/src/modules/notifications/routes.ts:30,198-234`, `mcp/tools/tickets.ts:199-215`, `mcp/allowlist.ts`, `groups/admin-group.test.ts`, `groups/substitutions.test.ts`, `packages/shared/src/tickets.ts:459`, `apps/web/src/features/tickets/tickets-page.tsx:232,260-345`, `api.ts`, `ticket-list.test.tsx`, `apps/web/src/features/notifications/centre-api.ts:66`, `client-table.tsx`, `client-table.test.tsx`, `apps/web/src/router-i18n.test.tsx`
- Create: migration with `DROP TABLE ticket_watch_settings` and the backfill

- [ ] **Step 1: Write failing tests:**
  - `notify.test.ts`: `a ticket with riešitelia reaches them and the author, not other clients`; `a ticket without a riešiteľ reaches every admin and the author`; `resolving reaches the same audience`;
  - `dashboard.test.ts`: the list is riešiteľ tickets, open tickets without a riešiteľ and tickets without a client;
  - migration test: an open ticket without a riešiteľ of a managed client gets the manager with no `notification_events` row; a resolved one and an already assigned one do not.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `ticketOwnerIds` returns riešitelia, else `listAdmins`. Delete `ticketResolvedAudienceIds`; `notify.ts` uses `ticketAudienceIds` for `resolved`. The 👎 path at `notify.ts:145` uses `ticketOwnerIds`, filtered to admins. Delete the routes, MCP tools, checkbox with its bubble, the settings column and `tickets.watch.*` keys in all nine locales.
- [ ] **Step 4: Generate the migration and append the backfill** by hand:

```sql
INSERT INTO ticket_assignees (ticket_id, user_id)
SELECT t.id, m.user_id
FROM tickets t
JOIN group_managers m ON m.group_id = t.group_id
JOIN "user" u ON u.id = m.user_id AND u.disabled_at IS NULL AND u.role IN ('admin', 'superadmin')
WHERE t.status IN ('new', 'in_progress')
  AND NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 5: Run** `pnpm typecheck` and `pnpm test`. Expected: PASS. EXPLAIN checks stay green for the dashboard query.
- [ ] **Step 6: Commit** `feat(tickets)!: remove Watch tickets; assignees and author hear a ticket`.

### Task 6: Lifecycle data, policy and opening by a riešiteľ

**Files:**
- Create: `apps/server/src/modules/tickets/lifecycle.ts`, `lifecycle.test.ts`
- Modify: `tickets/schema.ts`, `policy.ts`, `policy.test.ts`, `service.ts`, `routes.ts:485`, `packages/shared/src/tickets.ts`, `packages/shared/src/users.ts`
- Create: migration

**Interfaces:**
- Produces in shared: `TICKET_CONFIRM_DAYS = 5`; `ErrorCodes.invalidTicketState = 'invalid_ticket_state'`; on `TicketDto`, `confirmation: { adminDoneAt: string | null; resolvesAt: string | null; canMarkDone: boolean; canConfirm: boolean; canDecline: boolean }`; on list rows, `awaitingConfirmation: boolean`.
- Produces in `schema.ts`: `adminDoneAt`, `adminDoneBy` (FK `user`, `set null`), `adminDoneClearedAt`, index `tickets_admin_done_idx` on `adminDoneAt` where not null.
- Produces in `policy.ts`: `canMarkTicketDone(actor): boolean` (admins); `canConfirmTicket(actor, ticket, role): boolean` (same rule as `canRateTicket`); `startsTicketOnOpen(actor, ticket: TicketRef & { status; createdBy }, isAssignee: boolean, hasAssignees: boolean): boolean`.
- Produces in `lifecycle.ts`: `startTicketOnOpen(db, actor, row, by): Promise<TicketRow | null>`; `hasConfirmableAuthor(db, ticket): Promise<boolean>`.

- [ ] **Step 1: Write failing policy tests.** `startsTicketOnOpen` is true for a riešiteľ admin on a `new` ticket with a client; true for any admin when it has no riešitelia; false for a non-riešiteľ admin when it has riešitelia, a client role, `in_progress`, `groupId: null`, and `createdBy === actor.id`. `canConfirmTicket` matches every `canRateTicket` case.
- [ ] **Step 2: Write failing route tests:** `POST /tickets/:id/seen` by a riešiteľ makes it `in_progress` with one audit row and one `ticket.status` notification to the author; `GET /tickets/:id` and a repeated `seen` change nothing more; a non-riešiteľ admin's `seen` leaves `new`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Add the columns, generate the migration, implement.** `startTicketOnOpen` updates `where status = 'new'`, so a concurrent open returns null. After commit the route calls `emitTicket` and `runTicketChange` with `kind: 'status'`. `updateTicket` sets `adminDoneAt`, `adminDoneBy` and `adminDoneClearedAt` to null on every status change.
- [ ] **Step 5: Run** the three test files. Expected: PASS.
- [ ] **Step 6: Commit** `feat(tickets): a riešiteľ opening a new ticket starts it`.

### Task 7: The admin's and the author's actions

**Files:**
- Modify: `tickets/lifecycle.ts`, `lifecycle.test.ts`, `routes.ts`, `service.ts` (`assignTicketGroup`), `tickets/time.ts`, `hooks.ts`, `audit.ts`, `audit.test.ts`, `mcp/tools/tickets.ts`, `mcp/allowlist.ts`

**Interfaces:**
- Consumes: `canMarkTicketDone`, `canConfirmTicket`, `hasConfirmableAuthor`.
- Produces: `markTicketDone(db, id, actor, by): Promise<{ ticket; marked: boolean } & TimeEffect>`; `confirmTicket(db, id, actor, by)`; `declineTicket(db, id, actor, by)`. Routes `POST /tickets/:id/admin-done` (answers the ticket plus `askTime`), `/confirm`, `/decline`. `TicketChange.kind` gains `'marked' | 'declined'`.
- Task 10 replaces the time placeholder here: until then `markTicketDone` returns `noTimeEffect`.

- [ ] **Step 1: Write failing tests:**
  - admin-done on `in_progress` with a confirmable author sets the mark, status stays, `confirmation.resolvesAt` is `adminDoneAt + 5 days`;
  - admin-done with no confirmable author (admin author, no account, disabled) resolves at once;
  - admin-done on `new`, on `resolved`, and on an already marked ticket answer `409 invalid_ticket_state`;
  - a client or a žiadateľ gets `403`;
  - confirm by the author from `new`, from `in_progress`, and with the mark gives `resolved` with `resolvedAt` set and clears the mark; another client of the group gets `403`; on `resolved`, `409`;
  - decline with the mark clears it and sets `adminDoneClearedAt`; without a mark, `409`;
  - each change has its audit row;
  - moving a marked ticket clears the mark and keeps `in_progress`;
  - a ticket created on behalf of someone: the named person confirms, the creating manager gets `403`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Resolving reuses `updateTicket` with `{ status: 'resolved' }`, so time and audit stay in one path. Mark writes are conditional on `status = 'in_progress' and admin_done_at is null`. Add MCP tools `mark_ticket_done`, `confirm_ticket` and `decline_ticket` and allowlist them, as `mcp/coverage.test.ts` expects.
- [ ] **Step 4: Run** `lifecycle.test.ts`, `routes.test.ts`, `audit.test.ts`, `mcp/coverage.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tickets): solved on our side, confirm and decline`.

### Task 8: The author's message clears the mark

**Files:**
- Modify: `tickets/chat.ts` (`messageNotice`), `tickets/lifecycle.ts`, `chat.test.ts`

**Interfaces:**
- Produces: `clearMarkOnAuthorMessage(deps, ticket: TicketRow, authorId: string): Promise<void>`.

- [ ] **Step 1: Write failing tests:** an author's message and an author's thread reply clear the mark and set `adminDoneClearedAt`, with `ticket:updated` emitted; a message by the admin or another client keeps it; editing or deleting an earlier message keeps it; no mark means no write.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** with a conditional update on `admin_done_at is not null`, called from `messageNotice`, which runs only for new messages. No extra notification: the chat message already reaches the riešitelia.
- [ ] **Step 4: Run** `chat.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tickets): an author's message returns the ticket to in progress`.

### Task 9: Automatic resolve after 5 days

**Files:**
- Create: `apps/server/src/modules/tickets/jobs.ts`, `jobs.test.ts`
- Modify: `apps/server/src/deps.ts`

**Interfaces:**
- Produces: `AUTO_RESOLVE_JOB = 'tickets.auto-resolve'`; `autoResolveDue(deps: Pick<AppDeps, 'db' | 'io' | 'jobs'>, now: Date): Promise<number>`; `ticketsJobHandlers(deps)`; `ticketsSchedules = [{ name: AUTO_RESOLVE_JOB, cron: '15 * * * *', tz: 'Europe/Bratislava' }]`.

- [ ] **Step 1: Write failing tests** with `now` passed in:
  - a mark 5 days and 1 minute old resolves: audit row by `tickets.auto-resolve`, `ticket.resolved` to the audience, rating open;
  - a mark 4 days 23 hours old stays;
  - a declined ticket stays;
  - a run while another transaction holds the row skips it, and the next run takes it;
  - after a decline that commits first, the job leaves it `in_progress`;
  - an author who lost access does not block it;
  - a second run changes nothing and sends nothing.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** In one transaction per batch of 100: `select … where admin_done_at < now - 5 days for update skip locked`, then resolve through `updateTicket` with `actor: null` and `systemActor(AUTO_RESOLVE_JOB)`. After commit, `emitTicket` and `runTicketChange`. Loop until a batch is short. Register handlers and schedules in `deps.ts` beside `groupsSchedules`.
- [ ] **Step 4: Run** `jobs.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tickets): resolve after five days without an answer`.

### Task 10: Time moves to the admin's press, with a review

**Files:**
- Modify: `apps/server/src/modules/finance/ticket-time.ts`, `finance/task-time.ts:222-280`, `finance/schema.ts`, `tickets/time.ts`, `tickets/lifecycle.ts`, `tickets/routes.ts`, `tickets/service.ts`
- Create: migration
- Test: `finance/ticket-time.test.ts`, `tickets/lifecycle.test.ts`

**Interfaces:**
- Produces in finance: `TicketResolvedEvent` renamed `TicketDoneEvent`, `resolvedAt` renamed `doneAt`, `onTicketResolved` renamed `onTicketDone`; `requestTicketTimeReview(tx, e: TicketDoneEvent): Promise<{ askActor: boolean } & TimeChange>`, which sets `review_requested_at` on the admins' filled entries and records `ticket.time_review` for all but the actor; `keepTicketTime(db, userId, ticketId): Promise<void>`. `TimeRequestRow` gains `review: boolean`.
- Produces in tickets: `ticketDoneTime(tx, actor, ticket): Promise<TimeEffect>` for a press; `POST /tickets/:id/time/me/keep`.

- [ ] **Step 1: Write failing tests**, one per row of the spec's section 5.4:
  - first press: the presser gets `askTime: true`, other admin riešitelia `ticket.time_missing`, the entry's `workedOn` is the press's Bratislava day;
  - a non-riešiteľ admin's press: `askTime: false`;
  - confirm or auto-resolve with the mark set: no new request or notification;
  - cleared then pressed again: `askTime: true`, the entry keeps its minutes and `workedOn`, others with filled time get `ticket.time_review`;
  - cleared then the author confirms: `ticket.time_review` to admins with filled time, and those with none keep their ordinary request;
  - cleared then an admin resolves directly: `askTime: true`;
  - confirm before any press: `ticket.time_missing`, and the author gets no `askTime`;
  - `keep` clears `review_requested_at` and leaves `minutes`; a save clears it too;
  - a clear keeps unanswered requests; reopening from `resolved` drops them;
  - a review never appears in the finance missing-time count.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `ticketStatusTime` on becoming `resolved`: with `before.adminDoneAt` set, no effect; with `before.adminDoneClearedAt` set, `requestTicketTimeReview`; otherwise `onTicketDone`. `ticketDoneTime` picks the same way on a press. `myTimeRequests` selects open requests or `review_requested_at is not null`; `countMyTimeRequests` keeps `openRequestsOf`.
- [ ] **Step 4: Run** the finance tests and `lifecycle.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tickets): time is asked when the admin finishes, and reviewed after a return`.

### Task 11: Notifications and screens

**Files:**
- Modify: `packages/shared/src` notification kinds, `apps/server/src/modules/notifications/decide.ts`, `categories`, `unseen-kinds.ts`, `unseen-summary`, `digest-entries.ts`, `push-content.ts`, `apps/server/src/infra/i18n/<nine>.ts`, `tickets/notify.ts`
- Create: `apps/web/src/features/tickets/ticket-confirmation.tsx`, `ticket-confirmation.test.tsx`
- Modify: `apps/web/src/features/tickets/ticket-page.tsx`, `api.ts`, `ticket-list.tsx`, `status-badge.tsx`, `use-ticket-events.ts`, `apps/web/src/features/tasks/time-dialog.tsx`, `time-dialog.test.tsx`, `time-api.ts`, `apps/web/src/locales/tickets/<nine>.json`

**Interfaces:**
- Consumes: `TicketDto.confirmation`, `awaitingConfirmation`, the Task 7 routes, `TimeRequestRow.review`.
- Produces: kinds `ticket.awaiting_confirmation` (author), `ticket.confirmation_declined` (riešitelia), `ticket.time_review` (admin); `?confirm=1` on the first of them.

- [ ] **Step 1: Invoke the `frontend-design` skill** before touching a screen, as `CLAUDE.md` requires.
- [ ] **Step 2: Write failing server tests:** each kind in `decide.test.ts`, `categories.test.ts`, `push-content.test.ts` (`?confirm=1` on `ticket.awaiting_confirmation`, `?time=1` on `ticket.time_review`) and `unseen-summary.test.ts`.
- [ ] **Step 3: Write failing web tests** in `ticket-confirmation.test.tsx`, for each row of the spec's section 5.5 by role; a client who is not the author sees nothing; `?confirm=1` focuses the card and sends no request; a failed save shows `errors.generic`. In `time-dialog.test.tsx`: minutes prefilled and "Bez zmeny" sends `keep`. In `ticket-list.test.tsx`: the badge "Čaká na potvrdenie".
- [ ] **Step 4: Run them.** Expected: FAIL.
- [ ] **Step 5: Implement** the kinds, then the component, rendered above the chat and outside the folded details. `admin-done` feeds `askForTime` when the answer says `askTime`. Add the texts in all nine languages.
- [ ] **Step 6: Run** `pnpm test`. Measure the initial JS as in `docs/architecture/performance.md`. Expected: PASS, at or under 200 kB gzip.
- [ ] **Step 7: Commit** `feat(tickets): confirmation bar, card and notifications`.

### Task 12: End to end, dead code, docs, gate

**Files:**
- Create: `e2e/ticket-confirmation.spec.ts`, `docs/decisions/0075-tickets-assigned-to-managers-finished-by-both-sides.md`
- Modify: the docs of the spec's section 8, `docs/decisions/README.md`, and a "What's new" entry if `docs/product/whats-new.md` asks for one

- [ ] **Step 1: Write the end-to-end spec:** a manager creates a ticket on their client; the admin riešiteľ opens it and sees "V riešení"; presses "Vyriešené z našej strany" and fills the time; the author sees the card and presses "Ešte nie je vyriešené"; the admin presses again and the time is prefilled; the author presses "Áno, vyriešené"; the rating card appears.
- [ ] **Step 2: Run it in isolation** with `E2E_PORT=3457 DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_e2e_lifecycle E2E_SUPERADMIN_EMAIL=admin-lifecycle@example.com pnpm test:e2e e2e/ticket-confirmation.spec.ts`. Fix other specs that mention the watch checkbox or the programme. Expected: PASS.
- [ ] **Step 3: Dead-code pass.** Run `pnpm dlx knip --reporter json > /private/tmp/claude-501/knip-after.json` and remove each finding that is not in `knip-before.json`.
- [ ] **Step 4: Name search.** Run:

```bash
grep -rnE "ticket_area|ticketArea|areaRules|area-rules|AutoAssignIcon|ticket_watch|ticketWatch|ticket-watch|watchesTickets|ticketWatcherIds|tickets\.fields\.programme" apps packages e2e --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=migrations
```

Expected: only the audit label kept in Task 2. Then check that every key of `tickets.areaRules`, `tickets.watch` and `tickets.fields.programme` is gone from all nine locales.

- [ ] **Step 5: Write the ADR** (supersedes 0064 and 0069, amends 0021) and update the docs with `update-kb`. Delete the "Automatic assignees by area" and "Watch tickets" sections from `tickets.md`, and "Ticket areas" from `integrations/egrant.md`. Mark `programme` in `egrant-ticket-intake.md` as stored and no longer shown.
- [ ] **Step 6: Run** `bash scripts/ci.sh`. Expected: every check green.
- [ ] **Step 7: Commit** `docs(tickets): lifecycle rework`, push to GitHub and to the `gitlab` remote, and open the PR and MR.
