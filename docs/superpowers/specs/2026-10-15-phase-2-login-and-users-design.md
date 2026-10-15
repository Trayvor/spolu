# Spolu — Phase 2: Login & users (design)

Date: 2026-10-15 · Status: approved by the owner in brainstorming, written spec awaiting review

Requirements: [auth](../../product/auth.md), [roles-and-access](../../product/roles-and-access.md). Roadmap entry: [Phase 2](../../roadmap.md#phase-2--login--users). Builds on the [foundation design](2026-10-15-ehub-foundation-design.md) and [ADR 0006](../../decisions/0006-better-auth-email-otp.md).

Phase 1's code is complete; only its first server deploy (Task 18) waits for owner data. Phase 2 is built on branch `phase-2`, cut from `phase-1`.

## Goal

The superadmin logs in with a one-time email code and adds another admin, who receives an email and logs in the same way. Sessions are long-lived. Admins can remove other admins. The phase also lays the module wiring every later phase uses.

## Owner decisions (brainstorming, 2026-10-15)

| question | decision |
|---|---|
| Who can add admins | Any admin (superadmin or admin). |
| Who can remove an admin | Any admin. Never the superadmin, never yourself. |
| Unknown email on the login screen | Generic message ("If this email has access, we sent a code"); no email is sent. Nobody learns who is a user. |
| What an admin enters when adding an admin | Email and name, both required. |
| Auth approach | better-auth with the email-OTP plugin (ADR 0006); roles and deactivation are our own code. Rejected: hand-written auth (security burden on a solo maintainer), better-auth admin plugin (role rules would live in the library, against "permissions only in our policy functions"). |

Controller rulings (technical, owner informed):

- "Remove" means **deactivate**: the user row stays (names under past messages stay readable in later phases), `disabled_at` is set, every session is deleted and every live socket is disconnected at once. Adding the same email again reactivates the user with the new name.
- The code email is in the language the user selected on the login screen. The "you were added" email is in the language of the admin who added them.
- Name of the superadmin: new optional env `SUPERADMIN_NAME`; default is the part of `SUPERADMIN_EMAIL` before `@`.

## User experience

### Login (`/login`)

Public route; a logged-in user who opens it is sent to `/`. The header pill stays as in Phase 1 (brand, language menu). Centered below it one card (`bg-card rounded-xl`, max width 440px, padding 32px; on mobile full width minus the page gutter), in the style of egrant.sk's modal form.

1. **Email step.** Title "Log in" (`login.title`), one line "We will send a login code to your email." Field "Email" (`type=email`, `autocomplete=email`, autofocus). Full-width primary button "Send code". Invalid email format: inline field error.
2. **Code step** (same card). Text "If this email has access, we sent a 6-digit code to it. It is valid for 5 minutes." showing the entered email. One code field (`inputmode=numeric`, `autocomplete=one-time-code`, 6 digits, larger letter-spaced text); pasting or typing the 6th digit submits. Primary button "Log in". Two links under it: "Send again" (disabled with a countdown for 30 s after each send) and "Change email" (back to step 1).
   - Wrong code: "The code does not match. Attempts left: N."
   - Expired code or no attempts left: "The code has expired. Send a new one." 
   - Too many requests: "Too many attempts. Try again in a few minutes."
3. Success: go to the page the user originally wanted, else `/`.

Copy above is the English source; Slovak goes in `sk.json` (for example "Prihlásenie", "Poslať kód", "Prihlásiť sa", "Poslať znova", "Zmeniť e-mail"). Every string is an i18n key.

### Logged-in shell

- Header right side, before the language menu: link "Admins" (admins only) and a 38px circular `bg-secondary` button with the user's initials. It opens the existing Radix dropdown menu: name and email (not interactive), then "Log out". Log out ends the session and goes to `/login`.
- Home `/`: "Welcome, {name}" plus the Phase 1 system status card. Real content comes with groups in Phase 3.
- Every route except `/login` and the not-found page requires a session; without one the router redirects to `/login?redirect=<path>`.

### Admins page (`/admins`)

Admins only (the server enforces it; a client gets 403 and the page shows not-found).

- Title "Admins", primary button "Add admin" on the right (full width under the title on mobile).
- List in one card, one row per active admin: name (weight 600), email under it (`text-muted-foreground`). Badge "Superadmin" on the superadmin, badge "You" on the current user. Sorted: superadmin first, then by name.
- "Add admin" opens an inline form above the list (no modal): "Name", "Email", primary "Add and send email", ghost "Cancel". Success closes the form, the list refreshes and a status line says "{name} was added." Errors inline: "This email already belongs to an admin.", "This email belongs to a client." 
- Each row except the superadmin and yourself has a ghost "Remove" button. Clicking it turns the row into an inline confirmation: "Remove {name}? They lose access at once." with destructive "Remove" and "Cancel". No modal, no new dependency.
- Deactivated admins are not listed.

No new visual effects; transitions only as already defined (150 ms color/opacity). `frontend-design` is invoked again before each screen is implemented.

## Architecture

### Module wiring (first task of the phase)

- `AppDeps` becomes one object: `{ config, db, email, storage, jobs }` (logging uses Fastify's own logger). `buildApp(deps)` creates Fastify, attaches Socket.IO **inside** `buildApp` (exposed as `app.io`) and registers every module's routes under `/api` with the same deps. `main.ts` only creates the infra, calls `buildApp`, serves static files and listens. Tests build the same app.
- Module layout, the same for every module: `modules/<name>/schema.ts` (Drizzle tables), `service.ts` (exported functions — the only way other modules use it), `policy.ts` (permission functions), `routes.ts` (Fastify plugin taking `AppDeps`), tests next to them. Request/response zod schemas and types live in `packages/shared/src/<name>.ts` and are re-exported from the package index.
- Web: one folder per feature in `apps/web/src/features/<name>/`, its routes lazy in `router.tsx`, keys in `en.json`/`sk.json`.
- The `new-module` skill is rewritten against this real pattern (`modules/system`, `modules/users`), including the test database isolation pattern.
- E2E tests run against their own database `spolu_e2e`, created by the e2e setup.

### Auth module (`modules/auth`)

- One better-auth instance built from `AppDeps`: Drizzle adapter on our `db`, `secret` = `APP_SECRET`, `baseURL` = `PUBLIC_URL`, base path `/api/auth`. Fastify routes forward an allow-list of the better-auth endpoints the app uses (send code, sign in, sign out, get session) to its handler; other `/api/auth/` paths are 404.
- Email-OTP plugin: 6 digits, valid 5 minutes, 3 attempts per code, `disableSignUp: true` (an unknown email gets the same success response and nothing is sent). The send callback enqueues a pg-boss job `email.send` (with retries) and returns at once; the job renders and sends the email through `EmailSender`. A disabled user gets the same generic response and no email.
- Sessions: database sessions in an httpOnly, `Secure` (in production), `SameSite=Lax` cookie; 60 days, extended on use (sliding). A database hook refuses to create a session for a disabled user.
- Rate limiting: better-auth's built-in limiter with memory storage (one process, ADR 0005); stricter limits on the OTP send and verify paths.
- Exports `getSessionUser(request): Promise<SessionUser | null>` and Fastify preHandlers `requireUser` and `requireAdmin`. `SessionUser` = `{ id, email, name, role }`. A disabled user's request is treated as no session (401). The auth module also serves `GET /api/me` → `SessionUser` or 401.
- Emails (`modules/auth/emails.ts`, used by both modules): plain text plus simple HTML, SK and EN — the login code email and the "you were added to Spolu" email with a link to `/login`.

### Users module (`modules/users`)

- Uses better-auth's core tables `user`, `session`, `account`, `verification`, defined in `schema.ts`, with two extra user columns: `role` (`superadmin | admin | client`, not null, default `client`) and `disabled_at` (nullable timestamp). Indexes on `role` and on `email` (unique).
- On start, `ensureSuperadmin(deps)` makes sure a user with `SUPERADMIN_EMAIL` exists, has role `superadmin` and is not disabled; running it twice changes nothing. If the env var later points to a new email, that user becomes a superadmin too; the old one stays (documented in the runbook).
- Endpoints (zod-validated, shapes in `packages/shared/src/users.ts`):
  - `GET /api/admins` → active admins and superadmins `{ id, name, email, role }[]` (admin only).
  - `POST /api/admins` `{ email, name }` → 201 with the admin. 409 `email_taken_admin`, 409 `email_taken_client`. A disabled admin with that email is reactivated (role admin, new name). Sends the "added" email through the job queue.
  - `DELETE /api/admins/:id` → 204. Sets `disabled_at`, deletes the user's sessions, disconnects the user's sockets (room `user:<id>`). 403 when the policy refuses, 404 for an unknown id.
- `policy.ts`: `canManageAdmins(actor)` — actor role is `superadmin` or `admin`. `canDeactivate(actor, target)` — `canManageAdmins(actor)` and target role is `admin` and target is not the actor. Written test-first.

### Realtime

The Socket.IO handshake checks the `Origin` header against `PUBLIC_URL` (any origin in development) and reads the session cookie; no valid session → connection refused. Each socket joins `user:<id>`. Writes still go through HTTP only.

### Web

- `features/auth/`: login page (two steps), `useSession()` (TanStack Query on `/api/me`), user menu, logout. `features/admins/`: admins page.
- Router: `beforeLoad` on a protected layout route fetches the session (cached by the query client) and redirects to `/login?redirect=…`. `/login` and `/admins` are lazy chunks.
- The socket connects only after login and disconnects on logout.
- `ApiError` carries the parsed error body so forms can show `email_taken_admin` and similar.
- The bundle budget (175 kB initial) must hold; the user menu reuses the already-loaded dropdown.

### Hardening carried over from Phase 1

- Elastic Email sender: request timeout (10 s) and every failure wrapped in `EmailSendError`.
- Fastify `trustProxy: true` (behind Caddy) so rate limits and logs see the real client IP.
- `@fastify/static` with `dotfiles: 'deny'`.
- `GET /api` (no trailing slash) answers JSON 404 like other unknown API paths.
- pg-boss `stop` with a timeout below the compose stop grace period (30 s), e.g. 20 s.

### Configuration

New optional `SUPERADMIN_NAME`. `.env.example`, `deploy/test.env.example` and the runbooks list it.

## Error handling

- API errors are JSON `{ error: '<code>' }` with the right status (400 validation, 401 no session, 403 policy refusal, 404, 409 conflict, 429 rate limit). The web maps codes to translated messages; unknown codes show a generic "Something went wrong. Try again."
- A failed email job is retried by pg-boss and logged; the API response does not wait for it. The login screen still says the code was sent (the user can press "Send again").
- A request with a session of a user deactivated a moment ago gets 401 and the web goes to `/login`.

## Testing

Test-first for policies and server logic.

- Policy unit tests: every combination of actor role (superadmin, admin, client) × target (self, superadmin, another admin, client).
- Server integration tests on the test database, codes read from Mailpit: superadmin bootstrap is idempotent; unknown and disabled emails get the generic response and no email; login with the right code sets the session cookie; wrong code three times burns the code; expired code fails; `GET /api/me`; add admin (email sent), duplicate admin email, client email; deactivate (sessions gone, next request 401, socket disconnected); policy refusals (client cannot list or add, nobody removes the superadmin or themselves); socket without session or from a foreign origin is refused.
- Hardening tests: Elastic timeout → `EmailSendError`; dotfile request → 404; `GET /api` → JSON 404.
- Web component tests: both login steps, error messages, resend countdown, admins list badges, inline add form errors, inline remove confirmation, redirect to `/login` without a session.
- E2E (Playwright, database `spolu_e2e`): superadmin logs in with a code from Mailpit → adds an admin → logs out → the new admin logs in → sees the admins list.

## Done when

Walked by hand with the owner on the local production-like stack (https://localhost, Mailpit or Elastic Email); repeated on the test server after the deferred server deploy (see the roadmap, "Server deployment (deferred)"):

1. The owner logs in with a code that arrived by email (Mailpit locally, Elastic Email on the server).
2. The owner adds another admin (for example a second email of theirs); that person receives the email and logs in with a code.
3. After closing and reopening the browser the owner is still logged in.
4. The owner removes that admin; the admin loses access at once.

## Documentation updates in this phase

ADR 0006 (disableSignUp, roles and deactivation as our columns, OTP email through the job queue), `architecture/permissions.md` (resolve the "assumed" rows: any admin creates and removes admins; nobody removes the superadmin or themselves), `architecture/data-model.md` (User built), `architecture/overview.md` (module wiring, auth flow), `architecture/realtime.md` (socket auth and `user:<id>` room), `product/auth.md` (generic message for unknown emails), `.env.example`, runbooks (`SUPERADMIN_NAME`, changing the superadmin), the `new-module` skill, `glossary.md` if new terms appear.

## Out of scope

Clients, groups and invites (Phase 3); password login and profile editing (Phase 16); changing someone's role from client to admin; audit log of admin changes.
