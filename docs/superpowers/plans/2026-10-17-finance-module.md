# Phase 32 — Finančná správa: plan

Spec: [2026-10-17-finance-module-design.md](../specs/2026-10-17-finance-module-design.md) (read its "Owner decisions" first). Status: **approved** by the owner on 2026-10-17 (every recommendation accepted); part A1 in progress.

Five pull requests. **A1 is merged first**: it fixes the schema, the shared types, the permission and the empty screens, so the other parts only add code in files of their own. Then **A2, B and C run in parallel** (separate worktrees, any merge order, each rebases on the previous merge). **D** starts when B and C are merged (it reuses their list and aggregate functions and their cards). Each part is test-first (`superpowers:test-driven-development`), runs `bash scripts/ci.sh` before merging, and updates its docs with `update-kb`. Any screen work starts with the `frontend-design:frontend-design` skill (CLAUDE.md).

```
A1 foundation ──┬── A2 time on done and on resolve (tasks and tickets, notifications, dashboard)
                ├── B  documents and contracts (+ reminders)          ──┐
                └── C  overview, work log, rates, manual entries, charts ┴── D system-wide page and rankings
```

## Conflict rules for the parallel parts

- **Migrations:** only A1 writes one (all tables of the spec §3). A part that finds it needs a schema change makes its own migration on top of `main` and renumbers it when it rebases; it says so in its PR.
- **Server routes:** A1 creates `modules/finance/routes.ts`, which registers four sub-plugins, each an empty stub file owned by one part: `documents-routes.ts` (B), `log-routes.ts` (C), `system-routes.ts` (D), and A2's task-time routes live in `modules/finance/task-time-routes.ts` (registered outside `requireFinance`). A part edits only its own file.
- **Shared types:** A1 writes `packages/shared/src/finance/` with one file per part (`common.ts`, `time.ts`, `documents.ts`, `overview.ts`, `system.ts`, re-exported from `index.ts`) holding the full DTO and request schemas of the spec §7. A part may refine only its own file.
- **Locales:** A1 creates the namespaces `finance` (shared words: tab, page title, periods, units), `financeDocuments` (B), `financeLog` (C) and `financeSystem` (D), each `{}` or with the shared keys, in all nine languages, and registers them on both routes in `router.tsx`. A part fills only its namespace. A2 writes into `tasks`, `adminHome` and `notifications` (no other part touches those).
- **Web cards:** A1 lays out the grid (`features/finance/finance-tab.tsx`, `finance-page.tsx`) with three placeholder card files: `documents-card.tsx` (B), `overview-card.tsx` and `work-log-card.tsx` (C); D owns `features/finance/system/`. A part edits only its files; the grid file is A1's.
- **Docs:** A1 creates `docs/product/finance.md` with one section per part ("Access", "Time on done", "Documents and contracts", "Overview and work log", "System-wide"); each part fills its section. Edits of shared docs (permissions, realtime, data model, notifications, admin home) go into their own paragraph, appended at the end of the relevant section.

## Interfaces between the parts

Defined by A1 (signatures, with stubs that throw `not implemented` where another part fills them):

```ts
// modules/finance/policy.ts (A1)
canSeeFinance(actor: SessionUser): boolean
canGrantFinance(actor: SessionUser, target: { id: string; role: Role; disabledAt: Date | null }): boolean
canLogOwnTaskTime(actor: SessionUser, assigneeIds: readonly string[]): boolean
canLogOwnTicketTime(actor: SessionUser, ticket: { assigneeIds: readonly string[]; groupId: string | null }): boolean
canEditTimeEntry(actor: SessionUser, entry: { source: 'task' | 'ticket' | 'manual'; userId: string }): boolean
canManageRates(actor: SessionUser): boolean
canAddManualEntry(actor: SessionUser): boolean

// modules/finance/access.ts (A1)
requireFinance(auth): preHandler                       // 401 / 403
grantFinance(deps, actor, targetId) / revokeFinance(deps, actor, targetId)

// modules/finance/events.ts (A1)
FINANCE_ROOM = 'finance'
emitFinanceChanged(io, groupId: string | null, kind: 'items' | 'time' | 'rates'): void
emitTimeRequests(io, userId: string, count: number): void

// modules/finance/scope.ts (A1)
type FinanceScope = { kind: 'group'; groupId: string } | { kind: 'groups'; groupIds: string[] } | { kind: 'all' }
type MonthRange = { from: string /* YYYY-MM */; to: string }
scopeSql(column: AnyPgColumn, scope: FinanceScope): SQL

// modules/files (A1)
setFilesFinanceOnly(tx, fileIds: string[]): Promise<void>
// canReadFile: finance_only checked first; attachFiles refuses finance_only unless { finance: true }

// modules/finance/task-time.ts (A2; must not import modules/tasks)
onTaskCompleted(tx, e: { taskId; groupId; title; completedAt: Date; actorId; assigneeIds: string[]; sourceTicketId: string | null }): Promise<{ askActor: boolean; notified: string[] }>
onTaskReopened(tx, taskId): Promise<string[] /* users whose requests went */>
onAssigneesRemoved(tx, taskId, userIds: string[]): Promise<void>
onTaskDeleting(tx, taskId): Promise<string[]>
listMyTimeRequests(db, userId, limit): Promise<TimeRequestRow[]>
fillTaskTime(deps, actor, taskId, minutes): Promise<TaskTimeDto>
// listMyTimeRequests returns task and ticket requests (TimeRequestRow.kind)

// modules/finance/ticket-time.ts (A2; must not import modules/tickets) — extension of 2026-10-17
onTicketResolved(tx, e: { ticketId; groupId: string | null; title; resolvedAt: Date; actorId; assigneeIds: string[]; linkedTaskIds: string[] }): Promise<{ askActor: boolean; notified: string[]; linkedTasksLogged: boolean }>
onTicketReopened(tx, ticketId): Promise<string[]>
onTicketAssigneesRemoved(tx, ticketId, userIds: string[]): Promise<void>
onTicketMoved(tx, ticketId, groupId: string): Promise<void>
onTicketDeleting(tx, ticketId): Promise<string[]>
getTicketTime(db, actor, ticketId): Promise<TicketTimeDto>
fillTicketTime(deps, actor, ticketId, body: PutMyTicketTimeBody): Promise<TicketTimeDto>

// modules/finance/documents.ts (B)
listItems(db, scope: FinanceScope, filter: { folderId?; type?; q?; after?; sort? }): Promise<FinanceItemPage>
// D's global contracts table and finance search call it with { kind: 'groups' | 'all' }

// modules/finance/aggregates.ts and work-log.ts (C)
costSql(entries alias): SQL                            // the rate lookup (left join lateral)
overview(db, scope: FinanceScope, range: MonthRange): Promise<FinanceOverviewDto>
workLogPage(db, scope: FinanceScope, range: MonthRange | null, before: string | null): Promise<WorkLogPageDto>
// entries carry unitTicketId (ticket_id ?? linked_ticket_id) and the page a `tickets` list: one unit per ticket
listRates(db) / addRate(deps, actor, input) / deleteRate(deps, actor, id)
// D calls overview and workLogPage with a multi-group or all scope

// web (A1): features/finance/api.ts query keys ['finance', groupId|'all', kind, …]; useFinanceEvents(groupId|null)
// web (C):  features/finance/charts/{month-bars,small-multiples,rank-bar,scale}.tsx — D reuses them
```

---

## Part A1 — Foundation (branch `feat/finance-foundation`)

**Goal:** the right exists and is enforced; every finance table exists; the tab and the page exist (empty cards) for finance admins only; finance files and finance notifications are sealed.

Server:
- Migration (next number: **0034** after `0033_drop_ticket_followers`) `finance_foundation`: `user.finance_access_at`, `user.finance_access_by` + CHECK (admins only); `files.finance_only`; `finance_folders`, `finance_items`, `finance_attachments`, `finance_time_entries` (sources `task`, `ticket`, `manual`; `ticket_id`, `linked_ticket_id`, `covered_by_tasks`, spec §3.3), `finance_rates` with every index and CHECK of spec §3; `reminder_sets.finance_item_id` (unique, FK cascade) and the new `reminder_sets_subject_check`. Drizzle in `modules/finance/schema.ts`, `users/schema.ts`, `files/schema.ts`, `reminders/schema.ts` (`SUBJECT_COLUMNS.finance`).
- `modules/auth/auth.ts` (`additionalFields.financeAccessAt`), `session.ts` (`finance` on `SessionUser`; superadmin always true), `packages/shared/src/users.ts` (`SessionUserSchema.finance`, `MeSchema`).
- `modules/finance/{policy,access,events,scope,routes}.ts`; `PUT`/`DELETE /api/admins/:id/finance-access` (in `access.ts`, registered by `routes.ts`); deactivation clears the right (`modules/users/service.ts`); the `finance` room joined on connect (`infra/realtime`), moved on grant/revoke, `me:changed`.
- `modules/files/policy.ts` (`finance_only` first), `files/service.ts` (`attachFiles` refuses finance-only; `setFilesFinanceOnly`), `files/read-rules.ts` untouched but covered by a test.
- Notifications: `finance` in `NotificationCategories`; `visibleCategoriesFor` shows it only to `canSeeFinance`; the audience check drops a `finance` event for someone without the right; `ReminderSubjectKind` gains `'finance'` (the adapter itself is B's).
- `packages/shared/src/money.ts` (`Currencies`, `ENABLED_CURRENCIES = ['EUR']`, `MINOR_DIGITS`, `MoneySchema`, `formatMoney`, `parseMoney`), `packages/shared/src/duration.ts` (`parseDuration`, `formatDuration`), `packages/shared/src/finance/*` (all DTOs of spec §7).
- ADR `docs/decisions/00NN-sealed-finance-module.md` (own tables, own room, finance-only files, why not knowledge types).

Web:
- `features/admins/admins-page.tsx`: a "Finance" switch per admin, shown only to the superadmin.
- `features/groups/group-tabs.tsx`: the `finance` tab when `me.finance`; `router.tsx`: `/groups/$groupId/finance` (lazy `finance-tab`) and `/finance` (lazy `finance-page`), each loading `finance` + its parts' namespaces; a not-found screen for anyone without `me.finance`. Header link and section-menu row "Financie".
- `features/finance/finance-tab.tsx` (the 7fr/3fr × 2fr/3fr grid, the 641–1023 px and phone layouts with the segmented control of spec §9), `finance-page.tsx`, placeholder `documents-card.tsx`, `overview-card.tsx`, `work-log-card.tsx`, `system/` folder, `api.ts`, `use-finance-events.ts` (`finance:changed` → invalidate `['finance', groupId]` with a 2 s debounce; `me:changed` → refetch `/api/me`).
- Locales: the four namespaces in nine languages; the `admins` switch texts; the Finance row in Settings.

Tests (first): policy table (every function, every role, the superadmin, a disabled admin); grant/revoke routes (superadmin only, 404 for a client or unknown id, idempotent, sockets moved); `SessionUser.finance`; `canReadFile` for a finance-only file (finance admin yes; client, ziadatel, other admin no, also through a ticket read rule); `attachFiles` refusal from chat, task and knowledge; `visibleCategoriesFor`; the audience drop; migration CHECKs (a client cannot hold the right; a contract needs its amount; a manual entry needs minutes and a day); `parseDuration`/`parseMoney` tables; web: tab and link only with `me.finance`, the grid's three slots, the segmented control on phones, the Admins switch only for the superadmin.

Docs: `product/finance.md` (new, Access section), `product/roles-and-access.md`, `architecture/permissions.md`, `architecture/realtime.md` (room, events), `architecture/data-model.md`, `product/notifications.md` (the group), `glossary.md`, the ADR, `roadmap.md` (Phase 32 in progress). Bundle: measure the initial JS (expected < +0.3 kB) in `architecture/performance.md`.

Done when: the superadmin turns Finance on for an admin, who sees the empty Finance tab and page live; nobody else does, and every leak test passes.

---

## Part A2 — Time on done (branch `feat/finance-task-time`; after A1)

**Goal:** spec §5 entirely, including §5.6 (tickets, extension of 2026-10-17).

**As built** (branch `feat/finance-a2-time`). Interface changes against the A1 signatures above, all additive: the hooks' results also carry a `TimeChange` (`groupId`, `changed`, `users` whose requests changed, `eventIds` to deliver) that the callers pass to `announceTimeChange` after the commit; `TaskCompletedEvent` and `TicketResolvedEvent` gain `actorName` (the payload's), `TicketResolvedEvent` gains `number` (a ticket entry's title is `#123 Subject`); `onAssigneesRemoved` and `onTicketAssigneesRemoved` return whose requests went; `fillTaskTime` / `getTaskTime` take a `TaskTimeSubject` and `fillTicketTime` / `getTicketTime` a `TicketTimeSubject` read by the routes through the tasks module (`getTaskTimeSubject`) and the tickets module (`ticketAssigneeIds` in `audience.ts`, `listTasksFromTicket`), since finance reads neither table; `myTimeRequests` returns the rows and their count in one statement. Owner decision 24 was decided on 2026-10-17 (time without a client is recorded with `group_id` null): migration **0035** `finance_time_without_client` makes `finance_time_entries.group_id` nullable with CHECK `finance_time_entries_group_check` (only ticket entries). Parts C and D: a `{ kind: 'group' }` scope never matches those entries; `{ kind: 'all' }` (`scopeSql` gives `true`) includes them, and D shows them as "Bez klienta".

Server:
- `modules/finance/task-time.ts` (the hooks and `listMyTimeRequests`, `fillTaskTime`), `task-time-routes.ts` (`GET /api/tasks/:id/time`, `PUT /api/tasks/:id/time/me`: `requireAdmin`, the board check, `canLogOwnTaskTime`).
- `modules/tasks/task-service.ts`: call `onTaskCompleted` in `moveTask` (when `completedAt` is newly set) and `createTask` (created in Completed), `onTaskReopened` (moved out of Completed), `onAssigneesRemoved` in `updateTask`, `onTaskDeleting` in `deleteTask`; return `askTime`; notify after commit with `requestDelivery`; emit `finance:changed` (kind `time`) and `time:requests`. `task-routes.ts`: `askTime` in the move, create and update answers (false for clients).
- Notifications: kind `task.time_missing` (`NOTIFICATION_GROUP_OF` → `tasks`; passes every mode in `decide.ts`), push and digest texts in nine languages (`texts.ts`, `push-content.ts`, `digest-entries.ts`), the deep link `?task=<id>&time=1`.
- `modules/home/routes.ts` / `assigned.ts`: `GET /api/me/home/tasks` adds `timeRequests` (from `listMyTimeRequests`, first 20, tasks and tickets) and `timeRequestCount`.
- Tickets (§5.6): `modules/finance/ticket-time.ts` (the stubs of A1), the ticket routes in `task-time-routes.ts` (`GET /api/tickets/:id/time`, `PUT /api/tickets/:id/time/me`: `requireAdmin`, the ticket's read rule, `canLogOwnTicketTime`); `modules/tickets/service.ts` calls `onTicketResolved` when the status becomes `resolved`, `onTicketReopened`, `onTicketAssigneesRemoved`, `onTicketMoved` and `onTicketDeleting`; the status answer carries `askTime`; the notification kind `ticket.time_missing` (Ticket board group); `onTaskCompleted` gets the task's `source_ticket_id`. The riešitelia come from the tickets module's `modules/tickets/audience.ts` (who answers a ticket, PR #76, which removed per-ticket following); the time ask goes to the **admin** riešitelia only, never to client watchers.
- Web: the ticket dialog with options (a) and (b) and "My time" on the ticket page (`features/tickets/`), reusing the time dialog's parts.

Web:
- `features/tasks/time-dialog.tsx` (lazy chunk; duration field, chips, 0, the 12 h warning, Later, the queue in `time-queue.ts`), opened after a move/create/update answer with `askTime`, from the done circle, drag and the panel's bucket select (group board and global board), and by `time=1` in the URL.
- `features/tasks/task-panel.tsx` / `panel-parts.tsx`: "My time" for admin assignees; the per-assignee list for finance admins (`GET /api/tasks/:id/time`).
- `features/admin-home/cards.tsx`, `count-tile.tsx`: the "Fill in your time" rows on My tasks and the phone list; refetch on `time:requests`.
- Locales: `tasks`, `adminHome` in nine languages.

Tests (first): every row of spec §5.4 against the real database (move, done circle, create in Completed, the global board's panel move, a client actor, a non-assignee admin, reopen, removal, delete, re-complete, filled before completion, two admins at once, concurrency via the unique index); `askTime` per role; the time routes (a client 403, a non-assignee admin 403, an unknown task 404, 0 accepted, > 6000 refused); notification recipients and texts; the home payload; web: dialog parsing and chips, Later, the queue, My time states, the home rows and their click; e2e `e2e/task-time.spec.ts` (spec §14 scenarios 3 and 5).

Docs: `product/task-board.md`, `product/admin-home.md`, `product/notifications.md`, `product/finance.md` (Time on done), `architecture/permissions.md` (task time routes), `architecture/realtime.md` (`time:requests`), `architecture/performance.md` (the Tasks tab chunk delta).

Done when: an admin completes a task, is asked once, the other admin assignee is notified and keeps the dashboard row until they fill 0.

---

## Part B — Documents and contracts (branch `feat/finance-documents`; after A1, parallel with A2 and C)

**Goal:** the Documents card of spec §6.1 with contracts, files and reminders.

Server:
- Move the pure helpers: `knowledge/search.ts` → `infra/text/search.ts` (knowledge re-imports; its tests move along), the folder-tree helpers of `knowledge/folders.ts` (`descendantIds`, `byName`, path building) → `infra/tree.ts`. No behaviour change in knowledge.
- `modules/finance/documents.ts` (items: insert, update with `409 finance_changed`, delete with file cleanup; `listItems` with `FinanceScope`, keyset paging, search on `search_text`), `folders.ts` (`lockGroupFinance`, CRUD, move, delete moves contents up, cycle check), `files.ts` (`POST /api/groups/:id/finance/files`: upload through the files service with `finance_only`), `reminder-subject.ts` (kind `finance`, `routePrefix: 'finance-items'`, `canRead`/`canEdit` = `canSeeFinance`, link `/groups/<id>/finance?item=<id>`, notification group `finance`), `documents-routes.ts`.
- `modules/reminders/subjects.ts`: optional `filterRecipients(db, userIds)` hook used by `replaceReminderSet`, `subscribe` and the fire job (finance keeps only finance admins).
- Notifications: `reminder.due` with `subjectKind: 'finance'` → group `finance` in `notificationGroupOf`; push and digest texts ("Contract <title> · <client>: ends on …") in nine languages.

Web:
- `features/knowledge/folder-dialog.tsx`, `move-dialog.tsx`: their API calls as props (knowledge passes its own; no visible change).
- `features/finance/documents-card.tsx`, `documents/{item-list,item-row,item-sheet,item-form,contract-fields,new-menu}.tsx`, money input (`parseMoney`/`formatMoney`), the reminders section with the 30-days-before-end proposal.
- Locales: `financeDocuments` in nine languages.

Tests (first): items and folders CRUD and paging, contract CHECKs through the API (`400` for a missing amount, end before start, a disabled currency), search, folder move cycles, `409`, finance-only files (upload, attach only to finance items, download rules), the reminder adapter (non-finance recipient refused, fire job drops a revoked admin, calendar export, the `finance` group), the knowledge search and the chat picker never returning a finance item; web: the card's list, filters, new menu with four kinds, contract form validation, the sheet; e2e scenario 2 in `e2e/finance.spec.ts`.

Docs: `product/finance.md` (Documents and contracts), `product/contracts.md` (superseded, pointer), `product/reminders.md`, `product/notifications.md`, `architecture/permissions.md`, `architecture/data-model.md` (indexes as built), `architecture/overview.md` (API).

Done when: a finance admin keeps a client's contracts, documents and notes in folders, gets the contract reminder, and nobody else can reach any of it.

---

## Part C — Overview, work log, rates, manual entries (branch `feat/finance-log`; after A1, parallel with A2 and B)

**Goal:** the Overview and Work log cards of spec §6.1, the rates dialog (§6.2, step 3) and manual entries (§6.3), with the charts.

Server:
- Ticket units (2026-10-17): the work log groups a ticket with its linked tasks (`unitTicketId`, the page's `tickets` list with numbers and live titles through the tickets module's exported title batch); totals count every row once, (b) answers add 0; the overview and the summaries add `ticketCount`.
- `modules/finance/rates.ts` (lookup rule, "from the start", history, add, delete), `aggregates.ts` (`costSql`, `overview` per currency and month, hours per admin and month, missing rates), `work-log.ts` (`workLogPage`: 200 entries a page, month totals for the months on the page, period summary, `getTaskTitles` batch, names batch), `manual-entries.ts` (create, edit, delete; edits of task entries by finance admins), `log-routes.ts`.
- `modules/finance/test-volume.ts` and `explain.test.ts` (spec §10 volume and limits); the EXPLAIN numbers go into `architecture/performance.md`.

Web:
- `features/finance/charts/` (`scale.ts` with `niceScale`, `monthAxis`; `month-bars.tsx`; `small-multiples.tsx`; `rank-bar.tsx`; `chart-table.tsx` fallback), chart tokens `--chart-1…3` in the theme (light and dark).
- `overview-card.tsx` (Money · Hours switch, period filter with `useRememberedFilters`, totals per currency), `work-log-card.tsx` (sticky summary, chronology oldest-top with "Show earlier", entry menu), `manual-entry-dialog.tsx`, `rates-dialog.tsx` (opened from the tab's work log summary and, later, from `/finance`).
- Locales: `financeLog` in nine languages.
- ADR `docs/decisions/00NN-finance-charts-own-svg.md` (spec §8 table and decision).

Tests (first): rate lookup (history, "from the start", none), cost rounding once per total, per-currency totals (EUR and UAH contracts never summed), paid vs to be paid around today (Bratislava), month boundaries, requested entries excluded, deleted-task entries shown with their title, manual entry validation (future day, non-admin user, 0 allowed), every route 403 for a non-finance admin, paging; EXPLAIN on the volume; web: `niceScale`/`monthAxis`, bars and table fallback, the cards' empty/loading/error states, the work log's order and "Show earlier" keeping the scroll, the rates dialog; e2e scenario 4.

Docs: `product/finance.md` (Overview and work log), `architecture/overview.md` (API), `architecture/performance.md` (chunks and EXPLAIN), `architecture/realtime.md` (kinds `time` and `rates` consumers), the ADR.

Done when: a finance admin sees a client's money and hours by month, the work log by month and day with costs, sets rates with history, and adds a manual entry.

---

## Part D — System-wide page and rankings (branch `feat/finance-system`; after B and C)

**Goal:** spec §6.2.

Server:
- `modules/finance/rankings.ts` (paid by client for a year/month and currency; hours by client for a period, optional admin, sort by hours or cost; 20 a page, keyset on `(value desc, group_id)`), `system-routes.ts` (`GET /api/finance/overview`, `/work-log`, `/contracts`, `/rankings/paid`, `/rankings/hours`, reusing `overview`, `workLogPage`, `listItems` with `{ kind: 'groups' | 'all' }`).
- EXPLAIN cases for the rankings and the all-clients overview on the part C volume.

Web:
- `features/finance/system/{system-page,contracts-card,paid-ranking-card,hours-ranking-card,client-filter}.tsx` inside the A1 page grid; the rates button; the phone segmented control's fourth segment (Rankings); the client filter reused from the knowledge list (remembered, default all).
- Locales: `financeSystem` in nine languages.

Tests (first): rankings (ties, months, currency switch, admin filter, sort by cost with missing rates, paging), the clients filter (`400 invalid_filter` for a bad one), the contracts table sort and "ending soon"; web: the cards, filters, phone layout; e2e scenarios 1, 6 and 7, then the whole `e2e/finance.spec.ts`.

Docs: `product/finance.md` (System-wide), `architecture/overview.md`, `architecture/performance.md`, `roadmap.md` (Phase 32 done, Phases 14–15 "merged into 32" if the owner chose decision 3), the owner's walk list.

Done when: the spec's "Done when" holds: a finance admin sees every client's money and hours on `/finance`, ranks clients by money paid in a month and by an admin's hours or cost, and every number matches the client tabs.

---

## Phase "Done when"

A superadmin grants Finance to an admin; that admin keeps a client's contract with its reminder, the team's completed tasks fill the work log with hours (the other admin assignee is asked and fills 0), rates turn hours into cost, and `/finance` ranks the clients by money paid and by hours; no client and no admin without the right ever sees any of it (tab, page, search, files, notifications, sockets).

## Owner walk (after D, on https://help.egrant.sk)

Turn Finance on for one admin; add a real contract with its PDF; complete a task with two admin assignees on a phone and on a computer; check the push to the other admin and the dashboard row; set two rates; compare a client's tab with `/finance`; check that another admin and a client see nothing.
