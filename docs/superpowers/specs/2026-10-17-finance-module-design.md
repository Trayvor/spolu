# Phase 32 — Finančná správa (financial administration): design

Date: 2026-10-17 · Status: **approved** by the owner on 2026-10-17: decisions 1–22 of the "Owner decisions" table are accepted as written. The owner extended the phase the same day with time on tickets (request item 6, decisions 23–26, §5.6), built into the data model by part A1; decision 24 (tickets without a client) waits for the owner's confirmation. Built so far: part A1 (foundation, merged) and part B (documents and contracts, [finance.md](../../product/finance.md#documents-and-contracts)). Plan: [2026-10-17-finance-module.md](../plans/2026-10-17-finance-module.md). Roadmap: [Phase 32](../../roadmap.md#phase-32--finančná-správa).

Builds on the [knowledge base](2026-10-16-phase-17-knowledge-base-design.md) and its [folders](2026-10-16-phase-24-knowledge-folders-design.md), [reminders](2026-10-16-phase-19-task-reminders-design.md), the [admin home](2026-10-16-phase-20-admin-home-design.md), [notification groups](2026-10-16-notification-groups-design.md) and [the dashboard follows the notifications](2026-10-17-dashboard-follows-notifications-design.md). Rules: [permissions](../../architecture/permissions.md), [performance](../../architecture/performance.md), [realtime](../../architecture/realtime.md).

## Owner's request (translated from Ukrainian, intent kept)

1. Only people with the right see the module. The superadmin grants the right, and only an admin can hold it (a **finance admin**).
2. A new tab on the client (group) level: a dashboard split **40/60 by height** and **70/30 by width** into 3 cards: two wide ones on the left (top and bottom) and a tall one on the right.
   - 2.1 **Bottom left:** like the knowledge base, but only 4 kinds can be created: **Zmluva** (contract: one or more files, title, description, optional number, an amount in EUR — UAH comes in a few months, so money is multi-currency from day one —, a contract period from–to, and the same reminders as elsewhere, with notifications), **Document**, **Note** and **Folder** as in the knowledge base.
   - 2.2 **Right ("work log"), tied to a change of the task board:** for every task with an assigned admin, when that admin presses "done" or moves the task into Completed, a dialog asks how much time they spent (unless it is filled already; it can also be filled when editing the task). After a task is done, the other admin assignees who have not filled their time get a notification asking for it; until they fill it (0 is valid) a "you forgot to fill in your time" item stays on their dashboard's tasks card. In the finance tab the card shows a chronology by month: the days on which admins did work for this client (a task marked done) and the hours; newest at the bottom, older above; split by months; at the start of each month the total hours, tasks and hours per admin. Above the whole chronology: total hours, tasks and hours per admin, and a period filter.
   - 2.3 **Top left:** money and hours of the client. Default view **money**: how much the client paid and will pay according to the contracts (the payment date is the contract's start date); a chart on the left, on the right a small filter, the totals and a switch to view 2. View 2 **hours**: a chart of the hours spent over all time, 1 to n charts, one per admin who worked for the client.
3. The finance admin sets each admin's **hourly rate**. Wherever hours per admin and client totals are shown, the money the service cost is shown too. The money card also shows how much we spent on the client.
4. The finance admin adds **manual entries** to the work log: "admin X spent N hours", choosing when.
5. A **system-wide finance dashboard**: the same across all clients and admins, plus a client filter, plus two cards: (1) clients ranked by money paid, with a year/month filter; (2) clients ranked by hours spent, with an admin filter and a switch to rank by money instead of hours.
6. **Extension of 2026-10-17: tickets get time like tasks.** When a ticket is marked resolved, its admin riešitelia are asked how many hours they spent (the resolving admin by the dialog, the others by the "fill in your time" notification and dashboard row until they answer; 0 is valid). When the ticket has linked tasks (`tasks.source_ticket_id`) that are done with hours logged, the dialog offers two answers: (a) hours for the ticket itself, or (b) "the hours on the linked tasks already cover it" — an explicit answer that fills the request and records no extra time. Admins can always add ticket hours on top of the linked tasks' hours, from the dialog and later from the ticket page. The work logs (client tab, `/finance`) and the rankings show a ticket and its linked tasks as one unit (the ticket with its own hours, its tasks under it), and totals never double count. Tickets without a client: see decision 24.

## Owner decisions

Each one is a recommendation we build unless the owner says otherwise. **B** marks a business choice the owner must confirm; the others are technical defaults we take.

| # | Question | Recommendation | Why |
|---|---|---|---|
| 1 | **B** Does the superadmin see Finance without granting it to themselves? | **Yes.** The superadmin always has finance access; the flag is for other admins. | The superadmin grants the right, so hiding the data from them protects nothing and adds a step. |
| 2 | **B** Who grants and removes the right? | **Only the superadmin**, on the Admins page (a "Finance" switch per admin). A finance admin cannot pass it on. | The owner's words; keeps the circle small and auditable. |
| 3 | **B** The planned Phases 14–15 (Contracts for **every** admin, a global contract list, "ending soon" marks): keep them separately or let Finance replace them? | **Finance replaces them.** Contracts exist only inside Finance, so only finance admins see them; Phases 14 and 15 become "merged into 32". The global contract list and the "ending soon" mark live on the system-wide finance page (§6). | Two contract stores would split the data and leak amounts to admins without the right. **This narrows who sees contracts** compared with `product/contracts.md` (all admins), hence a business decision. |
| 4 | **B** Who is asked for their time? | **Every admin assignee (admin or superadmin) of every task**, on every client's board, whether or not they are a finance admin. Clients are never asked. No per-client opt-out at first. | Every task belongs to a client (`tasks.group_id` is required), so "only on clients' boards" is all boards today. An opt-out per client can come later if an internal group appears. |
| 5 | **B** What does an admin without the finance right see of time? | **Only their own time** on a task (the panel's "My time" and the dialog). Never other admins' time, never money, never the work log. | Asking for time must not show the finance data it feeds. |
| 6 | **B** One time entry per task or per completion? | **One entry per admin per task.** Reopening a task cancels the requests not yet answered; filled time stays. Completing it again asks only the admin assignees with no filled time. The entry counts on the day of its task's **first** completion, so a closed month's totals do not move; its minutes can be edited later (the panel or the work log). | Simple, matches "unless already filled", and keeps past months stable. More work after a reopen is added by editing the same entry. |
| 7 | **B** A task with filled time is deleted. | **The filled time stays** in the work log with the task's title as it was ("deleted task"); unanswered requests go. | The work was done and paid for; deleting a card must not erase the hours. |
| 8 | Closing the dialog without saving ("Later"). | **A request stays for the actor too** (the dashboard item), but no notification (they saw the dialog). | Same outcome as the other assignees, without a needless push. |
| 9 | **B** The notification to the other admin assignees. | A new kind `task.time_missing` in the **Task board** notification group, sent once, passing every mode (Off included) like a reminder: it is a direct request. The dashboard item stays until the time is filled, **whatever the notification settings** (it is assigned work, like My tasks). No repeat reminders at first. | A request to one person is not channel noise; the dashboard rule of 2026-10-17 already lists assigned work regardless of settings. A weekly nudge can come later if requests pile up. |
| 10 | **B** Hourly rates and history. | **Rates with an effective date.** A new rate applies from the date chosen (default: the first day of the current month); the first rate of an admin applies to all their earlier work ("from the start"). Past cost changes only when someone edits a past rate. | Raising a rate must not rewrite last year's cost. |
| 11 | **B** Currencies. | **EUR now, UAH later, never converted.** Money is stored as integer minor units with an ISO code. Every total is per currency; hourly rates and therefore cost are in EUR. When a client has contracts in two currencies, the money card shows both lines and the chart has a currency switch. The paid ranking ranks one currency at a time (EUR by default). | Exchange rates are a business rule of their own (which day, which source). Without one, adding EUR to UAH would be wrong; it can be added later as a rate table. |
| 12 | **B** When is a contract "paid"? | **The whole amount on the contract's start date** (owner's words): paid = start date today or earlier, "will pay" = later. No instalments at first. | The owner said so; instalments can become a child table later without changing the totals' API. |
| 13 | **B** Must a contract have a file? | **No:** 0 or more files; a contract without a file shows "No file" in the list. | Contracts are often entered before the signed scan exists; the owner's "one or more" is read as "several are allowed". |
| 14 | **B** The contract reminder's default. | The form proposes **one reminder 30 days before the end date at 09:00** (Europe/Bratislava), the author as recipient; times and recipients are edited as everywhere. Recipients can only be finance admins. | Matches the old Phase 15 example (30 days before signing the next contract). |
| 15 | The tab's name. | Tab **Financie** (EN "Finance"), page title **Finančná správa** (EN "Financial administration"); header link "Financie" for finance admins. | Short enough for the tab pills on a phone. |
| 16 | **B** The system-wide dashboard's bottom-left card. | **A list of contracts across clients** (client, title, number, period, amount, "ending soon" mark, sort and filters) with a search over every finance document and note. No folder browsing across clients. | That is the old Phase 14 global contract list; folders only make sense inside one client. |
| 17 | The system-wide page's default client filter. | **All clients** (the filter is remembered per person). | Finance is a team-wide view; "my clients" is a task-board habit. |
| 18 | Default periods. | The work log: **all time**, paged (older months load at the top). The overview chart: **the last 12 months and the next 12** (contracts not started yet). The rankings: **this year**. | Each shows something useful on the first open. |
| 19 | Phones. | The three cards become **one card at a time** under a segmented control "Overview · Documents · Work log" (remembered); see §9. | Three long cards stacked would bury the work log. |
| 20 | **B** An admin with finance access is deactivated. | **The right is removed** with the deactivation; reactivating needs a new grant. | Nobody gets financial data back silently. |
| 21 | Charts. | **Our own small SVG components**, no chart library (§8, ADR in part C). | About 4 kB gzip instead of 20–95 kB; the charts needed are bars only. |
| 22 | Knowledge code reuse. | **A sibling module `modules/finance`** with its own tables, sharing knowledge's pure helpers (search text, folder tree) and generic web components; nothing in `knowledge_*` tables. | Finance rows can then never appear in any existing knowledge list, search, chat attachment, chat-file mirror or digest; every one of those reads `knowledge_*` only. See §4. |
| 23 | **B** Tickets ask time like tasks (extension of 2026-10-17). | **Yes, as owner's request item 6.** Every admin riešiteľ of a ticket with a client is asked on resolve; option (b) "covered by the linked tasks" is a stored answer (a filled entry of 0 minutes with `covered_by_tasks`), so no reminder stays and nothing is added. One entry per admin per ticket, as for tasks (decision 6): reopening drops unanswered requests, filled time stays, it counts on the day of the first resolution. The notification is a kind of its own, `ticket.time_missing`, in the **Ticket board** group, passing every mode like `task.time_missing`. | Same habit as tasks, one dialog to learn; storing (b) explicitly tells "answered, nothing extra" from "not answered". |
| 24 | **B** Tickets without a client. | **Recommended: ask no time** while a ticket has no client (`canLogOwnTicketTime` refuses, no request, no dialog). When it gets a client later, its riešitelia can add their time from the ticket page (no request is created afterwards); entries of a ticket that moves to another client move with it (`onTicketMoved`). Alternative (not built): record such time "without client" and show it only on `/finance`, which would need `group_id` nullable on every finance aggregate and an extra row in every ranking. *To be confirmed by the owner (the coordinator asks).* | Finance is per client: a time entry with no client could not appear in any client tab, and intake tickets without a client are usually triage, not billable work. Keeping `group_id` required keeps every query and index simple. |
| 25 | A ticket and its tasks as one unit. | A task entry stores its task's ticket (`linked_ticket_id`, copied from `tasks.source_ticket_id` by the hooks, since finance never reads `tasks`); the work log groups rows by `coalesce(ticket_id, linked_ticket_id)`. Ticket entries and task entries are separate rows, so every total sums each row once. Tasks made from a meeting (`tasks.source_meeting_id`, 2026-10-17) are plain task rows, no unit. | Grouping by a stored column needs no join with the tasks module and stays correct after a task or ticket is deleted. |
| 26 | Ticket time and the leak rules. | Like tasks: `TicketDto` and `TicketListItem` get **no time field**; `GET /api/tickets/:id/time` answers only about the caller (their own entry, their own minutes on the linked tasks, and a yes or no "linked tasks have logged time") unless the caller is a finance admin, who also gets every admin riešiteľ's time. | Asking for time must not show the finance data it feeds (decision 5). |

## 1. Goal and scope

Finance admins see, per client and across clients: what was agreed and paid (contracts), what the work cost (hours × rates), and the documents behind it. The task board gains a light "how much time did you spend" step for admin assignees, which feeds the work log. Nothing of it reaches clients, requesters or admins without the right.

Out of scope (later): instalments and invoices, exchange rates, a per-client opt-out of time tracking, repeat reminders for missing time, exports (CSV/PDF), budgets and alerts, clients seeing their own hours.

## 2. Roles and the permission model

### 2.1 The right

- Stored on the user row: `user.finance_access_at timestamptz null` and `user.finance_access_by text null` (who granted it). Null means no right. A CHECK keeps it on admins only: `finance_access_at is null or role in ('admin', 'superadmin')`. Migration in part A1.
- Read with the session: the column is a better-auth `additionalFields` entry (like `disabledAt`, `input: false`), and `toSessionUser` adds `finance: boolean` to `SessionUser` (`role === 'superadmin' || financeAccessAt !== null`, decision 1). Sessions read the user row on every request (no cookie cache), so a grant or a removal acts on the next request. `GET /api/me` (`MeSchema`) carries `finance` for the web.
- Grant and remove: `PUT` / `DELETE /api/admins/:id/finance-access`, superadmin only (`canGrantFinance`), target an active admin (not the superadmin, who always has it; a client or unknown id answers `404`). Idempotent, rate-limited like the manager routes. Deactivating an admin clears it (decision 20).
- Sockets keep a `SessionUser` snapshot, so the grant routes also move the target's sockets: `io.in('user:<id>').socketsJoin('finance')` / `socketsLeave('finance')`, update `socket.data.user.finance`, and push `me:changed` to `user:<id>` so the web refetches `/api/me` (the tab and the header link appear or vanish).

### 2.2 Policy functions (`modules/finance/policy.ts`, test-first)

| function | rule |
|---|---|
| `canSeeFinance(actor)` | `isAdmin(actor) && actor.finance` (superadmin: always). Gate of **every** finance route, the `finance` room and every finance notification. |
| `canGrantFinance(actor, target)` | actor is the superadmin; target is an active `admin`. |
| `canLogOwnTaskTime(actor, assigneeIds)` | `isAdmin(actor)` and the actor is an assignee of the task now. Used by the task dialog and the panel's "My time". |
| `canLogOwnTicketTime(actor, ticket)` | `isAdmin(actor)`, the ticket has a client, and the actor is one of its riešitelia now (2026-10-17). |
| `canEditTimeEntry(actor, entry)` | `canSeeFinance(actor)`, or the entry is a task or ticket entry of the actor themselves. |
| `canManageRates(actor)` / `canAddManualEntry(actor)` | `canSeeFinance(actor)`. |

- Every finance route sits in one Fastify plugin whose preHandler is `requireFinance` (no session `401`, not `canSeeFinance` `403 forbidden`). Inside, a finance item, folder, entry or rate of an unknown id or of another group than the path's answers `404 not_found`. Clients and non-finance admins therefore never get a finance row, whatever id they send.
- The task-time routes (`/api/tasks/:id/time…`) are outside that plugin (they serve every admin assignee): `requireAdmin`, then the task's `canUseBoard`, then `canLogOwnTaskTime`. They answer only about the caller unless `canSeeFinance`.

### 2.3 Where finance data must never appear (and how that is guaranteed)

| surface | guarantee |
|---|---|
| Knowledge tab, global knowledge list, knowledge search, card view, Meetings card | Finance rows live in `finance_*` tables, which no knowledge query reads. |
| Chat: knowledge picker, attached knowledge cards, chat files mirrored into knowledge | The picker and `shareableItemCards` read `knowledge_items` only. A finance file cannot be attached to a message (below). |
| Files | `files.finance_only boolean not null default false`, set at upload by the finance upload route. `canReadFile` checks it **first**: a finance-only file is readable only when `canSeeFinance`, before any group rule or registered read rule (ticket rules, attached knowledge) is asked. `attachFiles` of chat, tasks, tickets and knowledge refuses a finance-only file (`400 invalid_attachment`), and finance's own attach accepts only finance-only files. |
| Reminders | A new subject kind `finance` (FK `reminder_sets.finance_item_id`). Its adapter's `canRead` and `canEdit` are `canSeeFinance`; a new optional adapter hook `filterRecipients(db, userIds)` keeps only finance admins when recipients are added or subscribe, and the fire job drops a recipient who lost the right. Upcoming reminders on the admin home list them only for their (finance) recipients, through the existing `canRead` filter. |
| Notifications (push, email digest, bell) | A new notification group **Finance** (`finance`), visible in Settings only to finance admins (`visibleCategoriesFor`). Delivery of a `finance` event re-checks the right at send time (the audience check), so a revoked admin gets nothing queued earlier. `task.time_missing` carries only the task id, title and client, never money. |
| Realtime | Finance events go only to the `finance` room (finance admins' sockets), never to `group:<id>`, `group:<id>:admins` or `admins`. |
| Task DTOs, the board, the global board, "Open in Claude" prompts, AI task split | Time lives in `finance_time_entries`; `TaskDto` and `TaskDetailDto` get no time field. The task panel asks `GET /api/tasks/:id/time` separately (admins only). The Claude prompt builder never reads finance tables. |
| Admin home | The "fill in your time" rows list only the caller's own requests (task or ticket title and client, no money). |
| Tickets (2026-10-17) | `TicketDto` and `TicketListItem` carry no time; `GET /api/tickets/:id/time` answers about the caller only (their entry, their own minutes on the linked tasks, a yes or no for "linked tasks have logged time") unless `canSeeFinance`. `ticket.time_missing` carries only the ticket id, title and client. |

Tests in every part assert these: a client, a ziadatel and a non-finance admin get `403`/`404` on every finance route; the knowledge global search does not find a contract's title; a finance file is `404` for a group's client and a non-finance admin even with its id; chat send with a finance file id is refused; a finance reminder cannot add a non-finance admin; no finance event reaches a group room.

## 3. Data model

All tables belong to `modules/finance` (`modules/finance/schema.ts`), one migration in part A1 (number after the latest at merge time: 0034, after `0033_drop_ticket_followers`). Ids are text like elsewhere. Money is integer **minor units** (`bigint`, cents) plus an ISO 4217 code; time is integer **minutes**. Dates of work are `date` in Europe/Bratislava.

### 3.1 Currencies (shared)

`packages/shared/src/money.ts`: `Currencies = ['EUR', 'UAH']` (UAH accepted by the schema only once the owner turns it on: `ENABLED_CURRENCIES = ['EUR']` in the same file, the one switch), `MINOR_DIGITS = { EUR: 2, UAH: 2 }`, `MoneySchema = { amountMinor: int ≥ 0, currency }`, `formatMoney(m, locale)` with `Intl.NumberFormat`, `parseMoney(text, currency)` (accepts `1 200,50` and `1200.50`). No floating point anywhere in sums; the server sums `bigint`, the API sends minor units as numbers (safe below 2^53, i.e. any realistic amount).

### 3.2 Documents, notes, folders and contracts

```
finance_folders (id, group_id → groups cascade, parent_id → finance_folders, name 1..100,
                 created_by → user, created_at, updated_at)
  idx (group_id), (parent_id)

finance_items (id, group_id → groups cascade, type in ('contract','document','note'),
               folder_id → finance_folders, title ≤ 200, body text (Markdown ≤ 10 000) default '',
               -- contract only (CHECK: (type = 'contract') = (amount_minor is not null) …):
               contract_number text ≤ 60 null, amount_minor bigint ≥ 0 null, currency text null,
               starts_on date null, ends_on date null (CHECK ends_on >= starts_on),
               search_text text, created_by → user, created_at, updated_at (precision 3))
  idx (group_id, created_at desc nulls first, id desc nulls first)          -- the card's list
  idx (folder_id, group_id, created_at desc nulls first, id desc nulls first) -- a folder's page
  idx (starts_on, group_id) where type = 'contract'                          -- money by month, paid ranking
  idx (ends_on) where type = 'contract'                                      -- "ending soon"
  gin (search_text gin_trgm_ops)
  idx (created_by)

finance_attachments (item_id → finance_items cascade, file_id → files cascade, pk (item_id, file_id))
  idx (file_id)
```

- A **document** is title, description and files (the knowledge "file" type); a **note** is title and Markdown body with optional files; a **contract** adds number, amount, currency, period. Contract fields live in `finance_items` (five nullable columns under one CHECK) rather than a side table: one row per contract keeps the money queries to one table.
- No visibility column: every finance admin sees everything of Finance.
- Folders behave like knowledge folders without the admins-only part: nested, breadcrumbs, "Move to…", deleting a folder moves its contents up. Writes of a group run under a transaction advisory lock (`lockGroupFinance`), as `lockGroupKnowledge` does.
- Reminders: `reminder_sets.finance_item_id → finance_items cascade`, unique, the CHECK becomes `num_nonnulls(knowledge_item_id, task_id, finance_item_id) = 1`. Only contracts offer reminders in the form (the server accepts them on any finance item; simplest and harmless).
- Files: `files.finance_only` (§2.3); finance files belong to the client's group like other files (storage, cleanup, the group cascade).

### 3.3 Time entries

```
finance_time_entries (
  id, group_id → groups cascade,
  user_id → user                      -- the admin who worked (never a client: checked by the service)
  source text in ('task', 'ticket', 'manual'),
  task_id → tasks on delete set null      -- task entries; null otherwise and after the task is deleted
  ticket_id → tickets on delete set null  -- ticket entries (2026-10-17); null otherwise and after the ticket is deleted
  linked_ticket_id → tickets on delete set null  -- a task entry's ticket (tasks.source_ticket_id): the work-log unit
  title text                          -- the task's or ticket's title when the entry was created or last filled
  minutes integer null CHECK (minutes between 0 and 6000)   -- null = asked, not answered yet
  worked_on date null                 -- the Bratislava day it counts on; null only for a task or ticket entry
                                      -- filled before its subject was ever completed or resolved
  covered_by_tasks boolean default false  -- a ticket entry answered "the linked tasks' hours cover it" (option b)
  note text ≤ 500 default ''          -- manual entries
  created_by → user, updated_by → user, created_at, updated_at, filled_at null
)
  unique (task_id, user_id) where task_id is not null                -- one entry per admin per task
  unique (ticket_id, user_id) where ticket_id is not null            -- one entry per admin per ticket
  idx (group_id, worked_on, id) where minutes is not null and worked_on is not null   -- the work log, client aggregates
  idx (worked_on, group_id) where minutes is not null and worked_on is not null       -- system-wide aggregates, hours ranking
  idx (user_id, worked_on) where minutes is not null and worked_on is not null        -- per-admin filter, rates join
  idx (user_id) where minutes is null and worked_on is not null                       -- my open requests (dashboard)
  idx (task_id) where task_id is not null                                             -- a task's entries, the FK
  idx (coalesce(ticket_id, linked_ticket_id), worked_on) where either is not null     -- a ticket unit's entries
  idx (linked_ticket_id) where linked_ticket_id is not null                           -- the FK
  CHECK subject: task → ticket_id null; ticket → task_id and linked_ticket_id null; manual → all three null
  CHECK source <> 'manual' or (minutes is not null and worked_on is not null)
  CHECK source = 'manual' or title is not null
  CHECK not covered_by_tasks or (source = 'ticket' and minutes = 0)
```

A task or ticket entry keeps its `source` and `title` after its subject is deleted (`task_id` / `ticket_id` null), so the CHECKs do not require the subject id.

States of a task or ticket entry: **requested** (`minutes` null, `worked_on` set: the task was completed or the ticket resolved and the admin has not answered), **filled** (`minutes` set; for option (b) `minutes = 0` and `covered_by_tasks`). Only filled entries with a `worked_on` count anywhere. An entry filled before the first completion (resolution) has `worked_on` null and starts counting then (its `worked_on` is set, and no request or dialog follows). No double counting by construction: a ticket's own hours and its linked tasks' hours are different rows, each summed once, and option (b) adds 0.

### 3.4 Hourly rates

```
finance_rates (id, user_id → user, rate_minor bigint > 0, currency text (EUR),
               effective_from date null,   -- null = "from the start" (only one such row per admin)
               created_by → user, created_at)
  unique (user_id, coalesce(effective_from, '-infinity'))
  idx (user_id, effective_from desc nulls last)
```

The rate of an entry is the admin's row with the latest `effective_from ≤ worked_on` (null counting as the earliest). Cost of a set of entries = `round(sum(minutes × rate_minor) / 60)` in minor units, rounded once per shown total, never per entry. An entry whose admin has no applicable rate has no cost; totals then show the cost of the rest and "N h without a rate" (a link to the rates dialog for finance admins).

### 3.5 Who owns what (module boundaries)

- `modules/finance` owns every `finance_*` table and `files.finance_only` semantics (through the files module's exported setter, as knowledge does with `setFilesAdminsOnly`).
- The tasks module calls finance's exported hook functions inside its own transactions (`modules/finance/task-time.ts`, which imports nothing from `modules/tasks`, so there is no import cycle): `onTaskCompleted`, `onTaskReopened`, `onAssigneesRemoved`, `onTaskDeleting`. Finance reads task titles for its pages through the tasks module's exported `getTaskTitles`, never by joining `tasks`.
- The home module gets the caller's open requests through finance's exported `listMyTimeRequests(db, userId)`; it never reads finance tables.
- Group names and logos come from the groups service; admin names from the users service.

## 4. Why a sibling module and not more knowledge types

Adding `contract` as a knowledge type with a `finance` visibility would reuse more code, but every existing knowledge query (tab, global list, search, card view, scope, chat picker, shareable check, folder paths, meeting card, events to `group:<id>:admins`) would need a new filter, and one missed filter leaks amounts to every admin. A sibling module gets that safety by construction. To keep it small:

- Server: reuse `normalizeSearch`, `searchTerms`, `escapeLike`, `buildSearchText` (knowledge `search.ts`) and the folder tree helpers (`descendantIds`, `byName`, path building) by moving the pure ones to `infra/text/search.ts` and `infra/tree.ts` (part B, a pure move with knowledge's tests kept). The finance service follows `knowledge/service.ts`'s shape (insert, update with the `updated_at` check, delete with file cleanup) but is much smaller: no visibility, no chat files, no meetings.
- Web: reuse the generic pieces as they are (`FilesField`, `FormattedTextField`, `Breadcrumbs`, `folder-tree.ts`, icons, `RecipientsField`, the reminders section); `FolderDialog` and `MoveDialog` get their two API calls as props (a small refactor in part B, knowledge passes its own). The finance list and form are their own components (the contract fields and money input do not belong in the knowledge form).

## 5. The task-board change (time on done)

### 5.1 When a task becomes done

"Done" is the moment `tasks.completed_at` goes from null to a time: the done circle, a drag into Completed, the panel's bucket select (also on the global board), and creating a task straight in Completed. Moving inside Completed is not a new completion. In that transaction the tasks module calls `onTaskCompleted(tx, { taskId, groupId, title, completedAt, actorId, assigneeIds })`, which:

1. takes the **admin assignees** (active admins and the superadmin among the assignees; clients are never asked);
2. for each without an entry: inserts a requested entry (`minutes` null, `worked_on` = the Bratislava date of `completedAt`); for each with a filled entry but no `worked_on`: sets it (it starts counting); an existing filled entry with a date is left alone (decision 6);
3. records `task.time_missing` for every admin assignee with a requested entry **except the actor** (decision 8);
4. returns `askActor: boolean`: the actor is an admin assignee whose entry is requested.

The move, create and update answers carry `askTime: boolean` (from `askActor`). The web opens the time dialog when it is true. Clients' answers never carry it (always false for them).

### 5.2 The dialog

- Title "How much time did you spend?" with the task's title and client. A duration field that accepts `1:30`, `1,5`, `1.5`, `90m`, `2h`, `2h 15m` (`parseDuration` in `packages/shared`, shown back as "1 h 30 min"), quick chips 15 min, 30 min, 1 h, 2 h, 4 h, and **0** as a chip of its own ("No time"). Above 12 h a soft warning ("That's more than a working day. Correct?"); above 100 h refused.
- **Save** writes `PUT /api/tasks/:id/time/me { minutes }`. **Later** closes; the request stays (dashboard item, no notification).
- The board does not wait for the dialog: the move is already done and shown; the dialog is a sheet on phones (`SheetDialog`), focus returns to the card.
- Several tasks completed quickly open one dialog after another (a small queue), never two at once.

### 5.3 The task panel

For an admin assignee, the Details tab shows **My time** under the assignees: "Not filled" (amber, with "Fill in") or "1 h 30 min" (with "Edit"); it opens the same dialog. It is there before completion too (pre-filling, §3.3). A finance admin also sees each admin assignee's time in a small list ("Time: Eva 1 h 30 min, Ján not filled"). Clients and other admins see nothing. Data: `GET /api/tasks/:id/time` → `{ mine: { minutes: number | null, requested: boolean } | null, assignees?: { userId, name, minutes, requested }[] }` (`assignees` only for finance admins).

### 5.4 The other cases

| case | behaviour |
|---|---|
| several admin assignees | each has their own entry; each is asked (the actor by the dialog, the others by the notification) |
| an admin who is not an assignee completes the task | no dialog for them; every admin assignee is notified |
| a client completes the task | every admin assignee is notified |
| a task with only client assignees, or none | nothing happens |
| the task is reopened (moved out of Completed) | `onTaskReopened`: requested (unanswered) entries are deleted, so the dashboard items vanish; filled entries stay; completing it again follows §5.1 |
| an admin assignee is removed | `onAssigneesRemoved`: their requested entry is deleted; a filled one stays (the work was done) |
| an admin is added to a task already in Completed | no request; they can fill "My time" in the panel |
| the task is deleted | `onTaskDeleting` deletes the requested entries; filled ones keep `task_title` and lose `task_id` (FK set null) and show as "deleted task" (decision 7) |
| an admin is deactivated | their requests stay (a finance admin can fill or delete them in the work log); they leave every dashboard because they cannot sign in |
| the task's title changes | the work log shows the live title through `getTaskTitles`; `task_title` is refreshed when the entry is filled or edited |

### 5.5 Notification and the dashboard item

- `task.time_missing`, group **Task board** (`tasks`), payload `{ taskId, groupId, title, actorName }`, passes every mode (`passesMode` treats it like `task.assigned`/reminders), delivered by the channel the person set for Task board (default as today). Push: "<title> · <client>" / "Fill in how much time you spent"; email digest line "<title>: fill in your time" with "Open task". Opens the task panel with the dialog (`?task=<id>&time=1`). Nine languages.
- The admin home's **My tasks** card gets, above the tasks, the caller's open requests ("Fill in your time" rows with a clock icon: the task title, client, completion day); a click opens the dialog in place (no navigation); saving removes the row. The card's subline adds "N without time". The phone tile and its full-screen list show the same rows first. They come from `listMyTimeRequests` inside `GET /api/me/home/tasks` (one more indexed query). Whatever the notification settings (decision 9). The header's Tasks count does not change (it stays "my open tasks").
- Live: filling, a reopen, a removal or a delete emits `time:requests` (`{ count }`) to `user:<id>`, and the card refetches; completion already emits `admin:activity` (kind `task`), which refetches My tasks.

### 5.6 Tickets (extension of 2026-10-17)

"Resolved" is the moment `tickets.status` becomes `resolved` from another status. In that transaction the tickets module calls `onTicketResolved(tx, { ticketId, groupId, title, resolvedAt, actorId, assigneeIds, linkedTaskIds })` (`modules/finance/ticket-time.ts`, which imports nothing from `modules/tickets`):

1. a ticket without a client (`groupId` null) asks nothing (decision 24);
2. otherwise as §5.1 for the **admin riešitelia** (`ticket_assignees` who are active admins or the superadmin): a requested entry (`source = 'ticket'`, `worked_on` = the Bratislava day of `resolvedAt`) for each without one, `worked_on` set on entries filled before;
3. records `ticket.time_missing` (Ticket board group, passes every mode, payload `{ ticketId, groupId, title, actorName }`) for each requested riešiteľ except the actor;
4. returns `askActor` (the status answer's `askTime`) and `linkedTasksLogged` (a linked task is done and has filled time).

The dialog (part A2): "How much time did you spend on #123 <subject>?". When `linkedTasksLogged`, it shows the linked tasks (the caller's own minutes on each, never other admins') and two choices: **(a) time for the ticket** (the duration field; it adds to the tasks' hours) and **(b) "The hours on the linked tasks cover it"** (`PUT /api/tickets/:id/time/me { coveredByTasks: true }`). Without logged linked tasks only (a) shows. "Later" leaves the request (dashboard row, no push), as for tasks. The ticket page shows **My time** for admin riešitelia, editable later (adding hours to a (b) answer turns it into an (a) answer); finance admins also see each admin riešiteľ's time.

The other cases mirror §5.4: reopening (`resolved` → another status) deletes unanswered requests (`onTicketReopened`); removing a riešiteľ deletes their request (`onTicketAssigneesRemoved`); deleting the ticket deletes requests, filled entries keep their `title` (`onTicketDeleting`, FK set null); a ticket moving to another client moves its entries (`onTicketMoved`). Task entries copy their task's `source_ticket_id` into `linked_ticket_id` when written (`TaskCompletedEvent.sourceTicketId`), which the work log groups by (decision 25).

## 6. Screens

### 6.1 The client's Finance tab (`/groups/$groupId/finance`)

Shown as the last tab pill only for finance admins (and the route answers a "not found" screen to anyone else, as the server does). One lazy route chunk `finance-tab` with the `finance` locale namespace.

From 1024 px: a grid `grid-template-columns: 7fr 3fr; grid-template-rows: 2fr 3fr` filling the window under the group header (`height: calc(100dvh - <header and tabs>)`, min 640 px); the left column holds **Overview** (top, 40 %) and **Documents** (bottom, 60 %), the right column the **Work log** (both rows). Each card scrolls inside itself, so the page never scrolls as a whole on a computer. 641–1023 px: two rows (Overview full width; Documents and Work log side by side 1fr 1fr). Phones: §9.

#### Overview card (top left)

- Header: title, the view switch **Money · Hours** (segmented, remembered), and on the right the small filter (period: last 12 months + next 12 [default], this year, last year, all time, custom month range) and the totals.
- **Money view.** Chart (left ~65 %): bars by month; per month a bar of the contracts **paid** (start date in that month, today or earlier: solid) or **to be paid** (start date later: light/hatched), and next to it a thinner bar of the **cost** of the work in that month (hours × rates). A zero line, a few gridlines, month labels (every 3rd on narrow widths). Totals (right ~35 %): **Paid**, **To be paid**, **Spent (cost of work)**, **Balance** (paid − spent, green or red), per currency (EUR first; UAH lines only when such contracts exist; the cost is EUR, decision 11), and "N h without a rate" when relevant.
- **Hours view.** One small chart per admin who has time for the client in the period (bars by month, one shared y scale so they compare), ordered by total hours; each with the admin's name, total hours and cost. More than 6 admins: the first 6 and "Show all (n)". A total line on top: hours, tasks, cost.
- Every chart has a "Show as table" toggle (the same numbers as an accessible table) and keyboard-focusable bars with a tooltip (month, values).

#### Documents card (bottom left)

The knowledge tab's look in a smaller frame: breadcrumbs, "New" with **Contract · Document · Note · Folder**, a type filter (All, Contracts, Documents, Notes), search (from 2 characters, a flat list across folders with each result's folder path), folders first then items newest first, 30 per page with "Show more". A contract row shows its number, title, period ("1. 1. 2026 – 31. 12. 2026"), amount, a bell when it has an upcoming reminder, "Ending soon" (end within 60 days) and "No file". Opening an item shows it in the same side sheet as knowledge items (view, edit, delete, files, reminders for contracts). Folder dialog and Move to… as in knowledge.

Contract form: title (required), number (optional), amount + currency (EUR only until UAH is enabled; the currency select appears then), period from (required) – to (required, ≥ from), description (Markdown), files (0..n), reminders (§3.2, decision 14).

#### Work log card (right)

- Top (sticky): the period filter (all time [default], this month, last month, this year, last year, custom) and the summary of the period: **total hours, tasks, cost**, and per admin a row "Eva — 12 h 30 min · 8 tasks · 625 €". "+ Add time" (manual entry, §6.3).
- A ticket and its linked tasks are **one unit** (2026-10-17): the ticket's row ("#123 Subject — Eva 30 min") with the linked tasks' entries indented under it, on the day of the ticket's entry (or of the first entry of the unit); a ticket answered with (b) shows "covered by the tasks" and no hours. Month and period totals sum every row once (`unitTicketId` on each entry, the page's `tickets` list for the headers).
- Below: the chronology, **oldest at the top, newest at the bottom**, opening scrolled to the bottom (like a chat). Each month starts with a header row: "October 2026 — 34 h · 21 tasks · 1 700 €" and the per-admin line. Under it, per day: the date, then its entries: the admin's avatar and name, the task title (opens the task panel) or the manual note, the duration and, for finance admins, its cost. Requested entries (not filled yet) show as "Eva — waiting for time" (no hours) so the finance admin sees what is missing, and can fill it.
- "Show earlier" at the top loads the previous page (keeps the scroll position).
- Each entry has a menu: Edit (minutes, day, note; for a task entry the minutes only), Delete (manual entries; a task entry can be "reset to 0" instead). Every change is live for other finance admins.

### 6.2 The system-wide finance page (`/finance`)

Header link **Financie** for finance admins (and a row in the section menu under 1280 px). One lazy chunk `finance-page`. A filter row: **clients** (the knowledge list's client filter, default all, remembered) and the **period** (as the work log). Then:

1. The same three-card grid, across the chosen clients: **Overview** (money and hours; in the hours view one chart per admin across clients), **Contracts** (decision 16: the contracts of the chosen clients as a table — client, title, number, period, amount, "Ending soon"/"Ended" marks; sort by start, end or amount; a search over all finance documents and notes of the chosen clients; 30 per page), **Work log** (the chronology across clients, each entry naming its client; the month headers add the top clients).
2. A row of two cards, 50/50:
   - **Clients by money paid**: a year select (default this year) and an optional month; a currency switch when UAH exists; rows: rank, logo, client, amount paid in the period, a proportional bar, the share of the total. 20 rows, "Show 20 more".
   - **Clients by hours**: the page's period, an **admin** filter (all or one admin), a **Hours · Money** switch (rank by hours or by the cost of those hours); rows: rank, logo, client, hours, cost, a bar. 20 rows, "Show 20 more".
3. **Hourly rates** button (top right) opens the rates dialog: every active admin with their current rate and "Change", the history per admin (date from, rate, who set it), delete a mistaken row. A new rate asks for the date it applies from (default the first day of this month; "from the start" for an admin's first rate).

### 6.3 Manual entry dialog

Finance admins only (`canAddManualEntry`): admin (any active or deactivated admin), client (fixed in a client's tab, a picker on `/finance`), day (date picker, default today, not in the future), duration (`parseDuration`, 0 allowed), note (optional, ≤ 500). Saved as `source = 'manual'`.

## 7. API (all JSON, schemas in `packages/shared/src/finance.ts`)

Access: `PUT`/`DELETE /api/admins/:id/finance-access` (superadmin).

Task time (any admin assignee; §2.2): `GET /api/tasks/:id/time`, `PUT /api/tasks/:id/time/me { minutes }`. Move/create/update answers gain `askTime`.

Ticket time (any admin riešiteľ of a ticket with a client; §5.6): `GET /api/tickets/:id/time` (`TicketTimeDto`), `PUT /api/tickets/:id/time/me { minutes } | { coveredByTasks: true }`. The status answer on resolve gains `askTime`.

Finance plugin (`requireFinance`):

| route | purpose |
|---|---|
| `GET /api/groups/:id/finance/items?folder=&type=&q=&after=` | the documents card's page (30, keyset on `created_at, id`) |
| `GET /api/groups/:id/finance/folders` | the client's folders (all, small) |
| `POST /api/groups/:id/finance/items` · `GET`/`PATCH`/`DELETE /api/finance/items/:id` | items (with `updatedAt` conflict check `409 finance_changed`) |
| `POST /api/groups/:id/finance/folders` · `PATCH`/`DELETE /api/finance/folders/:id` | folders |
| `POST /api/groups/:id/finance/files` | upload a finance-only file |
| `GET`/`PUT /api/finance-items/:id/reminders`, `…/subscribe`, `…/calendar.ics` | through the reminders module (`routePrefix: 'finance-items'`) |
| `GET /api/groups/:id/finance/overview?from=&to=` · `GET /api/finance/overview?clients=&from=&to=` | money by month and currency, cost by month, hours by month and admin, totals, missing rates |
| `GET /api/groups/:id/finance/work-log?from=&to=&before=` · `GET /api/finance/work-log?clients=&from=&to=&before=` | the chronology: up to 200 entries per page (keyset `worked_on desc, id desc`), the full totals of every month the page touches, the period summary on the first page |
| `POST /api/groups/:id/finance/time-entries` · `PATCH`/`DELETE /api/finance/time-entries/:id` | manual entries; finance admins' edits of any entry |
| `GET /api/finance/contracts?clients=&sort=&q=&after=` | the global contracts table and finance search |
| `GET /api/finance/rankings/paid?year=&month=&currency=&clients=&after=` | ranking 1 (20 a page) |
| `GET /api/finance/rankings/hours?from=&to=&admin=&sort=hours\|cost&clients=&after=` | ranking 2 (20 a page) |
| `GET`/`POST /api/finance/rates` · `DELETE /api/finance/rates/:id` | rates and their history |

Months are `YYYY-MM` (Bratislava); `from`/`to` inclusive months; a bad filter answers `400 invalid_filter`. Lists that grow are cursor-paged; the overview series are at most 24–120 months, small.

## 8. Charts

Needed: grouped/stacked bars by month (money: paid, to be paid, cost), small multiples of bars (hours per admin), horizontal bars (rankings). No lines, pies, zoom or pan.

| option | gzip (about) | fit |
|---|---|---|
| Chart.js 4 (tree-shaken bar only) | 45–65 kB | canvas, good bars, tooltips; heavy for three bar charts |
| Recharts | ~95 kB + d3 parts | React-friendly, too big |
| uPlot | ~20 kB | fast time series, canvas; bars and small multiples need plugins; weak accessibility |
| visx (scale, shape, axis) | ~20–25 kB | SVG primitives; still a dependency with d3 modules |
| **Own SVG components** | **~3–5 kB** | bars, axes and labels are simple geometry; accessible SVG and a table fallback; styled by our tokens; no dependency |

**Decision: own SVG components** in `apps/web/src/features/finance/charts/` (`MonthBars`, `SmallMultiples` built from `MonthBars`, `RankBar` as a plain CSS bar), with a `niceScale(max)` helper (round ticks) and `monthAxis(from, to)` (labels), unit-tested. They live only in the finance chunks, so the initial JS does not change. An ADR (`docs/decisions/00NN-finance-charts-own-svg.md`) records it in part C. Rules from the design: colours from tokens (`--chart-1…3`, defined for light and dark), no animation beyond a 150 ms opacity on hover, labels never rotated (skip every n-th instead), values formatted with `formatMoney` / hours.

## 9. Phones (≤ 640 px) and tablets

- The Finance tab: a segmented control **Overview · Documents · Work log** (remembered per person) shows one card at a time, each at its natural height (the page scrolls). The work log opens at the newest month at the bottom of the card; the period summary collapses to one line ("34 h · 21 tasks · 1 700 €", tap to expand per admin).
- Overview on a phone: the chart full width (220 px high), the totals as a 2 × 2 grid under it, the filter and the Money · Hours switch in one row above; the hours view stacks the per-admin charts.
- `/finance`: the filter row collapses into a "Filters (n)" pill (sheet), the segmented control adds **Rankings** as a fourth segment, which shows the two ranking cards one under the other.
- Dialogs (time, manual entry, contract form, rates) are full-screen sheets (`SheetDialog`).
- 641–1023 px: §6.1's two-row layout; `/finance` puts the rankings under it at 1fr 1fr.

## 10. Performance

- Two lazy chunks (`finance-tab`, `finance-page`, with a shared `finance-common` chunk for charts and cards) and a lazy `finance` locale namespace. The eager shell gains only `MeSchema.finance` and the hidden tab pill and header link (< 0.3 kB, measured in each part). The time dialog is a lazy chunk loaded by the board on the first `askTime: true` (and by the home card on click), so the Tasks tab grows by about 1 kB at most.
- Every query uses the partial indexes of §3 and is checked by an EXPLAIN test on a seeded volume (`modules/finance/explain.test.ts` with `modules/finance/test-volume.ts`): 3 100 groups (as `home/test-volume.ts`), 40 admins, 300 000 filled time entries over 5 years, 5 000 requested entries, 20 000 contracts, 200 rates. No sequential scan of `finance_*` tables, and limits: client overview and work-log page < 50 ms, system-wide overview and rankings over all clients < 300 ms, on the CI machine.
- No N+1: a work-log page is one entries query, one grouped month-totals query (`where worked_on >= first_month and worked_on < last_month + 1`), one batch `getTaskTitles`, one batch of admin names. Costs come from one `left join lateral` on `finance_rates (user_id, effective_from desc)` per entry inside the aggregate.
- Aggregates are computed on read (no rollup tables): sums over at most a few hundred thousand narrow rows by index are fast; a monthly rollup table is added only if the EXPLAIN test misses its limit.
- Realtime is a tiny signal: `finance:changed { groupId, kind: 'items' | 'time' | 'rates' }` to the `finance` room; the open finance screens refetch what that kind affects (2 s debounce, as `useAdminActivityRefetch`).

## 11. Realtime

| event | payload | room | when |
|---|---|---|---|
| `finance:changed` | `{ groupId: string \| null, kind }` | `finance` | after any finance write commits (item, folder, entry, rate; `groupId` null for rates) and after a task completion, reopen or delete changed time entries |
| `time:requests` | `{ count }` | `user:<id>` | the user's open requests changed |
| `me:changed` | `{}` | `user:<id>` | the finance right was granted or removed |

The `finance` room is joined on connect by sockets whose user passes `canSeeFinance`, and moved by the grant routes (§2.1).

## 12. i18n

All UI text in a new lazy namespace `finance` (`apps/web/src/locales/finance/<code>.json`) in all nine languages (sk, en, cs, sl, bg, et, it, hr, uk); the time dialog's and "My time" texts in `tasks`, the dashboard rows in `adminHome`, the access switch in `admins`, the notification group name in `settings`/`notifications`; server push and digest texts for `task.time_missing` and finance reminders in `notifications/texts.ts` for all nine. Amounts and dates through `Intl` with the UI language. Slovak is the source; the other seven new translations wait for a native speaker, as since Phase 26.

## 13. Docs to update (by the part that changes them)

`product/finance.md` (new: requirements as built), `product/README.md`, `product/contracts.md` (superseded by Finance, decision 3), `product/roles-and-access.md`, `product/task-board.md` (time on done), `product/admin-home.md` (the rows in My tasks), `product/notifications.md` (`task.time_missing`, the Finance group), `product/reminders.md` (the finance subject), `architecture/permissions.md`, `architecture/realtime.md`, `architecture/data-model.md`, `architecture/overview.md` (module, API), `architecture/performance.md` (chunks, EXPLAIN numbers), `glossary.md` (finance admin, time entry, request, rate), `decisions/` (two ADRs: the sealed finance module and the own SVG charts), `roadmap.md`.

## 14. End-to-end scenarios (`e2e/finance.spec.ts`, `e2e/task-time.spec.ts`)

1. **Access.** The superadmin turns on Finance for admin A on the Admins page; A sees the Financie tab and the header link without reloading; admin B and a client do not see them, and B gets the not-found screen at `/groups/<id>/finance`.
2. **Contract.** A creates a contract (number, 12 000 €, 1. 1.–31. 12., a PDF, the proposed reminder), finds it in the Documents card and in the client's money totals (paid when the start is past); the knowledge tab's search and the global knowledge search do not find it; B cannot download its file by URL.
3. **Time on done.** A task with assignees A and B (both admins) and a client; A ticks the done circle → the dialog → "1:30" → saved; B gets the notification and a "Fill in your time" row on My tasks; B enters 0 → the row disappears. The client never sees a dialog when they complete a task.
4. **Work log and cost.** A sets B's rate 50 €/h and A's 40 €/h; the client's work log shows the day with A 1 h 30 min (60 €) and B 0, the month header and the summary; A adds a manual entry for B (2 h, yesterday) → 100 € more; the hours view shows two charts.
5. **Reopen.** A task with a requested entry is moved back to To do → the request disappears from the dashboard; completing it again asks again.
6. **System-wide.** `/finance` with two clients: the paid ranking for this year lists the client with the contract first; the hours ranking filtered to A, switched to Money, ranks by A's cost.
7. **Phone.** At 390 px the Finance tab shows the segmented control and switches cards; the time dialog is a full-screen sheet.

## 15. Testing (test-first)

Server: the policy table of §2.2; the leak tests of §2.3; `onTaskCompleted` and friends for every row of §5.4 (move, done circle, create in Completed, global board panel, client actor, reopen, removal, delete, re-complete, filled-before-completion); the notification (`notificationGroupOf`, `passesMode`, recipients, texts in nine languages); rate lookup with history and "from the start", cost rounding, totals per currency, the missing-rate count; every list's paging; the EXPLAIN test. Shared: `parseDuration`, `formatDuration`, `parseMoney`, `formatMoney`. Web: the dialog (parse, chips, 0, Later, the queue), My time in the panel, the My tasks rows, the three cards' states (empty, loading, error with retry), the chart helpers (`niceScale`, `monthAxis`) and the table fallback, the rates dialog, the phone segmented control.

## 16. Risks

- **Asking every admin for time** is a habit change for the whole team (decision 4). Mitigation: one tap for common durations, "Later", no repeated nagging.
- **Data entry quality**: hours are self-reported; manual corrections by finance admins exist for that.
- **Multi-currency later**: the model is ready (codes and minor units everywhere); turning UAH on is the `ENABLED_CURRENCIES` switch plus the currency select, with the totals already per currency.
