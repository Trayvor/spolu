# Phase 2 — Login & Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The superadmin logs in with a one-time email code, adds another admin who logs in the same way, and can remove that admin; every later module plugs into one dependencies object.

**Architecture:** `buildApp(deps)` owns Fastify, Socket.IO and every module's routes. better-auth (email-OTP plugin, database sessions in a cookie) is mounted at `/api/auth/*` by the `auth` module; roles, deactivation and admin management are our own `users` module with test-first policy functions. The web gets a session-guarded router, a two-step login page and an Admins page.

**Tech Stack:** existing (Fastify 5, Drizzle + postgres.js, pg-boss, Socket.IO, React, TanStack Router/Query, Vitest, Playwright) + `better-auth@1.7.9` (server only).

**Spec:** `docs/superpowers/specs/2026-10-15-phase-2-login-and-users-design.md`. Requirements: `docs/product/auth.md`, `docs/product/roles-and-access.md`.

## Global Constraints

- English everywhere (code, comments, docs, commits). Every UI string is an i18n key with SK and EN values.
- The only new dependency is `better-auth` pinned to `1.7.9` in `apps/server` (covered by ADR 0006, updated in this phase). The web app adds no runtime dependency and calls the auth endpoints with `fetch` (no `better-auth/client`).
- Initial JS budget stays **175 kB gzip** (`docs/architecture/performance.md`); `/login` and `/admins` are lazy chunks.
- Any UI work starts by invoking `frontend-design:frontend-design`; reuse the existing tokens and `src/components/ui/*` (button, card, badge, dropdown-menu). No new visual effects; no modals in this phase.
- Permissions only through policy functions (`modules/users/policy.ts`); routes call the policy before the service. Modules use each other only through exported service functions; the better-auth Drizzle adapter receiving all four auth tables is the one documented exception.
- Emails are stored and compared lower-cased and trimmed.
- OTP: 6 digits, valid 300 s, 3 attempts per code, `disableSignUp: true`, `storeOTP: 'hashed'`. Session: `expiresIn` 5 184 000 s (60 days), `updateAge` 86 400 s (sliding). No `session.cookieCache`.
- API error body is `{ "error": "<code>" }` for our routes. Codes: `unauthorized` (401), `forbidden` (403), `not_found` (404), `validation_failed` (400), `email_taken_admin` (409), `email_taken_client` (409). better-auth routes keep their own `{ message, code }` body (`INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`, `ACCOUNT_DISABLED`; 429 has no code).
- Server tests share the `spolu_test` database and run in parallel: never truncate shared tables; every test creates users with unique emails (`${randomUUID()}@example.com`).
- Login codes in tests are read from Mailpit (`http://localhost:8025`); real email is never sent.
- Each commit updates the docs it affects (`update-kb`); Task 11 is only the final sweep.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the implementing model's own trailer).

Facts about better-auth 1.7.9 that the tasks rely on (verified by running it) are in the controller's research notes, passed to the Task 3–5 implementers. The essentials are repeated inside those tasks.

## Review Focus

- `/login?redirect=https://evil.example` or `//evil.example`: after login the user must land on `/`, never on another site (Task 7 test).
- Email typed with capitals or spaces (" Admin@Example.com ") at login, in "Add admin" and in `SUPERADMIN_EMAIL`: treated as the same person, not a duplicate account (Tasks 3 and 6 tests).
- An admin removed while their tab is open: the next API call or socket reconnect sends them to `/login`, and the socket does not retry in a loop (Task 8 test).
- Two fast clicks on "Add and send email" with the same email: one admin is created and the second request gets `409 email_taken_admin`, never a 500 (Task 6 test).
- `SUPERADMIN_EMAIL` pointing at an existing admin or a disabled user: that user becomes an active superadmin on start, no duplicate row (Task 3 test).

---

### Task 1: Module wiring

**Files:**
- Create: `apps/server/src/deps.ts`, `apps/server/src/infra/jobs/inline-jobs.ts`, `apps/server/test/test-app.ts`, `apps/server/src/app.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/main.ts`, `apps/server/src/infra/jobs/jobs.ts`, `apps/server/src/infra/jobs/jobs.test.ts`, `apps/server/src/infra/email/index.ts`, `apps/server/src/infra/realtime/socket.ts`, `apps/server/src/infra/realtime/socket.test.ts`, `apps/server/src/modules/system/routes.ts`, `apps/server/src/modules/system/routes.test.ts`, `docs/architecture/overview.md`

**Interfaces:**
- Produces:
  - `type AppDeps = { config: Config; db: Db; email: EmailSender; storage: Storage; jobs: JobQueue }` in `src/deps.ts`.
  - `createDeps(config: Config): Promise<{ deps: AppDeps; close(): Promise<void> }>` in `src/deps.ts` (creates db, email sender, disk storage, starts pg-boss with `jobHandlers`; `close` stops jobs then the db).
  - `interface JobQueue { send(name: string, data: unknown): Promise<void> }`, `type JobHandlers = Record<string, (data: unknown) => Promise<void>>`, `startJobs(databaseUrl: string, handlers: JobHandlers): Promise<{ queue: JobQueue; stop(): Promise<void> }>` in `infra/jobs/jobs.ts` (creates a queue and a worker per handler).
  - `createInlineJobs(handlers: JobHandlers): JobQueue` in `infra/jobs/inline-jobs.ts`: `send` awaits the handler directly (tests only).
  - `EMAIL_JOB = 'email.send'`, `emailJobHandlers(email: EmailSender): JobHandlers`, `sendEmailLater(jobs: JobQueue, msg: EmailMessage): Promise<void>` in `infra/email/index.ts`.
  - `buildApp(deps: AppDeps): Promise<FastifyInstance>`; the instance is decorated with `io: SocketIOServer` (attached inside `buildApp`, closed by `app.close()`).
  - Module route plugins have the type `FastifyPluginAsync<{ deps: AppDeps }>` and are registered as `app.register(plugin, { prefix: '/api', deps })`.
  - `buildTestApp(overrides?: { config?: Partial<Config> }): Promise<{ app: FastifyInstance; deps: AppDeps; close(): Promise<void> }>` in `test/test-app.ts`: real test DB, SMTP sender to Mailpit, disk storage in a temp dir, `createInlineJobs(emailJobHandlers(email))`.

- [ ] **Step 1: Write failing tests.** `src/app.test.ts`: `buildApp exposes app.io and app.close() closes it` (after `app.listen({ port: 0 })` a socket.io-client connects; after `app.close()` the client gets `disconnect`). `infra/jobs/jobs.test.ts`: `startJobs runs the registered handler for a sent job within 5 s` (replace the raw pg-boss test) and `createInlineJobs runs the handler before send resolves`. Update `system/routes.test.ts` and `realtime/socket.test.ts` to use `buildTestApp` / `app.io` (the degraded case builds deps with a bad `DATABASE_URL`).
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test` — expect the new tests to FAIL (missing exports).
- [ ] **Step 3: Implement** the interfaces above. `main.ts` becomes: load config → migrations → `createDeps` → `buildApp` → `registerStatic` → `listen`; shutdown calls `app.close()` then `close()`. `systemRoutes` reads `config` and `db` from `deps`.
- [ ] **Step 4: Run** `pnpm --filter @spolu/server test && pnpm typecheck` — PASS.
- [ ] **Step 5: Docs.** `docs/architecture/overview.md`: describe `AppDeps`, `buildApp` owning Socket.IO, module plugin registration, job handlers.
- [ ] **Step 6: Commit** `refactor(server): one deps object for every module, socket inside buildApp`.

### Task 2: Hardening, API client errors, e2e database

**Files:**
- Modify: `apps/server/src/infra/email/elastic-sender.ts`, `apps/server/src/infra/email/email.test.ts`, `apps/server/src/app.ts`, `apps/server/src/app.test.ts`, `apps/server/src/static.ts`, `apps/server/src/static.test.ts`, `apps/server/src/infra/jobs/jobs.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `playwright.config.ts`, `docs/architecture/overview.md`
- Create: `e2e/create-db.mjs`

**Interfaces:**
- Produces:
  - `createElasticSender(opts, fetchImpl = fetch, timeoutMs = 10_000)`. Every failure (non-2xx, network error, timeout) rejects with `EmailSendError`.
  - Web: `class ApiError extends Error { status: number; body: unknown; get code(): string | undefined }` (`code` = `body.error`, else `body.code`, when it is a string). `apiGet<T>(path, schema)` unchanged in use; new `apiSend<T>(method: 'POST' | 'DELETE', path: string, body?: unknown, schema?: ZodType<T>): Promise<T | undefined>` sending JSON and `Accept-Language: <current i18n language>`; any non-2xx rejects with `ApiError` carrying the parsed body. `apiGet` also sends `Accept-Language`.

- [ ] **Step 1: Write failing tests.**
  - `email.test.ts`: `elastic sender rejects with EmailSendError after the timeout` (fetchImpl that resolves only when its `signal` aborts, `timeoutMs` 50) and `elastic sender wraps a network error in EmailSendError` (fetchImpl rejects `TypeError`).
  - `app.test.ts`: `GET /api answers JSON 404 { error: 'not_found' }`; `request.ip comes from X-Forwarded-For (trustProxy)` (register a test-only route returning `request.ip` on the built app before `ready`, inject with `x-forwarded-for: 203.0.113.7`, expect `203.0.113.7`).
  - `static.test.ts`: `a dotfile in the web dist is not served` (dist dir containing `.secret`; `GET /.secret` → 404, body not the file content).
  - `api.test.ts`: `ApiError carries the JSON error body and its code` (409 `{ error: 'email_taken_admin' }` → `code === 'email_taken_admin'`); `apiSend posts JSON with Accept-Language`.
- [ ] **Step 2: Run** server and web tests — FAIL.
- [ ] **Step 3: Implement.** Elastic: `AbortSignal.timeout(timeoutMs)` and wrap thrown errors. `Fastify({ trustProxy: true, ... })` (the app is reachable only through Caddy; comment why). Not-found handler treats `path === '/api' || path.startsWith('/api/')` (same for `/socket.io`) as API. `@fastify/static` option `dotfiles: 'deny'`. `startJobs` stop: `boss.stop({ graceful: true, timeout: 20_000 })` with a comment: below the 30 s compose `stop_grace_period`.
- [ ] **Step 4: e2e database.** `e2e/create-db.mjs` creates `spolu_e2e` if missing (connect to `postgres://spolu:spolu@localhost:5432/spolu`; `ADMIN_DATABASE_URL` overrides). `playwright.config.ts` webServer command runs it before the server; default `DATABASE_URL` becomes `.../spolu_e2e`. Run `pnpm test:e2e` — PASS.
- [ ] **Step 5: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 6: Docs** (overview: trustProxy behind Caddy, e2e DB; CLAUDE.md "Commands" line for e2e mentions `spolu_e2e`). **Commit** `fix: email timeout, trustProxy, dotfiles deny, /api 404, ApiError body, e2e database`.

### Task 3: Users data, policy and superadmin

**Files:**
- Create: `apps/server/src/modules/users/schema.ts`, `apps/server/src/modules/users/policy.ts`, `apps/server/src/modules/users/policy.test.ts`, `apps/server/src/modules/users/service.ts`, `apps/server/src/modules/users/service.test.ts`, `apps/server/src/modules/auth/schema.ts`, `packages/shared/src/users.ts`, `packages/shared/src/users.test.ts`, generated migration in `apps/server/src/infra/db/migrations/`
- Modify: `packages/shared/src/index.ts`, `apps/server/src/infra/config/config.ts`, `apps/server/src/infra/config/config.test.ts`, `apps/server/test/test-config.ts`, `apps/server/src/main.ts`, `.env.example`, `deploy/test.env.example`, `docs/architecture/data-model.md`, `docs/architecture/permissions.md`

**Interfaces:**
- Produces:
  - Shared (`@spolu/shared`): `RoleSchema = z.enum(['superadmin','admin','client'])`, `type Role`; `SessionUserSchema = { id, email, name, role }`, `type SessionUser`; `AdminSchema = { id, name, email, role: 'superadmin'|'admin' }`, `AdminListSchema = z.array(AdminSchema)`; `AddAdminBodySchema = { email: trimmed lower-cased email, name: trimmed string 1..100 }`; `ApiErrorBodySchema = { error: string }`; `ErrorCodes` const object with the codes from Global Constraints.
  - Tables: `modules/users/schema.ts` exports `user` (`id` text PK, `name` text not null, `email` text not null unique, `email_verified` boolean not null default false, `image` text null, `role` text not null default `'client'` typed as `Role`, `disabled_at` timestamptz null, `created_at`/`updated_at` timestamptz not null default now(); index on `role`). `modules/auth/schema.ts` exports `session`, `account`, `verification` exactly as better-auth's generated Drizzle schema (snake_case columns, timestamptz, `session.user_id` and `account.user_id` → `user.id` on delete cascade, indexes on `session.user_id`, `account.user_id`, `verification.identifier`).
  - `policy.ts`: `isAdmin(actor: SessionUser): boolean` (superadmin or admin), `canManageAdmins(actor: SessionUser): boolean` (= isAdmin), `canDeactivate(actor: SessionUser, target: { id: string; role: Role }): boolean` (canManageAdmins(actor) && target.role === 'admin' && target.id !== actor.id).
  - `service.ts` (each takes `db: Db` first): `ensureSuperadmin(db, { email, name }): Promise<void>`; `findUserByEmail(db, email): Promise<UserRow | null>`; `getUserById(db, id): Promise<UserRow | null>`; `listAdmins(db): Promise<Admin[]>` (active only; superadmin first, then by name); `addAdmin(db, { email, name }): Promise<Admin>` (throws `EmailTakenError` with `kind: 'admin' | 'client'`; reactivates a disabled admin with the new name; a unique-violation race maps to `EmailTakenError('admin')`); `deactivateUser(db, id): Promise<void>`. `UserRow` = the selected user row type. New users get `email_verified = true` and an id from `crypto.randomUUID()`.
  - Config: `superadminEmail` lower-cased and trimmed; new `superadminName: string` from optional `SUPERADMIN_NAME`, default = part of the email before `@`.
  - `main.ts` calls `ensureSuperadmin` after migrations.

- [ ] **Step 1: Policy tests first** (`policy.test.ts`): table-driven over actor role superadmin/admin/client × target self / superadmin / other admin / client, asserting `canManageAdmins` and `canDeactivate` exactly per the `Interfaces` rules (e.g. admin → other admin: true; admin → superadmin: false; superadmin → self: false; client → anyone: false).
- [ ] **Step 2: Service and config tests** (`service.test.ts`, `config.test.ts`, `users.test.ts` in shared): `ensureSuperadmin creates the user once` (run twice → one row, role superadmin); `ensureSuperadmin promotes an existing admin and re-enables a disabled user`; `addAdmin lower-cases and trims the email`; `addAdmin rejects an existing admin (" X@Example.com " vs "x@example.com") with kind admin`; `addAdmin rejects a client email with kind client`; `addAdmin reactivates a disabled admin with the new name`; `listAdmins skips disabled users and orders superadmin first`; `SUPERADMIN_NAME defaults to the email local part`; `AddAdminBodySchema rejects an empty name and a bad email`.
- [ ] **Step 3: Run** — FAIL.
- [ ] **Step 4: Implement**, then `pnpm --filter @spolu/server db:generate` and commit the generated migration.
- [ ] **Step 5: Run** `pnpm --filter @spolu/server test && pnpm --filter @spolu/shared test && pnpm typecheck` — PASS.
- [ ] **Step 6: Docs.** `data-model.md`: User built (columns), auth tables (session, account, verification) as library-owned; `permissions.md`: replace the "assumed" rows with the owner decisions (any admin creates and removes admins; nobody removes the superadmin or themselves); `.env.example` and `deploy/test.env.example`: `SUPERADMIN_NAME` with a comment. **Commit** `feat(server): users table, admin policy, superadmin on start`.

### Task 4: Auth module (better-auth, email code, session)

**Files:**
- Create: `apps/server/src/modules/auth/auth.ts`, `apps/server/src/modules/auth/routes.ts`, `apps/server/src/modules/auth/session.ts`, `apps/server/src/modules/auth/service.ts`, `apps/server/src/modules/auth/emails.ts`, `apps/server/src/modules/auth/emails.test.ts`, `apps/server/src/modules/auth/language.ts`, `apps/server/src/modules/auth/auth.test.ts`, `apps/server/test/mailpit.ts`, `apps/server/test/login.ts`
- Modify: `apps/server/package.json` (`better-auth: 1.7.9`), `apps/server/src/app.ts`, `docs/decisions/0006-better-auth-email-otp.md`, `docs/architecture/overview.md`, `docs/product/auth.md`

**Interfaces:**
- Consumes: `AppDeps`, `sendEmailLater` (Task 1); `user` table, `findUserByEmail`, `isAdmin`, `SessionUser` (Task 3).
- Produces:
  - `createAuth(deps: AppDeps)` in `auth.ts` returning the better-auth instance; `type Auth = ReturnType<typeof createAuth>`. `buildApp` creates it once and decorates `app.auth`.
  - `authRoutes` plugin: `GET|POST /api/auth/*` forwarded to `auth.handler` as a Web `Request` (raw body string via a content-type parser scoped to this plugin; `x-forwarded-for` set to `request.ip`; every `Set-Cookie` forwarded as an array), and `GET /api/me` → `SessionUser` or `401 { error: 'unauthorized' }`, forwarding the refreshed session cookie (`getSession({ headers, returnHeaders: true })`).
  - `session.ts`: `getSessionUser(auth: Auth, request: FastifyRequest): Promise<SessionUser | null>` (null for no session or a disabled user); preHandler factories `requireUser(auth)` and `requireAdmin(auth)` that set `request.user: SessionUser` (Fastify request decoration) or reply 401 / 403.
  - `service.ts`: `revokeAllSessions(db: Db, userId: string): Promise<void>` (deletes the user's `session` rows).
  - `language.ts`: `type EmailLanguage = 'sk' | 'en'`; `pickLanguage(acceptLanguage: string | null | undefined): EmailLanguage` (first supported primary tag, default `sk`).
  - `emails.ts`: `loginCodeEmail(to: string, code: string, lang: EmailLanguage): EmailMessage`, `adminAddedEmail(to: string, p: { name: string; addedBy: string; loginUrl: string }, lang: EmailLanguage): EmailMessage`. Names are HTML-escaped in the HTML part.
  - Test helpers: `latestLoginCode(email: string, timeoutMs = 5000): Promise<string>` (polls Mailpit `GET /api/v1/search?query=to:"<email>"`, newest message, first 6-digit number); `loginAs(app, email): Promise<string>` (send code → read code → sign in → returns the `Cookie` header value).

better-auth options (exact): `secret: config.appSecret`, `baseURL: config.publicUrl`, `basePath: '/api/auth'`, `trustedOrigins: nodeEnv === 'development' ? ['http://localhost:5173'] : []`, `database: drizzleAdapter(db, { provider: 'pg', schema: { user, session, account, verification } })`, `session: { expiresIn: 5_184_000, updateAge: 86_400 }`, `user.additionalFields: { role: { type: 'string', required: true, defaultValue: 'client', input: false }, disabledAt: { type: 'date', required: false, input: false } }`, `advanced.database.generateId: () => crypto.randomUUID()` (if the option shape differs, any unique text id is fine), `plugins: [emailOTP({ otpLength: 6, expiresIn: 300, allowedAttempts: 3, disableSignUp: true, storeOTP: 'hashed', sendVerificationOTP })]`, `databaseHooks.session.create.before` throws `new APIError('FORBIDDEN', { message: 'Account disabled', code: 'ACCOUNT_DISABLED' })` for a disabled user (returning `false` crashes sign-in with a 500). Rate limiting: library defaults (on only in production; 3 code requests per minute per IP and path). `sendVerificationOTP({ email, otp, type }, ctx)`: only `type === 'sign-in'`; looks the user up; disabled → return silently; else `sendEmailLater(jobs, loginCodeEmail(email, otp, pickLanguage(ctx?.headers?.get('accept-language'))))`.

Email copy (subject / body essentials):
- Login code, EN: "Your Spolu login code: {code}" / "Your login code is {code}. It is valid for 5 minutes. If you did not ask for it, ignore this email." SK: "Váš prihlasovací kód do Spolu: {code}" / "Váš prihlasovací kód je {code}. Platí 5 minút. Ak ste oň nežiadali, tento e-mail ignorujte."
- Admin added, EN: "You were added to Spolu" / "{addedBy} added you as an administrator of Spolu by eGrant. Log in with your email {to}: {loginUrl}" SK: "Pridali vás do Spolu" / "{addedBy} vás pridal(a) ako administrátora v Spolu by eGrant. Prihláste sa svojím e-mailom {to}: {loginUrl}"

- [ ] **Step 1: Write failing tests** (`auth.test.ts` via `buildTestApp`, `emails.test.ts`): `known admin gets a code by email and signs in` (cookie set, `GET /api/me` → SessionUser with role admin); `unknown email gets 200 { success: true } and no email` (Mailpit has nothing for it after 1 s); `disabled user gets 200 and no email`; `wrong code → 400 INVALID_OTP`; `three wrong codes burn the code → the right code then fails (403 TOO_MANY_ATTEMPTS)`; `expired code → 400 OTP_EXPIRED` (set the `verification.expires_at` row in the past); `a disabled user with a valid code gets 403 ACCOUNT_DISABLED and no cookie`; `GET /api/me without a cookie → 401 { error: 'unauthorized' }`; `deleting the user's sessions (revokeAllSessions) makes /api/me 401`; `requireAdmin gives 403 to a client`; `sign-out with body {} clears the session`; `the code email follows Accept-Language (en → English subject, missing → Slovak)`; `emails escape HTML in names`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Install with `pnpm --filter @spolu/server add better-auth@1.7.9`.
- [ ] **Step 4: Run** `pnpm --filter @spolu/server test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Docs.** ADR 0006 "Decision": disableSignUp, hashed codes, roles and `disabled_at` as our columns, code email through the job queue, Fastify glue, cookie name `better-auth.session_token` (`__Secure-` prefix on https). `product/auth.md`: unknown emails get the generic message. `overview.md`: auth flow. **Commit** `feat(server): email code login with better-auth`.

### Task 5: Socket authentication and user rooms

**Files:**
- Create: `apps/server/src/infra/realtime/rooms.ts`
- Modify: `apps/server/src/infra/realtime/socket.ts`, `apps/server/src/infra/realtime/socket.test.ts`, `apps/server/src/app.ts`, `docs/architecture/realtime.md`

**Interfaces:**
- Consumes: `Auth`, `getSessionUser`-equivalent logic (Task 4), `loginAs` (Task 4 test helper).
- Produces: `attachSocket(app: FastifyInstance, config: Config, auth: Auth): SocketIOServer` with an `io.use` middleware: origin must equal `new URL(config.publicUrl).origin` in production (any origin otherwise); session read from the handshake cookie (`auth.api.getSession({ headers: fromNodeHeaders(socket.request.headers) })`); no session or disabled user → `next(new Error('unauthorized'))`; else `socket.data.user = SessionUser` and `socket.join(userRoom(user.id))`. `rooms.ts`: `userRoom(userId: string): string` (`user:<id>`), `disconnectUser(io: SocketIOServer, userId: string): void` (`io.in(userRoom(id)).disconnectSockets(true)`).

- [ ] **Step 1: Write failing tests:** `a socket without a session cookie gets connect_error "unauthorized"`; `a logged-in socket connects and gets the system:ping ack`; `in production a foreign Origin is refused` (build with `nodeEnv: 'production'`, `extraHeaders: { origin: 'http://evil.example' }`); `disconnectUser disconnects every socket of that user only`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** server tests — PASS.
- [ ] **Step 5: Docs** (`realtime.md`: handshake auth, origin rule, `user:<id>` room). **Commit** `feat(server): authenticated sockets with per-user rooms`.

### Task 6: Admins API

**Files:**
- Create: `apps/server/src/modules/users/routes.ts`, `apps/server/src/modules/users/routes.test.ts`
- Modify: `apps/server/src/app.ts`, `docs/architecture/overview.md`

**Interfaces:**
- Consumes: Task 3 service and policy, Task 4 `requireUser`/`requireAdmin`, `revokeAllSessions`, `adminAddedEmail`, `pickLanguage`, `sendEmailLater`; Task 5 `disconnectUser`.
- Produces:
  - `GET /api/admins` → 200 `Admin[]` (admin only).
  - `POST /api/admins` body `AddAdminBody` → 201 `Admin`; 400 `validation_failed`; 409 `email_taken_admin` / `email_taken_client`. After success enqueues `adminAddedEmail` in the language of the request's `Accept-Language`, `addedBy` = the actor's name, `loginUrl` = `${publicUrl}/login`.
  - `DELETE /api/admins/:id` → 204; 404 `not_found` for an unknown id; 403 `forbidden` when `canDeactivate` refuses (including a client target). On success: `deactivateUser`, `revokeAllSessions`, `disconnectUser(app.io, id)`.

- [ ] **Step 1: Write failing tests** (logged in via `loginAs`): `admin lists admins, superadmin first, disabled ones hidden`; `client gets 403 on GET/POST/DELETE`; `no session gets 401`; `admin adds an admin, who receives the added email and can log in`; `adding with " NEW@Example.com " stores new@example.com`; `duplicate admin email → 409 email_taken_admin`; `client email → 409 email_taken_client`; `two parallel POSTs with the same email → one 201 and one 409`; `invalid body → 400 validation_failed`; `admin removes another admin → 204, that admin's /api/me is 401 and their socket is disconnected`; `nobody removes the superadmin (403)`; `nobody removes themselves (403)`; `unknown id → 404`; `removed admin re-added → active again with the new name`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** server tests — PASS.
- [ ] **Step 5: Docs** (overview module list: auth, users built). **Commit** `feat(server): admins API (list, add, remove)`.

### Task 7: Web — session, route guard, login page

**Files:**
- Create: `apps/web/src/features/auth/api.ts`, `apps/web/src/features/auth/use-session.ts`, `apps/web/src/features/auth/login-page.tsx`, `apps/web/src/features/auth/login-page.test.tsx`, `apps/web/src/features/auth/redirect.ts`, `apps/web/src/features/auth/redirect.test.ts`, `apps/web/src/components/ui/input.tsx`, `apps/web/src/components/ui/label.tsx`
- Modify: `apps/web/src/router.tsx`, `apps/web/src/locales/en.json`, `apps/web/src/locales/sk.json`, `docs/design/tokens.md`

**Interfaces:**
- Consumes: `apiGet`, `apiSend`, `ApiError` (Task 2); `SessionUserSchema` (Task 3); endpoints from Task 4.
- Produces:
  - `api.ts`: `sendCode(email: string): Promise<void>` (POST `/auth/email-otp/send-verification-otp` `{ email, type: 'sign-in' }`), `verifyCode(email: string, otp: string): Promise<void>` (POST `/auth/sign-in/email-otp`), `signOut(): Promise<void>` (POST `/auth/sign-out` with body `{}`).
  - `use-session.ts`: `sessionQuery` (query key `['session']`, fetches `/me`, resolves `SessionUser | null` with 401 → null), `useSession(): SessionUser | null`.
  - `redirect.ts`: `safeRedirect(value: unknown): string` — returns the value only if it is a string starting with `/` but not `//` or `/\`, else `/`.
  - Router: a pathless layout route `authed` with `beforeLoad` that `ensureQueryData(sessionQuery)` and throws `redirect({ to: '/login', search: { redirect: location.href } })` without a session; `/`, `/settings` (and later `/admins`) are its children. `/login` route (lazy) validates `search.redirect` with `safeRedirect` and redirects a logged-in user to `/`.

Login page per the spec ("Login (`/login`)"): two steps in one card, email field (`type=email`, `autocomplete=email`, autofocus), full-width primary "Send code"; code field (`inputmode=numeric`, `autocomplete=one-time-code`, `maxLength=6`, digits only, submits when 6 digits are present including on paste), "Log in", "Send again" disabled with a 30 s countdown, "Change email". Error mapping: `INVALID_OTP` → `login.errors.wrongCode` with attempts left (3 minus wrong tries for the current code, counted client-side); `OTP_EXPIRED` and `TOO_MANY_ATTEMPTS` → `login.errors.expired`; HTTP 429 → `login.errors.tooMany`; `ACCOUNT_DISABLED` → `login.errors.disabled`; anything else → `errors.generic`. The email is trimmed before sending. Success: invalidate `['session']`, navigate to `safeRedirect(search.redirect)`.

i18n keys (EN / SK): `login.title` "Log in" / "Prihlásenie"; `login.intro` "We will send a login code to your email." / "Pošleme vám prihlasovací kód na e-mail."; `login.email` "Email" / "E-mail"; `login.sendCode` "Send code" / "Poslať kód"; `login.codeIntro` "If {{email}} has access, we sent a 6-digit code to it. It is valid for 5 minutes." / "Ak má {{email}} prístup, poslali sme naň 6-miestny kód. Platí 5 minút."; `login.code` "Code" / "Kód"; `login.submit` "Log in" / "Prihlásiť sa"; `login.sendAgain` "Send again" / "Poslať znova"; `login.sendAgainIn` "Send again in {{seconds}} s" / "Poslať znova o {{seconds}} s"; `login.changeEmail` "Change email" / "Zmeniť e-mail"; `login.errors.invalidEmail` "Enter a valid email." / "Zadajte platný e-mail."; `login.errors.wrongCode` "The code does not match. Attempts left: {{count}}." / "Kód nesedí. Zostávajúce pokusy: {{count}}."; `login.errors.expired` "The code has expired. Send a new one." / "Kód vypršal. Pošlite si nový."; `login.errors.tooMany` "Too many attempts. Try again in a few minutes." / "Príliš veľa pokusov. Skúste to znova o pár minút."; `login.errors.disabled` "This account no longer has access." / "Tento účet už nemá prístup."; `errors.generic` "Something went wrong. Try again." / "Niečo sa pokazilo. Skúste to znova."

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the login card and the input/label components (tokens in `docs/design/tokens.md`, section "Input").
- [ ] **Step 1: Write failing tests:** `redirect.test.ts` — `safeRedirect` keeps `/admins?x=1`, returns `/` for `https://evil.example`, `//evil.example`, `/\evil.example`, `undefined`, `42`. `login-page.test.tsx` (fetch mocked) — `email step sends the trimmed email and shows the code step with the email`; `invalid email shows the field error and sends nothing`; `six pasted digits submit the code`; `INVALID_OTP shows attempts left 2 then 1`; `OTP_EXPIRED shows the expired message`; `429 shows too many attempts`; `Send again is disabled for 30 s` (fake timers); `Change email returns to step 1`; `success navigates to the redirect target`. A router test: `an anonymous visit to / redirects to /login?redirect=%2F`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test` — FAIL. **Step 3: Implement.** **Step 4: Run** web tests, `pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Run** `pnpm --filter @spolu/web build`; the initial JS stays under 175 kB gzip and `/login` is its own chunk. Docs: `tokens.md` gets the login card and input as built. **Commit** `feat(web): login with an email code`.

### Task 8: Web — logged-in shell (user menu, logout, home, socket lifecycle)

**Files:**
- Create: `apps/web/src/features/auth/user-menu.tsx`, `apps/web/src/features/auth/user-menu.test.tsx`
- Modify: `apps/web/src/components/app-header.tsx`, `apps/web/src/routes/home.tsx`, `apps/web/src/lib/socket.ts`, `apps/web/src/lib/query-client.ts`, `apps/web/src/features/system/status-card.tsx` (only if needed for the lazy socket), `apps/web/src/locales/*.json`, `docs/design/tokens.md`, `docs/architecture/realtime.md`

**Interfaces:**
- Consumes: Task 7 `useSession`, `signOut`, `sessionQuery`.
- Produces: `UserMenu` (38 px circle `bg-secondary`, initials of the name — first letters of the first two words, upper-case — opening the existing dropdown menu: name and email as a non-interactive label, separator, "Log out"); header shows an "Admins" link (to `/admins`, only when `isAdmin`) and `UserMenu` before the language menu when logged in. `lib/socket.ts`: `getSocket()` creates the socket with `autoConnect: false`; `connectSocket()` / `disconnectSocket()`; the authed layout connects after the session resolves; logout disconnects. A `connect_error` with message `unauthorized` or any `ApiError` 401 from a query or mutation sets `['session']` to `null` and navigates to `/login`. Home: `home.welcome` "Welcome, {{name}}" / "Vitajte, {{name}}" above the status card.

i18n keys: `nav.admins` "Admins" / "Administrátori"; `user.menu` "Account menu" / "Menu účtu"; `user.logout` "Log out" / "Odhlásiť sa"; `home.welcome` as above.

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the user menu and the header's logged-in state (mobile 360 px: brand, Admins link, avatar and language must fit on one line; hide the "Admins" text link under 641 px and offer it inside the user menu instead).
- [ ] **Step 1: Write failing tests:** `user menu shows initials, name and email`; `Log out calls sign-out, clears the session and goes to /login`; `the Admins link is shown to admins only`; `a 401 from any query sends the user to /login`; `socket connect_error unauthorized sends the user to /login and does not reconnect`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** web tests, typecheck, lint, build (budget) — PASS.
- [ ] **Step 5: Docs** (`tokens.md` header logged-in state and user menu; `realtime.md` client connects after login). **Commit** `feat(web): user menu, logout and authenticated socket`.

### Task 9: Web — Admins page

**Files:**
- Create: `apps/web/src/features/admins/admins-page.tsx`, `apps/web/src/features/admins/admins-page.test.tsx`, `apps/web/src/features/admins/api.ts`
- Modify: `apps/web/src/router.tsx`, `apps/web/src/locales/*.json`, `docs/design/tokens.md`

**Interfaces:**
- Consumes: `apiGet`, `apiSend`, `ApiError` (Task 2); `AdminListSchema`, `AdminSchema`, `AddAdminBodySchema` (Task 3); Task 6 endpoints; `useSession` (Task 7).
- Produces: lazy route `/admins` under the authed layout; a client gets the not-found component (`beforeLoad` throws `notFound()` when the session role is `client`). `api.ts`: `adminsQuery` (key `['admins']`), `addAdmin(body)`, `removeAdmin(id)`.

Page per the spec ("Admins page"): title, "Add admin" button; inline add form (Name, Email, "Add and send email", "Cancel") validated with `AddAdminBodySchema`; status line "{{name}} was added."; inline remove confirmation; badges "Superadmin" and "You"; no Remove on the superadmin or yourself.

i18n keys (EN / SK): `admins.title` "Admins" / "Administrátori"; `admins.add` "Add admin" / "Pridať administrátora"; `admins.name` "Name" / "Meno"; `admins.email` "Email" / "E-mail"; `admins.submit` "Add and send email" / "Pridať a poslať e-mail"; `admins.cancel` "Cancel" / "Zrušiť"; `admins.added` "{{name}} was added." / "{{name}} bol(a) pridaný(á)."; `admins.remove` "Remove" / "Odobrať"; `admins.confirmRemove` "Remove {{name}}? They lose access at once." / "Odobrať {{name}}? Okamžite stratí prístup."; `admins.badge.superadmin` "Superadmin" / "Superadmin"; `admins.badge.you` "You" / "Vy"; `admins.errors.emailTakenAdmin` "This email already belongs to an admin." / "Tento e-mail už patrí administrátorovi."; `admins.errors.emailTakenClient` "This email belongs to a client." / "Tento e-mail patrí klientovi."; `admins.errors.nameRequired` "Enter a name." / "Zadajte meno.".

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the admins list, inline form and inline confirmation.
- [ ] **Step 1: Write failing tests:** `lists admins with Superadmin and You badges`; `no Remove button on the superadmin or on yourself`; `add form validates name and email before sending`; `successful add shows "{name} was added." and refreshes the list`; `409 email_taken_admin and email_taken_client show their messages`; `Remove asks inline, Cancel restores the row, confirming calls DELETE and refreshes`; `a client visiting /admins sees the not-found page`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** web tests, typecheck, lint, build (budget) — PASS.
- [ ] **Step 5: Docs** (`tokens.md`: list rows, inline form, inline confirmation as built). **Commit** `feat(web): admins page`.

### Task 10: End-to-end tests

**Files:**
- Create: `e2e/mailpit.ts`, `e2e/auth.setup.ts`, `e2e/admins.spec.ts`
- Modify: `playwright.config.ts`, `e2e/smoke.spec.ts`, `.gitignore` (`e2e/.auth/`)

**Interfaces:**
- Consumes: the whole stack. Production rate limits apply in e2e (3 code requests per minute per path from one IP), so the suite requests at most 3 codes per run.
- Produces: a `setup` project (`auth.setup.ts`) that logs in `admin@example.com` (the e2e `SUPERADMIN_EMAIL`) with a code read from Mailpit and saves `e2e/.auth/superadmin.json`; the `chromium` project depends on it and uses that storage state. `e2e/mailpit.ts`: `latestLoginCode(request, email)`.

- [ ] **Step 1: Write the tests:** smoke tests run logged in (unchanged expectations; the deep-link test now opens `/settings` logged in). New `admins.spec.ts`: `an anonymous visitor is sent to /login` (fresh context without storage state); `superadmin adds an admin, who logs in and sees the admins list` (unique email; second browser context logs in with the code from Mailpit; sees "Administrátori" and both names); `the superadmin removes that admin and the admin's next navigation lands on /login`.
- [ ] **Step 2: Run** `pnpm test:e2e` — PASS (fix the app, not the test, if behavior is wrong).
- [ ] **Step 3: Run** `bash scripts/ci.sh` — PASS. **Commit** `test(e2e): login and admins flow`.

### Task 11: Docs sweep and the new-module skill

**Files:**
- Modify: `.claude/skills/new-module/SKILL.md`, `docs/architecture/overview.md`, `docs/architecture/permissions.md`, `docs/architecture/data-model.md`, `docs/architecture/performance.md` (current initial JS size), `docs/runbooks/deploy.md` or `docs/runbooks/server-setup.md` (`SUPERADMIN_NAME`; changing `SUPERADMIN_EMAIL` adds a superadmin and keeps the old one), `docs/glossary.md` (login code, session, deactivated admin), `CLAUDE.md` (only if a command or rule changed), `docs/roadmap.md` (Phase 2 plan link)

- [ ] **Step 1:** Rewrite the `new-module` skill against the real code: the `AppDeps` object and `FastifyPluginAsync<{ deps }>` registration in `app.ts` under `/api`; `schema.ts` → `db:generate`; `policy.ts` test-first; `service.ts` exports; `requireUser`/`requireAdmin`; errors `{ error: code }`; `sendEmailLater` and job handlers; socket rooms (`userRoom`) and emit after commit; shared zod in `packages/shared/src/<name>.ts` re-exported from `index.ts`; web feature folder, lazy route under the authed layout in `router.tsx`, `apiGet`/`apiSend`, en/sk keys; tests with `buildTestApp`, unique emails, `loginAs`, Mailpit. Point to `modules/users` as the worked example.
- [ ] **Step 2:** Run the `update-kb` skill over `git diff phase-1...HEAD`; fix every stale statement (e.g. "planned" auth/users in the overview tree).
- [ ] **Step 3:** `bash scripts/check-docs.sh phase-1` and `bash scripts/ci.sh` — PASS. **Commit** `docs: phase 2 knowledge base sweep, new-module skill on the real pattern`.
