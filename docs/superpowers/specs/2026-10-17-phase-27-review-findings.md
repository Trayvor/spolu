# Phase 27: whole-project review findings (2026-10-17)

The owner asked for this review on 2026-10-17 and authorized the fixes the same night. This report lists every finding with its evidence, then groups the fixes into small pull requests ("batches"). Batches of medium or high impact and low risk are being built now, one PR each, with before and after numbers. The rest are "proposed, not done", for the owner to decide.

Base: `main` at `f012b74` (after PRs #39, #40, #41).

## How it was measured

- **Server queries.**
  - `EXPLAIN (ANALYZE)` on the seeded volume of `modules/home/test-volume.ts`: 100 groups, 20 000 tasks, 20 000 tickets and 200 000 messages, in a transaction that is rolled back.
  - A throwaway probe test (not committed) captured the SQL that the service functions send (postgres.js `debug`) and explained it.
  - For the wide cases it added 3 000 more groups with 100 messages each.
  - Local PostgreSQL 17.11 (the production image `postgres:17`), on an 8-core laptop.
- **Bundle.**
  - Initial JS: `pnpm build`, then gzip -9 of every script `dist/index.html` loads (the method in [performance.md](../../architecture/performance.md)).
  - What is in it: a sourcemap build, with bytes attributed to source files.
  - Precache: the manifest of `dist/sw.js`, gzip -9 per file.
- **Dead code:** `pnpm dlx knip` (knip 6.41, run from the dlx cache, no dependency added), each candidate checked with grep. Locale keys: a script that flattens every key of the nine languages and greps for literal and template uses.
- **Tests and CI:** Vitest JSON reports, run locally, plus the step timestamps of GitHub run 38985319394 (`feat/ui-polish-mobile`, green, 2026-10-17).
- **Docker:** `docker build` of the root `Dockerfile`, then `du` inside the image.

## Summary of the numbers

| What | Now | Note |
|---|---|---|
| Initial JS (gzip -9) | 174.16 kB | budget 200 kB |
| Service worker precache | 304 files, 756 kB gzip (1.87 MB raw) | every device downloads all of it on install |
| `ci.sh` on GitHub | 13 min 14 s | tests 7 min 0 s, e2e 4 min 40 s, lint + format + typecheck 1 min 11 s |
| Server tests | CI 315 s + EXPLAIN 60 s; local 34 s | 117 files, 1 710 tests |
| Web tests | CI 417 s; local 43.5 s | 125 files, 1 275 tests; jsdom set up 125 times |
| Docker image | 467 MB (95 MB compressed content) | node binary 118 MB, `node_modules` 94 MB |
| Deleting a channel with 2 000 messages | **81.8 s** | 500 000 messages in the table |
| Global board, admin who manages no client | **720 ms**, of which 620 ms is JIT | 18 000 open tasks |

## Findings

Impact: **high** = a user waits seconds, or the server does far more work than needed on a common path. **Med** = noticeable at eGrant's scale, or costs CI minutes. **Low** = tidy-up. Effort and risk are S/M/L.

### Server and database

**S1. Foreign keys without an index make deletes scan whole tables.** Impact high, effort S, risk low.
- Evidence: a catalog query lists 18 foreign keys whose columns lead no index. These matter:

  | Foreign key | On delete | Size in the test DB |
  |---|---|---|
  | `messages.parent_id` → messages | cascade | |
  | `messages.reply_to_id` → messages | cascade | |
  | `read_states.channel_id` → channels | cascade | |
  | `thread_read_states.channel_id` → channels | cascade | |
  | `notification_events.group_id` → groups | cascade | 41 MB |
  | `task_attachments.file_id` → files | cascade | |
  | `pending_invites.group_id` → groups | cascade | |
  | `bulk_subscriptions.campaign_id` → bulk_campaigns | set null | |

  The other 10 point at `"user"` (`created_by`, `uploaded_by`…); users are disabled, never deleted.
- Measured on the volume plus 3 000 groups (500 000 messages):

  | Delete | Before | After (with the indexes) |
  |---|---|---|
  | A channel with 100 messages | 5.6 s | 14 ms |
  | A channel with 2 000 messages | 81.8 s | 112 ms |

  Every deleted message checks `messages` twice, through `parent_id` and `reply_to_id`, with a sequential scan each time. Deleting a task deletes its chat channel the same way (`tasks/task-service.ts:525`). So does deleting one message (it cascades to its replies), a group, or a ticket chat.
- Building the four chat indexes takes 0.2 s on 500 000 messages.
- Fix: one migration with those 8 indexes. The two message indexes are partial (`where … is not null`). Plus a test that fails when a cascading or set-null foreign key has no index.

**S2. PostgreSQL JIT compiles the big statements on every call.** Impact high, effort S, risk low.
- Evidence: `jit = on` is the default of `postgres:17`, and `pg_jit_available()` is true. The planner's cost estimates for the statements with correlated subqueries pass `jit_above_cost` (100 000), so they are JIT-compiled on every call.

  | Query | JIT on | JIT off | Note |
  |---|---|---|---|
  | Global board, no client scope | 720 ms | 100 ms | Execution 1 110 ms, of which 924 ms was JIT (optimization 497 ms, emission 408 ms) |
  | Admin sidebar, 3 100 groups | 350 ms | 125 ms | |
  | Mentions, sidebar at 100 groups | unchanged (26 ms, 6 ms) | | |

  Those cases are an admin who manages no client (`clientIds: null`, `home/global-board.ts:51`) and the global ticket and board views.
- JIT pays off only for long analytical queries. Spolu runs short OLTP statements.
- Fix: `jit: 'off'` as a connection parameter in `infra/db/client.ts`. It is one line, and it also covers dev and tests. The database itself and pg-boss stay as they are.

**S3. The global ticket list (`scope=all`, `status=all`) has no index for its order.** Impact med, effort S, risk low.
- Evidence: `tickets/service.ts:384` sorts by `(created_at desc, id desc)` with no group filter. The plan is `Seq Scan tickets` + `Sort`, 11.6 ms at 20 000 tickets, and it grows linearly. The default (open, managed) view uses an index and takes 0.5 ms.
- Fix: index `tickets (created_at desc, id desc)`, in the same migration as S1.

**S4. Every chat or task write anywhere makes every open admin home refetch.** Impact med, effort M, risk med.
- Evidence:
  - `infra/realtime/rooms.ts:22` sends `admin:activity` to the admins room on every message send, edit and delete (twice for a reply: `chat/routes.ts:270,277`) and on every task write.
  - The client (`admin-home/use-admin-activity.ts`) waits 2 s after the last event, then refetches 3 to 4 home queries and the sidebar.
  - Cost: admins online × 5 GETs per quiet gap.
  - The timer restarts on every event, so under steady traffic it may never fire, and the counts stay stale.
- Proposed (not done tonight): the event carries the group id, and an admin who neither manages nor watches it ignores it. Add a max wait (e.g. 10 s) so the counts refresh during busy periods.

**S5. A notification event row for every admin on every top-level message.** Impact med, effort M, risk med.
- Evidence: `chat/messages.ts:263` notifies `listGroupPeople`, and every active admin is in every group (`groups/service.ts:245`). Rows = messages × (admins + clients). Most are stamped delivered at once (`notifications/service.ts:48`); they are written only to be purged after 30 days. The test DB's `notification_events` is 41 MB, the largest table.
- Proposed: skip recipients whose channel for the category is `none` in the `insert … select`. This touches the notification rules, so it needs the owner's review.

**S6. The admin sidebar counts unread messages for every group, and returns every group.** Impact med (grows with clients), effort L, risk med.
- Evidence: 6 ms at 100 groups, 125 ms at 3 100 groups with JIT off (S2). An admin has no `read_states` row for groups they never opened, so each lateral reads up to `UNREAD_CAP` = 100 messages. The response is unbounded. Already noted in performance.md.
- Proposed: a per-(user, channel) unread counter table. This is a bigger design change; later work, when clients reach the thousands.

**S7. N+1 in jobs.** Impact med, effort M, risk low to med.
- One `recordNotifications` per task in the deadline and urgent task reminders (`tasks/reminders.ts:88,122`; urgent runs 5×/day over all urgent tasks).
- About 4 queries per due reminder time in the fire batch (`reminders/jobs.ts:96-135`).
- One audience query per (group, category) in the delivery batch (`notifications/deliver.ts:182`), and one `jobs.send` per push device (`deliver.ts:69`).
- One advisory lock statement per (user, group) in the minutely digest (`notifications/digest.ts:127`).
- Proposed: batch each with one `insert … select` / `unnest`, test-first with `test/query-counter.ts`.
- **Done** (PR #60, branch `perf/job-batching`), behaviour kept: same dedupe keys and pending states, the fire batch still falls back to a savepoint per time if its insert fails, and push jobs fall back to one by one. Queries on the probe volume (warm run): delivery batch over 50 groups with 3 devices each 58 → 9 (and 150 push sends → 1 insert); digest of 50 pairs 57 → 8; deadline reminders for 200 tasks 201 → 2; reminder fire batch of 200 times 606 → 9. Details in [performance.md](../../architecture/performance.md).

**S8. The group board loads every task ever, including all completed ones.** Impact med as groups age, effort M, risk med (visible).
- Evidence: `tasks/service.ts:209` (`getBoard`) runs `selectTasks(eq(groupId))` with no limit. It is 1.8 ms for 200 tasks on the volume. It also runs `ensureBoard` (an insert … on conflict) on every GET.
- Proposed: cap the Done column (e.g. the last 50 plus "Show more", like the global board). This changes what users see, so it is the owner's call.

**S9. Session lookup on every request and socket event.** Impact low-med, effort S, risk med (security trade-off).
- Evidence: there is no better-auth `cookieCache` (`auth/auth.ts:45`). A socket handshake does 2 lookups, and every `group:join` one more plus `clientGroupIds` and `getGroup`.
- Proposed only: a cache delays the effect of disabling a user. Owner decision.

**S10. `clientGroupIds` queried even for admins, and the group-read check copied about 15 times.** Impact low, effort M, risk low.
- Where: `chat/routes.ts:116,145,155,194`, `groups/routes.ts:113,141,149,158`, `files/routes.ts:58,87`, `knowledge/routes.ts:153`, `tasks/routes.ts:49`…
- Proposed: one `canOpenGroup(db, actor, groupId)` helper that skips the membership query for admins. A refactor across modules; later.

**S11. Smaller server items.** All low:
- Ticket chat loads the same ticket 4 to 6 times per message (`tickets/chat.ts:16-55`).
- `createTasksFromSource` checks assignees one by one (`tasks/task-service.ts:106`) and reloads each created task (`:398`).
- The notification purge deletes and returns every id in one statement (`notifications/service.ts:90`).
- Bucket delete runs one UPDATE per moved task (`tasks/service.ts:304`).
- Expired `session` rows are never purged.
- The mentions query starts from all lifetime mentions (`home/mentions.ts:25`; 26 ms with 1 000).

**S12. Checked and fine.**
- No unbounded in-memory caches. Rate limiters sweep expired keys.
- No `io.emit` broadcast.
- Startup is migrations plus about 13 queue setups.
- The chat, knowledge, tickets, bulk email and global board lists are keyset-paged.
- The chat page is 6 small indexed queries (1.2 ms).

### Web

**W1. Eager imports that need not be eager.** Impact med, effort S, risk low.
- Composition of the 174 kB, by source (raw bytes):

  | Source | Raw |
  |---|---|
  | react-dom | 207 kB |
  | zod | 91 kB |
  | TanStack Router | 70 kB |
  | i18next | 48 kB |
  | TanStack Query | 33 kB |
  | tailwind-merge | 28 kB |
  | app code | about 40 kB |

- Avoidable:
  - **tailwind-merge** (about 8 kB gzip) is eager only because 4 eager files call `cn` to join static classes: `components/app-header.tsx`, `language-switcher.tsx`, `section-menu.tsx`, and `ui/button.tsx` through `routes/root-error.tsx`.
  - **`@spolu/shared` bulk-email and notifications schemas** come in through `language-switcher.tsx` → `features/profile/api.ts`, which imports `BulkSubscriptionSchema`, only for `saveLanguage`.
  - **`@spolu/shared` groups schemas** come in through `router.tsx` → `features/groups/api.ts` (`groupQuery`, for the group loader).
- Fix:
  - `saveLanguage` into its own small module.
  - The group loader imports `groupQuery` lazily, as the ticket loader already does.
  - Plain `clsx` where no class conflict is merged.

**W2. zod is in the initial JS.** Impact med (about 25 kB gzip), effort L, risk med.
- Evidence: `MeSchema` validates `/api/me` in the authed `beforeLoad`, so all of zod v4 classic loads first, including its JSON-schema code (`to-json-schema`, `json-schema-processors`, about 17 kB raw), which classic does not tree-shake.
- Proposed: `zod/mini` for the eager schemas, or a hand check of `/me`. It touches how shared schemas are written, so it is later work with its own ADR.

**W3. The service worker precaches every language.** Impact med, effort S, risk low.
- Evidence: `vite.config.ts` precaches `**/*.{js,css,html}`.

  | Precache part | Files | gzip |
  |---|---|---|
  | The 7 languages beyond sk and en | 140 | 145 kB |
  | sk and en | 38 | 36 kB |
  | Screens and other JS | 114 | 414 kB |
  | Fonts | 4 | 130 kB |
  | Total | 304 | 756 kB |

  Every phone downloads Bulgarian, Ukrainian, Estonian… on install, and again when one of those chunks changes.
- Fix: leave those 7 languages' chunks out of the precache (`globIgnores`) and cache them on first use (runtime `CacheFirst`; hashed names, so never stale). A user who picks such a language online gets it cached as before.

**W4. Duplicate refetch on a cold load of a group screen.** Impact med, effort S, risk low.
- Evidence:
  - `tasks/use-board-events.ts:29,87` and `knowledge/use-knowledge-events.ts:51,117` remember the join count at mount (0). The first join ack (1) then counts as a "rejoin", and they invalidate the board, every open task detail, the knowledge list and the folders, while the first fetch is in flight.
  - `tickets/use-ticket-events.ts:123` and `bulk-email/use-bulk-events.ts:20` refetch on the first `connect` the same way.
  - The other hooks already guard with `joins > 1` (`chat-tab-badge.tsx:61`, `tasks-tab-badge.tsx:50`).
- Fix: refetch only on a real rejoin or reconnect, test-first.

**W5. The global board drops the "Show 50 more" pages whenever any task changes.** Impact med, effort M, risk med.
- Evidence: `global-board/global-board.tsx:35,44-48` reset `extra` on every `dataUpdatedAt`, and the query refetches on every task activity anywhere and on focus.
- Proposed: keep the extra pages unless the filters change. It is a visible fix, so the owner should see it first; next web batch.

**W6. Task board re-renders every card on every board or chat event.** Impact low-med, effort S, risk low.
- Evidence: `memo` is used only in `chat/message-item.tsx`. `board.tsx:179` passes a new `onToggleDone`, and `task-chats.ts:54` replaces the summaries on every task-chat message. `formatDue` builds an Intl formatter per card per render (`tasks/dates.ts:17`).
- Proposed: memo `TaskCard` and cache the formatters. Not measured with a profiler tonight, so not done.

**W7. Other web items.**
- Low-med: the ticket list refetches every loaded page on each event (`use-ticket-events.ts:56`).
- Low: `refetchOnReconnect` is left at true, doubling the rejoin refetches. The docs say "Nothing polls", but `/settings` polls health every 30 s (`system/status-card.tsx:24`). `saveLanguage` sends a PUT on every app load (`authed-layout.tsx:43`).
- Low: Saans fonts are 56 kB each, not subset.
- Low: `refetchOnWindowFocus: true` on an infinite query (`knowledge-page.tsx:170`).

**W8. Duplicated web code.** Impact low, effort M, risk low.
- `fold()` (accents plus lowercase) is copied 5 times.
- The socket `on/off` boilerplate appears in about 14 hooks, with two different rejoin idioms (W4 comes from that).
- A "Load more" button is copied 5 times.
- Per-language Intl caches exist twice, while 7 other places build formatters per render.
- Proposed: `lib/text.ts`, `lib/format.ts`, `useSocketEvent`, `<LoadMore>`. Refactors; later.

### Dead code

**D1. Unused code.** Impact low, effort S, risk low.
- knip finds 0 unused files and 0 unused or unlisted dependencies. Its one unused devDependency, `tailwindcss`, is a false positive (the CSS `@import`).
- Safe to delete (no reference anywhere, tests included):
  - `audienceSql` (`bulk-email/audience.ts`)
  - `DEFAULT_FILTER` (`web features/tickets/api.ts`)
  - `CardFooter`, `CardAction`, `CardDescription` (`components/ui/card.tsx`)
  - `DropdownMenuGroup`
- Barrel re-exports nobody imports, in `infra/email`, `infra/push`, `infra/i18n` and `infra/storage`.
- Never called by production code, only by tests: `createTasksFromMessage` (a legacy wrapper of `createTasksFromSource`), `resolveAudience`, `getSetAuthorId`, `chat/reads.ts encodeCursor`, `canDeleteItem` (an alias).
- About 60 exports are used only inside their own file (`export` could go). Left alone: harmless.

**D2. Unused locale keys.** Impact low, effort S, risk low.
- `chat.save` and `taskSplit.close`, unused in all nine languages.
- English has the dead plural forms `chat.thread.summary_few/_many` and `replies_few/_many`; English has only one and other.
- Otherwise all nine languages have the same keys per file, and the plural forms match each language's CLDR categories.

**D3. Env vars and flags.** Impact none. Every variable in `.env.example` and the config schema is used. There are no stale flags.

### Tests and CI

**T1. Web tests set up jsdom once per file.** Impact high for CI, effort S, risk low.
- Evidence: Vitest reports "jsdom was created 125 times · 87.9 s, 32 % of tracked time". On GitHub the web suite takes 417 s, the longest step of `ci.sh`, run in parallel with the server suite on a 4-vCPU runner.
- Measured locally (all 1 275 tests pass in both):

  | Pool | Wall time |
  |---|---|
  | `forks` (now) | 43.5 s |
  | `threads` | 50.8 s |
  | `vmThreads` | 17.0 s |

  `vmThreads` keeps each file isolated in its own VM context but reuses the worker and its environment.
- Fix: `pool: 'vmThreads'` in `apps/web/vitest.config.ts`. The GitHub number will be in the PR.

**T2. Server tests: same idea, not safe yet.** Impact med, effort M, risk med.
- `--pool=vmThreads` takes the server suite from 34 s to 24.5 s locally. One time-based test (`tasks/reminders-coexist.test.ts`) failed under the extra load; it passes alone.
- Proposed: only after the load-sensitive tests are fixed (T3).

**T3. Flaky tests under load.** Impact med, effort M, risk low.
- `tickets/notify.test.ts` "ticket.created reaches the managers" failed once in a full run on a fresh database (10 s wait for a push; 0.8 s alone).
- Another agent removed a similar wait in the every-admin case today.
- Pattern: tests that wait on deliveries to "every admin of the shared test DB", or on wall time.
- Proposed: assert the recorded events and pushes of the test's own users only, like `scopedDelivery`, and never a count of all admins.
- **Done** (PR #58, branch `test/deterministic-deliveries`). Cause: delivery in tests is inline, so a push is in the fake before the request returns. But the tests' scoped delivery was scoped by user. Every admin is a person of every group, so another test file's message recorded events for this file's admins, and that file's delivery locked and delivered this file's pending admin events (`FOR UPDATE SKIP LOCKED`), pushing to *its* fake: the push never arrived here, and the 10 s wait timed out. Fix: `recordNotifications` returns the recorded event ids, `requestDelivery` sends `{ eventIds }`, and the tests' scoped deliver job delivers exactly those events (a job without ids delivers nothing). Then the waits went: `tickets/notify.test.ts` checks every push (managers and the every-admin `ticket.unassigned` case again) with no `vi.waitFor`; `notifications/deliver.test.ts` (admin default mode) and `tickets-contract.test.ts` deliver by event id and assert exact pushes, not "whichever process sent it". New test: a scoped job delivers only the events it names. Production delivery is unchanged; it ignores the job data. Left alone: `tickets-contract.test.ts`'s digest case still counts digests by user, so a foreign `ticket.unassigned` arriving in the same instant could add a second email (rare; not a timing wait). The other `vi.waitFor` calls wait on real pg-boss workers, sockets or SMTP, not on the size of the shared database.

**T4. The EXPLAIN suite takes 14 to 62 s.** Impact low-med, effort S, risk low. One seeding takes about 6 s here. The rest is retries: the test retries twice on a slow timing and reseeds each time. On GitHub it takes 60 s. With JIT off (S2), the heaviest board statement no longer risks the 50 ms bound. Proposed: add the `clientIds: null` board case and a few thousand groups to the volume, once S2 is in.

**T5. CI steps run one after another.** Impact med, effort S, risk low-med.
- Lint (29 s), format check (15 s) and typecheck (27 s) are independent.
- e2e uses 1 worker for 45 tests (4 min 20 s).
- Proposed: run lint, format and typecheck concurrently in `ci.sh` (about 40 s). Keep e2e serial: its tests share one database.
- **Done** (PR #56, branch `ci/parallel-static-checks`): `run_parallel` in `scripts/lib.sh` runs the three at once, prints each step's output whole and in order with its result and seconds, and fails after all finish if any failed (tests: `scripts/tests/run-parallel.test.sh`). Local, loaded laptop: 27 to 55 s one after another, 18 to 28 s in parallel.

**T6. 59 leftover `spolu_test_*` databases in the dev PostgreSQL.** Impact low. CLAUDE.md already says to drop them now and then; they slow Postgres down. No code change.

### Docker image

**K1. The runtime image ships npm, corepack and yarn.** Impact low-med, effort S, risk low.
- Evidence: `/usr/local/lib/node_modules` (npm, corepack) is 19 MB, `/opt/yarn-v1.22.22` 5.2 MB and `/usr/local/include` 6.7 MB, about 31 MB of 467 MB. Nothing runs npm in the container (the healthcheck and `CMD` use `node`).
- Fix: remove them in the runtime stage.

**K2. `react-dom` (7.9 MB) and `@types/node` (2.7 MB) are in the server's production `node_modules`.** They arrive as an optional peer of better-auth and through socket.io's typings. Proposed only: pnpm peer settings change the lockfile for every package.

## Fix batches

Each batch is one branch and one PR from fresh `origin/main`, independent of the others. Merge in this order:

| # | Branch | Findings | Impact | Risk | Status and measured gain |
|---|---|---|---|---|---|
| 1 | `perf/db-fk-indexes` | S1, S3 | high | low | PR #44: channel delete with 2 000 messages 94.9 s → 39 ms; global ticket list 32–64 ms → 0.1 ms |
| 2 | `perf/db-jit-off` | S2 | high | low | PR #45: global board without client scope 720 → 100 ms (EXPLAIN); sidebar with 3 100 groups 350 → 125 ms |
| 3 | `perf/web-vitest-vmthreads` | T1 | high (CI) | low | PR #46: web suite 31.4 → 13.9 s locally, 429 → 173 s on GitHub (the tests step is now bound by the server suite, about 390 s) |
| 4 | `perf/web-entry-chunk` | W1 | med | low | PR #47: initial JS 174.59 → 161.94 kB |
| 5 | `perf/pwa-precache-languages` | W3 | med | low | PR #48: precache 307 files / 758.6 kB → 167 / 613.3 kB gzip |
| 6 | `perf/web-first-join-refetch` | W4 | med | low | PR #53: a cold load sends 1 request instead of 2 (board, knowledge, tickets, bulk email) |
| 7 | `chore/dead-code` | D1, D2 | low | low | PR #52: 6 symbols, 2 keys in nine languages, 4 dead English plural forms |
| 8 | `perf/docker-runtime-slim` | K1 | low-med | low | PR #57: image 467 → 380 MB (94.7 → 82.8 MB compressed), source-only rebuild 26–31 → 17 s |
| 9 | `ci/parallel-static-checks` | T5 | med (CI) | low-med | PR #56: lint, format check and typecheck in parallel, 27–55 → 18–28 s |
| 10 | `test/deterministic-deliveries` | T3 | med (CI) | low | PR #58: the tests' delivery is scoped by event id; push checks no longer wait |
| 11 | `perf/job-batching` | S7 | med | low-med | PR #60: job queries per batch 58 → 9 (delivery), 57 → 8 (digest), 201 → 2 (deadline reminders), 606 → 9 (reminder fire) |

Proposed, not done (owner decision or later work):
- **Server:** S4, S5, S6, S8, S9, S10, S11.
- **Web:** W2, W5, W6, W7, W8.
- **Tests and CI:** T2, T4.
- **Docker:** K2.

The next web batch should be W5 together with S4.
