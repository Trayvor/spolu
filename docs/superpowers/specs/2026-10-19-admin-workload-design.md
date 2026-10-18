# Admin workload card (design)

Date: 2026-10-19 · Status: **draft, waiting for the owner** (the open questions at the end have a recommended answer each; building starts once they are answered or accepted). Plan: [2026-10-19-admin-workload.md](../plans/2026-10-19-admin-workload.md).

Builds on the [admin home](2026-10-16-phase-20-admin-home-design.md) (Phase 20), [unseen changes](2026-10-17-unseen-changes-design.md), [ticket riešitelia](../../decisions/0021-ticket-riesitelia-and-watching.md), the [sealed finance module](../../decisions/0027-sealed-finance-module.md) (Phase 32) and [group deactivation](../../decisions/0038-egrant-groups-webhook-and-group-deactivation.md). Requirements today: [product/admin-home.md](../../product/admin-home.md).

## 1. Goal

The owner wants to see at a glance how the open work is spread over the team: who carries many tasks and tickets, who has overdue work, who has a pile of changes they have not looked at, and for which clients. Today each admin sees only their own work (My tasks, Tickets); the global board shows tasks, not people.

The card answers "who is overloaded, and with which client" in one look, and leads to the global board with that person and client filtered. It is read-only and changes nothing.

Not a goal: time tracking reports (they live in Financie), performance reviews, or a list of the tasks themselves (the global board has them).

## 2. Users and roles

| role                         | sees the card                                           | what of it                                   |
| ---------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| superadmin                   | yes                                                     | every row, plus "Tento týždeň" (time logged) |
| admin with the finance right | yes                                                     | every row, plus "Tento týždeň"               |
| admin                        | yes                                                     | every row, without time                      |
| client, žiadateľ             | no (the admin home is admins only; the API answers 403) | -                                            |

The rows are the **active admins**: `user.role in ('admin', 'superadmin') and user.disabled_at is null`, the same set the managers rules use (`activeAdmin` in `modules/groups/managers.ts`). Every active admin has a row, also one with no open work (zeros), so the card shows who has room.

## 3. What is counted

All counts are per admin, and per admin and client for the breakdown. "Client" is the task's or ticket's group.

| column (SK)                     | definition                                                                                             | same as                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Úlohy**                       | open tasks (`completed_at is null`) the admin is an assignee of                                        | the My tasks card's count, for that admin                                 |
| **Po termíne**                  | of those, the ones with `due_date` before the Bratislava today                                         | the global board's `due=overdue`                                          |
| **Tikety**                      | active tickets (New, In progress) the admin is a riešiteľ of                                           | the "mine as riešiteľ" branch of the Tickets card                         |
| **Nevidené**                    | tasks plus tickets with a change the admin has not seen (`modules/notifications/unseen.ts`)            | the header's Tasks plus Tickets counts, for that admin                    |
| **Tento týždeň** (finance only) | the filled time entries of the admin with `worked_on` in the current Bratislava week, Monday to Sunday | the finance work log's counted entries (`countedEntriesSql`, scope `all`) |

Rules:

- **Deactivated groups are excluded** everywhere: a task or ticket of a group with `deactivated_at` set counts nowhere on the card (not in the totals, not in the breakdown). The sidebar does the same.
- **The admin group "eGrant tím" counts** (its tasks are real work); in the breakdown it is the row "eGrant tím", marked internal, shown first among equal loads like in the sidebar.
- **Tickets without a client** count in Tikety and Nevidené and are the breakdown row "Bez klienta".
- Tickets without a riešiteľ count for nobody in Tikety (they are nobody's yet; the Tickets card shows them to the watchers). This is on purpose: the card shows the work people have taken.
- Unseen changes follow each admin's own notification settings, exactly as their header counts do; a ticket without a client and without a riešiteľ is unseen for every admin until they open it (unseen-changes design), so it adds 1 to each admin's Nevidené. That is what their header shows too.
- Time is total per admin only (no per-client time in the breakdown, see open question 3), and only for viewers with the finance right.

## 4. UX

### 4.1 Place

The **lowest card** of the dashboard, under the Upcoming reminders and Mentions row, full width, from 1024 px. Under 1024 px (phones, small tablets) the home is the tiles and the client list; the card is not shown there in this version (open question 2).

### 4.2 Card (from 1024 px)

```
Vyťaženie tímu                                           Otvorená práca administrátorov
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Administrátor              Úlohy   Po termíne   Tikety   Nevidené   Tento týždeň      │
│ ▸ Jana Nováková              24        3           5        12        14 h 30 min     │
│ ▸ Vlad (vy)                  18        0           7         4         9 h            │
│ ▾ Peter Kováč                11        5           2         0         –              │
│     Mesto Senec               6        4           1         0                        │
│     eGrant tím                3        1           0         0                        │
│     Bez klienta               0        0           1         0                        │
│     a 2 ďalší klienti         2        0           0         0                        │
│ ▸ Eva Malá                    0        0           0         0         –              │
└──────────────────────────────────────────────────────────────────────────────────────┘
Bez deaktivovaných klientov. Čas: zápisy od pondelka do nedele.
```

- A table (`<table>` with `<th scope="col">`), numbers right-aligned in tabular figures, the egrant.sk card style the other cards use (`Card`, the tokens in `design/tokens.md`). No chart, no animation. Design work starts with the `frontend-design` skill (CLAUDE.md).
- **Order:** by load (Úlohy + Tikety) descending, then Po termíne descending, then name. The viewer's own row is not pinned; it is marked "(vy)".
- **Po termíne** above 0 is in the error red the cards use for overdue dates; 0 stays muted. Nothing else is coloured. Yellow stays reserved for unseen marks on items (review N10), so Nevidené is a plain number.
- **Expand:** each admin row has a disclosure button (chevron, `aria-expanded`, `aria-controls`) that shows their breakdown by client right under it: the clients with any count, by the same order (load, overdue, name), at most 20, then one row "a N ďalších klientov" with the rest summed. More than one admin can be open at a time. The breakdown comes in the same answer as the card, so expanding is instant and makes no request. What is open is remembered for the session only (component state).
- **Links:** in a client row, the Úlohy number opens the global board for that client and that admin (`/tasks?clients=<groupId>&assignee=<userId>`, or `assignee=me` on the viewer's own row), Po termíne the same with `&due=overdue`. In the admin row the numbers open the board for that admin and every client (`clients=all`). Tikety links only on the viewer's own rows (`/tickets?assignee=me`, plus `&clients=<groupId>` in a client row), because the ticket list has no "another person" filter yet (open question 4). Nevidené is not a link (the unseen marks are the other admin's, not the viewer's). "Bez klienta" and "a N ďalších" rows have no links.
- **Time:** shown as `formatDuration` (`packages/shared/src/duration.ts`), "–" for 0. The column is absent (not empty) for viewers without the finance right.
- **States:** loading shows three placeholder rows; an error shows the cards' "Nepodarilo sa to načítať. Skúste to znova." with "Skúsiť znova" (the existing `adminHome.shell.*` keys); with no active admins other than the viewer the card still shows the viewer's row.
- **Freshness:** the card loads when the dashboard opens, refetches when the window gets the focus, and is kept 60 s (`staleTime`). It does **not** listen to sockets: it is a team overview, not a to-do list, and every admin's dashboard re-running this statement on every task change anywhere would be the most expensive refetch of the home (see §7).

### 4.3 Texts (Slovak, the source language)

| key (`adminWorkload.*`)        | sk                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `title`                        | Vyťaženie tímu                                                                      |
| `caption`                      | Otvorená práca administrátorov                                                      |
| `columns.admin`                | Administrátor                                                                       |
| `columns.tasks`                | Úlohy                                                                               |
| `columns.overdue`              | Po termíne                                                                          |
| `columns.tickets`              | Tikety                                                                              |
| `columns.unseen`               | Nevidené                                                                            |
| `columns.week`                 | Tento týždeň                                                                        |
| `self`                         | (vy)                                                                                |
| `expand`                       | Zobraziť rozpis podľa klientov: {{name}}                                            |
| `collapse`                     | Skryť rozpis podľa klientov: {{name}}                                               |
| `noClient`                     | Bez klienta                                                                         |
| `more_one` / `_few` / `_other` | a {{count}} ďalší klient / a {{count}} ďalší klienti / a {{count}} ďalších klientov |
| `footnote`                     | Bez deaktivovaných klientov.                                                        |
| `footnoteTime`                 | Bez deaktivovaných klientov. Čas: zápisy od pondelka do nedele.                     |
| `empty`                        | Žiadna otvorená práca.                                                              |
| `links.tasks`                  | Úlohy: {{name}}, {{client}} (screen-reader label of a number link)                  |
| `links.overdue`                | Úlohy po termíne: {{name}}, {{client}}                                              |
| `links.tickets`                | Tikety: {{client}}                                                                  |
| `allClients`                   | všetci klienti (the `{{client}}` of an admin row's link labels)                     |

"eGrant tím" is the group's own name (no key). Plural keys follow i18next's per-language plural forms (`_one`, `_few`, `_many`, `_other` as each language needs; the locale tests check every key exists in all nine). The terms follow `design/wording.md` (riešiteľ = "Tikety" column here, since the column counts tickets, not people).

## 5. Data model

No new table and no new column. The card reads `user`, `groups`, `tasks`, `task_assignees`, `tickets`, `ticket_assignees`, `notification_events`, `task_seen`, `ticket_seen` and the notification settings, all through existing indexes (§7), plus `finance_time_entries` through the finance module.

No migration is expected. If the EXPLAIN check (plan Task 7) shows a sequential scan that an index would fix, the plan's contingency is one migration named `00XX_admin-workload` (the orchestrator assigns the number), with the index in the owning module's `schema.ts`.

No ADR is needed: no new dependency and no new approach (a read-only home endpoint, one statement, an EXPLAIN check, a lazy chunk and namespace, as Phase 20 did).

## 6. API

`GET /api/me/home/workload` in `modules/home/routes.ts`, behind `requireAdmin` like the other home routes (clients 403, signed out 401). No query parameters. Answer `HomeWorkload` (zod schema in `packages/shared/src/home.ts`):

```ts
type WorkloadCounts = {
  openTasks: number;
  overdueTasks: number;
  openTickets: number;
  unseen: number;
};

type WorkloadClient = WorkloadCounts & {
  groupId: string | null; // null = "Bez klienta"
  name: string | null; // the group's name, null for "Bez klienta"
  internal: boolean; // the admin group "eGrant tím"
};

type WorkloadAdmin = WorkloadCounts & {
  userId: string;
  name: string;
  self: boolean;
  /** Only in a finance holder's answer: filled minutes this Bratislava week. */
  minutesThisWeek?: number;
  /** At most WORKLOAD_LIMITS.clientsPerAdmin, already ordered. */
  clients: WorkloadClient[];
  /** The clients past the cap, summed; null when none. */
  moreClients: (WorkloadCounts & { count: number }) | null;
};

type HomeWorkload = {
  /** The Bratislava day "Po termíne" was computed for (YYYY-MM-DD). */
  today: string;
  /** Set only for a finance holder: the week of minutesThisWeek, from inclusive, until exclusive. */
  week: { from: string; until: string } | null;
  admins: WorkloadAdmin[]; // already ordered, at most WORKLOAD_LIMITS.admins
};
```

`WORKLOAD_LIMITS = { clientsPerAdmin: 20, admins: 100 }` in `packages/shared/src/home.ts`. The team is about ten people; the admins cap is a safety bound, not a page (with more than 100 active admins the lowest-loaded are left out and the card says nothing; see open question 6). There is no pagination: the answer is bounded by admins × 21 rows.

Server functions (`modules/home/workload.ts`):

- `workloadSql(today: string): SQL`: the one statement (§7).
- `getWorkload(db: Db, viewer: SessionUser, now: Date): Promise<HomeWorkload>`: runs it, shapes the rows, and when `canSeeFinance(viewer)` adds the week's minutes from the finance module.
- `bratislavaWeek(now: Date): { from: string; until: string }`: Monday of the Bratislava week and the next Monday.

The finance module exports `weekMinutesByUser(db: Db, userIds: readonly string[], range: { from: string; until: string }): Promise<Map<string, number>>` (`modules/finance/workload-time.ts`): one grouped query on `finance_time_entries_user_day_idx` through `countedEntriesSql({ kind: 'all' }, range)`. The home module never reads `finance_time_entries` itself (ADR 0027).

The notifications module widens `unseenTaskIdsSql`, `unseenTicketIdsSql`, `groupModeSql` and `channelOnSql` from `userId: string` to `userId: string | SQL`, so the statement can run them per admin with `` sql`a.id` `` inside a lateral join. A string still becomes a bound parameter, so every existing caller is unchanged.

No socket event, no MCP tool (open question 5), no write.

## 7. Performance

One SQL statement for the card (the finance minutes are one more, only for finance holders). Shape:

1. `admins`: active admins, from `user_role_idx`.
2. `task_cells`: `admins → task_assignees (task_assignees_user_id_idx) → tasks (pk, completed_at is null) → groups (pk, deactivated_at is null)`, grouped by admin and group, with `count(*) filter (where due_date < today)` for overdue.
3. `ticket_cells`: `admins → ticket_assignees (ticket_assignees_user_idx) → tickets (pk, status in new/in_progress) → left join groups` (null group kept, deactivated dropped), grouped the same way.
4. `unseen_cells`: `admins cross join lateral (unseenTaskIdsSql(a.id))` joined to `tasks` and `groups`, `union all` the same for tickets; each lateral reads `notification_events_unseen_task_idx` / `_ticket_idx` for one admin, as the header counts do.
5. `cells`: the three `union all`, summed per (admin, group); then `row_number() over (partition by admin order by load desc, overdue desc, name, group_id)` and the per-admin totals as window sums, so the cap and the "more" row are computed in SQL, one pass.
6. `admins left join cells`, so admins with no work have a row.

No N+1: the number of statements does not grow with admins or clients (tested with `createCountingDb`: exactly 1 for a non-finance admin, 2 for a finance holder).

Indexes: all exist (`user_role_idx`, `task_assignees_user_id_idx`, `ticket_assignees_user_idx`, the tasks/tickets/groups primary keys, the two unseen partial indexes). With a large share of tasks assigned to admins the planner may hash `task_assignees` and `tasks`, as the explain file already accepts for "my assignments"; the check forbids sequential scans of `notification_events`, `messages` and `tickets`.

EXPLAIN check: `modules/home/explain.test.ts` gains `workloadSql`. The home volume (`test-volume.ts`) gets 9 more active admins (`vhome00000000-admin2` … `-admin10`), one disabled admin, two deactivated groups, assignments of the tasks with `i % 3 = 2` spread over the new admins, a share of the riešiteľ rows and of the notification events for them. 50 ms with `RUN_BENCH=1` as the other home checks. If the seed change flips another check's plan, the workload check moves to its own `workload` volume (ADR 0040 allows several) instead of weakening that check.

Web: the card is a lazy chunk (`features/admin-home/workload-card.tsx`, `React.lazy` in `home-page.tsx`, rendered only from 1024 px) with its own lazy namespace `adminWorkload`, loaded with `useNamespaces` under the card's own `<Suspense>`. Nothing enters the initial JS; measure it as in performance.md, "How to check", and write the number there (expected +0 kB initial, the chunk about 2 kB gzip).

## 8. Security and privacy

- Admin-only on the server (`requireAdmin`), never trusting the client; the route is read-only.
- The card exposes counts only: no task or ticket titles, no client data an admin cannot already read (admins read every group). The other admins' unseen counts are a small privacy cost (they show how much someone has not opened); the owner asked for them (open question 1 confirms).
- **Finance stays sealed**: the minutes come from the finance module's exported read function, only when `canSeeFinance(viewer)`; for other admins the `minutesThisWeek` key and `week` are absent/null, not zero. A leak test checks the plain admin's raw JSON has no `minutesThisWeek`. The DTO carries no money.
- Disabled admins and deactivated groups never appear, so a removed colleague or a client who left is not listed.
- No new CSP source (ADR 0044): plain JSON over `/api`, no inline script, no external asset.

## 9. i18n

- New lazy namespace `adminWorkload`: `apps/web/src/locales/adminWorkload/<code>.json` for all nine languages (sk, en, cs, sl, bg, et, it, hr, uk). Nothing goes into the eager `locales/<code>.json`.
- Slovak is the source; the other eight are translated with the terms of `design/wording.md`. Italian uses the formal "Lei" in sentences and bare imperatives on buttons; Slovenian uses vikanje in sentences and the singular imperative on buttons (ADR 0019). The only sentence-like texts here are the footnotes and the empty line (no address), so the register shows mainly in the screen-reader labels ("Mostra il dettaglio per cliente: {{name}}", "Prikaži razčlenitev po strankah: {{name}}").
- Plurals: `more_*` uses each language's i18next plural categories (sk/cs `one`/`few`/`other`; sl `one`/`two`/`few`/`other`; uk, hr, bg as their rules). The locale tests check every key in all nine files.
- The server sends no text.

## 10. Tests (summary)

Server (Vitest, test-first): the counts and every rule of §3 (`workload.test.ts`), the week helper, the widened unseen helpers giving the same ids for a string and an SQL user, the finance minutes, the route (403, finance key presence and absence, schema), the statement count, the EXPLAIN check. Web (Vitest + Testing Library): the table, the order as sent, expand and collapse with ARIA, the cap row, links per row, the time column only with `week`, the lazy load not imported before the wide layout. e2e: one scenario in `e2e/admin-home.spec.ts` (written, run by whoever merges, after the other phases as the owner asked).

## 11. Open questions (with the recommended answer)

1. **Who sees the card?** Recommended: **every admin** (the request says "admin-only"; the team is small and the counts carry no content). Alternative: superadmin and finance holders only.
2. **Phones?** Recommended: **not in this version.** The phone home is the viewer's own tiles and the client list; a five-column table does not fit 360 px. Later: a sixth tile "Tím" opening a sheet with one line per admin (name, Úlohy, Po termíne).
3. **Time per client in the breakdown?** Recommended: **no**, total per admin only. Per-client time is the finance work log's job (filtered by admin), and it keeps the finance query to one small grouped read.
4. **Tikety links for other admins?** Recommended: **a small follow-up**: let the tickets list's `assignee` take a person id (as the board's does), then the Tikety numbers link on every row. Not in this card's plan, so the card does not change the tickets module.
5. **An MCP tool (`get_admin_workload`)?** Recommended: **later**, through the same `getWorkload`, once the card is used. The MCP server mirrors the HTTP API (ADR 0033), so it is a thin addition.
6. **More than 100 admins?** Recommended: **keep the cap** and do nothing more; the team is about ten. If it ever grows, the card gets "Zobraziť všetkých".
7. **Should overdue tickets count in Po termíne?** Recommended: **no**, Po termíne is tasks only (a ticket's due date comes from the client's request and is often absent). The column sits next to Úlohy, so it reads as tasks, and the Tickets card already marks overdue tickets in red.
8. **Live updates?** Recommended: **focus and open only, 60 s stale** (§4.2). If the owner wants it live, add the `admin:activity` refetch with a 10 s debounce, measured first.
