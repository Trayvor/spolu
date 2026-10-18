# Admin workload card: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (or `superpowers:executing-plans` inline) to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: [2026-10-19-admin-workload-design.md](../specs/2026-10-19-admin-workload-design.md). Status: **draft**; start only after the owner answered or accepted the spec's open questions, and (owner, 2026-10-19) only after the phases now in flight are finished, testing aside; the final e2e run comes after all of them.

**Goal:** the lowest card of the admin dashboard, "Vyťaženie tímu": per active admin the open assigned tasks, the overdue ones, the active tickets as riešiteľ, the unseen items and (finance holders only) the time logged this week, with a per-client breakdown on expand; one indexed statement, no N+1, an EXPLAIN check.

**Architecture:** a read-only route `GET /api/me/home/workload` in `modules/home` runs one SQL statement (`workloadSql`) over the tasks, tickets, groups and users tables (the home module's documented read-only exception) and the notifications module's unseen fragments, widened to take an SQL user expression so they run per admin in a lateral join. Finance minutes come from a new finance read function, called only for `canSeeFinance`. The web card is a lazy chunk with a lazy namespace, rendered from 1024 px under the existing cards.

**Tech stack:** Fastify, drizzle `sql` fragments on PostgreSQL 17, zod in `@spolu/shared`, React + TanStack Query + react-i18next, Vitest, Playwright.

Branch: `feat/admin-workload` from a fresh `origin/main`, its own worktree, its own test database (`TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_admin_workload`).

## Global Constraints

- Test-first for every server function and rule (`test-driven-development`): write the failing test, see it fail for the right reason, then the code.
- Permissions only on the server: `requireAdmin` on the route, `canSeeFinance` (from `modules/finance/policy.ts`) for the minutes. The client hides nothing that the server sent.
- Module boundaries: `modules/home` may read `user`, `groups`, `tasks`, `task_assignees`, `tickets`, `ticket_assignees` directly (documented exception, `architecture/overview.md`); it **never** reads `finance_time_entries` (ADR 0027): only `weekMinutesByUser` from `modules/finance/workload-time.ts`. The unseen logic stays in `modules/notifications/unseen.ts`.
- One statement for the card for a non-finance admin, two for a finance holder; asserted with `test/query-counter.ts`.
- No sequential scan of `notification_events`, `messages`, `message_mentions` or `tickets` in the EXPLAIN check.
- No migration expected. Only if Task 7 proves an index is needed: one migration `00XX_admin-workload` (the orchestrator assigns the number; check the latest on `origin/main` first, CLAUDE.md "Migrations"), the index declared in the owning `schema.ts`, `pnpm --filter @spolu/server db:generate`.
- No ADR (no dependency, no new approach). If one turns out to be needed, name it `ADR-XXXX` until the orchestrator numbers it.
- Web: nothing new in the initial JS (200 kB gzip budget, practically full). The card is `React.lazy`; its texts are only in the lazy namespace `adminWorkload`, all nine languages (sk, en, cs, sl, bg, et, it, hr, uk); it formal "Lei", sl vikanje in sentences (ADR 0019); never in `locales/<code>.json`.
- No socket listener, no write, no new CSP source (ADR 0044).
- Design: start the card's UI task with the `frontend-design` skill (CLAUDE.md); egrant.sk card style, no animation.
- Docs in the same commits (`update-kb`): `product/admin-home.md`, `architecture/overview.md` (Admin home API), `architecture/performance.md` (query and bundle numbers), `architecture/permissions.md` (the card's rule and the finance key).
- Do not run `pnpm test:e2e` or `scripts/ci.sh` in parallel with another agent; the merger runs them.

## Review Focus

1. **Correctness of the counts** against the spec §3 table: open = `completed_at is null`; overdue = `due_date < today` (Bratislava); tickets = `status in ('new','in_progress')` and the admin is in `ticket_assignees`; deactivated groups dropped everywhere; tickets without a client kept as "Bez klienta"; disabled admins absent.
2. **No double counting** across the `union all` of task, ticket and unseen cells (each cell sums only its own column; the others are 0).
3. **The finance seal:** `minutesThisWeek` and `week` absent/null for a plain admin in the raw JSON; the home module has no import of `modules/finance/schema.ts`.
4. **The widened unseen helpers** keep binding a string as a parameter (no SQL injection path; existing callers and tests unchanged).
5. **The cap row** ("a N ďalších klientov") sums exactly the clients past 20, and the per-admin totals include them.
6. **Plans:** the EXPLAIN check passes on the extended home volume, and no other check of `modules/home/explain.test.ts` changed its plan.
7. **Bundle:** the initial JS number is unchanged within noise; the card's chunk is not imported by `home-page.tsx` statically.

## File map

| file                                                                   | change                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/home.ts`                                          | `WORKLOAD_LIMITS`, `WorkloadCountsSchema`, `WorkloadClientSchema`, `WorkloadAdminSchema`, `HomeWorkloadSchema` and types |
| `packages/shared/src/home.test.ts`                                     | schema tests                                                                                                             |
| `apps/server/src/modules/notifications/follows.ts`                     | `groupModeSql`, `channelOnSql`: `userId: string \| SQL`                                                                  |
| `apps/server/src/modules/notifications/unseen.ts`                      | `unseenTaskIdsSql`, `unseenTicketIdsSql`: `userId: string \| SQL`                                                        |
| `apps/server/src/modules/notifications/unseen-user-sql.test.ts`        | new: string vs SQL user give the same ids                                                                                |
| `apps/server/src/modules/finance/workload-time.ts`                     | new: `weekMinutesByUser`                                                                                                 |
| `apps/server/src/modules/finance/workload-time.test.ts`                | new                                                                                                                      |
| `apps/server/src/modules/home/workload.ts`                             | new: `bratislavaWeek`, `workloadSql`, `getWorkload`                                                                      |
| `apps/server/src/modules/home/workload.test.ts`                        | new                                                                                                                      |
| `apps/server/src/modules/home/routes.ts`                               | the route                                                                                                                |
| `apps/server/src/modules/home/routes.test.ts`                          | 403 list, finance key, schema                                                                                            |
| `apps/server/src/modules/home/test-volume.ts`                          | 9 more admins, a disabled one, 2 deactivated groups, their rows                                                          |
| `apps/server/src/modules/home/explain.test.ts`                         | the workload check                                                                                                       |
| `apps/web/src/features/admin-home/api.ts`                              | `homeKeys.workload`, `workloadQuery`                                                                                     |
| `apps/web/src/features/admin-home/workload-card.tsx`                   | new: the lazy card                                                                                                       |
| `apps/web/src/features/admin-home/workload-card.test.tsx`              | new                                                                                                                      |
| `apps/web/src/features/admin-home/workload-links.ts`                   | new: pure link builders                                                                                                  |
| `apps/web/src/features/admin-home/workload-links.test.ts`              | new                                                                                                                      |
| `apps/web/src/features/admin-home/home-page.tsx`                       | lazy import, render last from 1024 px                                                                                    |
| `apps/web/src/features/admin-home/home-page.test.tsx`                  | the card is last, not on phones                                                                                          |
| `apps/web/src/locales/adminWorkload/{sk,en,cs,sl,bg,et,it,hr,uk}.json` | new namespace                                                                                                            |
| `e2e/admin-home.spec.ts`                                               | one scenario                                                                                                             |
| docs (see Global Constraints)                                          | updated with each task                                                                                                   |

---

### Task 1: Shared schema

**Files:** modify `packages/shared/src/home.ts`, `packages/shared/src/home.test.ts`.

- [ ] **Step 1: Write the failing tests** in `home.test.ts`:

```ts
describe('HomeWorkloadSchema', () => {
  const counts = { openTasks: 2, overdueTasks: 1, openTickets: 0, unseen: 3 };
  const admin = {
    ...counts,
    userId: 'u1',
    name: 'Jana',
    self: false,
    clients: [{ ...counts, groupId: null, name: null, internal: false }],
    moreClients: null,
  };

  it('accepts an answer without time (plain admin)', () => {
    const parsed = HomeWorkloadSchema.parse({ today: '2026-10-19', week: null, admins: [admin] });
    expect(parsed.admins[0]).not.toHaveProperty('minutesThisWeek');
  });

  it('accepts minutes and a week for a finance holder', () => {
    const parsed = HomeWorkloadSchema.parse({
      today: '2026-10-19',
      week: { from: '2026-10-19', until: '2026-10-26' },
      admins: [{ ...admin, minutesThisWeek: 90 }],
    });
    expect(parsed.admins[0]!.minutesThisWeek).toBe(90);
  });

  it('rejects negative counts and a more row without a count', () => {
    expect(() =>
      HomeWorkloadSchema.parse({
        today: '2026-10-19',
        week: null,
        admins: [{ ...admin, openTasks: -1 }],
      }),
    ).toThrow();
    expect(() =>
      HomeWorkloadSchema.parse({
        today: '2026-10-19',
        week: null,
        admins: [{ ...admin, moreClients: counts }],
      }),
    ).toThrow();
  });

  it('caps the breakdown at WORKLOAD_LIMITS.clientsPerAdmin', () => {
    const many = Array.from({ length: WORKLOAD_LIMITS.clientsPerAdmin + 1 }, (_, i) => ({
      ...counts,
      groupId: `g${i}`,
      name: `G${i}`,
      internal: false,
    }));
    expect(() =>
      HomeWorkloadSchema.parse({
        today: '2026-10-19',
        week: null,
        admins: [{ ...admin, clients: many }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @spolu/shared test -- home` → FAIL (`HomeWorkloadSchema` is not exported).
- [ ] **Step 3: Implement** in `home.ts`:

```ts
export const WORKLOAD_LIMITS = { clientsPerAdmin: 20, admins: 100 } as const;

const count = z.number().int().nonnegative();
export const WorkloadCountsSchema = z.object({
  openTasks: count,
  overdueTasks: count,
  openTickets: count,
  unseen: count,
});
export const WorkloadClientSchema = WorkloadCountsSchema.extend({
  groupId: z.string().nullable(),
  name: z.string().nullable(),
  internal: z.boolean(),
});
export const WorkloadAdminSchema = WorkloadCountsSchema.extend({
  userId: z.string(),
  name: z.string(),
  self: z.boolean(),
  minutesThisWeek: count.optional(),
  clients: z.array(WorkloadClientSchema).max(WORKLOAD_LIMITS.clientsPerAdmin),
  moreClients: WorkloadCountsSchema.extend({ count: z.number().int().positive() }).nullable(),
});
export const HomeWorkloadSchema = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  week: z.object({ from: z.string(), until: z.string() }).nullable(),
  admins: z.array(WorkloadAdminSchema).max(WORKLOAD_LIMITS.admins),
});
export type WorkloadCounts = z.infer<typeof WorkloadCountsSchema>;
export type WorkloadClient = z.infer<typeof WorkloadClientSchema>;
export type WorkloadAdmin = z.infer<typeof WorkloadAdminSchema>;
export type HomeWorkload = z.infer<typeof HomeWorkloadSchema>;
```

- [ ] **Step 4: Run** the same command → PASS; `pnpm --filter @spolu/shared typecheck`.
- [ ] **Step 5: Commit** `feat(home): workload answer schema`.

### Task 2: Unseen fragments for an SQL user

**Files:** modify `apps/server/src/modules/notifications/follows.ts`, `apps/server/src/modules/notifications/unseen.ts`; create `apps/server/src/modules/notifications/unseen-user-sql.test.ts`.

- [ ] **Step 1: Write the failing test** `unseen-user-sql.test.ts`, using the home fixtures (`newAdmin`, `newGroup`, `newTask`) and `recordNotifications`:
  - `it('unseenTaskIdsSql gives the same tasks for a string user and an SQL user')`: an admin, a group, two tasks; a `task.assigned` event for one (`payload: { taskId, groupId }`). Run `select task_id from (${unseenTaskIdsSql(admin.id)}) x` and ``select x.task_id from "user" u cross join lateral (${unseenTaskIdsSql(sql`u.id`)}) x where u.id = ${admin.id}``; expect both `[taskId]`.
  - `it('unseenTicketIdsSql gives the same tickets for a string user and an SQL user')`: the same with a ticket (insert as in `home/sidebar.test.ts`) and a `ticket.status` event.
  - `it('a lateral run over two admins keeps each admin\'s own unseen items')`: admins A and B, an event for A only; the lateral over both returns one row for A and none for B.
- [ ] **Step 2: Run** `TEST_DATABASE_URL=… pnpm --filter @spolu/server exec vitest run src/modules/notifications/unseen-user-sql.test.ts` → FAIL (type error on `` sql`u.id` ``: `SQL` is not assignable to `string`).
- [ ] **Step 3: Implement:** change the parameter type to `userId: string | SQL` in `groupModeSql`, `channelOnSql` (`follows.ts`), `unseenTaskIdsSql`, `unseenTicketIdsSql` and the private helpers they call in `unseen.ts`. The bodies stay as they are: drizzle binds a string as a parameter and inlines an `SQL`. Add to each doc comment: "`userId` is a user id (bound) or an SQL expression naming one (a lateral join's `a.id`)."
- [ ] **Step 4: Run** the new file and the existing `notifications` and `home` tests (`… vitest run src/modules/notifications src/modules/home`) → PASS. `pnpm --filter @spolu/server typecheck`.
- [ ] **Step 5: Commit** `refactor(notifications): unseen fragments take an SQL user`.

### Task 3: The Bratislava week

**Files:** create `apps/server/src/modules/home/workload.ts` (first part), `apps/server/src/modules/home/workload.test.ts` (first `describe`).

- [ ] **Step 1: Write the failing tests:**

```ts
describe('bratislavaWeek', () => {
  it('is Monday to the next Monday', () => {
    expect(bratislavaWeek(new Date('2026-10-21T10:00:00Z'))).toEqual({
      from: '2026-10-19',
      until: '2026-10-26',
    });
  });
  it('a Sunday belongs to the week that started six days before', () => {
    expect(bratislavaWeek(new Date('2026-10-25T12:00:00Z'))).toEqual({
      from: '2026-10-19',
      until: '2026-10-26',
    });
  });
  it('follows Bratislava, not UTC, around midnight', () => {
    // 23:30 UTC on Sunday 25 Oct is 00:30 on Monday 26 Oct in Bratislava (CET after the DST end).
    expect(bratislavaWeek(new Date('2026-10-25T23:30:00Z'))).toEqual({
      from: '2026-10-26',
      until: '2026-11-02',
    });
  });
});
```

- [ ] **Step 2: Run** `… vitest run src/modules/home/workload.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `bratislavaWeek(now: Date): { from: string; until: string }` from `bratislavaToday(now)` (`global-board.ts`): parse the day as a UTC date, step back `(getUTCDay() + 6) % 7` days for `from`, add 7 for `until`, format `YYYY-MM-DD`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(home): Bratislava week helper`.

### Task 4: The workload statement and service

**Files:** modify `apps/server/src/modules/home/workload.ts`, `apps/server/src/modules/home/workload.test.ts`.

Signatures:

```ts
export function workloadSql(today: string, viewerId: string): SQL;
export async function getWorkload(
  db: Db,
  viewer: SessionUser,
  now: Date,
  deps?: { weekMinutes?: typeof weekMinutesByUser },
): Promise<HomeWorkload>;
```

The test database is shared by every test file, so each test looks up **its own** admins by id in `admins` and never asserts the list's length.

- [ ] **Step 1: Write the failing tests** (`describe('getWorkload')`, `beforeAll` builds the app's `db` as in `home/routes.test.ts`; `now = new Date('2026-10-21T10:00:00Z')`, today `2026-10-21`):
  1. `it('counts open assigned tasks per admin and client, completed ones not')`: admin A, groups G1, G2; A has 2 open tasks in G1, 1 in G2, 1 completed in G1 → A `openTasks 3`; clients `G1: 2`, `G2: 1`.
  2. `it('counts overdue as a due date before the Bratislava today')`: due `2026-10-20` (overdue), `2026-10-21` (today, not), `null` (not) → `overdueTasks 1`.
  3. `it('counts active tickets the admin is a riešiteľ of')`: tickets in G1 `new`, `in_progress` with A in `ticket_assignees`, one `resolved` with A, one `new` without riešiteľ → `openTickets 2`.
  4. `it('puts tickets without a client in a "Bez klienta" row')`: an active ticket with `group_id null` and A as riešiteľ → a client row `{ groupId: null, name: null, openTickets: 1 }`.
  5. `it('leaves out deactivated groups everywhere')`: G3 with `deactivated_at = now()` (update the row directly), an open task and an active ticket of A in it, an unseen event for it → no G3 row; totals unchanged.
  6. `it('marks the admin group as internal and counts it')`: a task of A in the admin group (`ensureAdminGroup` from `groups/admin-group.ts`) → its row `internal: true`.
  7. `it('lists every active admin, one with no work with zeros, and no disabled admin or client')`: admin E with nothing → present with zeros and `clients: []`; admin D disabled with `deactivateUser` → absent; a client user with an assigned task → absent.
  8. `it('counts unseen tasks and tickets per admin as their header does')`: a `task.assigned` event for A on a G1 task and a `ticket.status` event for A on a G1 ticket → A `unseen 2`, G1 `unseen 2`; after inserting `task_seen` for A at `now()` → `unseen 1`. Assert A's `unseen` equals `countUnseenTasks + countUnseenTickets` restricted to non-deactivated groups (compute with the existing functions on a fixture where all groups are active).
  9. `it('orders admins and clients by load, then overdue, then name')`: B with 5, C with 5 of which 1 overdue, A with 1 → order C, B, A; inside an admin, clients by the same rule.
  10. `it('caps the breakdown at 20 clients and sums the rest')`: A with one task in each of 23 groups (two tasks in the first) → 20 rows, `moreClients { count: 3, openTasks: 3 }`, `openTasks 24`.
  11. `it('marks the viewer\'s own row')`: `self` true only for the viewer.
  12. `it('adds minutes only for a finance holder')`: with `deps.weekMinutes` a stub returning `new Map([[A.id, 90]])`: viewer `role: 'superadmin'` → `week` set, A `minutesThisWeek 90`, other admins `0`; viewer a plain admin (`finance: false`) → `week null`, no `minutesThisWeek` key on any row, and the stub not called.
  13. `it('runs one statement for a plain admin and two for a finance holder')`: `createCountingDb()`; `reset()`, `getWorkload(counting.db, plain, now)` → `count() === 1`; with a finance viewer and the real `weekMinutesByUser` (Task 5) → `2`. Add more admins and groups and assert the counts do not change.
- [ ] **Step 2: Run** `… vitest run src/modules/home/workload.test.ts` → FAIL.
- [ ] **Step 3: Implement** `workloadSql(today, viewerId)` as spec §7, one statement:

```sql
with admins as (
  select u.id, u.name from "user" u
  where u.role in ('admin', 'superadmin') and u.disabled_at is null
),
cells as (
  select user_id, group_id, sum(open_tasks)::int open_tasks, sum(overdue_tasks)::int overdue_tasks,
    sum(open_tickets)::int open_tickets, sum(unseen)::int unseen
  from (
    select ta.user_id, t.group_id, count(*) open_tasks,
      count(*) filter (where t.due_date < ${today}::date) overdue_tasks, 0 open_tickets, 0 unseen
    from admins a
    join task_assignees ta on ta.user_id = a.id
    join tasks t on t.id = ta.task_id and t.completed_at is null
    join groups g on g.id = t.group_id and g.deactivated_at is null
    group by 1, 2
    union all
    select ka.user_id, k.group_id, 0, 0, count(*), 0
    from admins a
    join ticket_assignees ka on ka.user_id = a.id
    join tickets k on k.id = ka.ticket_id and k.status in ('new', 'in_progress')
    left join groups g on g.id = k.group_id
    where k.group_id is null or g.deactivated_at is null
    group by 1, 2
    union all
    select a.id, t.group_id, 0, 0, 0, count(*)
    from admins a
    cross join lateral (${unseenTaskIdsSql(sql`a.id`)}) x
    join tasks t on t.id = x.task_id
    join groups g on g.id = t.group_id and g.deactivated_at is null
    group by 1, 2
    union all
    select a.id, k.group_id, 0, 0, 0, count(*)
    from admins a
    cross join lateral (${unseenTicketIdsSql(sql`a.id`)}) x
    join tickets k on k.id = x.ticket_id
    left join groups g on g.id = k.group_id
    where k.group_id is null or g.deactivated_at is null
    group by 1, 2
  ) u
  group by 1, 2
),
ranked as (
  select c.*, g.name as group_name, coalesce(g.kind = 'admin', false) as internal,
    row_number() over (partition by c.user_id
      order by c.open_tasks + c.open_tickets desc, c.overdue_tasks desc,
        g.kind = 'admin' desc nulls last, g.name nulls last, c.group_id nulls last) as rn
  from cells c left join groups g on g.id = c.group_id
)
select a.id as user_id, a.name, a.id = ${viewerId} as self,
  r.group_id, r.group_name, r.internal, r.rn,
  coalesce(r.open_tasks, 0) open_tasks, coalesce(r.overdue_tasks, 0) overdue_tasks,
  coalesce(r.open_tickets, 0) open_tickets, coalesce(r.unseen, 0) unseen,
  coalesce(sum(r.open_tasks) over w, 0)::int total_tasks,
  coalesce(sum(r.overdue_tasks) over w, 0)::int total_overdue,
  coalesce(sum(r.open_tickets) over w, 0)::int total_tickets,
  coalesce(sum(r.unseen) over w, 0)::int total_unseen
from admins a
left join ranked r on r.user_id = a.id
window w as (partition by a.id)
order by total_tasks + total_tickets desc, total_overdue desc, a.name, a.id, r.rn
```

`getWorkload` folds the rows in one pass: rows with `rn <= WORKLOAD_LIMITS.clientsPerAdmin` become `clients`, the rest are summed into `moreClients` (`count` = their number), totals from the `total_*` columns; keep the first `WORKLOAD_LIMITS.admins` admins. The admins' order comes from SQL; `getWorkload` does not sort. When `canSeeFinance(viewer)`: `week = bratislavaWeek(now)`, `minutes = await (deps.weekMinutes ?? weekMinutesByUser)(db, ids, week)`, each admin `minutesThisWeek: minutes.get(id) ?? 0`; else `week: null` and no key. The file's doc comment says it is the home module's read-only exception and names the indexes.

- [ ] **Step 4: Run** → PASS. `pnpm --filter @spolu/server typecheck lint`.
- [ ] **Step 5: Commit** `feat(home): workload statement` (docs: `architecture/overview.md` Admin home API gets the route's paragraph in Task 6's commit).

### Task 5: Finance minutes this week

**Files:** create `apps/server/src/modules/finance/workload-time.ts`, `apps/server/src/modules/finance/workload-time.test.ts`.

```ts
/** Filled minutes per user with `worked_on` in [from, until): one grouped read. */
export async function weekMinutesByUser(
  db: Db,
  userIds: readonly string[],
  range: { from: string; until: string },
): Promise<Map<string, number>>;
```

- [ ] **Step 1: Write the failing tests** (rows inserted into `financeTimeEntries` with the required columns copied from `finance/log.test.ts`'s manual entry builder):
  1. `it('sums the filled minutes of the week per user')`: A 30 + 60 in the week, B 15 → `{A: 90, B: 15}`.
  2. `it('leaves out entries outside the week, open requests and other users')`: A 45 on `until` (exclusive) and 20 the day before `from`; an open request (`minutes null`) in the week; C (not asked for) 50 → A 90 only from step 1's rows, no C key.
  3. `it('counts time without a client')`: an entry with `group_id null` in the week adds to A.
  4. `it('answers an empty map for no users without a query')`: with `createCountingDb`, `weekMinutesByUser(db, [], range)` → empty map, `count() === 0`.
- [ ] **Step 2: Run** `… vitest run src/modules/finance/workload-time.test.ts` → FAIL.
- [ ] **Step 3: Implement:** `select user_id, sum(minutes)::int from finance_time_entries where user_id in (…) and ${countedEntriesSql({ kind: 'all' }, range)} group by user_id`. Doc comment: "Called by the home workload card for a finance holder only (the caller checks `canSeeFinance`); reads `finance_time_entries_user_day_idx`."
- [ ] **Step 4: Run** → PASS; also `finance/seal.test.ts` (the seal must still hold: the new file is inside the module).
- [ ] **Step 5: Commit** `feat(finance): week minutes per user for the workload card`.

### Task 6: The route

**Files:** modify `apps/server/src/modules/home/routes.ts`, `apps/server/src/modules/home/routes.test.ts`; docs `architecture/overview.md`, `architecture/permissions.md`.

- [ ] **Step 1: Write the failing tests** in `routes.test.ts`:
  - add `'/api/me/home/workload'` to the list in `it('a client gets 403 on every admin home endpoint')`;
  - `it('the workload answers the schema and has no time for a plain admin')`: `HomeWorkloadSchema.parse(body)`, `body.week === null`, and `JSON.stringify(body)` does not contain `minutesThisWeek`;
  - `it('the workload has the week and minutes for a finance holder')`: grant the right with `setFinanceAccess` (users service) to an admin, log in, expect `week` set and `typeof admins[0].minutesThisWeek === 'number'`;
  - `it('the workload needs a session')`: no cookie → 401.
- [ ] **Step 2: Run** `… vitest run src/modules/home/routes.test.ts` → FAIL (404).
- [ ] **Step 3: Implement:**

```ts
app.get('/me/home/workload', { preHandler: adminOnly }, async (request): Promise<HomeWorkload> =>
  getWorkload(db, request.user!, now()),
);
```

- [ ] **Step 4: Run** → PASS. Update `architecture/overview.md` (Admin home API: the route, the answer, one statement, finance through `weekMinutesByUser`) and `architecture/permissions.md` (admins only; minutes for `canSeeFinance` only, absent otherwise).
- [ ] **Step 5: Commit** `feat(home): GET /api/me/home/workload`.

### Task 7: EXPLAIN check

**Files:** modify `apps/server/src/modules/home/test-volume.ts`, `apps/server/src/modules/home/explain.test.ts`; docs `architecture/performance.md`.

- [ ] **Step 1: Extend the volume** (the template rebuilds by its hash, ADR 0040): `homeVolumeIds()` returns `workloadAdminIds` (`${p}-admin2` … `${p}-admin10`); the seed inserts them (role `admin`), one disabled admin `${p}-admin-off` (`disabled_at = now()`, with assignments), sets `deactivated_at` on groups 99 and 100, assigns tasks `i % 3 = 2` to `workloadAdminIds[i % 9]`, makes the new admins riešitelia of tickets `i % 70 = 2`, and adds a share of `notification_events` for them (copy the admin's event insert with `i % 7 = 3`, recipient by `i % 9`). Update the seed's doc comment.
- [ ] **Step 2: Add the check** in the one `it` of `explain.test.ts`:

```ts
// 2026-10-19: the workload card, one statement over every active admin; the unseen laterals
// read the partial indexes once per admin, the assignment joins may hash (as above)
await expectIndexed(tx, workloadSql(bratislavaToday(new Date()), adminId), [
  ...UNSEEN_TABLES,
  ...CHAT_TABLES,
  'tickets',
]);
```

- [ ] **Step 3: Run** `TEST_DATABASE_URL=… pnpm --filter @spolu/server test:explain` and then `RUN_BENCH=1 … test:explain` on a quiet machine → PASS, workload under 50 ms. With `EXPLAIN_DEBUG=1` confirm every other check's plan still passes. If one flips: move the workload seed into its own `workload` volume (`test-volume-workload.ts`, listed in `VOLUMES` of `test/setup-explain-db.ts`) and restore `test-volume.ts`. If the workload check scans `tickets` or `notification_events`: find the missing index, add it in the owning `schema.ts`, migration `00XX_admin-workload`.
- [ ] **Step 4: Docs:** `architecture/performance.md` gets the statement's shape, the indexes it reads and the measured time.
- [ ] **Step 5: Commit** `test(home): EXPLAIN check of the workload statement`.

### Task 8: Web query and link builders

**Files:** modify `apps/web/src/features/admin-home/api.ts`; create `apps/web/src/features/admin-home/workload-links.ts`, `workload-links.test.ts`.

```ts
export function taskLink(
  row: { userId: string; self: boolean; groupId: string | null | 'all' },
  overdue: boolean,
): CardTarget | null;
export function ticketLink(row: {
  self: boolean;
  groupId: string | null | 'all';
}): CardTarget | null;
```

- [ ] **Step 1: Write the failing tests** (`workload-links.test.ts`):
  - `taskLink({ userId: 'u2', self: false, groupId: 'g1' }, false)` → `{ to: '/tasks', search: { clients: 'g1', assignee: 'u2' } }`;
  - `self: true` → `assignee: 'me'`; `overdue: true` adds `due: 'overdue'`; `groupId: 'all'` → `clients: 'all'`;
  - `groupId: null` (Bez klienta) → `null` (no link);
  - `ticketLink({ self: false, groupId: 'g1' })` → `null`; `{ self: true, groupId: 'g1' }` → `{ to: '/tickets', search: { assignee: 'me', clients: 'g1' } }`; `{ self: true, groupId: 'all' }` → `{ to: '/tickets', search: { assignee: 'me', scope: 'all' } }`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web exec vitest run src/features/admin-home/workload-links.test.ts` → FAIL.
- [ ] **Step 3: Implement** the two pure functions; in `api.ts` add `workload: ['home', 'workload']` to `homeKeys` and:

```ts
export const workloadQuery = queryOptions({
  queryKey: homeKeys.workload,
  queryFn: () => apiGet('/me/home/workload', HomeWorkloadSchema),
  refetchOnWindowFocus: true,
  staleTime: 60_000,
});
```

- [ ] **Step 4: Run** → PASS; `pnpm --filter @spolu/web typecheck`.
- [ ] **Step 5: Commit** `feat(web): workload query and links`.

### Task 9: Locale namespace

**Files:** create `apps/web/src/locales/adminWorkload/{sk,en,cs,sl,bg,et,it,hr,uk}.json`.

- [ ] **Step 1:** write `sk.json` with every key of spec §4.3 (without the `adminWorkload.` prefix, as namespace files are), and `en.json` ("Team workload", "Open work of the administrators", "Administrator", "Tasks", "Overdue", "Tickets", "Unseen", "This week", "(you)", "Show the breakdown by client: {{name}}", "Hide the breakdown by client: {{name}}", "Without client", "and {{count}} more client(s)" as `_one`/`_other`, "Deactivated clients are left out.", "… Time: entries from Monday to Sunday.", "No open work.", the link labels, "all clients").
- [ ] **Step 2:** translate the other seven with `design/wording.md`'s terms; plural keys per language (sk, cs `_one/_few/_other`; sl `_one/_two/_few/_other`; hr, uk `_one/_few/_many/_other` as their locale files already use; bg, et, it `_one/_other`); it: "Mostra/Nascondi il dettaglio per cliente: {{name}}"; sl: "Prikaži/Skrij razčlenitev po strankah: {{name}}".
- [ ] **Step 3: Run** `pnpm --filter @spolu/web exec vitest run src/locales src/i18n` → the locale parity tests PASS (every key in all nine).
- [ ] **Step 4: Commit** `feat(web): adminWorkload texts in nine languages`.

### Task 10: The card

**Files:** create `apps/web/src/features/admin-home/workload-card.tsx`, `workload-card.test.tsx`. Start with the `frontend-design` skill.

`export function WorkloadCard(): JSX.Element` (named export, loaded with `React.lazy(() => import('./workload-card').then((m) => ({ default: m.WorkloadCard })))`). It calls `useNamespaces(['adminWorkload'])` and `useQuery(workloadQuery)`.

- [ ] **Step 1: Write the failing tests** (`workload-card.test.tsx`, render with `renderWithRouter` and a mocked `apiGet` answer as `home-page.test.tsx` does):
  1. `it('shows a row per admin in the order sent, with the counts')`: two admins; `getAllByRole('row')` names in order; numbers in cells.
  2. `it('marks the viewer\'s row with (vy)')`.
  3. `it('shows Po termíne above 0 in the overdue colour and 0 muted')`: the cell's class contains the overdue token class used by the Tickets card's due date.
  4. `it('expands and collapses an admin\'s clients')`: the button has `aria-expanded="false"` and `aria-controls`; click → `true`, the client rows ("Mesto Senec", "eGrant tím", "Bez klienta") visible; click again → hidden; no new request (`apiGet` called once).
  5. `it('shows the more row with the summed counts')`: `moreClients { count: 3, … }` → "a 3 ďalší klienti".
  6. `it('links task numbers to the board with the admin and client')`: the Úlohy link of a client row has `href` `/tasks?clients=g1&assignee=u2`; Bez klienta has no link; another admin's Tikety is plain text, the viewer's is a link.
  7. `it('shows the time column only when the answer has a week')`: `week: null` → no "Tento týždeň" header; with a week → header and "1 h 30 min" for 90, "–" for 0.
  8. `it('shows the error line with a retry')`: the request fails → `adminHome.shell.loadError` text and a retry that refetches.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web exec vitest run src/features/admin-home/workload-card.test.tsx` → FAIL.
- [ ] **Step 3: Implement** the `Card` with a `<table>` (`<caption className="sr-only">` = title), `<th scope="col">` headers, numbers `tabular-nums text-right`, the disclosure button per admin row (an inline SVG chevron as the features' own `icons.tsx` files draw them (e.g. `features/tickets/icons.tsx`), rotated by class, no animation; no icon dependency), client rows in a `<tbody id=…>` toggled by state, links with `Link` from the builders of Task 8, `formatDuration` for minutes, the footnote. Loading: three placeholder rows; error: the existing `adminHome.shell.loadError` / `retry`.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @spolu/web lint typecheck`.
- [ ] **Step 5: Commit** `feat(web): workload card`.

### Task 11: On the dashboard, lazily

**Files:** modify `apps/web/src/features/admin-home/home-page.tsx`, `home-page.test.tsx`; docs `product/admin-home.md`, `architecture/performance.md`.

- [ ] **Step 1: Write the failing tests** in `home-page.test.tsx`:
  - `it('shows the workload card last on a wide screen')`: with the wide media query, after the cards load, the last card's heading is "Vyťaženie tímu" (`findByRole('heading', { name: … })` and its position after "Zmienky").
  - `it('does not show the workload card on a phone')`: narrow → no such heading, and `calls` has no `/me/home/workload`.
  - `it('does not import the workload card before the wide layout renders')`: as `task-panel.test.tsx` checks its lazy chat, spy on the dynamic import (`vi.mock('./workload-card', …)` with a counter) and assert 0 in the narrow layout.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web exec vitest run src/features/admin-home/home-page.test.tsx` → FAIL.
- [ ] **Step 3: Implement:** `const WorkloadCard = lazy(() => import('./workload-card').then((m) => ({ default: m.WorkloadCard })));` and, as the last child of the wide branch, `<Suspense fallback={null}><WorkloadCard /></Suspense>`. Update the doc comment of `HomePage`.
- [ ] **Step 4: Run** → PASS. Build and measure the initial JS as in `architecture/performance.md`, "How to check" (`pnpm build`, then the gzip -9 loop over the entry's file list); write the number and the new chunk's size in performance.md. Update `product/admin-home.md`: a "Team workload card (owner request, 2026-10-19)" section with the rules of spec §3–4 and the decisions taken on the open questions.
- [ ] **Step 5: Commit** `feat(web): workload card on the admin dashboard`.

### Task 12: e2e scenario

**Files:** modify `e2e/admin-home.spec.ts`.

- [ ] **Step 1: Write** `test('the team workload card shows each admin\'s open work by client')`: the spec's existing admin N and a second admin M (created as the file's other admins are); M gets an open task with yesterday's due date in client A (through the API as the file does); N opens `/` at 1280 px, scrolls to "Vyťaženie tímu", sees M's row with Úlohy 1 and Po termíne 1, expands it, sees client A, clicks the Úlohy number and lands on `/tasks` with `assignee=<M's id>` and `clients=<A's id>` in the URL, the task card visible.
- [ ] **Step 2:** do **not** run it in parallel with other agents; leave it for the merger's `pnpm test:e2e` / `bash scripts/ci.sh`, which (owner, 2026-10-19) runs once after all the phases now in flight are built. Note in `product/admin-home.md` that it is written, not yet run.
- [ ] **Step 3: Commit** `test(e2e): team workload card`.

### Task 13: Finish

- [ ] Run `update-kb`; check `bash scripts/check-docs.sh origin/main` is quiet.
- [ ] `pnpm lint && pnpm typecheck && TEST_DATABASE_URL=… pnpm test` (server, web, shared).
- [ ] Open the pull request from `feat/admin-workload`; the merger runs `bash scripts/ci.sh` (with e2e) and links the plan in `docs/roadmap.md`.

## Done when

An admin opens the dashboard on a computer and, under the other cards, sees every active colleague's open tasks, overdue tasks, active tickets as riešiteľ and unseen items (and, with the finance right, this week's time), expands a colleague to see the clients, and opens the global board filtered to that colleague and client in one click; deactivated clients and disabled admins never show; the card is one indexed statement and adds nothing to the initial JS.
