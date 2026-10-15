# Phase 3 — Groups & Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins create groups (name, logo, eGrant URL) and share a permanent invite link; clients join with email + code + name and see only their group; admins remove and restore clients.

**Architecture:** A new `groups` module (tables `groups`, `group_members`, policy, service, routes) following the `new-module` skill, public join endpoints that pre-create unverified clients so better-auth's `disableSignUp` stays on, logos resized in the browser and stored through `Storage`, and web features `groups`, `join` plus a name step. Phase 2 carry-overs and storage hardening ride along.

**Tech Stack:** existing only (Fastify 5, Drizzle, pg-boss 12, better-auth 1.7.7, Socket.IO, React 19, TanStack Router/Query, Vitest, Playwright). No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-15-phase-3-groups-and-invites-design.md`.

## Global Constraints

- English everywhere; every UI string is an i18n key with EN and SK values; only add locale keys (no reformatting).
- No new dependency (a needed one requires an ADR and a controller ruling first).
- Initial JS budget 200 kB gzip; `/groups`, `/groups/$groupId`, `/join/$token`, `/welcome` are lazy chunks.
- Any UI work starts by invoking `frontend-design:frontend-design`; reuse tokens and `components/ui/*`; inline forms and inline confirmations, no modals, no new effects.
- Permissions only via policy functions (`modules/groups/policy.ts`, `modules/users/policy.ts`); routes call the policy before the service. Reading a group you may not read answers **404 `not_found`**, never 403.
- Our API errors are `{ error: '<code>' }`; codes used in this phase: `validation_failed` 400, `invalid_logo` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, `egrant_url_taken` 409, `rate_limited` 429; Fastify's 413 for a too-large body.
- Emails lower-cased and trimmed everywhere. One client belongs to exactly one group; admins are never group members.
- Server tests share `spolu_test` in parallel: unique emails/URLs per test, never truncate; use `buildTestApp`, `loginAs`, Mailpit helpers.
- Mutations are never retried on the web (Phase 2 rule).
- Each commit updates the docs it affects.
- Commit trailer: `Co-Authored-By: <implementing model> <noreply@anthropic.com>`.

## Review Focus

- eGrant URL entered as `https://Firma.egrant.sk/`, `https://firma.egrant.sk/app/login` and `HTTPS://FIRMA.EGRANT.SK:443` for two groups: treated as the same URL → `409 egrant_url_taken` (Task 3 test).
- An invite opened after "Generate new link": the old link shows "no longer valid" and `POST /api/join/<old>` is 404, while the new link works (Task 4 and Task 6 tests).
- A file renamed to `.png` that is really a PDF, or a 2 MB photo whose resize fails: server answers `400 invalid_logo` / 413 and the old logo stays (Task 5 test).
- A removed client with an open tab and a live socket: the next navigation lands on `/login`, and opening the invite again sends no code (Task 4 and Task 6 tests).
- A newly joined client who closes the tab on the name step: on next login they get the name step again before anything else (Task 7 test).

---

### Task 1: Phase 2 carry-overs (server)

**Files:**
- Modify: `apps/server/src/modules/users/schema.ts` (CHECK constraints), generated migration, `apps/server/src/infra/jobs/jobs.ts` (schedules), `apps/server/src/deps.ts`, `apps/server/src/modules/auth/service.ts`, `apps/server/src/modules/auth/routes.ts` (sign-out), `apps/server/src/infra/realtime/socket.ts`, `apps/server/src/infra/realtime/rooms.ts`, tests next to each, `docs/architecture/realtime.md`, `docs/architecture/data-model.md`, `docs/architecture/overview.md`

**Interfaces:**
- Produces:
  - DB CHECKs: `user_role_check` (`role in ('superadmin','admin','client')`), `user_email_lower_check` (`email = lower(email)`).
  - `startJobs(databaseUrl, handlers, schedules?: { name: string; cron: string }[])` — creates a pg-boss schedule per entry (`boss.schedule(name, cron)`); handler for the schedule's name must exist in `handlers`.
  - `AUTH_CLEANUP_JOB = 'auth.cleanup-verifications'`, `authJobHandlers(db): JobHandlers` deleting `verification` rows with `expires_at < now()`; scheduled daily `'15 3 * * *'` in `createDeps`; `deleteExpiredVerifications(db): Promise<number>` in `modules/auth/service.ts`.
  - Socket: `socket.data.sessionId`; `sessionRoom(sessionId)` (`session:<id>`) in `rooms.ts` joined on connect; after joining, the middleware re-reads the user and disconnects if disabled.
  - `POST /api/auth/sign-out` (allow-listed route) reads the session before forwarding and, after a 200, calls `app.io.in(sessionRoom(id)).disconnectSockets(true)`.

- [ ] **Step 1: Failing tests:** `inserting a user with role 'boss' fails`; `inserting an upper-case email fails`; `deleteExpiredVerifications deletes only expired rows`; `startJobs registers the schedule` (assert via `boss.getSchedules()`); `sign-out disconnects only that session's sockets` (two sessions of one user, sign out one); `a user disabled between session lookup and join is disconnected` (stub to disable right after lookup).
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test` — FAIL.
- [ ] **Step 3: Implement**; `pnpm --filter @spolu/server db:generate` (check the CHECKs are in the SQL; existing rows already satisfy them).
- [ ] **Step 4: Run** server tests, typecheck, lint — PASS.
- [ ] **Step 5: Docs + commit** `feat(server): phase 2 carry-overs (checks, verification cleanup, session sockets)`.

### Task 2: Storage hardening and files backup

**Files:**
- Modify: `apps/server/src/infra/storage/disk-storage.ts`, `apps/server/src/infra/storage/storage.test.ts`, `apps/web/vite.config.ts` (`navigateFallbackDenylist` adds `/^\/files/`), `deploy/backup/backup.sh`, `deploy/docker-compose.yml` (backup mounts `files:/data/files:ro`), `scripts/tests/` (backup script test if one exists for backup.sh; else add a shellcheck-clean change only), `docs/runbooks/backup.md` (files archive + restore steps)

**Interfaces:**
- Produces: `verifySignature(key, expires, sig)` returns false unless `sig` matches `/^[0-9a-f]{64}$/` before comparing. `put` writes the `.meta.json` sidecar **before** the data file (both atomic), so a visible data file always has its metadata; `get` of a data file without a sidecar → `StorageNotFoundError`. Backup: each run also writes `files-<timestamp>.tar.gz` of `/data/files` next to the dump (same retention `BACKUP_KEEP`, `.partial` then rename).

- [ ] **Step 1: Failing tests:** `verifySignature rejects upper-case, short and non-hex signatures`; `a data file without its sidecar reads as not found`; `put writes the sidecar before the data` (spy on rename order or check after a failing data write that no data file exists).
- [ ] **Step 2–4:** run (FAIL), implement, run server tests + `bash scripts/ci.sh` script tests/shellcheck — PASS.
- [ ] **Step 5: Docs** (backup runbook: what is archived, how to restore files: stop app, extract into the `files` volume). **Commit** `fix: storage signature and sidecar order, files in the nightly backup`.

### Task 3: Groups data, policy and service

**Files:**
- Create: `apps/server/src/modules/groups/{schema.ts,policy.ts,policy.test.ts,service.ts,service.test.ts,egrant-url.ts,egrant-url.test.ts}`, `packages/shared/src/groups.ts` (+ test), generated migration
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/users.ts` (`ErrorCodes` gains `invalid_logo`, `egrant_url_taken`, `rate_limited`), `apps/server/src/modules/users/service.ts` (`reactivateUser`, `createUnverifiedClient`), `docs/architecture/data-model.md`, `docs/architecture/permissions.md`

**Interfaces:**
- Produces:
  - Tables per spec: `groups` (`id`, `name`, `logo_key`, `egrant_url` unique, `invite_token` unique, timestamps), `group_members` (`user_id` PK → user cascade, `group_id` → groups cascade, indexed, `created_at`).
  - `normalizeEgrantUrl(input: string): string | null` — returns the lower-cased origin without default port (`https://firma.egrant.sk`) or null for anything not http(s).
  - Shared: `GroupSummarySchema { id, name, hasLogo, memberCount }`, `GroupSchema { id, name, egrantUrl, hasLogo, updatedAt, inviteUrl?: string }`, `GroupInputSchema { name: trimmed 1..100, egrantUrl: string }`, `MemberSchema { id, name, email }`, `JoinInfoSchema { name, hasLogo }`, `JoinBodySchema { email }`, `NameBodySchema { name: trimmed 1..100 }`.
  - `policy.ts`: `canManageGroups(actor: SessionUser): boolean`; `canReadGroup(actor: SessionUser, groupId: string, actorGroupId: string | null): boolean`; `canRemoveMember(actor: SessionUser, target: { role: Role }): boolean` (admin actor, client target).
  - `service.ts` (db first): `listGroups(db): Promise<GroupSummary[]>` (one query with a member count of verified, active clients, ordered by name); `getGroup(db, id)`; `createGroup(db, input)` (throws `EgrantUrlTakenError`); `updateGroup(db, id, input)`; `regenerateInvite(db, id): Promise<string>`; `getGroupByInviteToken(db, token)`; `getMembershipGroupId(db, userId): Promise<string | null>`; `listMembers(db, groupId, { removed: boolean })` (clients with `email_verified = true`; `removed` selects `disabled_at is not null`); `addMember(db, groupId, userId)`; `setLogoKey(db, id, key | null): Promise<string | null>` (returns the previous key).
  - Users service: `reactivateUser(db, id)`; `createUnverifiedClient(db, email): Promise<UserRow>` (role client, name '', `email_verified false`).
  - Invite token: 32 chars base64url from `crypto.randomBytes(24)`.

- [ ] **Step 1: Policy tests first** (table over actor superadmin/admin/client-own/client-other/client-none × read, manage, remove(client target, admin target, self)).
- [ ] **Step 2: Service and URL tests:** `normalizeEgrantUrl` cases (`https://Firma.egrant.sk/` and `https://firma.egrant.sk/app/login` and `HTTPS://FIRMA.EGRANT.SK:443` → `https://firma.egrant.sk`; `ftp://x`, `not a url` → null); `createGroup rejects a duplicate normalized URL`; `regenerateInvite changes the token and the old token no longer resolves`; `listGroups counts only verified active clients`; `listMembers hides unverified clients and splits removed ones`; `setLogoKey returns the previous key`.
- [ ] **Step 3–4:** run (FAIL), implement + `db:generate`, run server and shared tests, typecheck — PASS.
- [ ] **Step 5: Docs** (data-model: Group, GroupMember built; permissions: group rows, 404 rule, client removal confirmed). **Commit** `feat(server): groups data, policy and service`.

### Task 4: Groups API, members, me

**Files:**
- Create: `apps/server/src/modules/groups/routes.ts`, `routes.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/modules/auth/routes.ts` (`GET /api/me` adds `groupId`; `PATCH /api/me`), `packages/shared/src/users.ts` (`SessionUserSchema` gains `groupId: string | null`), `apps/server/src/infra/realtime/socket.ts` + `rooms.ts` (`groupRoom(id)`, a client joins its group room), `docs/architecture/overview.md`, `docs/architecture/realtime.md`

**Interfaces:**
- Consumes: Task 3.
- Produces: every endpoint in the spec table except the logo and join rows; `inviteUrl = ${publicUrl}/join/${token}` returned to admins only; remove = `deactivateUser` + `revokeAllSessions` + `disconnectUser`; restore = `reactivateUser`; remove/restore answer 404 when the user is not a member of that group and 403 when the target is not a client.

- [ ] **Step 1: Failing tests:** `admin creates, reads, edits a group`; `duplicate eGrant URL → 409 egrant_url_taken`; `invalid body → 400 validation_failed`; `client lists groups → 403`; `client reads own group → 200 without inviteUrl`; `client reads another group → 404`; `regenerate returns a new inviteUrl`; `members list shows verified clients only`; `remove → the client's /api/me is 401 and socket disconnected`; `restore → the client can log in again`; `remove of an admin via the members route → 403`; `remove of a member of another group → 404`; `GET /api/me returns groupId for a client and null for an admin`; `PATCH /api/me changes only the caller's name, validates 1..100`; `a client's socket joins group:<id>`.
- [ ] **Step 2–4:** FAIL, implement, PASS (server tests, typecheck, lint).
- [ ] **Step 5: Docs + commit** `feat(server): groups API and members`.

### Task 5: Logo upload and serving

**Files:**
- Create: `apps/server/src/modules/groups/logo.ts` (+ `logo.test.ts`)
- Modify: `apps/server/src/modules/groups/routes.ts`, `routes.test.ts`, `docs/architecture/overview.md`

**Interfaces:**
- Produces: `sniffImageType(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null` (magic bytes: PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `RIFF....WEBP`); `PUT /api/groups/:id/logo` with a route-scoped raw-buffer content-type parser for the three image types and `bodyLimit: 524288`; key `groups/<id>/logo-<random>.<ext>`; old file deleted after the DB update; `DELETE /api/groups/:id/logo`; `GET /api/groups/:id/logo` (reader; `Cache-Control: private, max-age=86400`, `ETag` = key) and `GET /api/join/:token/logo` (public, same headers); 404 when there is no logo.

- [ ] **Step 1: Failing tests:** `sniffImageType` for PNG/JPEG/WebP/PDF/empty; `upload a PNG → 204, GET returns it with cache headers`; `a PDF sent as image/png → 400 invalid_logo and the previous logo stays`; `> 512 KB → 413`; `replacing deletes the old file from storage`; `client cannot upload (403)`; `client of another group cannot read the logo (404)`; `public join logo works for a valid token and 404 for an old one`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Docs + commit** `feat(server): group logos`.

### Task 6: Join endpoints

**Files:**
- Create: `apps/server/src/modules/groups/join-routes.ts`, `join-routes.test.ts`, `apps/server/src/infra/http/rate-limit.ts` (+ test)
- Modify: `apps/server/src/app.ts`, `docs/architecture/overview.md`, `docs/product/auth.md`, `docs/product/groups.md`

**Interfaces:**
- Produces: `createRateLimiter({ windowMs, max }): (key: string) => boolean` (in-memory fixed window, single process per ADR 0005); `GET /api/join/:token` → `{ name, hasLogo }` or 404; `POST /api/join/:token` `{ email }` → 200 `{ ok: true }` (identical for every email), 404 invalid token, 400 invalid email, 429 `rate_limited` after 10 per minute per `request.ip`. New email → `createUnverifiedClient` + `addMember` in one transaction. Existing users unchanged.

- [ ] **Step 1: Failing tests:** `rate limiter allows 10 then blocks within the window and resets after it`; `join with a new email creates an unverified client in the group; a code can then be requested and sign-in works, after which the client is listed as a member`; `join with an admin / a client of another group / a removed client returns the same body and changes nothing`; `removed client gets no code after join`; `old token → 404`; `11th join in a minute → 429`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Docs + commit** `feat(server): join a group by invite link`.

### Task 7: Web — name step, home redirect, join page

**Files:**
- Create: `apps/web/src/features/join/{join-page.tsx,join-page.test.tsx,api.ts}`, `apps/web/src/features/auth/{welcome-page.tsx,welcome-page.test.tsx}`
- Modify: `apps/web/src/features/auth/login-page.tsx` (extract the code step into a reusable `CodeStep` component used by login and join), `apps/web/src/features/auth/api.ts` (`updateName`), `apps/web/src/router.tsx`, `apps/web/src/routes/home.tsx` (or replace `/` with a redirect), locales, `docs/design/tokens.md`

**Interfaces:**
- Consumes: Task 4 (`/api/me` with `groupId`, `PATCH /api/me`), Task 6 (join endpoints), Task 5 (`/api/join/:token/logo`).
- Produces: routes `/join/$token` (public, lazy; a logged-in user goes to `/`), `/welcome` (authed, lazy; `?redirect=`); the authed layout's `beforeLoad` sends a session with an empty name to `/welcome?redirect=<href>`; `/` sends a client to `/groups/<groupId>` and an admin to `/groups` (the status card moves to `/settings`).

i18n keys (EN / SK): `join.title` "Join {{group}}" / "Pridajte sa ku skupine {{group}}"; `join.intro` "Enter your work email. We will send you a login code." / "Zadajte svoj pracovný e-mail. Pošleme vám prihlasovací kód."; `join.invalid` "This link is no longer valid. Ask eGrant for a new one." / "Tento odkaz už neplatí. Požiadajte eGrant o nový."; `join.errors.rateLimited` "Too many attempts. Try again in a minute." / "Príliš veľa pokusov. Skúste to znova o minútu."; `welcome.title` "How should we call you?" / "Ako vás máme oslovovať?"; `welcome.name` "Your name" / "Vaše meno"; `welcome.submit` "Continue" / "Pokračovať"; `welcome.errors.nameRequired` "Enter your name." / "Zadajte svoje meno."

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the join page and the name step.
- [ ] **Step 1: Failing tests:** `join page shows the group name and logo`; `invalid token shows the invalid message and no form`; `join sends the trimmed email, then the code step works like login`; `429 shows rateLimited`; `name step saves the trimmed name and continues to the redirect`; `a session with an empty name is sent to /welcome`; `/ redirects a client to its group and an admin to /groups`; `the login page still passes its tests with the extracted CodeStep`.
- [ ] **Step 2–4:** FAIL, implement, PASS (web tests, typecheck, lint, build within budget).
- [ ] **Step 5: Docs + commit** `feat(web): join by invite and name step`.

### Task 8: Web — groups list, group form, logo resize, header, socket backoff

**Files:**
- Create: `apps/web/src/features/groups/{api.ts,groups-page.tsx,groups-page.test.tsx,group-form.tsx,group-form.test.tsx,resize-image.ts,resize-image.test.ts,group-logo.tsx}`
- Modify: `apps/web/src/router.tsx`, `apps/web/src/components/app-header.tsx`, `apps/web/src/features/auth/user-menu.tsx`, `apps/web/src/features/auth/authed-layout.tsx` (socket `server_error` reconnect with backoff 1, 2, 4 … 30 s, reset on connect), locales, `docs/design/tokens.md`, `docs/architecture/realtime.md`

**Interfaces:**
- Produces: `groupsQuery` (`['groups']`), `groupQuery(id)` (`['groups', id]`), `createGroup`, `updateGroup`, `uploadLogo(id, blob)`, `removeLogo(id)`; `resizeImage(file: File, max = 256): Promise<Blob>` (canvas, WebP 0.85, keeps aspect ratio, rejects non-images); `GroupLogo({ groupId?, token?, name, hasLogo, version, size })` (img with `?v=` cache-buster or the first-letter placeholder); `GroupForm({ group?, onSaved, onCancel })` used for create and edit; header "Groups" link for admins (moves into the user menu under 641 px).

i18n keys (EN / SK): `nav.groups` "Groups" / "Skupiny"; `groups.title` "Groups" / "Skupiny"; `groups.create` "Create group" / "Vytvoriť skupinu"; `groups.empty` "No groups yet. Create the first one for a client." / "Zatiaľ žiadne skupiny. Vytvorte prvú pre klienta."; `groups.members` "{{count}} members" / "Členovia: {{count}}"; `groups.form.name` "Name" / "Názov"; `groups.form.egrantUrl` "Client's eGrant URL" / "Adresa klienta v eGrant"; `groups.form.logo` "Logo" / "Logo"; `groups.form.save` "Save" / "Uložiť"; `groups.form.cancel` "Cancel" / "Zrušiť"; `groups.form.removeLogo` "Remove logo" / "Odstrániť logo"; `groups.errors.nameRequired` "Enter a name." / "Zadajte názov."; `groups.errors.invalidUrl` "Enter a valid URL." / "Zadajte platnú adresu."; `groups.errors.urlTaken` "Another group already uses this eGrant URL." / "Túto adresu eGrant už používa iná skupina."; `groups.errors.invalidLogo` "The logo must be a PNG, JPEG or WebP image up to 512 KB." / "Logo musí byť obrázok PNG, JPEG alebo WebP do 512 KB."

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the list, form and logo field.
- [ ] **Step 1: Failing tests:** `lists groups with logo placeholder and member count`; `empty state`; `create form validates and shows urlTaken`; `create with a logo resizes then uploads`; `edit form prefilled; remove logo`; `resizeImage keeps aspect ratio within 256` (mocked canvas); `Groups link only for admins`; `server_error schedules a reconnect with growing delay and resets after connect` (fake timers).
- [ ] **Step 2–4:** FAIL, implement, PASS (web tests, typecheck, lint, build within budget).
- [ ] **Step 5: Docs + commit** `feat(web): groups list and form`.

### Task 9: Web — group page (invite, members, removed members)

**Files:**
- Create: `apps/web/src/features/groups/{group-page.tsx,group-page.test.tsx,invite-box.tsx,members-list.tsx}`
- Modify: `apps/web/src/features/groups/api.ts` (`regenerateInvite`, `membersQuery(id)`, `removedMembersQuery(id)`, `removeMember`, `restoreMember`), `apps/web/src/router.tsx`, locales, `docs/design/tokens.md`

**Interfaces:**
- Produces: route `/groups/$groupId` (authed, lazy; a 404 from the API shows the not-found component).

i18n keys (EN / SK): `group.edit` "Edit" / "Upraviť"; `group.invite.title` "Invite" / "Pozvánka"; `group.invite.copy` "Copy" / "Kopírovať"; `group.invite.copied` "Link copied." / "Odkaz skopírovaný."; `group.invite.regenerate` "Generate new link" / "Vygenerovať nový odkaz"; `group.invite.confirm` "The old link will stop working. Generate a new one?" / "Starý odkaz prestane fungovať. Vygenerovať nový?"; `group.invite.generate` "Generate" / "Vygenerovať"; `group.members.title` "Members" / "Členovia"; `group.members.empty` "No members yet. Send the invite link to the client." / "Zatiaľ žiadni členovia. Pošlite klientovi odkaz s pozvánkou."; `group.members.remove` "Remove" / "Odobrať"; `group.members.confirmRemove` "Remove {{name}}? They lose access at once." / "Odobrať {{name}}? Okamžite stratí prístup."; `group.members.removedTitle` "Removed members ({{count}})" / "Odobraní členovia ({{count}})"; `group.members.restore` "Restore" / "Obnoviť"; `group.members.you` "You" / "Vy"; reuse `admins.cancel` for Cancel.

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the group page.
- [ ] **Step 1: Failing tests:** `admin sees invite box, copy writes the URL to the clipboard and shows Link copied.`; `regenerate asks inline and replaces the URL`; `members list with You badge for a client`; `remove asks inline, focus moves, confirming removes`; `removed members section restores`; `a client sees no invite box, no Edit, no Remove`; `API 404 shows the not-found page`.
- [ ] **Step 2–4:** FAIL, implement, PASS (web tests, typecheck, lint, build within budget).
- [ ] **Step 5: Docs + commit** `feat(web): group page with invite and members`.

### Task 10: End-to-end

**Files:**
- Create: `e2e/groups.spec.ts`
- Modify: `e2e/auth.setup.ts` (stored state per role where needed), `e2e/mailpit.ts`/`e2e/login.ts` helpers, `e2e/admins.spec.ts` / `e2e/smoke.spec.ts` (only if `/` now redirects), `playwright.config.ts`

**Interfaces:**
- Consumes: the whole stack. Production limits apply: 10 code requests per minute per path per IP (Phase 2 fix) and 10 joins per minute.

- [ ] **Step 1: Write** `admin creates a group with a logo (fixture PNG in e2e/fixtures/), copies the invite; a second context joins with a new email (code from Mailpit), enters a name and sees only its group (no Groups link; another group's URL shows not-found); the admin removes the client; the client's next navigation lands on /login` — one serial test. Keep the total code sends per run within the limit; do not sign out shared stored sessions.
- [ ] **Step 2: Run** `pnpm test:e2e` and `pnpm exec playwright test --workers=1` — PASS.
- [ ] **Step 3: Run** `bash scripts/ci.sh` — PASS. **Commit** `test(e2e): groups and invites flow`.

### Task 11: Docs sweep

**Files:** as listed in the spec "Documentation updates in this phase", plus `.claude/skills/new-module/SKILL.md` if the groups module shows a pattern the skill lacks (public routes, route-scoped body parsers, rate limiter).

- [ ] **Step 1:** Run the `update-kb` skill over `git diff phase-2...HEAD`; fix every stale statement; do not mark Phase 3 done.
- [ ] **Step 2:** `bash scripts/check-docs.sh phase-2` and `bash scripts/ci.sh` — PASS. **Commit** `docs: phase 3 knowledge base sweep`.
