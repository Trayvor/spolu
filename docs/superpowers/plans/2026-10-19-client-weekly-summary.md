# Weekly Client Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every client group gets a weekly email (what we did, what we need from you, what is coming), drafted by AI or as a plain factual list, reviewed, edited and sent by the group's manager (never without that review). Every weekly report, sent or not, is kept permanently and searchable by client, date range and text (the archive of work reports per client).

**Architecture:** A new server module `modules/weekly-summary` owns seven tables, its policy, its pg-boss jobs (prepare, draft, send, remind, sweep, purge of old recipient emails) and its routes, the archive search included; the facts come from functions exported by `tasks`, `tickets`, `projects` and `chat`; the AI provider lives in `modules/ai` next to the meeting summary. The web adds three lazy routes (`/weekly-summaries`, `/weekly-summaries/archive`, `/weekly-summaries/$summaryId`) with a lazy namespace `weeklySummary`, plus small entries in existing lazy screens.

**Tech Stack:** Fastify, Drizzle + PostgreSQL 17, pg-boss, zod (`packages/shared`), Socket.IO, React + TanStack Router/Query, i18next lazy namespaces, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-19-client-weekly-summary-design.md](../specs/2026-10-19-client-weekly-summary-design.md) (read §1, §3, §4, §7, §7.3 and §14 first).

**Timing:** implementation starts only after every phase now in flight is done (owner, 2026-10-19). Task 21's e2e spec is written with the code but run only in the final e2e pass, after all seven plans of 2026-10-19 (ticket AI draft, ICS calendar, admin workload, ticket rating, this one, audit log, chat message search) are implemented (`pnpm test:e2e` / `scripts/ci.sh`, never concurrently with another worktree).

**Owner decisions (2026-10-19), binding:** a summary is never sent to a client without the manager's review (no auto-send, now or later); drafts never expire, disappear or get replaced (no `expired` status; a regeneration or restore keeps the earlier text as a revision); every weekly report is kept permanently and searchable by client, date range and text for managers and admins.

## Global Constraints

- English in code, comments, docs and commits; UI texts in all nine languages (sk, en, cs, sl, bg, et, it, hr, uk); Italian formal "Lei", Slovenian vikanje in sentences and singular imperative on buttons (ADR 0019); Slovak is the source text (spec §12).
- New web texts only in lazy namespaces: new `weeklySummary`, plus `adminHome`, `projects`, `notifications`, `unsubscribe`. **No key in the eager `apps/web/src/locales/<code>.json`.** The initial JS (200 kB gzip budget, practically full) must not grow: measure as in performance.md "How to check".
- Server texts in all nine `apps/server/src/infra/i18n/<code>.ts` under `ServerTexts.weeklySummary`.
- Permissions only through `modules/weekly-summary/policy.ts`; unreadable or unknown ids answer `404 not_found`; a client on an admin route `403 forbidden`; a non-manager admin on a manager route `403 forbidden`.
- Writes over HTTP; `weekly-summary:changed` `{ id, groupId, week, status, version }` to `ADMINS_ROOM` only after commit.
- Modules call each other's exported functions; `modules/weekly-summary` never reads `tasks`, `tickets`, `project_events`, `messages`, `channels`, `group_members` or `group_managers` directly.
- Migration placeholder name `00XX_client-weekly-summary` (one migration; the orchestrator assigns the number; main's newest is `0062_night_integration` and #113 takes `0063`, so check `origin/main`'s latest before `db:generate`). ADR placeholder `ADR-XXXX`.
- Sources are client-visible only: tasks, tickets (subject only), project events of active projects, live messages of the group chat and the group's task chats. Never knowledge, meetings, finance, ticket chats, the admin group, deactivated groups.
- Limits: 50 facts per source; 150 newest messages, 500 characters each, 40 000 in all; items ≤ 500 characters, ≤ 30 per section stored, ≤ 15 per section from the AI; intro ≤ 1500 (AI ≤ 600), closing ≤ 600 (AI ≤ 300).
- Schedules (Europe/Bratislava): prepare `0 7 * * 5`, remind `0 9 * * 5`, sweep `*/5 * * * *`, purge (recipient emails only) `10 4 * * *`. AI timeout 60 s; draft queue `localConcurrency: 2`.
- Rate limits: regenerate 10/h per admin, test send 10/h per admin, unsubscribe routes 30/min per IP.
- Retention: summaries and revisions **permanently** (never deleted, never expired); recipient email addresses blanked after 90 days, the recipient rows (name, language, `sent_at`) kept.
- Archive: every admin reads it (`canReadWeeklySummaries`); filters `groupId`, `from`/`to` (window overlap), `q` (folded like the global search, trigram index on `spolu_fold(search_text)`), `status`; 20 a page, keyset on `(window_end, id)`. It is not part of the global search; deactivated groups' reports stay in it (spec §14 Q9).
- Every foreign key leads an index; every filter/sort column indexed; no N+1; lists keyset-paged (50).
- Test-first for server logic and every policy rule. Assert behaviour, never wall time (bench bounds only with `RUN_BENCH=1`).
- Do not edit `docs/roadmap.md` (the orchestrator links plans).

## Review Focus

1. **A ticket moved to another client, or a task/event deleted, after the draft was made** → Send must not mail its subject; it answers `409 refs_changed` with those items removed (Task 11 test `send drops refs that left the group`).
2. **Two managers editing the same draft, or a double click on Send** → exactly one write wins (`409 stale_version`) and recipients get one email each (Task 11 test `a second send with the same version is 409 and sends nothing twice`).
3. **AI down, slow or returning junk / injected text from client chat** → a factual draft with `aiFailed`, unknown keys become `ref: null`, HTML in AI text is escaped in the email (Task 7 `sanitize` tests and Task 8 `falls back to facts on timeout`).
4. **Client changes membership between draft and send** (removed, disabled, unsubscribed, became žiadateľ only) → not a recipient; recipients are computed at Send, not at draft time (Task 9 test `recipients exclude removed, disabled, unverified, unsubscribed and requesters`).
5. **A week with a gap** (last week skipped or left unsent, or the server was down on Friday) → the window starts at the previous row's `window_end`, capped at 14 days, and the prepare job is idempotent per `(group, week)` (Task 6 `windowFor` tests and Task 8 `prepare twice makes one row per group`).
6. **A draft disappearing** (owner decision) → no job, status or route deletes, expires or overwrites a report without keeping its text: next Friday's prepare leaves the old draft untouched, regenerate and restore write a revision first (Task 8 `prepare never touches earlier weeks' rows`, `regenerate keeps the replaced text as a revision`; Task 12 `purge never deletes a summary or a revision`).
7. **The archive leaking or crawling** → clients get 403, the answer has no `search_text` or email, and every archive shape is indexed on three years of rows (Task 14, Task 15).

---

## File structure

Server, new (`apps/server/src/modules/weekly-summary/`):

- `schema.ts` — the seven tables (spec §6).
- `policy.ts` — `canReadWeeklySummaries`, `canManageWeeklySummary`, `canSetMyWeeklySummary`.
- `week.ts` — `isoWeek`, `windowFor`, `rangeText`.
- `facts.ts` — `collectFacts` (calls the four modules' exported readers).
- `facts-draft.ts` — `factsDraft` (the non-AI draft).
- `service.ts` — rows: create, get, list, update, skip, regenerate and restore (with revisions), settings, prefs, unsubscribes, `pendingDraftCount`, `olderDraftCount`.
- `search-text.ts` — `searchText(content)` (spec §6.1).
- `archive.ts` — `listArchive`, `listArchiveSql` (spec §7.3).
- `recipients.ts` — `currentRecipients`, `freezeRecipients`.
- `email.ts` — `summaryEmail`, `reminderEmail`.
- `token.ts` — `signSummaryUnsubscribeToken`, `verifySummaryUnsubscribeToken`, `summaryUnsubscribeUrls`.
- `jobs.ts` — handlers, queues, schedules.
- `events.ts` — `emitSummaryChanged`.
- `routes.ts`, `unsubscribe-routes.ts`, `me-routes.ts`.
- `errors.ts` — `StaleVersionError`, `NotDraftError`, `RefsChangedError`, `NoRecipientsError`, `GroupInactiveError`.
- `explain.test.ts` and the tests next to each file.

Server, changed: `modules/ai/weekly-summary.ts` (new), `modules/ai/index.ts`; `modules/tasks/weekly-facts.ts` (new), `modules/tasks/schema.ts` (index); `modules/tickets/weekly-facts.ts` (new), `modules/tickets/schema.ts` (index); `modules/projects/weekly-facts.ts` (new); `modules/chat/weekly-facts.ts` (new); `infra/email/email.ts`, `infra/email/layout.ts`, `infra/email/smtp-sender.ts`, `infra/email/elastic-sender.ts`; `infra/i18n/types.ts` + nine `<code>.ts`; `modules/home/routes.ts` (+ `packages/shared` `NavCountsSchema`); `deps.ts`, `app.ts`; `test/test-app.ts` (`weeklySummary` override); `test/explain-templates.ts` (if the `home` volume lacks resolved tickets, client-review tasks or events).

Shared: `packages/shared/src/weekly-summary.ts` (+ export from `index.ts`).

Web, new (`apps/web/src/features/weekly-summary/`): `api.ts`, `list-page.tsx`, `archive-page.tsx`, `editor-page.tsx`, `section-editor.tsx`, `revisions-dialog.tsx`, `preview-dialog.tsx`, `send-dialog.tsx`, `settings-strip.tsx`, `use-summary-events.ts`, `status-chip.tsx`; `apps/web/src/locales/weeklySummary/<9>.json`. Changed: `router.tsx`, `features/admin-home/cards.tsx`, `features/projects/overview-tab.tsx`, `features/notifications/notifications-section.tsx`, `features/bulk-email/unsubscribe-page.tsx` pattern copied to `features/weekly-summary/unsubscribe-page.tsx`, the four lazy namespaces' nine files.

e2e: `e2e/weekly-summary.spec.ts`.

---

### Task 1: Shared schemas

**Files:**

- Create: `packages/shared/src/weekly-summary.ts`, `packages/shared/src/weekly-summary.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/home.ts` (`NavCountsSchema.weeklySummaries: z.number().int().nonnegative()`)

**Interfaces:**

- Produces:
  - `WeeklySummaryStatuses = ['preparing','draft','sending','sent','skipped'] as const`, `WeeklySummaryStatus` (no `expired`: drafts never expire)
  - `WeeklySummaryItemSchema` `{ id: z.string().uuid(), ref: { kind: 'task'|'ticket'|'event', id: string } | null, text: z.string().trim().min(1).max(500) }`
  - `WeeklySummaryContentSchema` `{ intro ≤1500, done/waiting/upcoming ≤30 items, closing ≤600 }`, `EMPTY_WEEKLY_CONTENT`
  - `WeeklySummaryListItemSchema`, `WeeklySummaryDtoSchema` (spec §7.1), `WeeklySummaryListQuerySchema` `{ week?: /^\d{4}-W\d{2}$/, scope: 'mine'|'all' = 'mine', status: 'review'|'sent'|'all' = 'review', cursor?, limit 1..50 = 50 }`
  - bodies: `WeeklySummaryPatchSchema { version: int ≥1, content, language?: UserLanguageSchema }`, `WeeklySummaryVersionSchema { version, language? }`, `WeeklySummaryPreviewSchema { language }`, `WeeklySummarySettingsSchema { enabled: boolean }`, `MyWeeklySummarySchema { subscribed: boolean }`, `WeeklySummaryReminderSchema { remind: boolean }`
  - `WeeklySummaryEvents = { changed: 'weekly-summary:changed' }`, `WeeklySummaryChangedSchema { id, groupId, week, status, version }`
  - archive: `WeeklySummaryArchiveQuerySchema { groupId?, from?: /^\d{4}-\d{2}-\d{2}$/, to?, q?: trim 2..100, status: 'sent'|'unsent'|'all' = 'all', cursor?, limit 1..50 = 20 }` refined `from <= to`; `WeeklySummaryArchiveItemSchema` (spec §7.1)
  - revisions: `WeeklySummaryRevisionSchema { id, version, language, source, createdBy: { name } | null, createdAt, content }`; `WeeklySummaryDtoSchema.revisionCount`

- [ ] **Step 1: Write the failing tests** in `weekly-summary.test.ts`:
  - `content accepts the empty draft` — `WeeklySummaryContentSchema.parse(EMPTY_WEEKLY_CONTENT)` equals `{ intro: '', done: [], waiting: [], upcoming: [], closing: '' }`.
  - `an item longer than 500 characters is rejected` — `safeParse({ id: uuid, ref: null, text: 'a'.repeat(501) }).success === false`; 500 passes.
  - `a section with 31 items is rejected`.
  - `an item with a whitespace-only text is rejected`.
  - `the list query defaults to mine and review` — `parse({})` matches `{ scope: 'mine', status: 'review', limit: 50 }`; `week: '2026-43'` fails.
  - `a ref kind outside task, ticket, event is rejected` (`'knowledge'`).
  - `there is no expired status` — `WeeklySummaryStatuses` does not include `'expired'`.
  - `the archive query defaults to all statuses and 20 a page and rejects from after to` — `parse({})` matches `{ status: 'all', limit: 20 }`; `{ from: '2026-06-30', to: '2026-03-01' }` fails; `q: 'a'` fails.
- [ ] **Step 2: Run** `pnpm --filter @spolu/shared test weekly-summary` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the schemas above in `weekly-summary.ts` and export them from `index.ts`; add `weeklySummaries` to `NavCountsSchema`.
- [ ] **Step 4: Run** the same command — Expected: PASS; `pnpm --filter @spolu/shared typecheck` passes.
- [ ] **Step 5: Commit** `feat(shared): weekly summary schemas`.

### Task 2: Tables, migration, the two source indexes and the archive indexes

**Files:**

- Create: `apps/server/src/modules/weekly-summary/schema.ts`, `apps/server/src/infra/db/migrations/00XX_client-weekly-summary.sql` (generated) and its `meta/` files
- Modify: `apps/server/src/infra/db/schema.ts` (export the new schema), `apps/server/src/modules/tasks/schema.ts`, `apps/server/src/modules/tickets/schema.ts`
- Test: `apps/server/src/modules/weekly-summary/schema.test.ts`

**Interfaces:**

- Produces: Drizzle tables `weeklySummaries` (with `search_text`), `weeklySummaryRecipients` (with `name`, nullable `email`), `weeklySummaryRevisions`, `weeklySummaryGroupSettings`, `weeklySummaryUnsubscribes`, `weeklySummaryAdminPrefs`, `weeklySummaryReminders` exactly as spec §6 (names, checks, indexes; the archive indexes `(group_id, window_end desc, id)`, `(window_end desc, id)`, the gin trigram index on `spolu_fold(search_text)` written with `foldSql` from `infra/db/fold.ts` as `projects/schema.ts` does, and `(group_id, status) where status = 'draft'`); `tasks_group_due_open_idx` on `(group_id, due_date) where completed_at is null`; `tickets_group_resolved_idx` on `(group_id, resolved_at) where resolved_at is not null`.

- [ ] **Step 1: Write the failing tests** (`schema.test.ts`, test database):
  - `one row per group and week` — two inserts with the same `(group_id, week)` throw a unique violation.
  - `status and week are checked` — `status: 'queued'`, `status: 'expired'` and `week: '2026-43'` each throw a check violation.
  - `window_end must be after window_start`.
  - `deleting a group deletes its summaries, settings and unsubscribes`.
  - `deleting a user nulls updated_by and sent_by and deletes their recipient rows`.
  - `deleting a group deletes its summaries' revisions` (only a group deletion does that; no code path deletes a summary).
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/schema` — Expected: FAIL (no tables).
- [ ] **Step 3: Implement** `schema.ts` and the two indexes; run `pnpm --filter @spolu/server db:generate`, rename the generated SQL to `00XX_client-weekly-summary.sql` (keep the journal tag in step), and confirm the SQL creates exactly the seven tables, the two source indexes and the archive indexes (`spolu_fold` and `pg_trgm` already exist on main).
- [ ] **Step 4: Run** the schema test and `apps/server/src/infra/db/foreign-key-indexes.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(weekly-summary): tables and source indexes`.

### Task 3: Policy

**Files:**

- Create: `apps/server/src/modules/weekly-summary/policy.ts`, `policy.test.ts`

**Interfaces:**

- Produces:
  - `canReadWeeklySummaries(actor: SessionUser): boolean` — `isAdmin(actor)`
  - `canManageWeeklySummary(actor: SessionUser, managesGroup: boolean): boolean` — `isAdmin(actor) && managesGroup`
  - `canSetMyWeeklySummary(actor: SessionUser, groupId: string, actorGroupIds: readonly string[]): boolean` — `actor.role === 'client' && actorGroupIds.includes(groupId)`

- [ ] **Step 1: Write the failing tests:**
  - `admins and the superadmin read summaries, clients do not` — admin true, superadmin true, client false.
  - `only a managing admin manages` — admin+true → true; admin+false → false; superadmin+false → false; client+true → false.
  - `a client sets only their own groups` — client with `['g1']`: `g1` true, `g2` false; admin with `['g1']` false.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/policy` — FAIL.
- [ ] **Step 3: Implement** the three functions.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(weekly-summary): policy`.

### Task 4: Source readers in their owning modules

**Files:**

- Create: `apps/server/src/modules/tasks/weekly-facts.ts` (+ `.test.ts`), `modules/tickets/weekly-facts.ts` (+ test), `modules/projects/weekly-facts.ts` (+ test), `modules/chat/weekly-facts.ts` (+ test)

**Interfaces:**

- Produces (each also exports its `…Sql` builder for Task 15's EXPLAIN test, as `openTasksOfSql` does):
  - `doneTasksOf(db, groupId, from: Date, to: Date, limit = 50): Promise<{ id: string; title: string; completedAt: Date }[]>` — newest first
  - `waitingOnClientTasksOf(db, groupId, limit = 50): Promise<{ id; title; dueDate: string | null }[]>` — open tasks in the `client_review` bucket, by position
  - `dueTasksOf(db, groupId, fromDay: string, toDay: string, limit = 50): Promise<{ id; title; dueDate: string }[]>` — open, `due_date` between (inclusive), by date
  - `taskRefsInGroup(db, groupId, ids: string[]): Promise<Set<string>>`
  - `resolvedTicketsOf(db, groupId, from, to, limit = 50): Promise<{ id; number: number; subject: string; resolvedAt: Date }[]>`
  - `ticketRefsInGroup(db, groupId, ids): Promise<Set<string>>`
  - `upcomingEventsOf(db, groupId, fromDay, toDay, limit = 50): Promise<{ id; name; projectName; occursOn: string }[]>` — active projects only
  - `eventRefsInGroup(db, groupId, ids): Promise<Set<string>>`
  - `clientVisibleMessagesOf(db, groupId, from, to, opts = { limit: 150, maxChars: 500, totalChars: 40_000 }): Promise<{ author: string; text: string; at: Date; place: string | null /* task title for a task chat */ }[]>` — oldest first after taking the newest `limit`

- [ ] **Step 1: Write the failing tests** (each module's test file, with `insertTask` and the existing fixtures):
  - `doneTasksOf lists tasks completed in the window only` — completed before `from`, inside, at `to` (excluded), open: only the inside one.
  - `doneTasksOf never returns another group's task`.
  - `waitingOnClientTasksOf lists open client_review tasks by position` — a done one in that bucket and an open one in `todo` are excluded.
  - `dueTasksOf includes both ends and skips completed tasks`.
  - `taskRefsInGroup keeps only ids of the group` — ids of the group, another group, a deleted task: only the first.
  - `resolvedTicketsOf lists tickets resolved in the window of this group` — a ticket moved to another group after resolving is not listed for the old group; a ticket without a client never.
  - `upcomingEventsOf skips archived projects and events outside the range`.
  - `clientVisibleMessagesOf reads the group chat and the group's task chats only` — a ticket chat message of the same group, a deleted message and another group's message are absent.
  - `clientVisibleMessagesOf cuts each text to 500 characters and the total to 40 000`.
  - `clientVisibleMessagesOf writes @? for a mentioned person who is no person of the group`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-facts` — FAIL.
- [ ] **Step 3: Implement** each reader as one query (the chat one: the group's channels of kind `group` and `task` by `channels_group_id_idx`, one lateral join per channel on `(channel_id, created_at)`, `deleted_at is null`, then the newest 150 overall); render message bodies to plain text with the chat module's existing plain-text helper used by notifications.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: weekly summary source readers in tasks, tickets, projects and chat`.

### Task 5: Server texts

**Files:**

- Modify: `apps/server/src/infra/i18n/types.ts`, `sk.ts`, `en.ts`, `cs.ts`, `sl.ts`, `bg.ts`, `et.ts`, `it.ts`, `hr.ts`, `uk.ts`
- Test: `apps/server/src/infra/i18n/i18n.test.ts` (extend)

**Interfaces:**

- Produces `ServerTexts.weeklySummary`:

  ```ts
  weeklySummary: {
    subject(group: string, range: string): string;   // sk 'Týždenný prehľad: {group}, {range}'
    heading: string;                                  // sk 'Týždenný prehľad práce'
    done: string; waiting: string; upcoming: string;  // sk 'Čo sme urobili' / 'Čo od vás potrebujeme' / 'Čo nás čaká'
    button: string;                                   // sk 'Otvoriť v Help'
    factsIntro(range: string): string;                // sk 'Dobrý deň, posielame prehľad práce za obdobie {range}.'
    factsClosing: string;                             // sk 'Ak máte otázky, odpovedzte v chate skupiny v Help.'
    footer(group: string, url: string): string;       // sk 'Tento prehľad dostávate ako člen skupiny {group}. Odhlásiť sa: {url}'
    testPrefix: string;                               // '[Test]' (same in all)
    reminder: { subject(n: number): string; body(groups: string[], more: number): string; button: string };
  }
  ```

- [ ] **Step 1: Write the failing test** `every language has the weekly summary texts` — for each of the nine: every string and every function's result is non-empty, and differs from en except `testPrefix`; `sk.weeklySummary.subject('Firma', '13. 10. – 17. 10. 2026')` equals `'Týždenný prehľad: Firma, 13. 10. – 17. 10. 2026'`. The formal register (it "Lei", sl vikanje) is a review item, not a test.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test i18n` — FAIL (type error / missing).
- [ ] **Step 3: Implement** the type and the nine translations (Italian "Lei", Slovenian vikanje; terms from `docs/design/wording.md`; reminder plural with `plural()`).
- [ ] **Step 4: Run** the test and `pnpm --filter @spolu/server typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(i18n): weekly summary server texts in nine languages`.

### Task 6: Week, window, facts and the factual draft

**Files:**

- Create: `modules/weekly-summary/week.ts`, `facts.ts`, `facts-draft.ts` and their tests

**Interfaces:**

- Consumes: Task 4 readers; `serverTexts`.
- Produces:
  - `isoWeek(now: Date): string` — ISO week in Europe/Bratislava, `'2026-W43'`
  - `windowFor(previousEnd: Date | null, now: Date): { start: Date; end: Date }` — `start = max(previousEnd ?? now − 7 d, now − 14 d)`, `end = now`
  - `rangeText(lang: UserLanguage, start: Date, end: Date): string` — `'13. 10. – 17. 10. 2026'` in sk via `Intl` with `serverTexts(lang).intl`
  - `type Fact = { key: string; ref: { kind: 'task'|'ticket'|'event'; id: string }; text: string; date: string | null }`
  - `type Facts = { done: Fact[]; waiting: Fact[]; upcoming: Fact[]; messages: { author: string; text: string; at: Date; place: string | null }[] }`
  - `collectFacts(db, groupId, window, today: string): Promise<Facts>` — keys `t1…`, `k1…`, `e1…`; ticket text `#<number> <subject>`; event text `<name> (<project>)`; upcoming = due tasks + events sorted by date; `hasActivity(f: Facts): boolean`
  - `factsDraft(facts: Facts, lang: UserLanguage, range: string): WeeklySummaryContent` — items with fresh uuids, `ref` from the fact, sections cut to 30

- [ ] **Step 1: Write the failing tests:**
  - `isoWeek uses Bratislava time` — `2026-10-18T22:30:00Z` (Monday 00:30 local) → `'2026-W43'`; `2026-12-31T12:00:00Z` → `'2026-W53'`; `2027-01-04` → `'2027-W01'`.
  - `windowFor starts at the previous end` — previous end 3 days ago → start = it.
  - `windowFor caps a gap at 14 days` — previous end 30 days ago → start = now − 14 d; null → now − 7 d.
  - `rangeText in sk and en` — sk `'13. 10. – 17. 10. 2026'`, en uses `en-GB` order.
  - `collectFacts gives stable keys and refs` — one done task, one resolved ticket, one event: keys `t1`, `k1`, `e1`, refs match ids.
  - `hasActivity is false with no facts and no messages`.
  - `factsDraft writes the fixed intro and closing in the draft language` — sk intro equals `serverTexts('sk').weeklySummary.factsIntro(range)`; done items' texts equal the facts' texts; every item id is a uuid.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/week weekly-summary/facts` — FAIL.
- [ ] **Step 3: Implement** the four files.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(weekly-summary): week window, facts and factual draft`.

### Task 7: AI provider

**Files:**

- Create: `apps/server/src/modules/ai/weekly-summary.ts`, `weekly-summary.test.ts`
- Modify: `apps/server/src/modules/ai/index.ts`, `apps/server/test/test-app.ts` (override `weeklySummary?: WeeklySummaryProvider | null`, default null), `apps/server/src/deps.ts` (build it from `config.ai`)

**Interfaces:**

- Produces:
  - `type WeeklySummaryRequest = { groupName: string; language: UserLanguage; today: string; range: string; facts: Record<'done'|'waiting'|'upcoming', { key: string; text: string; date: string | null }[]>; messages: { author: string; text: string; at: string; place: string | null }[] }`
  - `type RawWeeklyDraft = { intro: string; done: { key: string | null; text: string }[]; waiting: …; upcoming: …; closing: string }`
  - `interface WeeklySummaryProvider { draft(req: WeeklySummaryRequest, signal: AbortSignal): Promise<{ draft: RawWeeklyDraft; usage: { promptTokens: number; completionTokens: number } | null }> }`
  - `WEEKLY_SUMMARY_TIMEOUT_MS = 60_000`, `WEEKLY_SYSTEM_PROMPT` (spec §5 rules), `createOpenAiWeeklySummary({ apiKey, model, fetch? })`, `createFakeWeeklySummary()` (turns each fact into one item, intro `'Fake intro'`), `createWeeklySummaryProvider(config.ai)`
  - `sanitizeWeeklyDraft(raw: RawWeeklyDraft, facts: Facts): WeeklySummaryContent` — key → ref via facts; unknown key → `ref: null`; trim; intro ≤ 600, closing ≤ 300, item ≤ 500; ≤ 15 per section; empty texts dropped

- [ ] **Step 1: Write the failing tests:**
  - `sanitize maps known keys to refs and unknown keys to null` — key `t1` → `{ kind: 'task', id }`; key `x9` → `null`.
  - `sanitize cuts texts and sections` — 20 items → 15; a 900-character intro → 600.
  - `sanitize keeps markup as text` — an item `<b>hi</b>` stays the literal string (escaping is the renderer's job; asserted again in Task 9).
  - `the OpenAI request sends only text and names` — with a fetch spy: the body contains the facts' texts and authors, and contains no `@` email of the fixture people and no user id.
  - `an error status, a refusal or invalid JSON throws AiFailedError` (three cases, the error body is not read).
  - `the system prompt asks for formal address and only the given facts` — contains `'formal'` and `'Never invent'`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test ai/weekly-summary` — FAIL.
- [ ] **Step 3: Implement** following `meeting-summary.ts` (strict `json_schema`, `max_completion_tokens: 8000`, never log prompt or answer).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(ai): weekly summary draft provider`.

### Task 8: Service rows and the prepare / draft / sweep jobs

**Files:**

- Create: `modules/weekly-summary/service.ts`, `errors.ts`, `events.ts`, `jobs.ts`, `jobs.test.ts`, `service.test.ts`
- Modify: `apps/server/src/deps.ts` (handlers, queues, schedules)

**Interfaces:**

- Consumes: Tasks 2, 4, 6, 7; `isGroupManager`, `listGroupPeople` (groups), `getNotificationProfiles` (users); `ADMINS_ROOM`.
- Produces:
  - job names `WS_PREPARE_JOB = 'weekly-summary.prepare'`, `WS_DRAFT_JOB = 'weekly-summary.draft'`, `WS_SEND_JOB = 'weekly-summary.send'`, `WS_REMIND_JOB = 'weekly-summary.remind'`, `WS_SWEEP_JOB = 'weekly-summary.sweep'`, `WS_PURGE_JOB = 'weekly-summary.purge'`
  - `weeklySummaryJobHandlers(deps: { db; config; jobs: JobQueue; io; ai: WeeklySummaryProvider | null }): JobHandlers`, `weeklySummaryQueues` (`[WS_DRAFT_JOB]: { localConcurrency: 2 }`, `[WS_SEND_JOB]: { policy: 'standard' }`), `weeklySummarySchedules` (spec §3 crons, `tz: 'Europe/Bratislava'`)
  - `eligibleGroupsSql(week: string): SQL` and `prepareWeek(deps, now: Date): Promise<number>` — inserts `preparing` rows `on conflict (group_id, week) do nothing`, `sendMany` draft jobs for inserted rows only; never updates or deletes rows of earlier weeks
  - `runDraft(deps, summaryId: string): Promise<void>` — facts; no activity → `skipped`/`no_activity`; AI (timeout) → `sanitizeWeeklyDraft`; failure, timeout or zero items with facts → `factsDraft` + `aiFailed`; AI off → `factsDraft`, `aiFailed: false`; writes `content` and `search_text`, sets `draft`, bumps version, emits
  - `draftLanguage(languages: UserLanguage[]): UserLanguage` — majority, tie or empty → `'sk'`
  - service: `getSummary(db, id)`, `listSummaries(db, actor, query)`, `updateDraft(db, id, version, content, language?, actorId)`, `skipDraft(db, id, version, actorId)`, `markRegenerating(db, id, version, language?, actorId)` (stores the current content as a `weekly_summary_revisions` row first, in the same transaction), `restoreRevision(db, id, revisionId, version, actorId)` (same, then sets the revision's content), `listRevisions(db, id)`, `olderDraftCount(db, adminId, week)`, `getGroupSetting(db, groupId)`, `setGroupSetting(db, groupId, enabled, actorId)`, `pendingDraftCount(db, adminId, week)`; errors `StaleVersionError(current)`, `NotDraftError`, `GroupInactiveError`
  - `emitSummaryChanged(io, row: { id; groupId; week; status; version })`

- [ ] **Step 1: Write the failing tests** (`jobs.test.ts`, inline jobs, fake AI unless stated):
  - `prepare makes one preparing row per eligible group and a draft job each`.
  - `prepare skips the admin group, deactivated groups, groups turned off, groups with no manager and groups with no recipient`.
  - `prepare twice makes one row per group` — second run returns 0 and sends no job.
  - `prepare never touches earlier weeks' rows` — a `draft` of `2026-W42` with edited content stays `draft` with the same content and version after the W43 prepare; the group gets a separate W43 row; a `sent` and a `skipped` row stay as they were.
  - `a group with no activity is skipped without an AI call` — AI spy not called; status `skipped`, `skip_reason = 'no_activity'`.
  - `the draft uses the AI answer` — status `draft`, `source: 'ai'`, refs from facts.
  - `falls back to facts on timeout` — a provider that never resolves with the timeout set to 50 ms through the deps: `source: 'facts'`, `ai_failed: true`, content equals `factsDraft(...)` modulo item ids.
  - `AI off gives a factual draft without the failure flag`.
  - `admin-only knowledge and finance never reach the AI` — an admins-only knowledge item and a finance document in the group: the request the fake receives contains neither title.
  - `the draft language is the recipients' majority` — two `it` clients and one `sk` → `it`; `draftLanguage([])` → `sk`.
  - `the sweep re-sends a job for a row stuck in preparing for over 10 minutes`.
  - `every state change emits weekly-summary:changed to the admins room` (socket spy).
  - `service.test.ts`: `updateDraft with an old version throws StaleVersionError carrying the current row`; `updateDraft on a sent summary throws NotDraftError`; `pendingDraftCount counts drafts of the week in groups the admin manages`; `olderDraftCount counts drafts of earlier weeks in groups the admin manages`; `every content write rewrites search_text` (draft job, update, regenerate, restore); `regenerate keeps the replaced text as a revision` (one revision with the old content and version, then the new draft); `restore keeps the replaced text as a revision too`; `an old week's draft can still be updated`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/jobs weekly-summary/service` — FAIL.
- [ ] **Step 3: Implement** the service, the jobs and the wiring in `deps.ts` (handlers, queues, schedules spread like the other modules).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(weekly-summary): prepare and draft jobs with factual fallback`.

### Task 9: Recipients, unsubscribe token and the email

**Files:**

- Create: `modules/weekly-summary/recipients.ts`, `token.ts`, `email.ts` and tests
- Modify: `apps/server/src/infra/email/email.ts` (`headers?: Record<string, string>`), `layout.ts` (`SystemEmail.footerLines?: string[]`, appended to the system footer; `headers` passed through), `smtp-sender.ts`, `elastic-sender.ts` (send `headers`), `test/mail.ts` (`CaughtEmail.headers`)

**Interfaces:**

- Produces:
  - `type Recipient = { userId: string; name: string; email: string; language: UserLanguage }`
  - `currentRecipients(db, groupId): Promise<Recipient[]>` — active verified client members, not disabled, not unsubscribed; at most three queries
  - `freezeRecipients(tx, summaryId, groupId): Promise<number>` — one `insert … select`, with each person's name so the archive and the sent DTO show who got it
  - `signSummaryUnsubscribeToken(secret, userId, groupId)`, `verifySummaryUnsubscribeToken(secret, token): { userId; groupId } | null`, `summaryUnsubscribeUrls(publicUrl, token): { page: string; oneClick: string }` (page `/weekly-summary/unsubscribe/<token>`, one-click `/api/weekly-summary/unsubscribe/<token>/one-click`)
  - `summaryEmail(i: { to: string; lang: UserLanguage; publicUrl: string; groupId: string; groupName: string; range: string; content: WeeklySummaryContent; unsubscribe: { page: string; oneClick: string }; test?: boolean }): EmailMessage` — spec §8.1; `List-Unsubscribe: <oneClick>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

- [ ] **Step 1: Write the failing tests:**
  - `recipients exclude removed, disabled, unverified, unsubscribed and requesters` — six people, one of each kind plus one valid: only the valid one.
  - `recipients never include admins or managers`.
  - `recipients of a group are loaded in at most three queries` (`createCountingDb`).
  - `a token verifies only its own user and group` — tampered group id → null; a bulk email token → null (different purpose string).
  - `the email has the sections in the recipient's language and the text as written` — lang `it`: headings equal `serverTexts('it').weeklySummary.done` etc.; an item text `<b>x</b>` appears escaped in `html` and literal in `text`; empty sections are left out.
  - `the email carries the one-click unsubscribe headers and footer line`.
  - `a test email has the [Test] prefix`.
  - `transactional senders pass headers through` (`smtp-sender.test.ts` extended).
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/recipients weekly-summary/token weekly-summary/email infra/email` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS (and the existing `layout.test.ts`, `email.test.ts` unchanged).
- [ ] **Step 5: Commit** `feat(weekly-summary): recipients, unsubscribe token and email`.

### Task 10: Review routes (list, read, edit, regenerate, preview, test, skip, settings)

**Files:**

- Create: `modules/weekly-summary/routes.ts`, `routes.test.ts`
- Modify: `apps/server/src/app.ts` (register `weeklySummaryRoutes` with prefix `/api`)

**Interfaces:**

- Consumes: Tasks 3, 8, 9.
- Produces: the review rows of spec §7's table (all except send, the archive, `/me` and unsubscribe; the revisions list and restore included), answers per §7.1. `WeeklySummaryDto.refs` built with one query per kind (`taskRefsInGroup`-style title readers may be added to the same `weekly-facts.ts` files as `taskTitlesInGroup`, `ticketTitlesInGroup`, `eventTitlesInGroup`).

- [ ] **Step 1: Write the failing tests** (`buildTestApp`, `loginAs`):
  - `a client gets 403 on every summary route and no session 401`.
  - `an unknown or malformed id answers 404`.
  - `any admin lists and reads; canEdit is true only for the manager`.
  - `the list defaults to the admin's managed groups and pages by group name` — 3 groups, `limit=2`: two items, `nextCursor`, then one.
  - `a non-manager admin gets 403 on patch, regenerate, test, skip and settings put`.
  - `patch saves content and bumps the version; an old version is 409 stale_version with the current dto`.
  - `patch rejects a 501-character item with 400 validation_failed`.
  - `patch on a sent summary is 409 not_draft`.
  - `regenerate answers 202, sets preparing and the job makes a new draft`; `the 11th regenerate in an hour is 429`.
  - `revisions lists the replaced texts newest first for any admin`; `restore by the manager brings a revision back and keeps the current text as a revision`; `restore by a non-manager admin is 403`; `restore with an old version is 409 stale_version`.
  - `an older week's draft is still editable by its manager` (no `not_draft`, no `expired`).
  - `preview renders the email in the asked language without sending`.
  - `test sends only to the acting admin's address` — `countEmailsTo(client) === 0`, the admin got one with `[Test]`.
  - `skip sets skipped with skip_reason manager`.
  - `the dto never carries recipient emails` — `JSON.stringify(dto)` contains no fixture email.
  - `settings put by the manager turns the group off and prepare then skips it`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/routes` — FAIL.
- [ ] **Step 3: Implement** with `requireAdmin`, then `isGroupManager` + `canManageWeeklySummary` for manager routes; in-memory per-user limiters as in `ai/text-routes.ts`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(weekly-summary): review routes`.

### Task 11: Send

**Files:**

- Modify: `modules/weekly-summary/routes.ts`, `jobs.ts`, `service.ts`
- Create: `modules/weekly-summary/send.test.ts`

**Interfaces:**

- Consumes: Tasks 4 (`*RefsInGroup`), 8, 9.
- Produces: `POST /api/weekly-summaries/:id/send`; `sendSummary(deps, actor, id, version): Promise<{ recipients: number }>` throwing `StaleVersionError`, `NotDraftError`, `RefsChangedError(dto)`, `NoRecipientsError`, `GroupInactiveError`; the `WS_SEND_JOB` handler `sendBatch(deps, summaryId)` (20 `pending` rows `for update skip locked`, `sendEmailLater` each, mark `sent`, re-send itself while rows are left, then `status = 'sent'`, `sent_at`, emit).

- [ ] **Step 1: Write the failing tests:**
  - `send freezes recipients, answers 202 and each recipient gets one email in their language` — two clients `sk` and `it`: `latestEmail` subjects equal each language's `subject(...)`.
  - `a second send with the same version is 409 and sends nothing twice` — `countEmailsTo` stays 1 each.
  - `send drops refs that left the group` — draft cites a ticket, the ticket moves to another group: `409 refs_changed`, the returned dto has no item with that ref and a new version, no email sent; sending the new version succeeds.
  - `send with no recipient is 409 no_recipients`; `send in a deactivated group is 409 group_inactive`.
  - `an older week's draft can still be sent` — a W42 draft sent during W43 mails its own W42 content and becomes `sent`; the W43 row is untouched.
  - `recipients are taken at Send time` — a client removed after the draft but before Send is not mailed; a client added after the draft is.
  - `the batch sends 20 a run and finishes with sent` — 45 recipients: 3 runs, then status `sent`, `sent_at` set, one `weekly-summary:changed` with `sent`.
  - `the sweep resumes a summary stuck in sending` — rows left `pending` with no job: the sweep sends the job and they are mailed once.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/send` — FAIL.
- [ ] **Step 3: Implement** (spec §7.2: one transaction with `select … for update`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(weekly-summary): send to the group's clients`.

### Task 12: Client settings, unsubscribe, manager reminder and purge

**Files:**

- Create: `modules/weekly-summary/me-routes.ts`, `unsubscribe-routes.ts`, `me-routes.test.ts`, `unsubscribe-routes.test.ts`, `remind.test.ts`
- Modify: `modules/weekly-summary/jobs.ts`, `email.ts` (`reminderEmail`), `service.ts`, `apps/server/src/app.ts`, the CSRF guard's exempt list (where the bulk email unsubscribe routes are listed)

**Interfaces:**

- Produces: `GET /api/me/weekly-summary`, `PUT /api/me/weekly-summary/:groupId`, `GET`/`PUT /api/me/weekly-summary/reminder`, `GET`/`POST /api/weekly-summary/unsubscribe/:token`, `POST …/:token/one-click`; `remindManagers(deps, now): Promise<number>`; `purgeRecipientEmails(db, now): Promise<void>` (only `update … set email = null`; no delete); `reminderEmail(i: { to; lang; publicUrl; groups: string[] }): EmailMessage`.

- [ ] **Step 1: Write the failing tests:**
  - `a client lists their groups with subscribed true by default`.
  - `a client unsubscribes from one group and is no recipient of it any more`; `a group the client is not in answers 404`; `an admin gets 403 on PUT /me/weekly-summary/:groupId`.
  - `the unsubscribe page tells only groupName, language and subscribed`; `POST unsubscribes, a second POST is idempotent`; `one-click answers 200 with no body and needs no Origin`; `a forged token is 404`; `the 31st call in a minute from one IP is 429`.
  - `the reminder emails each manager once a week with their groups' drafts` — manager of 3 groups with 2 drafts: one email, `subject(2)`; the job run twice → still one (`weekly_summary_reminders`).
  - `a manager who turned reminders off gets none`; `a manager with no draft gets none`.
  - `purge blanks recipient emails older than 90 days and keeps the rows` — `email` null, `name`, `language`, `sent_at` kept.
  - `purge never deletes a summary or a revision` — rows of three years ago in every status are still there after the purge.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/me-routes weekly-summary/unsubscribe weekly-summary/remind` — FAIL.
- [ ] **Step 3: Implement** (unsubscribe routes copy `bulk-email/unsubscribe-routes.ts`'s limiter and CSRF exemption).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(weekly-summary): client opt-out, unsubscribe link and manager reminder`.

### Task 13: Admin home count

**Files:**

- Modify: `apps/server/src/modules/home/routes.ts`, `home/routes.test.ts`

**Interfaces:**

- Consumes: `pendingDraftCount(db, adminId, week)` (Task 8), `isoWeek` (Task 6).
- Produces: `NavCounts.weeklySummaries` on `GET /api/me/home/counts`.

- [ ] **Step 1: Write the failing test** `counts carry the admin's drafts to review this week` — a manager of a group with a `draft` row: `weeklySummaries === 1`; another admin: `0`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test home/routes` — FAIL.
- [ ] **Step 3: Implement** (one extra indexed query in the handler's `Promise.all`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(home): weekly summaries to review in the counts`.

### Task 14: The archive (server)

**Files:**

- Create: `modules/weekly-summary/archive.ts`, `archive.test.ts`
- Modify: `modules/weekly-summary/routes.ts` (register `GET /weekly-summaries/archive` before `/:id`), `routes.test.ts`

**Interfaces:**

- Consumes: Task 1 (`WeeklySummaryArchiveQuerySchema`, `WeeklySummaryArchiveItemSchema`), Task 2 (archive indexes, `search_text`), `normalizeSearch` and `foldSql` (`infra/db/fold.ts`, from the global search #143), the groups module's exported name reader.
- Produces: `listArchiveSql(query, cursor): SQL` (for Task 15) and `listArchive(db, query): Promise<{ items: WeeklySummaryArchiveItem[]; nextCursor: string | null }>` (spec §7.3: every status but `preparing`; window overlap with `from`/`to` in Europe/Bratislava days; `spolu_fold(search_text) like` with `%`/`_` escaped; `status` `sent` / `unsent` / `all`; order `window_end desc, id desc`, keyset, 20 a page).

- [ ] **Step 1: Write the failing tests** (`archive.test.ts`, test database, and `routes.test.ts`):
  - `the archive keeps every week of a client` — rows of three weeks in statuses `sent`, `draft` (an older unsent week) and `skipped`: all three listed, newest first; none has disappeared after a second `prepareWeek`.
  - `a date range finds every week that overlaps it` — windows 21–28 Feb, 27 Feb–6 Mar, 23–30 Jun and 1–7 Jul with `from=2026-03-01&to=2026-06-30`: the 6 Mar and 30 Jun weeks only.
  - `the client filter lists only that group's reports`.
  - `text search folds diacritics and case` — an item "Podali sme žiadosť o platbu": `q=ZIADOST` finds it; `q=100%` treats `%` literally.
  - `status=sent lists only sent, status=unsent lists draft, sending and skipped`.
  - `pages are keyset by window_end and id` — 45 rows, `limit=20`: 20, 20, 5, no duplicates.
  - `from after to is 400 validation_failed`; `a one-character q is 400`.
  - `every admin reads the archive, managers and non-managers alike; a client gets 403; no session 401`.
  - `an unknown groupId is 404`.
  - `a deactivated group's reports stay in the archive` (spec §14 Q9; flip the test if the owner answers otherwise).
  - `the answer never carries search_text or recipient emails`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/archive weekly-summary/routes` — FAIL.
- [ ] **Step 3: Implement** with `requireAdmin` + `canReadWeeklySummaries`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(weekly-summary): searchable archive of work reports`.

### Task 15: Query plans on the seeded volume

**Files:**

- Create: `apps/server/src/modules/weekly-summary/explain.test.ts`
- Modify: `apps/server/test/explain-templates.ts` (the `home` volume gains three years of weekly summaries for its groups, about 480 000 rows with realistic `search_text`; and, if missing, resolved tickets, `client_review` tasks with due dates, project events and messages in task chats for its sample group; bump the template version so the template is rebuilt)

**Interfaces:**

- Consumes: the `…Sql` builders of Task 4, `eligibleGroupsSql` (Task 8), the list query builder `listSummariesSql` exported from `service.ts`, `listArchiveSql` (Task 14).

- [ ] **Step 1: Write the test** `weekly summary queries use indexes on the seeded volume` (same `expectIndexed` helper as `projects/explain.test.ts`, `inject('explainDatabaseUrls').home`): no seq scan on `groups`, `tasks`, `tickets`, `project_events`, `projects`, `messages`, `channels`, `weekly_summaries`, `group_members`, `group_managers` for the eligibility query (bound 200 ms), each of the six source queries (30 ms), the list page (30 ms) and the three archive shapes (one client and a range 30 ms, all clients and a range 30 ms, a text query 100 ms); bounds checked only with `RUN_BENCH=1`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test weekly-summary/explain` — Expected: PASS once Task 2's indexes exist; if a plan seq-scans, fix the query or the index, not the test.
- [ ] **Step 3: Run** with `RUN_BENCH=1` once and write the numbers into performance.md in Task 22.
- [ ] **Step 4: Commit** `test(weekly-summary): query plans on the seeded volume`.

### Task 16: Web data layer and the list screen

Start with the `frontend-design` skill (CLAUDE.md rule) for the list and the editor.

**Files:**

- Create: `apps/web/src/features/weekly-summary/api.ts`, `status-chip.tsx`, `list-page.tsx`, `list-page.test.tsx`, `use-summary-events.ts`, `use-summary-events.test.tsx`, `apps/web/src/locales/weeklySummary/{sk,en,cs,sl,bg,et,it,hr,uk}.json`
- Modify: `apps/web/src/router.tsx` (route `/weekly-summaries`, admins, `lazyRouteComponent(withNamespaces(['weeklySummary'], () => import('./features/weekly-summary/list-page')), 'WeeklySummaryListPage')`)

**Interfaces:**

- Produces: query keys `['weekly-summaries', 'list', week, scope, status]`, `['weekly-summaries', 'detail', id]`; hooks `useSummaryList(query)`, `useSummary(id)`, `usePatchSummary(id)`, `useSendSummary(id)`, `useSkipSummary(id)`, `useRegenerateSummary(id)`, `useTestSummary(id)`, `useGroupSummarySetting(groupId)`, `useSummaryEvents()` (invalidates both keys on `weekly-summary:changed`, 2 s debounce, `firstJoinCheck` on reconnect).

- [ ] **Step 1: Write the failing tests:**
  - `list-page.test.tsx`: `shows a row per group with status, source and counts` (sk texts `Koncept`, `Iba fakty`, `8 bodov`, `4 príjemcovia`); `the filters are remembered and put into the URL`; `empty week shows Tento týždeň nie je čo kontrolovať.`; `week arrows change the week param`.
  - `use-summary-events.test.tsx`: `a changed event invalidates the list and that summary once within 2 s`.
  - the locale test (`apps/web/src/locales/*.test.ts`) passes for the new namespace in all nine languages.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test weekly-summary` — FAIL.
- [ ] **Step 3: Implement** with the existing UI components (no new dependency); Slovak texts from spec §12.2, the other eight languages translated (it "Lei", sl vikanje).
- [ ] **Step 4: Run** the tests, `pnpm --filter @spolu/web build`, and compare the initial JS with `main` (performance.md "How to check") — Expected: PASS, initial JS unchanged.
- [ ] **Step 5: Commit** `feat(web): weekly summaries list`.

### Task 17: Web editor, preview and send

**Files:**

- Create: `features/weekly-summary/editor-page.tsx`, `section-editor.tsx`, `preview-dialog.tsx`, `send-dialog.tsx`, `settings-strip.tsx`, and `editor-page.test.tsx`
- Modify: `apps/web/src/router.tsx` (route `/weekly-summaries/$summaryId`, same namespace)

**Interfaces:**

- Consumes: Task 16 hooks; `WeeklySummaryDto`.
- Produces: `<SectionEditor items onChange disabled />` (textarea per item, Vyššie / Nižšie / Odstrániť, Pridať bod, ref link), `<PreviewDialog summaryId />` (language select, `<iframe sandbox="" srcDoc>`), `<SendDialog count onConfirm />`.

- [ ] **Step 1: Write the failing tests** (`editor-page.test.tsx`):
  - `a manager edits an item and saves with the current version` — PATCH body `{ version: 3, content: … }`.
  - `a 409 stale_version shows Koncept medzitým upravil … Načítať novú verziu? and keeps the typed text until confirmed`.
  - `the aiFailed note is shown for a factual fallback`.
  - `a non-manager sees the read-only note and no Send button`.
  - `send asks Poslať prehľad 4 príjemcom? and on 409 refs_changed shows the note and the new content`.
  - `regenerate asks for confirmation first` — the text says the current text is kept among the previous versions.
  - `Predchádzajúce verzie (2) lists revisions and Obnoviť túto verziu restores one for the manager only`.
  - `an older week's draft shows the Koncept z týždňa 41 note and can be sent`.
  - `the preview iframe is sandboxed and uses srcdoc` (attribute `sandbox` is `''`).
  - `moving an item down swaps it with the next one`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test weekly-summary/editor` — FAIL.
- [ ] **Step 3: Implement** (spec §12.3 texts; autosave 1 s after the last change, never while a 409 is unresolved).
- [ ] **Step 4: Run** — PASS; build and initial JS unchanged.
- [ ] **Step 5: Commit** `feat(web): weekly summary editor`.

### Task 18: Entry points in existing screens

**Files:**

- Modify: `apps/web/src/features/admin-home/cards.tsx` (+ test), `features/projects/overview-tab.tsx` (+ test), `features/notifications/notifications-section.tsx` (+ test); the nine files of `locales/adminHome/`, `locales/projects/`, `locales/notifications/`
- Create: `features/weekly-summary/overview-line.tsx` (rendered by the overview tab for admins, loads `weeklySummary` with `useNamespaces` under `<Suspense>`)

- [ ] **Step 1: Write the failing tests:**
  - `the home shows Týždenné prehľady · Na kontrolu: 3 when counts.weeklySummaries is 3 and nothing when 0`.
  - `the overview tab shows the summary line to admins only` — client render has no such text.
  - `a client toggles the weekly summary of one group in the profile` — PUT `/api/me/weekly-summary/g1` `{ subscribed: false }`; an admin sees "Pripomenúť mi koncepty e-mailom" instead.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test admin-home overview-tab notifications-section` — FAIL.
- [ ] **Step 3: Implement** (texts from spec §12.1, §12.4, §12.5 in nine languages).
- [ ] **Step 4: Run** — PASS; build and initial JS unchanged.
- [ ] **Step 5: Commit** `feat(web): weekly summary entry points`.

### Task 19: Web unsubscribe page

**Files:**

- Create: `apps/web/src/features/weekly-summary/unsubscribe-page.tsx`, `unsubscribe-page.test.tsx`
- Modify: `apps/web/src/router.tsx` (public route `/weekly-summary/unsubscribe/$token`, namespace `unsubscribe`), the nine `locales/unsubscribe/<code>.json`

- [ ] **Step 1: Write the failing tests:** `shows the group and unsubscribes on open`; `Znova prihlásiť subscribes again`; `a bad link shows Odkaz je neplatný alebo už neplatí.`; `the page is in the token's language`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test weekly-summary/unsubscribe` — FAIL.
- [ ] **Step 3: Implement** after `features/bulk-email/unsubscribe-page.tsx`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(web): weekly summary unsubscribe page`.

### Task 20: Web archive

Start with the `frontend-design` skill (CLAUDE.md rule).

**Files:**

- Create: `apps/web/src/features/weekly-summary/archive-page.tsx`, `archive-page.test.tsx`
- Modify: `apps/web/src/router.tsx` (route `/weekly-summaries/archive`, admins, same namespace, declared before `$summaryId`), `features/weekly-summary/api.ts` (`useSummaryArchive(query)`, infinite query, key `['weekly-summaries', 'archive', query]`, invalidated by `useSummaryEvents`), `list-page.tsx` (header link, the older-drafts line), `overview-line.tsx` (archive link), the nine `locales/weeklySummary/<code>.json`

- [ ] **Step 1: Write the failing tests** (`archive-page.test.tsx`):
  - `filters live in the URL` — picking a client, `Od`, `Do`, a text and `Neodoslané` sets `groupId`, `from`, `to`, `q`, `status`; opening that URL restores them.
  - `each report shows its week, status and full content` — sk `Odoslané 17. 10. 2026 · Jana Nováková`, the intro and the items.
  - `matched text is marked and stored text stays text` — `q=platbu` wraps the match in `<mark>`; an item `<b>x</b>` renders literally.
  - `Načítať ďalšie loads the next page`; `empty filters show Pre tieto filtre nie je žiadny prehľad.`
  - `a deactivated client is listed as (deaktivovaná) in the picker`.
  - `list-page.test.tsx`: `older unsent drafts show the line and link to the archive with status=unsent`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test weekly-summary/archive weekly-summary/list` — FAIL.
- [ ] **Step 3: Implement** (spec §12.8 texts in nine languages; the text input debounced 300 ms; no new dependency).
- [ ] **Step 4: Run** — PASS; build and initial JS unchanged.
- [ ] **Step 5: Commit** `feat(web): weekly summary archive`.

### Task 21: e2e spec (run only in the final e2e pass)

**Files:**

- Create: `e2e/weekly-summary.spec.ts`
- Modify: `e2e` fixtures only if a helper to trigger the prepare job exists for other jobs; otherwise add a dev/e2e-only route guarded like the existing e2e helpers (never registered in production, assert in `app.test.ts`).

- [ ] **Step 1: Write the spec** `a manager reviews, edits and sends the weekly summary` (fake AI): seed a group with a manager, one client (language `it`), a completed task and a `client_review` task; trigger prepare; the manager opens `/weekly-summaries`, opens the draft, edits the intro, opens the preview, sends; Mailpit has one email to the client with the Italian headings and the edited intro, and the `List-Unsubscribe` header; the client's unsubscribe link page shows the group; the summary row shows "Odoslané"; the archive (`/weekly-summaries/archive`, client filter and a word of the edited intro) finds the report. Also `a client never reaches /weekly-summaries or the archive` (redirect or not-found screen, API 403). The CSP spec's console check covers the editor and the preview (add both routes to `e2e/csp.spec.ts`).
- [ ] **Step 2: Do not run it in the worktree.** Run `pnpm --filter @spolu/server typecheck` and `pnpm lint` only. The orchestrator runs `pnpm test:e2e` once in the final e2e pass, after all seven plans of 2026-10-19 are implemented (CLAUDE.md: never concurrently).
- [ ] **Step 3: Commit** `test(e2e): weekly summary`.

### Task 22: Docs and ADR

**Files:**

- Create: `docs/product/weekly-summary.md`, `docs/decisions/XXXX-weekly-client-summaries.md` (ADR-XXXX, content per spec §15)
- Modify: `docs/product/README.md`, `docs/architecture/{permissions,data-model,realtime,performance,overview}.md`, `docs/glossary.md`, `docs/decisions/README.md`, `docs/design/wording.md`, `.env.example` only if a variable was added (none planned). **Not** `docs/roadmap.md`.

- [ ] **Step 1:** Run the `update-kb` skill; write each doc per spec §16 (permissions: the policy, every route and its answers, the archive for every admin; data model: seven tables, the two new source indexes, the archive indexes and permanent retention; realtime: the event and room; performance: Task 15's numbers and the unchanged initial JS; overview: the module and its six jobs).
- [ ] **Step 2:** `bash scripts/check-docs.sh origin/main` — Expected: no warning.
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test` (own `TEST_DATABASE_URL`) — Expected: PASS.
- [ ] **Step 4: Commit** `docs: weekly client summaries`.

## Merge notes

- One branch per part is fine: **W1** = Tasks 1–9 and 15 (server foundation, no routes), **W2** = Tasks 10–14 (routes and the archive), **W3** = Tasks 16–20 (web), **W4** = Tasks 21–22. W2 needs W1; W3 needs W2's shared DTOs (Task 1, already in W1). Rebase rules from CLAUDE.md: renumber the migration after a rebase that brings one with the same number; re-check all nine locales after a locale conflict.
- Owner answers to spec §14 may change: Q3 (per-recipient translation) changes Task 9; Q4 (ticket chats) changes Task 4's chat reader only; Q9 (deactivated groups in the archive) changes one join and one test in Task 14. Q1 is decided (never auto-send) and adds nothing.
