# Phase 6 — Notifications and Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recorded notification events reach people. Web Push is the main channel and email digests are optional. Each user sets a mode per group with a bell, and a profile on `/settings` changes the name, the email and the two channel switches.

**Architecture:**
- A `notifications.deliver` pg-boss job locks undelivered `notification_events` (`FOR UPDATE SKIP LOCKED`, 200 per batch). For each event it decides, from the group mode, read marks, group access and the channel switches, and marks it delivered.
- It then queues one `notifications.push` job per device subscription, and pg-boss retries those up to 3 times. It also stamps `email_due_at` on email-eligible events, which a digest job batches into one email per user and group.
- The push sender sits behind `PushSender` (`web-push` for real, a fake for tests and e2e). The browser side is a hand-written `public/push-sw.js`, imported into the existing Workbox service worker.
- A single `<AppPrompt>` in the signed-in shell insists, every 6 hours, on installing the app on phones and on enabling notifications. On iOS older than 16.4 it switches email on once instead.
- The bell is a single `ModeMenu` component, used in the group header and on the groups page. The settings page and the prompts are lazy.

**Tech Stack:** Fastify 5, Drizzle, pg-boss 12, better-auth 1.7.7 (its `verification` table), React 19, TanStack Router and Query, radix-ui, i18next, Vitest, Playwright. New dependencies, pinned exactly (server only): `web-push@3.6.7` and `@types/web-push@3.6.4` (dev).

**Spec:** `docs/superpowers/specs/2026-10-16-phase-6-notifications-design.md` (builds on `docs/superpowers/specs/2026-10-15-phase-4-shared-foundation-design.md`).

## Global Constraints

- Branch `phase-6`, built **in parallel with Phase 9**. Build nothing from Phase 9. The deliverer reads `taskId` from any chat payload generically. Edits to `chat/messages.ts`, `tasks/task-service.ts` and `groups/group-header.tsx` stay minimal (a few lines each), so the merge stays small.
- One migration for the whole phase: `apps/server/src/infra/db/migrations/0009_notifications_delivery.sql`, created in Task 1. Every later schema need is already in it. Whichever branch merges second regenerates its migration.
- English everywhere. Every UI string is an i18n key, present in **both** `apps/web/src/locales/en.json` and `sk.json`; the locales test enforces parity and `_other` plural forms. Add keys only; do not reformat the files. Server-side copy (push and email) lives in `modules/notifications/texts.ts` and `modules/auth/emails.ts`, in sk and en.
- Performance first. The eager JS stays **≤ 200 kB gzip** (now about 197 kB):
  - The settings sections, the bell, `<AppPrompt>` and `push-device.ts` live in lazy chunks only (settings route, group layout, groups page, authed layout).
  - The only eager additions are:
    - the service-worker navigate listener in `routes/root.tsx`;
    - the `beforeinstallprompt` capture in `lib/install-prompt.ts`, imported by `main.tsx` because the event fires before the lazy shell mounts;
    - one `saveLanguage` call in the language switcher;
    - a dynamic `import()` in `signOut`.
  - The service worker code is the static file `apps/web/public/push-sw.js`.
- No fancy effects. The one exception is the spec's short slide-in of an `<AppPrompt>` card, and only under `motion-safe`. Inline confirmations only; no toasts.
- A UI task starts by invoking `frontend-design:frontend-design`, on the egrant.sk tokens in `docs/design/tokens.md` and `components/ui/*`.
- Reuse: one `ModeMenu` (bell and menu) for the group header, the group rows and the "All groups" control.
- Test-first (`superpowers:test-driven-development`): every code step follows a failing test.
- Tests share the databases `spolu_test` and `spolu_e2e`. Use unique emails and endpoints (`randomUUID()`), never truncate, and never assume an empty table.
  - The deliverer and the digest take an optional `userIds` scope. Tests always pass it, so parallel test files never deliver each other's events.
- Modules talk only through exported service functions (CLAUDE.md). The notifications module never queries `messages`, `tasks` or `user` itself; it calls the chat, tasks, groups and users services named in each Interfaces block.
- Errors are `{ error: '<code>' }`. Codes added in this phase:
  - `email_taken` (409);
  - `push_unavailable` (503);
  - `invalid_subscription` (400);
  - `invalid_code` (400, a wrong, expired or used-up email-change code).
- Push sends go through `PushSender`. `PUSH_PROVIDER=webpush` (the default) uses `web-push`; `PUSH_PROVIDER=fake` records sends in memory and, when `PUSH_FAKE_FILE` is set, appends JSON lines to that file for e2e.
- `EMAIL_BATCH_DELAY_MS` (default `600000`) sets the digest delay; e2e uses `3000`.
- Reminder crons run in `Europe/Bratislava`.
- Docs are updated in the same commit as the code they describe (`update-kb` skill). Prettier is checked per task: `rtk proxy pnpm exec prettier --check <changed files>`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017ePsEvddJdebom9HRHr5oh
  ```

## Review Focus

- **A member removed before delivery.** An event recorded for a client who is removed from the group (or disabled) before the deliverer runs must send nothing. A reasonable person expects a removed client to stop hearing about the group at once. Test in Task 5: `a client removed after the event gets no push`.
- **A message deleted before delivery.** A message deleted within the seconds before delivery must not reach anyone's lock screen. Test in Task 5: `a deleted message is not pushed`.
- **Mention and message split across batches.** Chat records `chat.message` and `chat.mention` for the same message and user. When the 200-row batch boundary falls between them, the user must still get exactly one push. Test in Task 5: `one push per message even when its events land in different batches` (with `limit: 1`).
- **A shared device switching accounts.** User A subscribes a browser, logs out without the cleanup reaching the server, then user B logs in on the same browser. The endpoint must now belong only to B, so A's notifications never show on B's screen. Test in Task 3: `the same endpoint saved by another user moves to that user`.
- **Bratislava time at the day edge.** At 23:30 UTC on 16 Oct it is already 17 Oct in Bratislava, so a task due 18 Oct is "Deadline tomorrow". On the DST change day (25 Oct 2026) the 20:00 urgent slot is 19:00 UTC, not 18:00. Tests in Task 10: `deadline uses the Bratislava date at 23:30 UTC` and `urgent slot key follows Bratislava hour across DST`.

---

### Task 1: Shared contracts, schema and migration 0009

**Files:**
- Modify: `packages/shared/src/notifications.ts`, `packages/shared/src/users.ts` (ErrorCodes)
- Test: `packages/shared/src/notifications.test.ts` (new)
- Modify: `apps/server/src/modules/users/schema.ts`, `apps/server/src/modules/users/service.ts`, `apps/server/src/modules/notifications/schema.ts`
- Create: `apps/server/src/infra/db/migrations/0009_notifications_delivery.sql` (+ meta snapshot and journal, generated)
- Test: `apps/server/src/modules/users/service.test.ts`
- Docs: `docs/architecture/data-model.md`

**Interfaces:**
- Produces (shared, `@spolu/shared`):
  - `NotificationKinds` gains `'task.deadline'` and `'task.urgent'`.
  - `GroupModes = ['all', 'mentions', 'off'] as const`, `GroupMode`, `GroupModeSchema`.
  - `roleDefaultMode(role: Role): GroupMode`: `'all'` for client, `'mentions'` for admin and superadmin.
  - `effectiveGroupMode(input: { override: GroupMode | null; defaultMode: GroupMode | null; role: Role }): GroupMode`.
  - `NotificationModesSchema = z.object({ defaultMode: GroupModeSchema.nullable(), roleDefault: GroupModeSchema, overrides: z.record(z.string(), GroupModeSchema) })`, `NotificationModes`.
  - `ModeBodySchema = z.object({ mode: GroupModeSchema })`.
  - `NotificationPrefsSchema = z.object({ pushEnabled: z.boolean(), emailEnabled: z.boolean(), vapidPublicKey: z.string().nullable() })`, `NotificationPrefs`. `NotificationPrefsPatchSchema` is `{ pushEnabled?: boolean; emailEnabled?: boolean }`, `.strict()`, with at least one key.
  - `PushSubscriptionBodySchema`: `{ endpoint: https URL ≤ 2048 chars, keys: { p256dh: /^[A-Za-z0-9_-]{87}$/, auth: /^[A-Za-z0-9_-]{22}$/ } }` (extra fields such as `expirationTime` are stripped). `EndpointBodySchema = { endpoint: z.string().min(1).max(2048) }`.
  - `PushPayload = { title: string; body: string; url: string; tag: string }`.
  - `TaskDeadlinePayload = { taskId; groupId; title; daysLeft: 1 | 2 | 3 }`, `TaskUrgentPayload = { taskId; groupId; title }`.
  - `UserLanguages = ['sk', 'en'] as const`, `UserLanguage`, `LanguageBodySchema = z.object({ language: z.enum(UserLanguages) })`.
  - `EmailChangeRequestSchema = { newEmail: trimmed, lower-cased email }`, `EmailChangeConfirmSchema = { newEmail (same), code: /^\d{6}$/ }`.
  - `ErrorCodes` gains `emailTaken: 'email_taken'`, `pushUnavailable: 'push_unavailable'`, `invalidSubscription: 'invalid_subscription'` and `invalidCode: 'invalid_code'`.
- Produces (schema):
  - `user` gains:
    - `default_group_mode text null`, with check `in ('all','mentions','off')`;
    - `push_enabled boolean not null default true`;
    - `email_enabled boolean not null default false`;
    - `language text not null default 'sk'`, with check `in ('sk','en')`;
    - `email_fallback_at timestamptz null` (set once by the iOS fallback in Task 7).
  - `push_subscriptions(id text pk, user_id → user cascade, endpoint text unique not null, p256dh, auth, user_agent text null, created_at, last_success_at null)`, with index `push_subscriptions_user_id_idx`.
  - `group_notification_settings(user_id → user cascade, group_id → groups cascade, mode text check, pk (user_id, group_id))`, with index on `group_id`.
  - `notification_events` gains:
    - `email_due_at timestamptz null`, `emailed_at timestamptz null` and `dedupe_key text null`;
    - partial unique index `notification_events_dedupe_unique on (user_id, dedupe_key) where dedupe_key is not null`;
    - partial index `notification_events_undelivered_idx on (created_at) where delivered_at is null`;
    - partial index `notification_events_email_due_idx on (email_due_at) where emailed_at is null and email_due_at is not null`.
  - Drizzle exports: `pushSubscriptions`, `groupNotificationSettings` (in `modules/notifications/schema.ts`).
- Produces (`modules/users/service.ts`):
  - `type NotificationProfile = { id; email; name; role: Role; language: UserLanguage; pushEnabled: boolean; emailEnabled: boolean; defaultGroupMode: GroupMode | null; disabled: boolean }`.
  - `getNotificationProfiles(db: Db, ids: string[]): Promise<Map<string, NotificationProfile>>`, one query.
  - `updateNotificationPrefs(db, id, patch: { pushEnabled?: boolean; emailEnabled?: boolean }): Promise<void>`.
  - `setDefaultGroupMode(tx: Db, id, mode: GroupMode | null): Promise<void>`.
  - `setUserLanguage(db, id, language: UserLanguage): Promise<void>`.
  - `changeUserEmail(db, id, email: string): Promise<void>`: throws `EmailTakenError` on a unique violation and sets `emailVerified = true`.
  - `applyEmailFallback(db, id): Promise<boolean>`: `update user set email_enabled = true, email_fallback_at = now() where id = $1 and email_fallback_at is null`. It returns true only when it changed the row, so a later manual opt-out is never undone.

- [ ] **Step 1: Write the failing shared tests** in `packages/shared/src/notifications.test.ts`:

```ts
it('role defaults', () => {
  expect(roleDefaultMode('client')).toBe('all');
  expect(roleDefaultMode('admin')).toBe('mentions');
  expect(roleDefaultMode('superadmin')).toBe('mentions');
});
it('override beats the user default, which beats the role default', () => {
  expect(effectiveGroupMode({ override: null, defaultMode: null, role: 'client' })).toBe('all');
  expect(effectiveGroupMode({ override: null, defaultMode: 'off', role: 'client' })).toBe('off');
  expect(effectiveGroupMode({ override: 'all', defaultMode: 'off', role: 'admin' })).toBe('all');
});
it('push subscription body', () => {
  const ok = { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };
  expect(PushSubscriptionBodySchema.safeParse(ok).success).toBe(true);
  expect(PushSubscriptionBodySchema.safeParse({ ...ok, endpoint: 'http://x.test/1' }).success).toBe(false);
  expect(PushSubscriptionBodySchema.safeParse({ ...ok, keys: { ...ok.keys, p256dh: 'A'.repeat(86) } }).success).toBe(false);
});
it('email change confirm', () => {
  expect(EmailChangeConfirmSchema.parse({ newEmail: ' New@X.sk ', code: '012345' }).newEmail).toBe('new@x.sk');
  expect(EmailChangeConfirmSchema.safeParse({ newEmail: 'a@x.sk', code: '12345' }).success).toBe(false);
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/shared exec vitest run src/notifications.test.ts`. Expected: FAIL (the exports are missing).
- [ ] **Step 3: Implement the shared exports** listed under Interfaces, then run the test again. Expected: PASS.
- [ ] **Step 4: Write the failing users-service tests** in `users/service.test.ts`:
  - `a new user has push on, email off, no default mode and language sk`: `getNotificationProfiles` gives `{ pushEnabled: true, emailEnabled: false, defaultGroupMode: null, language: 'sk' }`.
  - `updateNotificationPrefs changes only the given switch`.
  - `changeUserEmail to an address another account has throws EmailTakenError, and the email stays`.
  - `changeUserEmail stores the new address`.
  - `applyEmailFallback turns email on once and never again`. The first call returns true and email is on. After `updateNotificationPrefs({ emailEnabled: false })`, a second call returns false and email stays off.
- [ ] **Step 5: Add the schema, then generate the migration.** Add the columns, tables and indexes to the two `schema.ts` files. Then run `pnpm --filter @spolu/server db:generate --name notifications_delivery`. Expected: a new file `0009_notifications_delivery.sql` that holds only this phase's changes. Review it by eye.
- [ ] **Step 6: Implement the users-service functions and run the tests.** Run `pnpm --filter @spolu/server exec vitest run src/modules/users/service.test.ts src/modules/notifications/service.test.ts`. Expected: PASS. The existing notification tests still pass.
- [ ] **Step 7: Docs.** In `data-model.md`, describe the new columns, both tables and the event columns `email_due_at`, `emailed_at` and `dedupe_key`.
- [ ] **Step 8: Commit.** Commit message: `feat(notifications): shared contracts and schema for delivery`.

---

### Task 2: Push sender, config and job options

**Files:**
- Create: `apps/server/src/infra/push/push.ts`, `web-push-sender.ts`, `fake-push-sender.ts`, `index.ts`, `push.test.ts`
- Create: `apps/server/scripts/vapid-generate.mjs`
- Modify: `apps/server/package.json` (add `web-push@3.6.7`, `@types/web-push@3.6.4` dev, and the script `"vapid:generate": "node scripts/vapid-generate.mjs"`)
- Modify: `apps/server/src/infra/config/config.ts` and `config.test.ts`; `apps/server/src/infra/jobs/jobs.ts`; `apps/server/src/deps.ts`; `apps/server/test/test-config.ts`; `apps/server/test/test-app.ts`
- Docs: `.env.example`, `deploy/test.env.example`, `docs/runbooks/deploy.md`, `docs/decisions/0013-web-push.md` (new) and `docs/decisions/README.md`

**Interfaces:**
- Produces:
  - `type PushTarget = { endpoint: string; p256dh: string; auth: string }`.
  - `interface PushSender { send(target: PushTarget, payload: PushPayload): Promise<'sent' | 'gone'> }`. It answers `'gone'` on 404 and 410; every other failure throws `PushSendError` (`statusCode: number | null`).
  - `createWebPushSender(vapid: { publicKey; privateKey; subject }, send = webpush.sendNotification): PushSender`. It calls `send({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload), { vapidDetails, TTL: 86_400, urgency: 'high' })`.
  - `type FakePushSender = PushSender & { sent: { endpoint: string; payload: PushPayload }[]; failNext(endpoint: string, outcome: 'gone' | number): void }`.
  - `createFakePushSender(file?: string): FakePushSender`. When `file` is set, it appends one JSON line `{ endpoint, payload, at }` per send.
  - `createPushSender(config: Config['push']): PushSender | null`.
  - `Config` gains two fields:
    - `push: { provider: 'webpush'; publicKey: string; privateKey: string; subject: string } | { provider: 'fake'; publicKey: string | null; file: string | undefined } | null`;
    - `emailBatchDelayMs: number`.
  - New env variables:
    - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` or `https:`), all three or none;
    - `PUSH_PROVIDER` (`webpush` | `fake`, default `webpush`);
    - `PUSH_FAKE_FILE`;
    - `EMAIL_BATCH_DELAY_MS` (int ≥ 0, default 600000).
  - `AppDeps` gains `push: PushSender | null`. `testConfig()` uses `push: { provider: 'fake', publicKey: 'test-vapid-public-key', file: undefined }` and `emailBatchDelayMs: 600_000`. `buildTestApp` exposes the fake as `deps.push` (typed `FakePushSender` on the returned object as `push`).
  - Job options: `JobOptions` gains `startAfter?: number` (seconds), `retryLimit?: number` and `retryDelay?: number`. `JobSchedule` gains `tz?: string`, passed as `boss.schedule(name, cron, {}, { tz })`.

- [ ] **Step 1: Write the failing tests.**
  - In `push.test.ts`:
    - `web-push sender answers gone on 410 and 404`: a stub `send` rejects with `{ statusCode: 410 }`, then `{ statusCode: 404 }`, and the result is `'gone'`.
    - `web-push sender throws PushSendError with the status on 500`.
    - `web-push sender passes the VAPID details and a one-day TTL`.
    - `fake records sends and appends JSON lines to its file`, using a temp file.
    - `fake failNext answers once`: `failNext(e, 'gone')`, then two sends give `'gone'` and then `'sent'`; `failNext(e, 500)` makes the next send throw.
  - In `config.test.ts`:
    - `push is null without VAPID vars`.
    - `all three VAPID vars give webpush`.
    - `only VAPID_PUBLIC_KEY names the two missing vars`: ConfigError variables `['VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']`.
    - `VAPID_SUBJECT must be mailto: or https:`.
    - `PUSH_PROVIDER=fake needs no keys`.
    - `EMAIL_BATCH_DELAY_MS defaults to 600000 and parses '3000'`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/infra/push src/infra/config`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Install the pinned packages: `pnpm --filter @spolu/server add web-push@3.6.7` and `add -D @types/web-push@3.6.4`.
  - Write the senders, the config and the job options.
  - Wire `deps.ts`: `push: createPushSender(config.push)`.
  - Write `vapid-generate.mjs`: it prints `VAPID_PUBLIC_KEY=…` and `VAPID_PRIVATE_KEY=…` from `webpush.generateVAPIDKeys()`.
- [ ] **Step 4: Run the tests again.** Run the same command plus `pnpm --filter @spolu/server typecheck`. Expected: PASS. Also run `pnpm --filter @spolu/server vapid:generate`, which prints two lines.
- [ ] **Step 5: Docs.**
  - ADR 0013 records three decisions:
    - Web Push with VAPID through `web-push`, with no Firebase and no third-party service;
    - the push handlers live in the static `public/push-sw.js`, imported into the Workbox service worker of ADR 0011 (no caching change);
    - the fake provider is for tests.
  - Add the env vars to `.env.example` and `deploy/test.env.example`, each with a comment.
  - Add a "Generate VAPID keys once per environment" step to `deploy.md`.
- [ ] **Step 6: Commit.** Commit message: `feat(push): push sender behind an interface, VAPID config and job options`.

---

### Task 3: Settings API (preferences, device subscriptions, group modes)

**Files:**
- Create: `apps/server/src/modules/notifications/modes.ts`, `push-subscriptions.ts`, `routes.ts`, `modes.test.ts`, `routes.test.ts`
- Modify: `apps/server/src/app.ts` (register `notificationsRoutes`)
- Docs: `docs/architecture/permissions.md`, `docs/architecture/overview.md` (API list)

**Interfaces:**
- Consumes:
  - from Task 1: `getNotificationProfiles`, `updateNotificationPrefs`, `setDefaultGroupMode`, `effectiveGroupMode` and `roleDefaultMode`;
  - from the existing groups module: `canReadGroup`, `getMembershipGroupId` and `getGroup`;
  - from the existing auth module: `requireUser`.
- Produces (`modes.ts`):
  - `getModeSettings(db, user: SessionUser): Promise<NotificationModes>`.
  - `setGroupMode(db, userId, groupId, mode): Promise<void>`, an upsert.
  - `setDefaultMode(db, userId, mode): Promise<void>`. In one transaction it calls `setDefaultGroupMode` and deletes the user's `group_notification_settings` rows.
  - `getEffectiveModes(db, pairs: { userId: string; groupId: string }[], profiles: Map<string, NotificationProfile>): Promise<Map<string, GroupMode>>`, keyed `${userId}:${groupId}`, one query.
- Produces (`push-subscriptions.ts`):
  - `saveSubscription(db, userId, s: { endpoint; p256dh; auth; userAgent: string | null }): Promise<void>`. It inserts or, on a conflict on `endpoint`, updates `user_id`, the keys and the user agent.
  - `deleteOwnSubscription(db, userId, endpoint): Promise<void>`.
  - `listSubscriptions(db, userIds): Promise<Map<string, PushSubscriptionRow[]>>`.
  - `getSubscription(db, id)`, `deleteSubscriptionById(db, id)` and `markPushSuccess(db, id)`.
- Produces (routes, all behind `requireUser`; each acts only on `request.user`):

  | Method and path | Answer |
  |---|---|
  | `GET /api/notifications/preferences` | `NotificationPrefs`. `vapidPublicKey` is `config.push?.publicKey ?? null`. |
  | `PATCH /api/notifications/preferences` | `NotificationPrefs`, or 400 `validation_failed`. |
  | `GET /api/notifications/modes` | `NotificationModes`. |
  | `PUT /api/notifications/modes/default` `{ mode }` | `NotificationModes`. 403 `forbidden` for a client. |
  | `PUT /api/groups/:groupId/notification-mode` `{ mode }` | 204. 404 `not_found` when the group is missing or unreadable; 400 on a bad mode. |
  | `POST /api/push/subscriptions` | 204. 503 `push_unavailable` when `deps.push` is null; 400 `invalid_subscription` when `PushSubscriptionBodySchema` fails. It saves the `user-agent` header, truncated to 300 characters. |
  | `DELETE /api/push/subscriptions` `{ endpoint }` | 204. It deletes the row only when it is the caller's. |

- [ ] **Step 1: Write the failing tests** (`routes.test.ts` via `buildTestApp` and `loginAs`; `modes.test.ts` against the db):
  - `preferences default to push on, email off, with the VAPID key`.
  - `PATCH preferences changes only the caller`: user B's preferences stay unchanged.
  - `PATCH preferences rejects unknown keys`, for example `{ role: 'admin' }`, which answers 400.
  - `modes: client default all, admin default mentions`, using `roleDefault` from `GET /notifications/modes`.
  - `a per-group mode overrides the all-groups default` (spec test).
  - `setting the all-groups default removes per-group rows`: `overrides` becomes `{}` and `defaultMode` is `'off'`.
  - `a client cannot set the all-groups default` (403).
  - `a client cannot set the mode of a group they are not in` (404). The same goes for an unknown group id.
  - `subscription saved and deleted by its owner only`: B's DELETE of A's endpoint leaves the row in place.
  - `the same endpoint saved by another user moves to that user` (Review Focus): after B saves it, `listSubscriptions([A])` is empty.
  - `invalid subscription answers invalid_subscription`.
  - `push unavailable answers 503 push_unavailable`, with `buildTestApp({ config: { push: null } })`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/notifications`. Expected: FAIL.
- [ ] **Step 3: Implement** `modes.ts`, `push-subscriptions.ts` and `routes.ts`, and register the routes in `app.ts` after `chatRoutes`. For the 404 check, the group mode route uses `canReadGroup(actor, groupId, await getMembershipGroupId(db, actor.id))` and then `getGroup`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Docs.** Add the notification rules to `permissions.md` and the endpoints to `overview.md`.
- [ ] **Step 6: Commit.** Commit message: `feat(notifications): preferences, push subscriptions and group modes API`.

---

### Task 4: The decision and the push content (pure functions)

**Files:**
- Create: `apps/server/src/modules/notifications/decide.ts`, `decide.test.ts`, `push-content.ts`, `push-content.test.ts`, `texts.ts`

**Interfaces:**
- Consumes: `NotificationKind`, `GroupMode`, `PushPayload`, `UserLanguage` and `BucketLabel` from shared.
- Produces:
  - `passesMode(kind: NotificationKind, mode: GroupMode): boolean`, the spec table. `chat.message` passes only `all`. Every other kind passes `all` and `mentions`. Nothing passes `off`.
  - `KIND_RANK: Record<NotificationKind, number>`: `chat.message` is 1 and every other kind is 2.
  - `isOutranked(event: { id: string; kind: NotificationKind }, siblings: { id: string; kind: NotificationKind }[]): boolean`. Siblings are the same user and `messageId`. An event is outranked by a sibling with a higher rank, or with the same rank and a smaller `id`.
  - `decideEvent(i: { kind; mode; isGroupPerson; unread; outranked; pushEnabled; emailEnabled; hasSubscriptions }): { push: boolean; email: boolean }`. It returns both false unless `isGroupPerson && unread && !outranked && passesMode(kind, mode)`. Then `push = pushEnabled && hasSubscriptions` and `email = emailEnabled`.
  - `buildPushPayload(i: { kind; payload: Record<string, unknown>; groupName: string; taskTitle: string | null; parentId: string | null; lang: UserLanguage }): PushPayload`. The values are pinned by the tests below.
  - `texts(lang)` in `texts.ts`, server copy for sk and en:
    - `sentFile(name)`, `moved(label)`, `assigned(name)`, `deadline(daysLeft)` and `urgent`;
    - `bucket(label: BucketLabel)`, which reuses the board names (en "To do", "eGrant review", "{group} review", "Completed"; sk "Na spracovanie", "Kontrola eGrant", "Kontrola {group}", "Hotové");
    - the digest strings for Task 11.

- [ ] **Step 1: Write the failing tests.**
  - `decide.test.ts`: `it.each` over every (kind × mode) row of the spec table, plus:
    - `outranked event sends nothing`;
    - `read event sends nothing`;
    - `not a group person sends nothing`;
    - `push off still allows email`;
    - `no subscriptions means no push`;
    - `isOutranked: mention beats message, equal rank keeps the smaller id`.
  - `push-content.test.ts` (`g1` is the group, `c1` the channel, `m1` the message):

```ts
const chat = { channelId: 'c1', messageId: 'm1', groupId: 'g1', authorName: 'Jana', excerpt: 'Ahoj' };
const base = { kind: 'chat.message', payload: chat, groupName: 'Firma', taskTitle: null, parentId: null, lang: 'sk' } as const;
expect(buildPushPayload(base))
  .toEqual({ title: 'Firma', body: 'Jana: Ahoj', url: '/groups/g1/chat?message=m1', tag: 'chat:c1' });
// reply
expect(buildPushPayload({ ...base, kind: 'chat.thread_reply', parentId: 'r1' }))
  .toMatchObject({ url: '/groups/g1/chat?thread=r1&message=m1', tag: 'thread:r1' });
// task chat (Phase 9 payloads carry taskId)
expect(buildPushPayload({ ...base, payload: { ...chat, taskId: 't1' }, taskTitle: 'Report' }))
  .toMatchObject({ title: 'Report · Firma', url: '/groups/g1/tasks/t1?tab=chat&message=m1', tag: 'chat:c1' });
expect(buildPushPayload({ ...base, payload: { ...chat, taskId: 't1' }, taskTitle: 'Report', parentId: 'r1' }).url)
  .toBe('/groups/g1/tasks/t1?tab=chat&thread=r1&message=m1');
// 140-char excerpt → first 120 + '…'; empty excerpt → 'Jana sent a file' (en) / 'Jana poslal(a) súbor' (sk)
// task.moved to egrant_review (en): { title: 'Report · Firma', body: 'Moved to eGrant review', url: '/groups/g1/tasks/t1', tag: 'task:t1' }
// task.moved to client_review (en): body 'Moved to Firma review'; (sk) egrant_review: 'Presunuté do Kontrola eGrant'
// task.assigned: 'Jana assigned you to this task' / 'Jana vás priradil(a) k úlohe'
// task.deadline daysLeft 2: 'Deadline in 2 days' / 'Termín o 2 dni'; daysLeft 1: 'Deadline tomorrow' / 'Termín zajtra'
// task.urgent: 'Urgent: still open' / 'Urgentné: stále otvorené'
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/notifications/decide.test.ts src/modules/notifications/push-content.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files. IDs in URLs go through `encodeURIComponent`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit.** Commit message: `feat(notifications): delivery decision and push content`.

---

### Task 5: Delivery pipeline (deliver job, push job, sweep, wiring)

**Files:**
- Create: `apps/server/src/modules/notifications/deliver.ts`, `deliver.test.ts`
- Create: `apps/server/src/modules/chat/notify.ts`, `notify.test.ts`
- Modify:
  - `apps/server/src/modules/notifications/service.ts`: `recordNotifications` returns `string[]` and takes an optional `dedupeKey` (`onConflictDoNothing`); add `requestDelivery`.
  - `apps/server/src/modules/notifications/jobs.ts`.
  - `apps/server/src/modules/chat/messages.ts`: collect recipients and call `requestDelivery` after the commit.
  - `apps/server/src/modules/tasks/task-service.ts`: the same, plus `getTaskTitles`.
  - `apps/server/src/deps.ts` and `apps/server/test/test-app.ts`.
- Docs: `docs/architecture/overview.md` (the delivery pipeline), `docs/architecture/realtime.md` (a note that push is separate from sockets)

**Interfaces:**
- Consumes:
  - Task 1: `getNotificationProfiles`.
  - Task 3: `getEffectiveModes`, `listSubscriptions`, `getSubscription`, `deleteSubscriptionById` and `markPushSuccess`.
  - Task 4: `decideEvent`, `isOutranked` and `buildPushPayload`.
  - The groups module: `listGroupPeople` (once per distinct group in a batch) and `getGroup`.
- Produces:
  - `unreadForNotify(db, pairs: { userId: string; messageId: string }[]): Promise<Map<string, { id: string; channelId: string; parentId: string | null }>>`, in `chat/notify.ts`. It is keyed `${userId}:${messageId}`.
    - It keeps a message that is not deleted, was not written by that user, and lies past the user's read mark: `read_states.last_read_at` for a top-level message, or `thread_read_states.last_read_at` of its root for a reply. A reply with no thread row counts as unread.
    - It runs as one query.
  - `getTaskTitles(db, ids: string[]): Promise<Map<string, string>>`, in `tasks/task-service.ts`.
  - `requestDelivery(jobs: JobQueue, userIds: string[]): Promise<void>`. It does nothing for an empty list. It sends `DELIVER_JOB` with `{ userIds }`, and catches and logs errors (the sweep is the fallback).
  - Constants: `DELIVER_JOB = 'notifications.deliver'` and `PUSH_JOB = 'notifications.push'`.
  - `deliverPending(deps: NotificationJobDeps, opts?: { userIds?: string[]; limit?: number }): Promise<number>`. It returns the number of events processed. Each loop iteration does this:
    1. In one transaction, select `limit` (200) undelivered rows, scoped to `userIds` when given, `ORDER BY created_at, id FOR UPDATE SKIP LOCKED`.
    2. Load the context in bulk: profiles, effective modes, group people, `unreadForNotify` for events with `payload.messageId`, sibling events (same user and `payload->>'messageId'`, any delivery state, without locks), subscriptions, group names and task titles.
    3. Decide each event, then set `delivered_at = now()` and `email_due_at = now() + emailBatchDelayMs` for the email ones, and commit.
    4. After the commit, send one `PUSH_JOB` per (event, subscription) with `{ subscriptionId, payload }` and options `{ retryLimit: 3, retryDelay: 30, deleteAfterSeconds: 3600 }`.
    5. Repeat until a batch is shorter than `limit`.
  - `sendPush(deps, data: { subscriptionId: string; payload: PushPayload }): Promise<void>`.
    - A missing subscription is a no-op.
    - `'gone'` deletes the subscription.
    - `'sent'` calls `markPushSuccess`.
    - A `PushSendError` is logged and rethrown, so pg-boss retries it.
  - `type NotificationJobDeps = { db: Db; config: Config; push: PushSender | null; jobs: JobQueue }`.
  - `notificationsJobHandlers(deps: NotificationJobDeps): JobHandlers` handles `DELIVER_JOB`, `PUSH_JOB` and the existing purge.
  - `notificationSchedules: JobSchedule[]` holds `DELIVER_JOB` every minute (`'* * * * *'`, data `{}`) and the purge at 03:45.
  - `deps.ts` and `test-app.ts` pass `jobs` as a forwarding object (`{ send: (...a) => queue.send(...a) }`), because the handlers need the queue that is built from them.

- [ ] **Step 1: Write the failing tests.**
  - `chat/notify.test.ts`:
    - `top-level unread until the channel mark passes it`;
    - `a reply is unread until the thread mark passes it`;
    - `own messages are never returned`;
    - `a deleted message is not returned`.
  - `deliver.test.ts` uses `buildTestApp`.
    - Writes go through a quiet copy, `{ ...deps, jobs: { send: async () => {} } }`, so a test controls when delivery runs.
    - Each test calls `deliverPending(deps, { userIds: [...] })` and asserts on `push.sent` (the fake).
    - Every test seeds unique users, a group, and a subscription (`saveSubscription` with `https://push.example.test/${randomUUID()}`).
    - The tests:
      - `a client in mode all gets one push for an admin's message`: `push.sent[0].payload` matches `{ title: group.name, body: 'Admin: Ahoj' }` and the event has `deliveredAt` set.
      - `an admin in default mode gets no push for a plain message but one for an @mention`.
      - `one push per message when mention and message coincide`.
      - `one push per message even when its events land in different batches`, with `limit: 1` (Review Focus).
      - `a message read before delivery is skipped`, after `markRead` past it.
      - `a client removed after the event gets no push` (Review Focus).
      - `a deleted message is not pushed` (Review Focus).
      - `mode off sends nothing, even for a mention`; `task.moved arrives in mentions mode`.
      - `push switched off sends nothing but still marks delivered`.
      - `email-eligible events get email_due_at = delivered_at + delay; others stay null`.
      - `a task chat payload links to the task chat`: a recorded `chat.message` with `taskId` in its payload pushes the URL `/groups/g/tasks/t?tab=chat&message=m`.
      - `two workers never deliver the same event twice`: 30 events and `Promise.all` of two `deliverPending` calls give exactly 30 sends with distinct event messages.
      - `410 deletes the subscription`, via `failNext(endpoint, 'gone')`.
      - `a 500 throws so pg-boss retries, and the subscription stays`: `sendPush` rejects.
    - The test that `chat send triggers delivery` goes in `chat/routes.test.ts`. It uses the real inline jobs: an admin's `POST` message gives a push to a subscribed client.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/notifications/deliver.test.ts src/modules/chat/notify.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `notify.ts`, `getTaskTitles`, `deliver.ts`, `jobs.ts` and the `requestDelivery` calls (chat send, task create, update and move), then the wiring in `deps.ts` and `test-app.ts`.
- [ ] **Step 4: Run the whole server suite.** Run `pnpm --filter @spolu/server test`. Expected: PASS. The existing chat and task tests still pass with inline delivery.
- [ ] **Step 5: Docs.**
  - `overview.md`: a "Notification delivery" section covering the event, the job, the decision, the push job, the email stamp and the sweep.
  - `realtime.md`: one line saying that push is delivered outside the sockets.
- [ ] **Step 6: Commit.** Commit message: `feat(notifications): delivery pipeline with push jobs and sweep`.

---

### Task 6: Web app manifest, push service worker and device subscription

**Files:**
- Create: `apps/web/pwa-manifest.ts` (the manifest object, moved out of `vite.config.ts`), `apps/web/src/pwa-manifest.test.ts`
- Modify:
  - `apps/web/vite.config.ts`: use `manifest: pwaManifest`, and add `workbox.importScripts: ['/push-sw.js']`.
  - `apps/web/index.html`: add `<meta name="apple-mobile-web-app-title" content="Spolu" />`.
- Create: `apps/web/public/push-sw.js`, `apps/web/src/sw/push-sw.test.ts`
- Create: `apps/web/src/features/notifications/api.ts`, `push-device.ts`, `push-device.test.ts`
- Create: `apps/web/src/lib/use-sw-navigate.ts`
- Modify:
  - `apps/web/src/routes/root.tsx`: call `useSwNavigate()`.
  - `apps/web/src/features/auth/api.ts`: `signOut` first runs `(await import('@/features/notifications/push-device')).forgetThisDevice()` inside a try/catch.
- Docs: `docs/decisions/0011-pwa-with-vite-plugin-pwa.md` (the manifest name and the imported push handlers)

**Interfaces:**
- Consumes: the Task 3 endpoints and `NotificationPrefs`.
- Produces:
  - `pwaManifest`, as the spec requires:
    - `name: 'Spolu'`, `short_name: 'Spolu'`, `display: 'standalone'`, `start_url: '/'`, `scope: '/'`;
    - `theme_color` and `background_color` `'#F5F3F1'` (the page base token);
    - the three icons in `public/icons` (192, 512 and maskable 512).
  - `features/notifications/api.ts`, shared by Tasks 6, 7, 9 and 13:
    - `notificationPrefsQuery` (key `['notifications', 'preferences']`) and `updateNotificationPrefs(patch)`;
    - `notificationModesQuery` (key `['notifications', 'modes']`), `setGroupMode(groupId, mode)` and `setDefaultMode(mode)`;
    - `savePushSubscription(json: PushSubscriptionJSON)`, `deletePushSubscription(endpoint)` and `requestEmailFallback(): Promise<NotificationPrefs>` (Task 7's endpoint).
  - `push-device.ts`:
    - `type DeviceState = 'unsupported' | 'needs-home-screen' | 'blocked' | 'on' | 'off'`.
    - `isStandalone(): boolean`, from `matchMedia('(display-mode: standalone)')` or `navigator.standalone`.
    - `iosVersion(ua?: string, nav?): number | null`, for example `16.4`. It reads `OS 16_4` on iPhone and iPad, and the `Version/x.y` of a Mac-like iPad (MacIntel with `maxTouchPoints > 1`); it is null when not iOS.
    - `isIosOutsideHomeScreen(): boolean`: iOS and not standalone.
    - `getDeviceState(): Promise<DeviceState>`.
    - `subscribeThisDevice(vapidPublicKey: string): Promise<'on' | 'blocked'>`. It asks permission only when `Notification.permission === 'default'` (callers run it inside a click), then calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` and `savePushSubscription`.
    - `forgetThisDevice(): Promise<void>`. It finds the current subscription, calls `deletePushSubscription` and then `unsubscribe()`. It does nothing when unsupported.
  - `push-sw.js` behaviour:
    - On `push`, it calls `self.registration.showNotification(title, { body, tag, renotify: true, icon: '/icons/icon-192.png', data: { url } })`.
    - On `notificationclick`, it closes the notification and keeps only a same-origin path from `data.url` (anything else becomes `/`). It focuses the first same-origin window client and posts `{ type: 'spolu:navigate', url }` to it, or else calls `self.clients.openWindow(url)`.
    - `useSwNavigate()` listens for that message and calls `router.navigate({ href: url })` when `url.startsWith('/')`.

- [ ] **Step 1: Write the failing tests.**
  - `pwa-manifest.test.ts`:
    - `manifest is standalone, named Spolu, themed with the page token`;
    - `manifest lists the 192, 512 and maskable icons, and the files exist in public/icons`.
  - `push-sw.test.ts` reads `public/push-sw.js` with `fs`, runs `new Function('self', source)(fakeSelf)`, and fires the captured listeners with `waitUntil` collecting promises:
    - `push shows the notification with tag, body and url`;
    - `click focuses an open tab and posts the path`;
    - `click opens a window when no tab is open`;
    - `a foreign url opens / instead`.
  - `push-device.test.ts`:
    - `iosVersion reads iPhone, iPad and Mac-like iPad agents and is null on Android`;
    - `iOS Safari outside the home screen needs-home-screen`;
    - `denied permission is blocked`;
    - `an existing subscription is on`;
    - `subscribe asks permission only when default and posts the JSON`;
    - `forgetThisDevice deletes on the server, then unsubscribes`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/pwa-manifest.test.ts src/sw src/features/notifications`. Expected: FAIL.
- [ ] **Step 3: Implement** the files listed above.
- [ ] **Step 4: Run the web tests and the build.** Run `pnpm --filter @spolu/web test && pnpm --filter @spolu/web build`. Expected: PASS. Then check the build output:
  - `dist/manifest.webmanifest` has `"name":"Spolu"`;
  - `dist/sw.js` contains `importScripts("/push-sw.js")`;
  - the eager JS is still ≤ 200 kB gzip.
- [ ] **Step 5: Docs.** In ADR 0011's Consequences, record the manifest name and that the push handlers are imported into the Workbox worker.
- [ ] **Step 6: Commit.** Commit message: `feat(web): manifest, push service worker, device subscription and logout cleanup`.

---

### Task 7: `<AppPrompt>`: install, enable notifications, iOS email fallback

**Files:**
- Server:
  - Modify: `apps/server/src/modules/notifications/routes.ts`, adding `POST /api/me/notification-fallback`.
  - Test: `apps/server/src/modules/notifications/routes.test.ts`.
- Web:
  - Create: `apps/web/src/lib/install-prompt.ts`, imported for its side effect by `apps/web/src/main.tsx`.
  - Create: `apps/web/src/features/notifications/prompt-rules.ts`, `prompt-rules.test.ts`, `app-prompt.tsx`, `app-prompt.test.tsx`, `share-icon.tsx`.
  - Modify: `apps/web/src/features/auth/authed-layout.tsx`, which renders `<AppPrompt />` next to `<Outlet />`.
  - Modify: the locales (`notifications.prompt.*`).
- Docs: `docs/design/tokens.md` (the prompt card), `docs/product/notifications.md` (the prompts)

**Interfaces:**
- Consumes: `applyEmailFallback` and `getNotificationProfiles` (Task 1); `notificationPrefsQuery` and `requestEmailFallback` (Task 6); `getDeviceState`, `subscribeThisDevice`, `isStandalone` and `iosVersion` (Task 6).
- Produces (server):
  - `POST /api/me/notification-fallback` answers 200 with `NotificationPrefs`, behind `requireUser`.
  - It calls `applyEmailFallback(db, user.id)`, so it is idempotent: after the user turns email off again, a repeat call leaves it off.
- Produces (web):
  - `lib/install-prompt.ts`:
    - It listens for `beforeinstallprompt` at load, calls `preventDefault()`, and keeps the event.
    - `canInstall(): boolean`.
    - `promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'>`.
    - It clears the event on `appinstalled`.
  - `type Prompt = 'install-android' | 'install-ios' | 'enable' | 'ios-unsupported' | null`.
  - `type PromptInput = { phone: boolean; standalone: boolean; ios: number | null; hasPushManager: boolean; pushEnabled: boolean; vapidKey: boolean; permission: NotificationPermission | 'unsupported'; subscribed: boolean; installDismissedAt: number | null; enableDismissedAt: number | null; fallbackDone: boolean; now: number }`.
  - `choosePrompt(i: PromptInput): Prompt`, a pure function that returns the first rule that applies:
    1. `'ios-unsupported'` when the device is iOS and either the version is below 16.4 or it is standalone without `PushManager`, and `!fallbackDone`.
    2. `null` for iOS below 16.4 once the fallback is done. Installing would not bring notifications there, so no install card is shown.
    3. `'install-ios'` or `'install-android'` when `phone && !standalone` and the install prompt is outside the 6-hour window. iOS gets the iOS card; everything else gets the Android/Chromium card.
    4. `'enable'` when every one of these holds: `pushEnabled`, `vapidKey`, `hasPushManager`, `permission === 'default'`, `!subscribed`, `(standalone || !phone)`, and outside the 6-hour window.
    5. Otherwise `null`.
  - `REPROMPT_MS = 6 * 60 * 60 * 1000`.
  - `isPhone(): boolean` is true on a touch device (`matchMedia('(pointer: coarse)')`) that also has a viewport below 641 px or a mobile user agent.
  - Storage keys, read and written through try/catch:
    - `spolu.prompt.install.dismissedAt`;
    - `spolu.prompt.enable.dismissedAt`;
    - `spolu.prompt.iosFallback.done`.
    - If storage is missing or throws, the value counts as null or false, so the prompt shows again.
  - `<AppPrompt />` shows one bottom card (`role="dialog"`, `aria-labelledby`, buttons at least 44 px tall, a slide-in only under `motion-safe`):
    - `install-android`:
      - Text: "Install Spolu as an app".
      - **Install** calls `promptInstall()`. While `canInstall()` is false, the card shows the fallback text "Open the browser menu ⋮ → Install app / Add to Home screen" instead of the button.
      - **Not now** records the dismissal.
    - `install-ios`:
      - The spec's exact text: "Important: install Spolu to get notifications. On iPhone, notifications only work from the Home Screen app."
      - The steps "Tap Share → Add to Home Screen → open Spolu from the icon", with `<ShareIcon>` inline.
      - **Not now** records the dismissal.
    - `enable`: "Turn on notifications on this device". **Turn on** calls `subscribeThisDevice` inside the click; **Not now** records the dismissal.
    - `ios-unsupported`:
      - On mount it calls `requestEmailFallback()` once and writes the result to the preferences cache.
      - It shows the spec's notice: "Your iPhone's iOS doesn't support app notifications. We turned on email notifications for you. Update iOS to 16.4 or newer to get notifications on the phone."
      - **OK** sets `iosFallback.done`.
    - When permission is already `granted` and push is on but the device has no subscription, it re-subscribes silently and shows no card.
  - Every string gets a key under `notifications.prompt.*`, in en and in sk.

- [ ] **Step 1: Write the failing server test** in `routes.test.ts`: `notification-fallback turns email on once and respects a later opt-out`.
  1. A call answers `emailEnabled: true`.
  2. A `PATCH` sets `emailEnabled` to false.
  3. A second call answers `emailEnabled: false`.
- [ ] **Step 2: Write the failing web tests.**
  - `prompt-rules.test.ts`, as `it.each` rows:
    - `Android phone in the browser gets install-android`;
    - `iPhone 17 in Safari gets install-ios`;
    - `installed iPhone 17 with permission default gets enable`;
    - `desktop with permission default gets enable`;
    - `installed and subscribed gets nothing`;
    - `permission denied gets nothing`;
    - `push switched off in the profile gets no enable prompt`;
    - `install dismissed 5 h 59 min ago stays hidden, 6 h ago shows again`, and the same for enable;
    - `iOS 15.8 gets ios-unsupported, then nothing once done`;
    - `standalone iOS without PushManager gets ios-unsupported`;
    - `missing storage values mean the prompt shows`.
  - `app-prompt.test.tsx`, with `push-device` and `install-prompt` mocked:
    - `Install button uses the captured event`;
    - `Android without the event shows the menu steps`;
    - `iOS card shows the strong copy and the Share icon`;
    - `Not now stores the time and hides the card`;
    - `Turn on subscribes inside the click and hides`;
    - `iOS fallback calls the server once and shows the notice; OK stores done`;
    - `granted permission without a subscription re-subscribes silently`;
    - `blocked storage still shows the prompt`.
- [ ] **Step 3: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/notifications/routes.test.ts` and `pnpm --filter @spolu/web exec vitest run src/features/notifications`. Expected: FAIL.
- [ ] **Step 4: Design pass.** Invoke `frontend-design:frontend-design` for the prompt card: a bottom card above the safe area, egrant tokens, a primary button and a ghost button, the iOS card with stronger emphasis, and the Share icon drawn after the iOS glyph.
- [ ] **Step 5: Implement** the endpoint, the files and the copy (en and sk).
- [ ] **Step 6: Run the checks.** Run both test suites and `pnpm --filter @spolu/web build`. Expected: PASS. `<AppPrompt>` lands in the authed-layout chunk, and the eager JS is ≤ 200 kB gzip.
- [ ] **Step 7: Docs.** Add the prompt card to `tokens.md`, and the three prompts and the iOS fallback to `notifications.md`.
- [ ] **Step 8: Commit.** Commit message: `feat(web): install and enable prompts with the iOS email fallback`.


---

### Task 8: E2E push with the fake sender

**Files:**
- Create: `e2e/notifications.spec.ts`, `e2e/push-log.ts`
- Modify: `playwright.config.ts`. Its `webServer.env` gains `PUSH_PROVIDER: 'fake'`, `PUSH_FAKE_FILE: resolve('data/e2e-push.jsonl')` and `EMAIL_BATCH_DELAY_MS: '3000'`.

**Interfaces:**
- Consumes: the Task 3 endpoints and the Task 5 pipeline.
- Produces:
  - `fakeSubscription(): { endpoint: string; keys: { p256dh: string; auth: string } }`, in `e2e/push-log.ts`. It uses a unique endpoint `https://push.example.test/<uuid>`, `createECDH('prime256v1')` for the public key and 16 random bytes for `auth`, both base64url.
  - `waitForPush(endpoint: string, match: (p: PushPayload) => boolean, timeoutMs = 10_000): Promise<PushPayload>`, which polls the JSONL file.
  - `pushesFor(endpoint): PushPayload[]`.

- [ ] **Step 1: Write the tests**, which fail until the env lines are in place. Set up a group and a client who joins by invite, the same way `e2e/chat.spec.ts` does. Then:
  - `a client in mode All gets a push for an admin's message`. The client page grants `notifications` and posts `fakeSubscription()` with `page.request.post('/api/push/subscriptions')`. The admin sends a message through the API. Then `waitForPush(endpoint, p => p.body.includes(text))` resolves, and its `url` starts with `/groups/<id>/chat?message=`.
  - `in Mentions and replies the client gets none for a plain message but one for an @mention`. The client sets its mode with `PUT /api/groups/:id/notification-mode { mode: 'mentions' }`. The admin sends a plain message and then a message with `@[<client name>](<client id>)`. Once the mention push arrives, `pushesFor(endpoint)` holds no push with the plain text.
- [ ] **Step 2: Run them.** Run `pnpm test:e2e -- e2e/notifications.spec.ts`. Expected: FAIL before the config change, PASS after it.
- [ ] **Step 3: Commit.** Commit message: `test(e2e): push delivery by group mode with the fake sender`.

---

### Task 9: Bell and mode menu (group header, groups page, All groups)

**Files:**
- Create: `apps/web/src/features/notifications/mode-menu.tsx`, `mode-menu.test.tsx`, `use-modes.ts`, `icons.tsx`, `all-groups-mode.tsx`
- Modify: `apps/web/src/features/groups/group-header.tsx` (render `<GroupBell groupId={group.id} />` right after the name block), `groups-page.tsx` and `groups-page.test.tsx`
- Modify: the locales (`notifications.mode.*`)
- Test: `e2e/notifications.spec.ts` (add one bell test)
- Docs: `docs/design/tokens.md` (the bell and the All groups control)

**Interfaces:**
- Consumes: `notificationModesQuery`, `setGroupMode` and `setDefaultMode` (Task 6); `effectiveGroupMode` (Task 1); `useSession`.
- Produces:
  - `ModeMenu(props: { value: GroupMode | 'mixed'; onChange(mode: GroupMode): void; triggerLabel: string; showText?: boolean })`.
    - The trigger is a 38 px round button with a `BellIcon`, `BellAtIcon` or `BellOffIcon`. For `'mixed'` it shows the bell with the text "Mixed".
    - The content is a `DropdownMenuRadioGroup` of the three modes. Each item has a title, a one-line hint and a check on the current mode.
  - `GroupBell({ groupId })`. Its trigger label is `notifications.mode.bellLabel` ("Notifications: {{mode}}").
  - `useGroupMode(groupId): { mode: GroupMode | undefined; setMode(mode): void }`. It updates the `['notifications', 'modes']` cache optimistically and rolls back on error, with an inline error under the bell.
  - `allGroupsValue(groupIds: string[], modes: NotificationModes): GroupMode | 'mixed'`.
  - `AllGroupsMode({ groupIds })`. Its label is "All groups:" with `showText`. A change calls `setDefaultMode` and sets the cache to `{ defaultMode: mode, overrides: {} }`.
  - Copy (en; sk to match):
    - `all` "All messages", hint "Every new message in this group";
    - `mentions` "Mentions and replies", hint "When someone mentions you, replies in your thread, or a task of yours changes";
    - `off` "Off", hint "No notifications from this group";
    - `mixed` "Mixed";
    - `allGroups` "All groups:".

- [ ] **Step 1: Write the failing tests.**
  - `mode-menu.test.tsx`:
    - `shows the current mode icon and checks it in the menu`;
    - `choosing a mode calls PUT and updates at once`, the optimistic update, with the request held pending;
    - `a failed save rolls back and shows the error`;
    - `allGroupsValue: same everywhere gives that mode, differing gives mixed, default with no overrides gives the default`.
  - `groups-page.test.tsx`:
    - `each row has a bell outside the link`: clicking it does not navigate;
    - `All groups shows Mixed when groups differ`;
    - `choosing in All groups sets every row`.
  - E2E: `the client switches the bell to Mentions and replies and it sticks after reload`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/notifications src/features/groups`. Expected: FAIL.
- [ ] **Step 3: Design pass.** Invoke `frontend-design:frontend-design` for the bell, the menu items and the All groups control.
- [ ] **Step 4: Implement.**
  - On the groups page, restructure each row into a `Link` (logo, name, counts) followed by a sibling `GroupBell`.
  - Render `AllGroupsMode` above the list when there are groups.
- [ ] **Step 5: Run the checks.** Run the web tests, `pnpm --filter @spolu/web build` (eager ≤ 200 kB) and `pnpm test:e2e -- e2e/notifications.spec.ts`. Expected: PASS.
- [ ] **Step 6: Docs.** Add the bell and the All groups control to `tokens.md`.
- [ ] **Step 7: Commit.** Commit message: `feat(web): notification bell per group and All groups control`.

---

### Task 10: Deadline and urgent reminders

**Files:**
- Create: `apps/server/src/modules/tasks/reminders.ts`, `reminders.test.ts`, `apps/server/src/modules/tasks/jobs.ts`
- Modify: `apps/server/src/deps.ts` (handlers and schedules with `tz: 'Europe/Bratislava'`)
- Docs: `docs/product/task-board.md` (the reminders), `docs/architecture/overview.md` (the list of jobs)

**Interfaces:**
- Consumes: `recordNotifications(tx, { …, dedupeKey })` and `requestDelivery` (Task 5).
- Produces:
  - `bratislavaDay(now: Date): string` (`YYYY-MM-DD`) and `bratislavaHour(now: Date): number`, both through `Intl.DateTimeFormat` with `timeZone: 'Europe/Bratislava'`.
  - `recordDeadlineReminders(deps: Pick<AppDeps, 'db' | 'jobs'>, now: Date): Promise<number>`.
    - It covers tasks with `completed_at is null` and `due_date` equal to the Bratislava day plus 1, 2 or 3 days.
    - Recipients are the assignees. The payload is a `TaskDeadlinePayload`, and `dedupeKey` is `deadline:<taskId>:<day>`.
  - `recordUrgentReminders(deps, now: Date): Promise<number>`.
    - It covers tasks with `urgent` set and `completed_at is null`, sent to the assignees.
    - `dedupeKey` is `urgent:<taskId>:<day>T<HH>`.
  - Constants: `TASK_DEADLINE_JOB = 'tasks.deadline-reminders'` (cron `'0 9 * * *'`) and `TASK_URGENT_JOB = 'tasks.urgent-reminders'` (cron `'0 8,11,14,17,20 * * *'`). Both use `tz: 'Europe/Bratislava'`.

- [ ] **Step 1: Write the failing tests** (they use unique groups and tasks, and query events by the test's assignee ids):
  - `deadline reminders for tasks due in 3, 2 and 1 days, not 0 or 4`, with `daysLeft` in the payload.
  - `nothing for a completed task`, for both kinds.
  - `running twice on the same day records once` (idempotent).
  - `deadline uses the Bratislava date at 23:30 UTC` (Review Focus). With `now = 2026-10-16T23:30Z`, a task due 2026-10-18 gets `daysLeft: 1`.
  - `urgent slot key follows Bratislava hour across DST` (Review Focus). On 2026-10-25, `now = 19:00Z` gives slot `T20`; the same slot run twice records once, and `T17` is a separate reminder.
  - `a task without assignees records nothing`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/tasks/reminders.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `reminders.ts` and `jobs.ts`, and wire them in `deps.ts`. Each reminder run calls `requestDelivery` with the recipients.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Docs.** Add the reminders to `task-board.md` and the jobs to `overview.md`.
- [ ] **Step 6: Commit.** Commit message: `feat(tasks): deadline and urgent reminders in Bratislava time`.

---

### Task 11: Email digest

**Files:**
- Create: `apps/server/src/infra/email/layout.ts`, `layout.test.ts`
- Modify: `apps/server/src/modules/auth/emails.ts` (use the layout; no change to its output)
- Create: `apps/server/src/modules/notifications/digest.ts`, `digest.test.ts`
- Modify: `apps/server/src/modules/notifications/jobs.ts` and `deliver.ts` (send the delayed digest job after the commit when any `email_due_at` was set)
- Docs: `docs/product/notifications.md` (email batching), `docs/architecture/overview.md`

**Interfaces:**
- Consumes: `unreadForNotify` (Task 5), `getNotificationProfiles`, `getGroup`, `sendEmailLater` and `texts(lang)` (Task 4).
- Produces:
  - `buildEmail(i: { to: string; subject: string; paragraphs: string[]; button?: { label: string; url: string } }): EmailMessage`. This is the existing paragraph layout from `auth/emails.ts`, moved to `infra/email/layout.ts`. When a button is given, the text part ends with `label: url` and the HTML part ends with an `<a>` styled as the egrant primary button (inline styles).
  - `DIGEST_JOB = 'notifications.email-digest'`.
  - `sendDueDigests(deps: NotificationJobDeps, opts?: { now?: Date; userIds?: string[] }): Promise<number>`. It returns the number of emails queued. In one transaction:
    1. It picks the (user, group) pairs that have a row with `emailed_at is null and email_due_at <= now` (group not null, scoped by `userIds` when given).
    2. It locks every pending row of those pairs with `FOR UPDATE SKIP LOCKED` and sets `emailed_at = now`.
    3. It keeps the events still unread (chat ones through `unreadForNotify`; task events always count), deduplicated by `messageId`.
    4. If the user still has email on and at least one event remains, it queues one email after the commit.
  - `digestEmail(i: { to; lang; groupName; groupUrl; count: number; lines: string[] }): EmailMessage`.
    - Subject in en: "1 new message in Firma", "3 new messages in Firma".
    - Subject in sk: "1 nová správa v Firma", "3 nové správy v Firma", "5 nových správ v Firma".
    - Up to 5 lines (the 5 newest, oldest first). Chat lines read "Jana: text"; task lines read "<push body>: <task title>".
    - The button is "Open Firma" (sk "Otvoriť Firma") and links to `${publicUrl}/groups/<id>/chat`.
  - `deliverPending` sends `DIGEST_JOB` with `{ userIds }` and `{ startAfter: ceil(emailBatchDelayMs / 1000) }`. `notificationSchedules` adds `DIGEST_JOB` every minute.

- [ ] **Step 1: Write the failing tests.** In `digest.test.ts`, the user has email on and the events are delivered with `deliverPending`. Assertions go through Mailpit (`latestEmail`, `countEmailsTo`) and `now` is passed explicitly.
  - `one email for 3 unread messages after the delay`: subject `3 nové správy v <group>`, the 3 lines, and the group link.
  - `nothing before the delay`: at `now = delivered + delay − 1 s` the result is 0.
  - `none when the messages were read within the delay`, after `markRead` past them.
  - `a message read and another unread gives a digest of 1`.
  - `events after the first one join the same email`.
  - `email switched off before the digest sends nothing`.
  - `the same rows are never emailed twice`: a second run gives 0.
  - In `layout.test.ts`: `escapes HTML and renders the button link in both parts`.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/notifications/digest.test.ts src/infra/email/layout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the layout, the digest and the job wiring. Run `src/modules/auth/emails.test.ts` as well, to confirm the login-code email is unchanged.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Docs.** Describe the batching in `notifications.md` and the digest job in `overview.md`.
- [ ] **Step 6: Commit.** Commit message: `feat(notifications): batched email digest per user and group`.

---

### Task 12: Profile server (email change with a code, language)

**Files:**
- Create: `apps/server/src/modules/auth/email-change.ts`, `email-change.test.ts`
- Modify:
  - `apps/server/src/modules/auth/auth.ts`: export `LOGIN_CODE_TTL_SECONDS = 300` and `CODE_ATTEMPTS = 3`, and use them in `emailOTP`.
  - `apps/server/src/modules/auth/emails.ts`: add `emailChangeCodeEmail` and `emailChangedNoticeEmail`.
  - `apps/server/src/modules/auth/routes.ts`.
- Docs: `docs/product/profile.md`, `docs/product/auth.md`, `docs/architecture/permissions.md`

**Interfaces:**
- Consumes: `changeUserEmail`, `findUserByEmail`, `setUserLanguage` and `getNotificationProfiles` (Task 1); `sendEmailLater`; `createRateLimiter`; `buildEmail` (Task 11).
- Produces:
  - `requestEmailChange(deps, user: SessionUser, newEmail: string): Promise<void>`.
    - It throws `SameEmailError` when the new address equals the current one.
    - It replaces any earlier request in `verification`: the identifier is `email-change:<userId>`, the value is `<hmacSha256(appSecret, code)>:<newEmail>:<attempts>`, and it expires after `LOGIN_CODE_TTL_SECONDS`.
    - It always sends the code to `newEmail`, even when the address is taken, in the user's stored language. The send options are the same short-lived ones as the login code.
  - `confirmEmailChange(deps, user: SessionUser, newEmail: string, code: string): Promise<void>`.
    - It throws `InvalidCodeError` when there is no request, the request is for another address, it has expired, the attempts are used up (`CODE_ATTEMPTS`), or the code is wrong. A wrong code increments the attempts.
    - On a correct code it deletes the request and calls `changeUserEmail`, which throws `EmailTakenError` for a taken address.
    - It then sends `emailChangedNoticeEmail` to the old address.
  - Routes (`requireUser`):
    - `POST /api/me/email-change` `{ newEmail }` answers 204. It gives 400 `validation_failed` for an invalid or identical address, and 429 `rate_limited` above 10 requests a minute per user (the login code's plugin limit).
    - `POST /api/me/email-change/confirm` `{ newEmail, code }` answers 200 with `Me`. It gives 400 `invalid_code` and 409 `email_taken`.
    - `PUT /api/me/language` `{ language }` answers 204.

- [ ] **Step 1: Write the failing tests** (`email-change.test.ts` through `buildTestApp` and `loginAs`, reading codes with `latestLoginCode(newEmail)`):
  - `the code goes to the new address and the change applies`: `GET /api/me` shows the new email, and a notice reaches the old address mentioning the new one.
  - `a wrong code answers invalid_code and the email stays`.
  - `three wrong codes use the request up`: the right code then answers `invalid_code`.
  - `an expired code answers invalid_code`: set `verification.expires_at` in the past.
  - `an address of another account answers email_taken only after the code`: the request answers 204 and the code is mailed.
  - `the same address answers validation_failed`.
  - `the 11th request in a minute answers rate_limited`.
  - `confirm acts only on the caller`: user B confirming with A's new address and code gets `invalid_code`.
  - `language is stored and used for the next email`: after `PUT /api/me/language { language: 'en' }`, the code email is in English.
  - `existing login-code tests still pass` (`auth.test.ts`).
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/server exec vitest run src/modules/auth`. Expected: FAIL.
- [ ] **Step 3: Implement** `email-change.ts`, the emails and the routes. Compare the code hashes with `timingSafeEqual`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Docs.** Add the Phase 6 profile part to `profile.md`, the email-change code to `auth.md`, and the "only themselves" rule to `permissions.md`.
- [ ] **Step 6: Commit.** Commit message: `feat(auth): change email with a code to the new address; store language`.

---

### Task 13: Settings page, language sync, email e2e and phase wrap-up

**Files:**
- Create: `apps/web/src/components/ui/switch.tsx` (radix-ui `Switch`, egrant tokens)
- Create: `apps/web/src/features/profile/profile-section.tsx`, `email-change.tsx`, `api.ts`, `profile-section.test.tsx`
- Create: `apps/web/src/features/notifications/notifications-section.tsx`, `notifications-section.test.tsx`
- Modify:
  - `apps/web/src/routes/settings.tsx`: the sections Profile, Notifications and System status, in that order.
  - `apps/web/src/components/language-switcher.tsx`: when signed in, `void saveLanguage(value)`.
  - `apps/web/src/features/auth/authed-layout.tsx`: once per user id, `saveLanguage(i18n.language)`.
- Modify: the locales (`settings.profile.*`, `settings.notifications.*`)
- Test: `e2e/notifications.spec.ts` (the email digest)
- Docs, for this task's code: `docs/design/tokens.md` (the settings sections).
- Docs, for the phase sweep:
  - `docs/product/notifications.md`: rename the modes to All messages / Mentions and replies / Off, and add the role defaults and the task kinds.
  - `docs/glossary.md`: push subscription, group mode, email digest, AppPrompt.
  - `docs/roadmap.md`: Phase 6 status, links to the spec and this plan.
  - `docs/architecture/performance.md`: the measured eager size and the new lazy chunks.
  - `docs/runbooks/deploy.md`: a manual check list for the "Done when" items on real devices, done at the deferred server-deploy step. It covers desktop, Android (install prompt) and iPhone (the strong install card, then enabling from the Home Screen app).

**Interfaces:**
- Consumes:
  - from Task 6: the notification API, `getDeviceState`, `subscribeThisDevice` and `isIosOutsideHomeScreen`;
  - from Task 12: the endpoints;
  - the existing `updateName` and `sessionQuery`.
- Produces:
  - `requestEmailChange(newEmail)`, `confirmEmailChange(newEmail, code): Promise<Me>` and `saveLanguage(language)`, all in `features/profile/api.ts`.
  - `ProfileSection`. The name field has Save and an inline "Saved". The email row has Change, which runs a 3-step inline flow: new address → 6-digit code ("We sent a code to {{email}}") → done. Errors appear inline: `invalid_code` reads "The code is wrong or has expired" and `email_taken` reads "This address belongs to another account". On success it invalidates `sessionQuery`.
  - `NotificationsSection`:
    - A Push switch backed by `pushEnabled`. Turning it on also calls `subscribeThisDevice` when the device is `'off'`.
    - A device line: "This device: on / not set up / blocked in the browser settings", with a "Turn on for this device" button when it is not set up.
    - When blocked, one line on how to unblock: "Allow notifications for this site in the browser's site settings, then reload."
    - The iOS hint in place of the device controls when `'needs-home-screen'`.
    - "Push notifications are not available on this server" when `vapidPublicKey` is null.
    - An Email switch backed by `emailEnabled`, with the hint "A summary of unread messages, at most every 10 minutes".

- [ ] **Step 1: Write the failing tests.**
  - `profile-section.test.tsx`:
    - `saves the name`;
    - `email change: address, code, done, session refreshed`;
    - `wrong code shows the inline error and keeps the code step`;
    - `email_taken shows its message`.
  - `notifications-section.test.tsx`:
    - `push switch states: granted (device on), default (not set up, button), denied (blocked text with the unblock steps)`;
    - `iOS hint when not standalone`;
    - `turning push on with the device off asks to subscribe`;
    - `email switch PATCHes emailEnabled`;
    - `no VAPID key shows the unavailable text`.
  - `language-switcher.test.tsx`: `a signed-in change saves the language`.
  - E2E: `with email on, one batched email arrives in Mailpit`.
    - The client turns on the Email switch in `/settings`.
    - The admin sends 3 messages through the API.
    - Within 15 s, exactly one email reaches the client, its subject contains "3 nové správy", and no second email follows within 5 s more.
- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @spolu/web exec vitest run src/features/profile src/features/notifications src/components`. Expected: FAIL.
- [ ] **Step 3: Design pass.** Invoke `frontend-design:frontend-design` for the two sections, the switch rows and the inline email flow.
- [ ] **Step 4: Implement** the components, the copy (en and sk) and the language sync.
- [ ] **Step 5: Run the checks.** Run `pnpm --filter @spolu/web test`, `pnpm --filter @spolu/web build` and `pnpm test:e2e -- e2e/notifications.spec.ts`. Expected: PASS. The settings chunk is lazy, and the eager JS is ≤ 200 kB gzip; if it is over, stop and report to the controller rather than restructure the locales.
- [ ] **Step 6: Docs.** Add the settings sections and the switch to `tokens.md`.
- [ ] **Step 7: Commit.** Commit message: `feat(web): profile and notification settings`.
- [ ] **Step 8: Run the `update-kb` skill and make the phase sweep edits listed under Files.** Then make sure every file listed under "Documentation updates in this phase" in the spec has been touched.
- [ ] **Step 9: Local walkthrough in desktop Chromium.**
  - Generate real keys with `pnpm --filter @spolu/server vapid:generate` and put them in `.env`, then run `pnpm build` and serve the build the way `playwright.config.ts` does.
  - Accept the enable prompt, send a message as another user, and confirm that a notification appears and that clicking it opens the message.
- [ ] **Step 10: Run the full CI.** Run `bash scripts/ci.sh`. Expected: "All checks passed".
- [ ] **Step 11: Commit.** Commit message: `docs: phase 6 knowledge base sweep`.

