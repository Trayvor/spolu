# Notification groups (brief item C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the profile's Push and Email switches with four notification groups (chat, tasks, tickets, knowledge), each with a channel (email, push, both, none), and route every notification event through its group's channel.

**Architecture:** The user's choices live in one `user.notification_channels` jsonb column (missing key = the group's default). One map in the notifications module assigns each event kind to a group; recording, delivery, the email digest and the API read the event's group channel. The web settings card renders the groups the server lists.

**Tech Stack:** TypeScript, Fastify, Drizzle (PostgreSQL 17), zod, React + TanStack Query, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-16-notification-groups-design.md](../specs/2026-10-16-notification-groups-design.md)

## Global Constraints

- Group keys: `chat`, `tasks`, `tickets`, `knowledge` (this order everywhere). Channels: `email`, `push`, `both`, `none`.
- Defaults: `tickets` = `both`; `chat`, `tasks`, `knowledge` = `push`.
- Existing users start on the defaults: `push_enabled` and `email_enabled` are dropped, not carried over.
- Ticket-group events pass every bell mode, Off included; `reminder.due` keeps passing every mode.
- An unknown kind never throws: it is recorded already delivered and skipped by delivery and digest.
- Migration only through `pnpm --filter @spolu/server db:generate`. Item A may add a migration in parallel; whichever merges second regenerates.
- Every UI string in `apps/web/src/locales/settings/{en,sk}.json` (SK and EN). English in code, comments, docs, commits.
- Do not touch item A (board filter) or item B (tickets, `ziadatel`, `group_members`) code.
- Design work on the settings card starts with the `frontend-design` skill.
- Each commit updates the affected docs (`update-kb`).

## Review Focus

1. **Stored garbage**: `notification_channels` holding a non-string or an unknown channel (`{"chat": 5}`) → the default applies; the API never returns an invalid value. Test in Task 1 (`resolveChannels`) and Task 3 (row set by SQL).
2. **Concurrent group changes**: two PATCHes for different groups at once must both survive (`jsonb_set`, not read-modify-write). Test in Task 5.
3. **Push unavailable on the server** (no VAPID) with a group on `both`: email still goes, push never queued; the card disables Push and Both. Tests in Task 2 (`decideEvent`) and Task 6.
4. **Group switched away from email after delivery, before the digest is due** → no email for that group's events, but another group's events in the same user+group digest still go. Test in Task 4.
5. **iOS fallback after the user already chose email everywhere** → `turnedOn: false`, nothing changes, and the card says email is already on. Tests in Task 3 and Task 6.

---

### Task 1: Shared types for groups and channels

**Files:**
- Modify: `packages/shared/src/notifications.ts`
- Test: `packages/shared/src/notifications.test.ts` (create if missing)

**Interfaces:**
- Produces:
  - `NotificationCategories`, `NotificationCategory`, `NotificationCategorySchema`
  - `NotificationChannels`, `NotificationChannel`, `NotificationChannelSchema`
  - `DEFAULT_CHANNELS: Record<NotificationCategory, NotificationChannel>`
  - `type ChannelMap = Record<NotificationCategory, NotificationChannel>`
  - `resolveChannels(stored: unknown): ChannelMap` — stored valid values over defaults; anything not a valid channel is ignored
  - `wantsPush(c: NotificationChannel): boolean`, `wantsEmail(c: NotificationChannel): boolean`
  - `NotificationPrefsSchema = { channels: ChannelMap, visibleCategories: NotificationCategory[], vapidPublicKey: string | null }`
  - `NotificationPrefsPatchSchema = { category, channel }` (strict)
  - `NotificationFallbackSchema = NotificationPrefsSchema.extend({ turnedOn: boolean })` (unchanged shape rule)

- [ ] **Step 1: Failing tests**

```ts
it('defaults: tickets both, the rest push', () => {
  expect(resolveChannels({})).toEqual({ chat: 'push', tasks: 'push', tickets: 'both', knowledge: 'push' });
});
it('keeps valid choices and ignores garbage', () => {
  expect(resolveChannels({ chat: 'none', tasks: 5, knowledge: 'loud', x: 'email' }))
    .toEqual({ chat: 'none', tasks: 'push', tickets: 'both', knowledge: 'push' });
  expect(resolveChannels(null)).toEqual(DEFAULT_CHANNELS);
});
it.each([['email', false, true], ['push', true, false], ['both', true, true], ['none', false, false]] as const)(
  '%s → push %s, email %s', (c, p, e) => { expect(wantsPush(c)).toBe(p); expect(wantsEmail(c)).toBe(e); });
it('patch schema accepts one group and channel, refuses others', () => {
  expect(NotificationPrefsPatchSchema.safeParse({ category: 'tickets', channel: 'none' }).success).toBe(true);
  expect(NotificationPrefsPatchSchema.safeParse({ category: 'dm', channel: 'push' }).success).toBe(false);
  expect(NotificationPrefsPatchSchema.safeParse({ category: 'chat', channel: 'sms' }).success).toBe(false);
  expect(NotificationPrefsPatchSchema.safeParse({ category: 'chat', channel: 'push', x: 1 }).success).toBe(false);
});
```

- [ ] **Step 2:** `pnpm --filter @spolu/shared test` → FAIL (not exported).
- [ ] **Step 3:** Implement in `notifications.ts`; remove `pushEnabled`/`emailEnabled` from the prefs schemas.
- [ ] **Step 4:** `pnpm --filter @spolu/shared test` → PASS. (`pnpm typecheck` fails in server/web until Tasks 3–6; expected.)
- [ ] **Step 5:** Commit `feat(shared): notification groups and channels`.

### Task 2: Event → group map and the decision

**Files:**
- Create: `apps/server/src/modules/notifications/categories.ts`, `categories.test.ts`
- Modify: `apps/server/src/modules/notifications/decide.ts`, `decide.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `NOTIFICATION_GROUP_OF: Record<NotificationKind, NotificationCategory>` (chat.* → chat, task.* → tasks, reminder.due → tasks)
  - `notificationGroupOf(kind: string, payload: Record<string, unknown>): NotificationCategory | null` — `chat.*` with a non-empty string `taskId` → `tasks`; `reminder.due` with `subjectKind === 'knowledge'` → `knowledge`; kind not in the map → `null`
  - `visibleCategoriesFor(db: Db, user: { id: string }): Promise<NotificationCategory[]>` — returns `[...NotificationCategories]`; doc comment says item B-1 narrows it to `['tickets']` for requester-only users
  - `passesMode(kind: NotificationKind, group: NotificationCategory, mode: GroupMode): boolean` — `group === 'tickets'` → true; `reminder.due` → true; else as today
  - `DecisionInput` replaces `pushEnabled`/`emailEnabled` with `group: NotificationCategory`, `channel: NotificationChannel`, `pushAvailable: boolean`; `decideEvent` → `{ push: wantsPush(channel) && pushAvailable && hasSubscriptions, email: wantsEmail(channel) }` after the unchanged gates

- [ ] **Step 1: Failing tests**
  - `categories.test.ts`: every row of the spec table; `notificationGroupOf('chat.mention', { taskId: 't1' })` → `tasks`; `('chat.mention', { taskId: '' })` → `chat`; `('reminder.due', { subjectKind: 'knowledge' })` → `knowledge`; `('reminder.due', { subjectKind: 'task' })` → `tasks`; `('ticket.created', {})` → `null`; the map covers every `NotificationKinds` entry.
  - `decide.test.ts`: the `passesMode` table gains the group argument (each kind with its own group, unchanged results); plus `passesMode('chat.message', 'tickets', 'off')` → true and `('chat.message', 'tickets', 'mentions')` → true. `decideEvent` with channel `email` → `{push:false,email:true}`, `push` → `{true,false}`, `both` → `{true,true}`, `none` → `{false,false}`; `both` with `pushAvailable: false` → `{false,true}`; `push` without subscriptions → `{false,false}`.
- [ ] **Step 2:** `pnpm --filter @spolu/server exec vitest run src/modules/notifications/categories.test.ts src/modules/notifications/decide.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(notifications): event group map and channel decision`.

### Task 3: Storage, profiles, recording, fallback

**Files:**
- Modify: `apps/server/src/modules/users/schema.ts`, `apps/server/src/modules/users/service.ts`, `users/service.test.ts`
- Modify: `apps/server/src/modules/notifications/service.ts`, `service.test.ts`
- Create: generated migration in `apps/server/src/infra/db/migrations/` (+ `meta/`)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `user.notificationChannels: jsonb('notification_channels').$type<Partial<ChannelMap>>().notNull().default({})`; `pushEnabled`, `emailEnabled` removed
  - `NotificationProfile.channels: ChannelMap` (resolved) instead of `pushEnabled`/`emailEnabled`
  - `setNotificationChannel(db: Db, id: string, category: NotificationCategory, channel: NotificationChannel): Promise<void>` — one `update … set notification_channels = jsonb_set(notification_channels, array[category], to_jsonb(channel))`
  - `getNotificationChannels(db: Db, id: string): Promise<ChannelMap>`
  - `applyEmailFallback(db: Db, id: string, categories: NotificationCategory[]): Promise<boolean>` — one statement guarded by `email_fallback_at is null`: for each listed category whose resolved channel is `push`, store `both`; always sets `email_fallback_at`; returns true only when a channel changed
  - `recordNotifications` computes `group = notificationGroupOf(kind, payload)`; `null` → `delivered_at = now()`; otherwise the `case` uses `coalesce(u.notification_channels ->> group, DEFAULT_CHANNELS[group])`: in (`email`,`both`) → null; in (`push`,`both`) and a subscription exists → null; else now()

- [ ] **Step 1: Failing tests**
  - `users/service.test.ts`: a new user's profile has `channels` = `DEFAULT_CHANNELS`; `setNotificationChannel(…, 'chat', 'none')` then the profile has chat `none`, the rest default; a row set by SQL to `{"chat": 5}` resolves to chat `push`.
  - fallback: defaults → `true`, then channels `{chat: both, tasks: both, tickets: both, knowledge: both}`; second call → `false`, unchanged; user with chat `none`, tasks `email` → chat stays `none`, tasks stays `email`; after the fallback, setting chat `push` by hand and calling again → stays `push`; a user with every listed group already on `email`/`both`/`none` → `false`.
  - `notifications/service.test.ts` pending state, one user, push subscription present: chat `none` + `chat.message` → delivered; tasks `email` + `task.moved` → pending; chat `push` + no subscription (another user) → delivered; `both` → pending; disabled user with `both` → delivered; a `chat.message` with `taskId` follows the `tasks` channel; kind `'ticket.created'` (cast) → recorded and delivered.
  - migration: after `setup-db`, `select column_default from information_schema.columns where column_name = 'notification_channels'` is `'{}'::jsonb`, and `push_enabled` no longer exists.
- [ ] **Step 2:** `pnpm --filter @spolu/server exec vitest run src/modules/users src/modules/notifications/service.test.ts` → FAIL.
- [ ] **Step 3:** Change the schema, run `pnpm --filter @spolu/server db:generate` (check the SQL: `ADD COLUMN notification_channels jsonb DEFAULT '{}'::jsonb NOT NULL`, two `DROP COLUMN`), implement the service functions and the SQL.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(notifications): store channels per group; record by the event's group`.

### Task 4: Delivery and the digest

**Files:**
- Modify: `apps/server/src/modules/notifications/deliver.ts`, `deliver.test.ts`
- Create: `apps/server/src/modules/notifications/digest-entries.ts`, `digest-entries.test.ts`
- Modify: `apps/server/src/modules/notifications/digest.ts`, `digest.test.ts`

**Interfaces:**
- Consumes: `notificationGroupOf`, `decideEvent` (Task 2); `NotificationProfile.channels` (Task 3).
- Produces:
  - `type DigestEntry = { line: string; url: string; button: string }`
  - `type DigestContext = { groupName: string; groupId: string; publicUrl: string; lang: UserLanguage; taskTitles: Map<string, string> }`
  - `digestEntry(row: { kind: string; payload: Record<string, unknown> }, ctx: DigestContext): DigestEntry | null` — the current line logic moved out of `collectDigests`; `url` = `${publicUrl}/groups/<groupId>/chat`, `button` = `texts(lang).digestButton(groupName)`; unknown kind → `null`
  - `digestEmail` takes `url` and `button` instead of `groupUrl` (subject unchanged)

- [ ] **Step 1: Failing tests**
  - `digest-entries.test.ts`: a `chat.message` → `"Jana: hello"` and the group chat url; a `task.moved` → `"Moved to …: <title>"`; a task `reminder.due` → the current reminder line with the task's current title; unknown kind → `null`.
  - `deliver.test.ts`: user with chat `none`, tasks `push`, one device: a chat message gives no push job, a task move gives one; user with chat `email`: chat event gets `email_due_at`, no push; push sender `null` and chat `both`: email only.
  - `digest.test.ts`: chat `push`, tasks `both`, a chat event and a task event both pending for email (set `email_due_at` directly for the chat one) → one email with only the task line; tasks switched to `push` after delivery → no email, rows stamped `emailed_at`; `splitByUrl(entries: { entry: DigestEntry; rowId: string }[])` (exported from `digest.ts`) with two urls → two groups in first-seen order, each keeping its rows.
- [ ] **Step 2:** `pnpm --filter @spolu/server exec vitest run src/modules/notifications` → FAIL.
- [ ] **Step 3:** Implement: in `decideBatch`, `group = notificationGroupOf(...)`, skip `null` with the existing warning, `reachable` uses `wantsEmail` or (`wantsPush` and device); pass `group`, `channel`, `pushAvailable: deps.push !== null` to `decideEvent`. In `collectDigests`, keep a row only if `wantsEmail(profile.channels[group])`, build entries with `digestEntry`, split by `url` (`splitByUrl`), one `digestEmail` per split.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(notifications): deliver and email by each event's group channel`.

### Task 5: API

**Files:**
- Modify: `apps/server/src/modules/notifications/routes.ts`, `routes.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: `GET /api/notifications/preferences` → `NotificationPrefs`; `PATCH` with `NotificationPrefsPatch` → `NotificationPrefs`; `POST /api/me/notification-fallback` → `NotificationFallback`.

- [ ] **Step 1: Failing tests** (`routes.test.ts`): GET for a new user → the defaults, `visibleCategories` = the four groups in order, `vapidPublicKey`; PATCH `{category:'chat',channel:'email'}` → 200 and chat `email`, other groups unchanged; PATCH `{category:'dm',…}`, `{channel:'sms'}`, `{}` → 400 `validation_failed`; two PATCHes in parallel (`Promise.all`, chat `none` and tasks `email`) → both stored; PATCH by user A never changes user B; fallback → `turnedOn: true` and push groups now `both`, second call `turnedOn: false`; unauthenticated → 401.
- [ ] **Step 2:** `pnpm --filter @spolu/server exec vitest run src/modules/notifications/routes.test.ts` → FAIL.
- [ ] **Step 3:** Implement: `prefsOf` builds from `getNotificationChannels` and `visibleCategoriesFor`; PATCH also refuses a category not in `visibleCategoriesFor` (400).
- [ ] **Step 4:** Same command → PASS; then `pnpm --filter @spolu/server test` and `pnpm --filter @spolu/server typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(notifications): preferences API by group`.

### Task 6: Settings card and prompts (web)

**Files:**
- Modify: `apps/web/src/features/notifications/notifications-section.tsx`, `notifications-section.test.tsx`
- Modify: `apps/web/src/features/notifications/prompt-rules.ts`, `prompt-rules.test.ts`, `app-prompt.tsx`, `app-prompt.test.tsx`
- Modify: `apps/web/src/router-i18n.test.tsx` (its prefs fixture)
- Modify: `apps/web/src/locales/settings/{en,sk}.json`

**Interfaces:**
- Consumes: Task 1 schemas; `updateNotificationPrefs(patch: NotificationPrefsPatch)` (existing, new body).
- Produces: `PromptInput.pushWanted: boolean` replaces `pushEnabled` (true when some visible group `wantsPush`).

- [ ] **Step 1:** Invoke the `frontend-design` skill for the card: device line on top, then one row per group (name, one hint line, `Select` on the right; stacked under 641 px).
- [ ] **Step 2: Failing tests**
  - section: renders four rows labelled Chat, Task board, Ticket board, Knowledge base, selects showing push/push/both/push; changing Chat to None sends `{category:'chat',channel:'none'}` and shows None at once; a failed save rolls back and shows the error line; choosing Push on Knowledge while the device is `off` calls `subscribeThisDevice` before the PATCH; `vapidPublicKey: null` → Push and Both options disabled and the "not available" text; device line hidden when no group wants push.
  - `choosePrompt`: `enable` with `pushWanted: true`, `null` with `pushWanted: false`.
  - app-prompt: the fallback response updates the prefs cache with `channels`; texts for `turnedOn` true / already on (some group wants email) / off (none wants email).
- [ ] **Step 3:** `pnpm --filter @spolu/web test` → FAIL.
- [ ] **Step 4:** Implement. New keys under `notifications` (EN / SK):
  - `groups.chat` "Chat" / "Chat"; `hints.chat` "Messages, mentions and replies in group chats." / "Správy, zmienky a odpovede v skupinových chatoch."
  - `groups.tasks` "Task board" / "Nástenka úloh"; `hints.tasks` "Task moves, assignments, deadlines, reminders and task chats." / "Presuny, priradenia, termíny, pripomienky a chaty úloh."
  - `groups.tickets` "Ticket board" / "Nástenka tiketov"; `hints.tickets` "Support tickets and their conversations." / "Tikety podpory a ich komunikácia."
  - `groups.knowledge` "Knowledge base" / "Znalostná báza"; `hints.knowledge` "Knowledge base reminders." / "Pripomienky zo znalostnej bázy."
  - `channels.email` "Email" / "E-mail"; `channels.push` "Push" / "Push"; `channels.both` "Email and push" / "E-mail a push"; `channels.none` "None" / "Nič"
  - remove `push`, `pushHint`, `email`, `emailHint`.
- [ ] **Step 5:** `pnpm --filter @spolu/web test`, `pnpm --filter @spolu/web typecheck`, `pnpm lint` → PASS.
- [ ] **Step 6:** Commit `feat(web): notification groups on the settings page`.

### Task 7: E2E, docs, full CI

**Files:**
- Modify: `e2e/notifications.spec.ts`
- Modify: `docs/product/notifications.md`, `docs/product/profile.md`, `docs/architecture/data-model.md`, `docs/glossary.md`, `docs/roadmap.md` (only the item C line under "Next": link spec and plan)

- [ ] **Step 1:** In the email e2e test, replace the switch with the Chat select: `client.getByRole('combobox', { name: 'Chat' })`, `selectOption('both')`, wait for the PATCH 200, then the same Mailpit assertions.
- [ ] **Step 2:** Run the `update-kb` skill; update the docs listed above (delivery channels → notification groups with the table of groups and defaults; ticket events pass every mode; the iOS fallback; `user.notification_channels`; glossary "notification group", "channel").
- [ ] **Step 3:** `docker compose -f docker-compose.dev.yml up -d --wait`, then `bash scripts/ci.sh` → every step passes.
- [ ] **Step 4:** Commit `test(e2e): email digest through the chat notification group` and `docs: notification groups`, push, open the PR.
