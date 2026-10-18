# Personal calendar feed (ICS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every admin and client subscribes once to a personal, read-only iCalendar feed of their project events, task deadlines and calls, which respects their read permissions at every fetch.

**Architecture:** A new server module `calendar` owns `calendar_feeds` (one row per person: a nonce, the derived token's hash, the include switches), the `/api/me/calendar-feed` routes and the public `GET /api/public/calendar/:token/help.ics`. The feed is assembled from exported feed functions of the projects, tasks, knowledge, teams and groups modules and serialised by a new `buildIcsFeed` next to the existing `buildIcsText`; the body is deterministic, so its hash is the ETag. The web gets a lazy "Kalendár" card on `/settings` with the lazy `calendarFeed` namespace.

**Tech Stack:** Fastify, Drizzle + PostgreSQL 17, zod (`@spolu/shared`), Vitest, React + TanStack Query, react-i18next. No new dependency.

**Spec:** [docs/superpowers/specs/2026-10-19-ics-calendar-design.md](../specs/2026-10-19-ics-calendar-design.md)

**When:** implementation starts after the current phases are done. The final e2e pass (`pnpm test:e2e`, `scripts/ci.sh`) runs once, after all seven 2026-10-19 plans are implemented.

## Global Constraints

- Migration name `00XX_ics-calendar` (placeholder; main's newest is `0062_night_integration` and #113 takes 0063; before generating, take the next free number on `origin/main` as CLAUDE.md says, then rename). ADR placeholder `ADR-XXXX`.
- English in code, comments, docs, commits. Every new UI text in all nine `apps/web/src/locales/calendarFeed/<code>.json` (sk, en, cs, sl, bg, et, it, hr, uk); every server text in all nine `apps/server/src/infra/i18n/<code>.ts`. it and sl in the formal register.
- Slovak is the source wording; copy the spec §3 texts verbatim into `sk.json`.
- Token: `base64url(HMAC-SHA256(APP_SECRET, "calendar-feed\0" + userId + "\0" + nonce))`, full 32 bytes = 43 characters, regex `/^[A-Za-z0-9_-]{43}$/`. Nonce: 16 random bytes base64url. Stored: nonce and SHA-256 hex of the token only.
- Public route `GET /api/public/calendar/:token/help.ics`: `text/calendar; charset=utf-8`, `Content-Disposition: inline; filename="help.ics"`, `Cache-Control: private, max-age=900`, `ETag`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`; 60 a minute per IP, 20 a minute per token; every failure 404 `not_found`.
- `/me/calendar-feed` writes (PUT, rotate): 20 an hour per user, 429 `rate_limited`.
- Window: dated items `[today − 30 days, today + 365 days]` with `today = bratislavaDay(now)`; calls `[now − 30 days, now + 365 days)`. At most 1 000 rows per source, date order ascending.
- Call length: `teams_meeting_links.duration_minutes`, else 60 minutes. No `VALARM` in the feed. No `METHOD`. `DTSTAMP` = the event's `updatedAt`.
- UIDs: `event-<id>@spolu`, `task-<id>-deadline@spolu`, `call-<itemId>@spolu`.
- Descriptions cut to 1 000 characters; calls carry no notes, transcript or summary.
- Owner decision (2026-10-19): an admin's feed has only the tasks they are assigned to, plus the project events and calls of their own clients (`managedGroupIdsOf`; none when they manage nobody). No "all deadlines of managed clients" switch. Deactivated groups give nothing to anyone, admins included.
- Permissions only through policy functions (`canUseCalendarFeed`, `canReadProjects`, `canUseBoard`, `canReadItem`). Modules talk through exported functions only.
- Initial JS may grow by at most 0.05 kB gzip (measure as in `performance.md`, "How to check").
- Test databases of your own: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ics pnpm --filter @spolu/server test …`. Never run `pnpm test:e2e` or `scripts/ci.sh` (the orchestrator runs them serially).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A client removed from a group, or a deactivated group, while the calendar app keeps polling** — the next poll must drop that group's events, deadlines and calls, for admins too (test in Task 6: `drops a deactivated group and a removed membership on the next fetch`).
2. **An admin's scope** — only their assigned deadlines and their own clients' events and calls; another admin's client never appears (Task 5: `an admin gets only their assigned deadlines and their own clients' events and calls`).
3. **An admins-only call (or a call in an admins-only folder) in a client's group** — never in the client's feed, always in an admin's (Task 4 SQL test and Task 6 route test `leaves admins-only calls out for a client`).
4. **The token in server logs** — Fastify logs `req.url`; the token must appear as `:token` (Task 7: `never logs the feed token`).
5. **A poll with `If-None-Match` after an edit or a deletion** — must get 200 with a new ETag, never a stale 304 (Task 6: `changes the ETag after an edit and after a delete`).
6. **Rotation or revoke while a calendar keeps the old URL** — the old URL answers 404 at once; a disabled user's URL too (Task 6: `old token is 404 after rotate, revoke and deactivation`).

---

## File structure

| File                                                                                                    | Responsibility                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/calendar-feed.ts` (+ `index.ts` export)                                            | `CalendarFeedInclude`, `CalendarFeedPutBodySchema`, `CalendarFeedSchema`, `CalendarFeedAnswerSchema`, `CALENDAR_FEED_LIMITS` |
| `apps/server/src/modules/reminders/ics.ts`                                                              | + `buildIcsFeed` (shares escape/fold)                                                                                        |
| `apps/server/src/modules/calendar/schema.ts`                                                            | `calendarFeeds` table                                                                                                        |
| `apps/server/src/modules/calendar/token.ts`                                                             | token derive, hash, constant-time check                                                                                      |
| `apps/server/src/modules/calendar/policy.ts`                                                            | `canUseCalendarFeed`                                                                                                         |
| `apps/server/src/modules/calendar/service.ts`                                                           | get/put/rotate/delete feed, `findFeedByToken`, `touchFetched`, `deleteFeedOf`                                                |
| `apps/server/src/modules/calendar/feed.ts`                                                              | `buildFeedFor(db, user, include, now)` — scope, sources, policy re-check, events                                             |
| `apps/server/src/modules/calendar/routes.ts`                                                            | `/me/calendar-feed` routes                                                                                                   |
| `apps/server/src/modules/calendar/public-routes.ts`                                                     | the `.ics` route, ETag, rate limits                                                                                          |
| `apps/server/src/modules/calendar/emails.ts`                                                            | the create/rotate email                                                                                                      |
| `apps/server/src/modules/calendar/test-volume.ts`                                                       | EXPLAIN volume `calendar`                                                                                                    |
| `apps/server/src/modules/projects/feed.ts`                                                              | `feedEvents`                                                                                                                 |
| `apps/server/src/modules/tasks/feed.ts`                                                                 | `feedAssignedDeadlines`                                                                                                      |
| `apps/server/src/modules/knowledge/feed.ts`                                                             | `feedCalls`                                                                                                                  |
| `apps/server/src/modules/teams/service.ts`                                                              | + `meetingDurations`                                                                                                         |
| `apps/server/src/modules/groups/service.ts`                                                             | + `activeGroupLabels`                                                                                                        |
| `apps/server/src/app.ts`                                                                                | register routes; request serializer hiding the token                                                                         |
| `apps/server/src/modules/users/service.ts`                                                              | `deactivateUser` calls `deleteFeedOf`                                                                                        |
| `apps/server/src/infra/i18n/{types,sk,en,cs,sl,bg,et,it,hr,uk}.ts`                                      | `calendarFeed` texts                                                                                                         |
| `apps/web/src/features/calendar-feed/{api.ts,calendar-feed-section.tsx,calendar-feed-section.test.tsx}` | the settings card                                                                                                            |
| `apps/web/src/routes/settings.tsx`                                                                      | lazy card for admins and clients                                                                                             |
| `apps/web/src/locales/calendarFeed/<code>.json`                                                         | nine languages                                                                                                               |

---

### Task 1: Shared schemas and the feed serializer

**Files:**

- Create: `packages/shared/src/calendar-feed.ts`, `packages/shared/src/calendar-feed.test.ts`
- Modify: `packages/shared/src/index.ts`, `apps/server/src/modules/reminders/ics.ts`, `apps/server/src/modules/reminders/ics.test.ts`

**Interfaces:**

- Produces:
  - `CalendarFeedIncludeSchema = z.object({ events: z.boolean(), tasks: z.boolean(), calls: z.boolean() }).strict()`; `type CalendarFeedInclude`.
  - `CalendarFeedPutBodySchema = z.object({ include: CalendarFeedIncludeSchema }).strict()`.
  - `CalendarFeedSchema = z.object({ url, webcalUrl, googleUrl: z.string(), include, createdAt: z.string(), lastFetchedAt: z.string().nullable() })`; `CalendarFeedAnswerSchema = z.object({ feed: CalendarFeedSchema.nullable() })`.
  - `CALENDAR_FEED_LIMITS = { rowsPerSource: 1000, pastDays: 30, aheadDays: 365, callMinutes: 60, description: 1000, writesPerHour: 20, perIpPerMinute: 60, perTokenPerMinute: 20 } as const`.
  - `buildIcsFeed(input: { name: string; events: IcsEvent[] }): string` in `reminders/ics.ts`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/calendar-feed.test.ts`:

```ts
it('accepts three booleans and refuses anything else', () => {
  expect(
    CalendarFeedPutBodySchema.safeParse({ include: { events: true, tasks: false, calls: false } })
      .success,
  ).toBe(true);
  expect(
    CalendarFeedPutBodySchema.safeParse({
      include: { events: true, tasks: 'managed', calls: true },
    }).success,
  ).toBe(false);
  expect(
    CalendarFeedPutBodySchema.safeParse({
      include: { events: true, tasks: true, calls: true, x: 1 },
    }).success,
  ).toBe(false);
});
```

`reminders/ics.test.ts`, new `describe('buildIcsFeed')` (reuse the file's `lines`/`unfold` helpers):

```ts
it('has calendar properties and no METHOD', () => {
  const all = lines(buildIcsFeed({ name: 'Help – Mária', events: [event()] }));
  expect(all).toContain('X-WR-CALNAME:Help – Mária');
  expect(all).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
  expect(all).toContain('X-PUBLISHED-TTL:PT1H');
  expect(all.some((l) => l.startsWith('METHOD:'))).toBe(false);
});
it('stamps each event with its own updatedAt and has no alarm', () => {
  const all = lines(buildIcsFeed({ name: 'n', events: [event()] }));
  expect(all).toContain('DTSTAMP:20261016T080000Z');
  expect(all).not.toContain('BEGIN:VALARM');
});
it('is byte-identical for the same events whatever the clock', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01'));
  const a = buildIcsFeed({ name: 'n', events: [event()] });
  vi.setSystemTime(new Date('2027-01-01'));
  expect(buildIcsFeed({ name: 'n', events: [event()] })).toBe(a);
  vi.useRealTimers();
});
it('escapes the calendar name', () => {
  expect(lines(buildIcsFeed({ name: 'a,b;c', events: [] }))).toContain('X-WR-CALNAME:a\\,b\\;c');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/shared test calendar-feed && pnpm --filter @spolu/server exec vitest run src/modules/reminders/ics.test.ts`
Expected: FAIL (module / `buildIcsFeed` not found).

- [ ] **Step 3: Implement**

Shared file and export as in Interfaces. In `ics.ts` refactor the per-event lines into a private `eventLines(event, stamp: string, alarm: boolean): string[]` used by both builders; `buildIcsFeed` writes `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//eGrant//Spolu//EN`, `CALSCALE:GREGORIAN`, `X-WR-CALNAME:<escaped>`, `REFRESH-INTERVAL;VALUE=DURATION:PT1H`, `X-PUBLISHED-TTL:PT1H`, the events with `stamp = utc(event.updatedAt)` and `alarm = false`, `END:VCALENDAR`, folded, CRLF. `buildIcsText` output must not change (its existing tests stay green).

- [ ] **Step 4: Run to verify they pass**

Same command. Expected: PASS, including every existing `buildIcsText` test.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/calendar-feed.ts packages/shared/src/calendar-feed.test.ts packages/shared/src/index.ts apps/server/src/modules/reminders/ics.ts apps/server/src/modules/reminders/ics.test.ts
git commit -m "feat(calendar): shared feed schemas and buildIcsFeed"
```

### Task 2: Table, migration, token and policy

**Files:**

- Create: `apps/server/src/modules/calendar/{schema.ts,token.ts,token.test.ts,policy.ts,policy.test.ts}`, migration `apps/server/src/infra/db/migrations/00XX_ics-calendar.sql` (+ `meta/` snapshot and journal, generated)
- Modify: the drizzle schema index file that lists module schemas (the same place `mcp/schema.ts` is listed)

**Interfaces:**

- Produces:
  - `calendarFeeds` (columns per spec §4: `userId` PK FK `user.id` cascade, `nonce`, `tokenHash` unique `calendar_feeds_token_hash_unique`, `includeEvents` default true, `includeTasks` boolean default true, `includeCalls` default true, `lastFetchedAt`, `createdAt`, `updatedAt`, precision 3).
  - `FEED_TOKEN = /^[A-Za-z0-9_-]{43}$/`, `newFeedNonce(): string`, `feedToken(appSecret, userId, nonce): string`, `feedTokenHash(token): string`, `isFeedToken(appSecret, row: { userId: string; nonce: string }, token: string): boolean`.
  - `canUseCalendarFeed(actor: SessionUser, actorGroupIds: readonly string[]): boolean`.

- [ ] **Step 1: Write the failing tests**

`token.test.ts`:

```ts
it('derives a 43-character token that changes with the nonce and the user', () => {
  const a = feedToken('secret', 'u1', 'n1');
  expect(a).toMatch(FEED_TOKEN);
  expect(feedToken('secret', 'u1', 'n1')).toBe(a);
  expect(feedToken('secret', 'u1', 'n2')).not.toBe(a);
  expect(feedToken('secret', 'u2', 'n1')).not.toBe(a);
  expect(feedToken('other', 'u1', 'n1')).not.toBe(a);
});
it('checks a token against its row', () => {
  const t = feedToken('secret', 'u1', 'n1');
  expect(isFeedToken('secret', { userId: 'u1', nonce: 'n1' }, t)).toBe(true);
  expect(isFeedToken('secret', { userId: 'u1', nonce: 'n2' }, t)).toBe(false);
  expect(isFeedToken('secret', { userId: 'u1', nonce: 'n1' }, t.slice(1))).toBe(false);
});
it('hashes as SHA-256 hex', () => expect(feedTokenHash('x')).toMatch(/^[0-9a-f]{64}$/));
```

`policy.test.ts` (roles via the existing `SessionUser` fixtures of other policy tests):

```ts
it('admins and clients with a group use the feed; a requester-only person does not', () => {
  expect(canUseCalendarFeed(admin, [])).toBe(true);
  expect(canUseCalendarFeed(superadmin, [])).toBe(true);
  expect(canUseCalendarFeed(client, ['g1'])).toBe(true);
  expect(canUseCalendarFeed(client, [])).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/server exec vitest run src/modules/calendar`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** `token.ts` (as `teams/calendar-token.ts`, but the full digest and the `calendar-feed` label), `policy.ts`, `schema.ts`; register the schema; check the latest migration number on `origin/main`, run `pnpm --filter @spolu/server db:generate`, rename to `00XX_ics-calendar` with the real number (journal tag too).

- [ ] **Step 4: Run to verify they pass**

Run: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ics pnpm --filter @spolu/server exec vitest run src/modules/calendar src/infra/db`
Expected: PASS, including `foreign-key-indexes.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/calendar apps/server/src/infra/db
git commit -m "feat(calendar): calendar_feeds table, derived token and policy"
```

### Task 3: Feed settings service and `/me/calendar-feed` routes

**Files:**

- Create: `apps/server/src/modules/calendar/{service.ts,service.test.ts,routes.ts,routes.test.ts,emails.ts}`
- Modify: `apps/server/src/app.ts` (register `calendarFeedRoutes` with prefix `/api`), `apps/server/src/modules/users/service.ts` (`deactivateUser` → `deleteFeedOf`), `apps/server/src/infra/i18n/{types,sk,en,cs,sl,bg,et,it,hr,uk}.ts` (`calendarFeed.createdEmail`, `calendarFeed.name`, `eventSummary`, `callSummary`, `withGroup`)

**Interfaces:**

- Consumes: Task 1 schemas and limits; Task 2 table, token, policy.
- Produces:
  - `type FeedRow = typeof calendarFeeds.$inferSelect`
  - `getFeed(db, userId): Promise<FeedRow | null>`
  - `putFeed(db, userId, include: CalendarFeedInclude): Promise<{ row: FeedRow; created: boolean }>` (insert with a new nonce, or update the switches only; `on conflict (user_id)`)
  - `rotateFeed(db, userId): Promise<FeedRow | null>`, `deleteFeedOf(db, userId): Promise<boolean>`
  - `findFeedByToken(db, appSecret, token): Promise<FeedRow | null>` (regex, hash lookup, `isFeedToken`)
  - `touchFetched(db, userId, now): Promise<void>` (only when `last_fetched_at` is null or older than 1 hour)
  - `toFeedDto(row, publicUrl, appSecret): CalendarFeed` — `url = <publicUrl>/api/public/calendar/<token>/help.ics`, `webcalUrl` = same with `webcal://` replacing the scheme, `googleUrl = https://calendar.google.com/calendar/r?cid=` + `encodeURIComponent(webcalUrl)`
  - Server texts: `calendarFeed: { name(userName: string): string; eventSummary(project: string, event: string): string; callSummary(title: string): string; withGroup(group: string, summary: string): string; createdEmail: { subject: string; lines: string[]; button: string } }`. sk: `name: (n) => \`Help – ${n}\``, `eventSummary: (p, e) => \`${p} · ${e}\``, `callSummary: (t) => \`Hovor: ${t}\``, `withGroup: (g, s) => \`${g}: ${s}\``, subject "Vytvorili ste odkaz na odber kalendára", lines ["Pre váš účet v Help bol vytvorený odkaz na odber kalendára.", "Ak ste to neboli vy, otvorte Nastavenia a odber zrušte."], button "Otvoriť nastavenia".

- [ ] **Step 1: Write the failing tests**

`service.test.ts`:

```ts
it('creates once, then only changes the switches', async () => {
  const a = await putFeed(db, userId, { events: true, tasks: true, calls: true });
  const b = await putFeed(db, userId, { events: false, tasks: false, calls: true });
  expect([a.created, b.created]).toEqual([true, false]);
  expect(b.row.nonce).toBe(a.row.nonce);
  expect(b.row.includeEvents).toBe(false);
});
it('rotate replaces the token; the old one no longer resolves', async () => {
  const { row } = await putFeed(db, userId, include);
  const old = feedToken(secret, userId, row.nonce);
  await rotateFeed(db, userId);
  expect(await findFeedByToken(db, secret, old)).toBeNull();
});
it('touches last_fetched_at at most once an hour', async () => {
  await touchFetched(db, userId, t0);
  await touchFetched(db, userId, new Date(t0.getTime() + 30 * 60_000));
  expect((await getFeed(db, userId))!.lastFetchedAt).toEqual(t0);
});
it('deactivateUser deletes the feed', async () => {
  await putFeed(db, userId, include);
  await deactivateUser(db, userId);
  expect(await getFeed(db, userId)).toBeNull();
});
```

`routes.test.ts` (`buildTestApp`, `loginAs`, `emailWithSubject`):

```ts
it('GET answers { feed: null } before any feed', ...);  // 200, body { feed: null }
it('PUT creates (201) then updates (200) and the URL shape is right', ...);
  // expect(feed.url).toMatch(/\/api\/public\/calendar\/[A-Za-z0-9_-]{43}\/help\.ics$/); webcalUrl starts with 'webcal://'
it('refuses a body with a non-boolean tasks', ...);   // tasks 'managed' → 400 (the old switch no longer exists)
it('a requester-only person gets 403 and no session 401', ...);
it('rotate and delete are 404 without a feed; delete is 204', ...);
it('sends the created email on create and rotate, not on a settings change', ...);
  // emailWithSubject(sk.calendarFeed.createdEmail.subject) count: 1 after PUT, 1 after second PUT, 2 after rotate
it('rate-limits writes to 20 an hour', ...);         // 21st PUT → 429 rate_limited
```

- [ ] **Step 2: Run to verify they fail**

Run: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ics pnpm --filter @spolu/server exec vitest run src/modules/calendar src/infra/i18n`
Expected: FAIL.

- [ ] **Step 3: Implement** the service, the routes (`requireUser` preHandler, then `canUseCalendarFeed(actor, isAdmin ? [] : await clientGroupIds(db, actor.id))`), the email through `sendEmailLater` (failure logged, never answered, as in `mcp/routes.ts`), the nine server text files.

- [ ] **Step 4: Run to verify they pass**

Same command. Expected: PASS (`i18n.test.ts` confirms all nine languages have the keys).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/calendar apps/server/src/app.ts apps/server/src/modules/users/service.ts apps/server/src/infra/i18n
git commit -m "feat(calendar): feed settings routes, rotation, revoke and the security email"
```

### Task 4: Source feed functions in the owning modules

**Files:**

- Create: `apps/server/src/modules/projects/feed.ts`, `apps/server/src/modules/tasks/feed.ts`, `apps/server/src/modules/knowledge/feed.ts`, `apps/server/src/modules/calendar/sources.test.ts`
- Modify: `apps/server/src/modules/groups/service.ts` (`activeGroupLabels`), `apps/server/src/modules/teams/service.ts` (`meetingDurations`)

**Interfaces:**

- Produces (all `limit` default `CALENDAR_FEED_LIMITS.rowsPerSource`, rows ordered by date then id ascending):
  - `activeGroupLabels(db, ids: readonly string[] | 'all'): Promise<Map<string, string>>` — groups with `deactivated_at is null`.
  - `type FeedEventRow = { id; groupId; projectName; name; description; occursOn: string; updatedAt: Date }`; `feedEvents(db, q: { groupIds: string[]; from: string; to: string; limit?: number }): Promise<FeedEventRow[]>` — joins `projects` with `status = 'active'`; dates inclusive.
  - `type FeedDeadlineRow = { id; groupId; title; description; dueDate: string; updatedAt: Date }`; `feedAssignedDeadlines(db, q: { userId; groupIds; from; to; limit? })` — open tasks (`completed_at is null`) with `due_date` in range.
  - `type FeedCallRow = { id; groupId; title; visibility: Visibility; startsAt: Date; meetingUrl: string | null; updatedAt: Date }`; `feedCalls(db, q: { groupIds; includeAdminsOnly: boolean; from: Date; to: Date; limit? })` — `type = 'meeting'`, `starts_at` in `[from, to)`.
  - `meetingDurations(db, itemIds: string[]): Promise<Map<string, number>>` — one `in (...)` read of `teams_meeting_links`.
  - Each `*Sql` builder is exported next to its function (`feedEventsSql`, `feedAssignedDeadlinesSql`, `feedCallsSql`) for Task 8's EXPLAIN checks.

- [ ] **Step 1: Write the failing tests** (`calendar/sources.test.ts`, one seeded group set per `describe`)

```ts
it('activeGroupLabels leaves deactivated groups out', ...);   // setGroupDeactivated(g2) → map has g1 only, also for 'all'
it('feedEvents: only the given groups, the window, active projects', ...);
  // events on from-1, from, to, to+1 → only from and to; an event of an archived project absent; other group absent
it('feedAssignedDeadlines: assigned, open, dated tasks of the given groups', ...);
  // completed task absent; task without due date absent; task assigned to someone else absent; group not given absent
it('feedCalls: admins-only calls only with includeAdminsOnly', ...);
  // public + admins call → includeAdminsOnly false: [public]; true: both
it('feedCalls includes every created call of a series', ...);
  // create a weekly series through the knowledge service (ADR 0049) → feedCalls returns each created occurrence with its own id
it('caps each source at its limit in date order', ...);       // 5 events, limit 3 → the three earliest
it('meetingDurations returns the Teams length by item id', ...);
```

- [ ] **Step 2: Run to verify they fail**

Run: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ics pnpm --filter @spolu/server exec vitest run src/modules/calendar/sources.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** each function with one statement, `group_id = any(${ids}::text[])`; an empty `groupIds` returns `[]` without a query.

- [ ] **Step 4: Run to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/{projects,tasks,knowledge,teams,groups} apps/server/src/modules/calendar/sources.test.ts
git commit -m "feat(calendar): feed reads in the projects, tasks, knowledge, teams and groups modules"
```

### Task 5: Feed assembly with policy re-checks

**Files:**

- Create: `apps/server/src/modules/calendar/feed.ts`, `apps/server/src/modules/calendar/feed.test.ts`

**Interfaces:**

- Consumes: Task 4 functions; `clientGroupIds`, `managedGroupIdsOf`, `bratislavaDay`, `canReadProjects`, `canUseBoard`, `canReadItem`, `serverTexts(lang)`, `buildIcsFeed`.
- Produces: `buildFeedFor(db, user: SessionUser & { language: UserLanguage }, include: CalendarFeedInclude, publicUrl: string, now?: Date): Promise<{ text: string; etag: string }>`; `etag = '"' + sha256(text).base64url.slice(0, 22) + '"'`.

Scope rules exactly as spec §6 steps 1–3; the group prefix (`withGroup`) only for admins; descriptions cut to `CALENDAR_FEED_LIMITS.description` characters plus `\n\n<link>`; calls: description = item link and meeting link only, `location = meetingUrl`, `end = start + (durations.get(id) ?? 60) min`, `alarm: false`; all events sorted by (start instant / date at 00:00 UTC, uid). A source cut at its limit logs `warn` with `{ userId, source }` (pass a `log` argument: `buildFeedFor(…, log?: { warn(obj: object, msg: string): void })`).

- [ ] **Step 1: Write the failing tests**

```ts
it('a client gets their groups\' events, own deadlines and public calls only', ...);
  // assert UIDs: event-e1@spolu, task-t1-deadline@spolu, call-c1@spolu; absent: other group's, admins-only call, someone else's task
it('an admin gets only their assigned deadlines and their own clients\' events and calls', ...);
  // admin A manages g1, admin B manages g2: A's feed has g1's events and calls and A's assigned tasks (also in g2), never g2's events, calls or unassigned tasks
it('an admin who manages no client gets only their assigned deadlines', ...);
it('excludes every kind switched off', ...);              // include { events:false, tasks:false, calls:false } → no VEVENT
it('prefixes the client name only for admins', ...);     // SUMMARY:Obec Lúky: Hovor: Porada vs SUMMARY:Hovor: Porada
it('a call without Teams lasts 60 minutes, with Teams its length', ...);
it('a call carries no notes', ...);                      // item body 'tajné' → text does not contain 'tajné'
it('times are UTC and dates all-day', ...);              // DTSTART:20261025T090000Z ; DTSTART;VALUE=DATE:20261101
it('the same data gives the same ETag; an edit or a delete changes it', ...);
it('a client with no client group left gets an empty calendar', ...); // text has BEGIN:VCALENDAR and no BEGIN:VEVENT
it('texts follow the user\'s language', ...);            // language 'en' → SUMMARY:Call: …, X-WR-CALNAME:Help – <name>
```

- [ ] **Step 2: Run to verify they fail**

Run: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ics pnpm --filter @spolu/server exec vitest run src/modules/calendar/feed.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `buildFeedFor`: run the enabled sources with `Promise.all`, then `meetingDurations` for the calls, filter each row through its policy function with the user's `actorGroupIds`, map to `IcsEvent`s, `buildIcsFeed`.

- [ ] **Step 4: Run to verify they pass**

Same command. Expected: PASS. Also run `test/query-counter.ts` in one test: a feed with all switches on costs at most 7 queries (group ids, managed groups, labels, events, deadlines, calls, durations: assert `<= 7`), and 10 rows and 100 rows give the same count.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/calendar/feed.ts apps/server/src/modules/calendar/feed.test.ts
git commit -m "feat(calendar): assemble the feed with permissions checked at fetch time"
```

### Task 6: Public `.ics` route

**Files:**

- Create: `apps/server/src/modules/calendar/public-routes.ts`, `apps/server/src/modules/calendar/public-routes.test.ts`
- Modify: `apps/server/src/app.ts` (register `calendarPublicRoutes` with prefix `/api`)

**Interfaces:**

- Consumes: `findFeedByToken`, `touchFetched`, `buildFeedFor`, `toSessionUser`, `getUserById`, `createRateLimiter`.
- Produces: `GET /api/public/calendar/:token/help.ics` per Global Constraints.

- [ ] **Step 1: Write the failing tests**

```ts
it('serves the feed with the calendar headers', ...);
  // 200; content-type 'text/calendar; charset=utf-8'; cache-control 'private, max-age=900'; etag matches /^"[A-Za-z0-9_-]{22}"$/;
  // x-robots-tag 'noindex'; referrer-policy 'no-referrer'; body starts with 'BEGIN:VCALENDAR'
it('answers 304 with no body for a matching If-None-Match', ...);
it('changes the ETag after an edit and after a delete', ...);
it('old token is 404 after rotate, revoke and deactivation', ...);
it('a malformed or unknown token is 404', ...);           // 'abc', 43 random chars
it('drops a deactivated group and a removed membership on the next fetch', ...); // for a client and for an admin who manages that group
it('leaves admins-only calls out for a client', ...);
it('limits 20 calls a minute per token', ...);            // 21st → 429
it('notes last_fetched_at', ...);
it('needs no session and passes the CSRF guard on HEAD', ...); // HEAD → 200, empty body
```

- [ ] **Step 2: Run to verify they fail**

Run: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ics pnpm --filter @spolu/server exec vitest run src/modules/calendar/public-routes.test.ts`
Expected: FAIL (404 for every URL).

- [ ] **Step 3: Implement**: IP limit first (before any DB read), then the regex, the per-token limit (keyed by `feedTokenHash`), `findFeedByToken`, the user read fresh (`toSessionUser`; null → 404), `buildFeedFor`, `touchFetched` (errors logged, not answered), the 304 check, the headers.

- [ ] **Step 4: Run to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/calendar/public-routes.ts apps/server/src/modules/calendar/public-routes.test.ts apps/server/src/app.ts
git commit -m "feat(calendar): public ICS feed route with ETag and rate limits"
```

### Task 7: Keep the token out of the logs

**Files:**

- Create: `apps/server/src/infra/http/log-url.ts`, `apps/server/src/infra/http/log-url.test.ts`
- Modify: `apps/server/src/app.ts` (logger `serializers.req`), `apps/server/src/modules/calendar/public-routes.test.ts`

**Interfaces:**

- Produces: `logUrl(url: string): string` — replaces the segment after `/api/public/calendar/` with `:token`; every other URL unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it('hides the feed token', () =>
  expect(logUrl('/api/public/calendar/' + 'a'.repeat(43) + '/help.ics')).toBe(
    '/api/public/calendar/:token/help.ics',
  ));
it('leaves other URLs alone', () => expect(logUrl('/api/groups/g1')).toBe('/api/groups/g1'));
```

In `public-routes.test.ts`: `it('never logs the feed token', …)` — build the app with `logStream` collecting lines, fetch the feed, `expect(lines.join('\n')).not.toContain(token)` and `toContain('/api/public/calendar/:token/help.ics')`.

- [ ] **Step 2: Run to verify they fail**

Run: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ics pnpm --filter @spolu/server exec vitest run src/infra/http/log-url.test.ts src/modules/calendar/public-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `logUrl` and in `buildApp` give both logger configs `serializers: { req: (req) => ({ method: req.method, url: logUrl(req.url), host: req.host, remoteAddress: req.ip }) }`.

- [ ] **Step 4: Run to verify they pass** — same command, PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/infra/http/log-url.ts apps/server/src/infra/http/log-url.test.ts apps/server/src/app.ts apps/server/src/modules/calendar/public-routes.test.ts
git commit -m "fix(calendar): request logs hide the feed token"
```

### Task 8: EXPLAIN checks

**Files:**

- Create: `apps/server/src/modules/calendar/test-volume.ts`, `apps/server/src/modules/calendar/explain.test.ts`
- Modify: `apps/server/test/setup-explain-db.ts` (volume `calendar`: `CALENDAR_VOLUME_TABLES`, `seedCalendarVolume`)

**Interfaces:**

- Consumes: Task 4's `*Sql` builders; `projectVolumeIds` from `projects/test-volume.ts`.
- Produces: `CALENDAR_VOLUME_TABLES = ['user','groups','knowledge_items','knowledge_meetings']`, `seedCalendarVolume(db)` (200 groups, 40 000 calls spread over two years), `calendarVolumeIds(db)`.

- [ ] **Step 1: Write the tests** (copy `expectIndexed` from `projects/explain.test.ts`)

```ts
it('feed events read project_events by group and date', ...);      // projects volume; no seq scan of projects, project_events; 20 ms
it('assigned deadlines start from task_assignees', ...);           // projects volume; no seq scan of tasks, task_assignees
it('feed calls read knowledge_meetings by start', ...);            // calendar volume; no seq scan of knowledge_meetings, knowledge_items; 30 ms
```

- [ ] **Step 2: Run them**

Run: `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ics pnpm --filter @spolu/server exec vitest run --project explain src/modules/calendar/explain.test.ts` (use the same project name the existing EXPLAIN suite uses in `vitest.config.ts`)
Expected: PASS; on a sequential scan, fix the statement or add the index to the Task 2 migration (regenerate it) and rerun.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/calendar/test-volume.ts apps/server/src/modules/calendar/explain.test.ts apps/server/test/setup-explain-db.ts
git commit -m "test(calendar): EXPLAIN checks of the feed reads"
```

### Task 9: Web settings card

**Files:**

- Create: `apps/web/src/features/calendar-feed/{api.ts,calendar-feed-section.tsx,calendar-feed-section.test.tsx}`, `apps/web/src/locales/calendarFeed/{sk,en,cs,sl,bg,et,it,hr,uk}.json`
- Modify: `apps/web/src/routes/settings.tsx`

**Interfaces:**

- Consumes: `CalendarFeedAnswerSchema`, `CalendarFeedPutBodySchema`, `CalendarFeedSchema`; `apiGet`, `apiSend` (`@/lib/api`).
- Produces: `calendarFeedQuery` (key `['me','calendar-feed']`), `putCalendarFeed(include)`, `rotateCalendarFeed()`, `deleteCalendarFeed()`; `CalendarFeedSection({ admin }: { admin: boolean })`.
- Keys (sk values from spec §3): `title`, `intro`, `show`, `events`, `myTasks`, `calls`, `create`, `link`, `copy`, `copied`, `google`, `apple`, `warning`, `lastFetched` (`{{when}}`), `neverFetched`, `saved`, `rotate`, `rotateTitle`, `rotateText`, `revoke`, `revokeTitle`, `revokeText`, `back`, `cancel`.

- [ ] **Step 0: Invoke the `frontend-design` skill** (CLAUDE.md rule) and model the card on `features/mcp/mcp-section.tsx`.

- [ ] **Step 1: Write the failing tests** (pattern of `mcp-section.test.tsx`, `loadAllNamespaces`, mocked `fetch`)

```tsx
it('without a feed shows the switches and creates one', ...);  // click 'Vytvoriť odkaz na kalendár' → PUT body { include: { events:true, tasks:true, calls:true } }
it('shows the same three switches to admins and clients', ...);    // no managed-clients switch
it('shows the link, copies it and offers Google and webcal links', ...);
  // google link href === feed.googleUrl, target _blank, rel 'noopener noreferrer'; apple href === feed.webcalUrl
it('a switch change saves at once', ...);                      // uncheck Hovory → PUT with calls:false
it('rotate asks first, then shows the new URL', ...);
it('revoke asks first and returns to the empty state', ...);   // DELETE → 'Vytvoriť odkaz na kalendár' again
it('shows when the calendar last fetched it', ...);            // lastFetchedAt null → 'Kalendár odkaz zatiaľ nenačítal.'
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/web exec vitest run src/features/calendar-feed`
Expected: FAIL.

- [ ] **Step 3: Implement** the API, the card and the nine locale files (it/sl formal); in `routes/settings.tsx` add `const CalendarFeedSection = lazy(withNamespaces(['calendarFeed'], () => import('@/features/calendar-feed/calendar-feed-section').then((m) => ({ default: m.CalendarFeedSection }))))` rendered after `NotificationsSection` inside `<Suspense fallback={null}>` for every signed-in user whose `GET` does not answer 403 (the card renders nothing on 403, so a requester-only person sees no card).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @spolu/web exec vitest run src/features/calendar-feed src/routes src/locales`
Expected: PASS (the locale tests confirm the nine files have the same keys).

- [ ] **Step 5: Measure the initial JS** as in `performance.md`, "How to check", on this branch and on `origin/main`. Expected: growth ≤ 0.05 kB.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/calendar-feed apps/web/src/locales/calendarFeed apps/web/src/routes/settings.tsx
git commit -m "feat(calendar): Kalendár card on the settings page"
```

### Task 10: Docs and ADR (`update-kb`)

**Files:**

- Create: `docs/decisions/ADR-XXXX-personal-calendar-feed.md` (the orchestrator numbers it), `docs/product/calendar-feed.md`
- Modify: `docs/decisions/README.md`, `docs/product/README.md`, `docs/product/profile.md`, `docs/product/reminders.md` (link to the feed next to the one-off export), `docs/architecture/{overview,data-model,permissions,performance}.md`, `docs/runbooks/deploy.md` (rotating `APP_SECRET` breaks feed links), `docs/glossary.md` ("Odber kalendára"), `docs/integrations/mcp.md` (the feed routes are not in the allowlist). Do **not** edit `docs/roadmap.md`.

- [ ] **Step 1: Run the `update-kb` skill** and write the ADR (context: one-off exports only; decision: derived HMAC token with nonce, expanded occurrences, deterministic body + content ETag, no server cache; consequences: `APP_SECRET` rotation, series calls only 60 days ahead).
- [ ] **Step 2: Record the measured initial JS** in `performance.md`.
- [ ] **Step 3: Check** — `bash scripts/check-docs.sh origin/main` prints no warning; `pnpm exec prettier --check docs`.
- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: personal calendar feed (ADR-XXXX)"
```

### Task 11: Final checks (no e2e, no ci.sh)

- [ ] `pnpm lint && pnpm typecheck` — clean.
- [ ] `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ics pnpm test` — all green.
- [ ] Drop the test databases: `docker exec spolu-postgres-1 psql -U spolu -d postgres -c "drop database if exists spolu_test_ics"` (and its `_explain_*` clones).
- [ ] Write `e2e/calendar-feed.spec.ts` (sign in as a seeded client, create the link on `/settings`, `request.get(url)` → 200 with `BEGIN:VCALENDAR` and the seeded event's SUMMARY, revoke, `request.get(url)` → 404). **Do not run it**: the final e2e run (`pnpm test:e2e`, `scripts/ci.sh`) is the orchestrator's, once all seven 2026-10-19 plans are implemented.
- [ ] Commit, push the branch, open the PR.
