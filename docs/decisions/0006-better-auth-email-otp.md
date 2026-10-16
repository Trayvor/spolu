# 0006 better-auth with email OTP

Date: 2026-10-15
Status: accepted

## Context
Users log in with an email and a one-time code; passwords come only in a late phase. Hand-written authentication is risky and costly to maintain.

## Decision
- Use better-auth with its email-OTP plugin.
- Sessions are stored in the database and sent in an httpOnly cookie. They are long-lived (about 60 days, sliding).
- Roles (`superadmin | admin | client`) are our own, not part of the library.
- better-auth `1.7.7`, pinned exactly in `apps/server` (1.7.9 was too new for pnpm's minimum-release-age guard, which we keep) (`modules/auth/auth.ts`, `createAuth(deps)`). Settings:
  - **No sign-up** (`disableSignUp: true`): users are created only by us (superadmin on start, admins by admins). An unknown email gets the same `200 {"success":true}` as a known one, but no code and no account, so the endpoint does not reveal who has an account.
  - **Codes**: 6 digits, valid 300 s, 3 attempts per code (then the code is dead, `403 TOO_MANY_ATTEMPTS`), stored **hashed** (`storeOTP: 'hashed'`) in `verification`; a new code replaces the previous one.
  - **Sessions**: `expiresIn` 60 days, `updateAge` 1 day (sliding). No cookie cache and no secondary storage, so deleting a user's `session` rows (`revokeAllSessions`) logs them out at once.
  - **Roles and `disabled_at` are our columns** on `user` (better-auth `additionalFields`, `input: false`). A disabled user gets no code email (checked in `sendVerificationOTP`) and cannot create a session: `databaseHooks.session.create.before` throws an `APIError` `403 ACCOUNT_DISABLED` (returning `false` there crashes sign-in with a 500).
  - **Code email through the job queue**: `sendVerificationOTP` only enqueues the `email.send` job (`sendEmailLater`), in the language of `Accept-Language` (`sk` default, `en`).
  - Ids of rows better-auth creates are `crypto.randomUUID()` (`advanced.database.generateId` as a function; `'uuid'` would leave the id to a column default we do not have). Telemetry off.
  - **Origin check always on** (`advanced.disableOriginCheck: false`; the library would otherwise skip it in test runs). Trusted origin: the `PUBLIC_URL` origin, plus `http://localhost:5173` in development (the Vite proxy keeps the browser's Origin).
  - **Rate limiting**: the library's in-memory limiter, enabled when our config says `NODE_ENV=production` (the library would read `process.env` itself). The plugin's own default of 3 per minute per IP and path would block an office of colleagues behind one NAT address, so `emailOTP({ rateLimit: { window: 60, max: config.loginCodesPerMinute } })` raises code requests and sign-in attempts to 10 per minute per IP (`LOGIN_CODES_PER_MINUTE`, default 10; the e2e server sets 200, as all its browsers log in from 127.0.0.1) (plugin rules win over the library's `/sign-in` special rule of 3 per 10 s). The brute-force guard is not the rate limit but the 3 attempts per code.
  - **Short-lived code job**: the login-code email is enqueued with `expireInSeconds: 240`, `retentionSeconds: 240`, `deleteAfterSeconds: 60` (`sendEmailLater(jobs, msg, options)`, passed to pg-boss `send`). The plaintext code is in the job payload, so it is deleted a minute after the email is sent, and a late retry never mails a code that is already dead.
- **Fastify glue** (`modules/auth/routes.ts`): only an **allow-list** of better-auth endpoints is exposed: `POST /api/auth/email-otp/send-verification-otp`, `POST /api/auth/sign-in/email-otp`, `POST /api/auth/sign-out`. `GET /api/auth/get-session` is closed on purpose: the web uses only `/api/me`, and get-session ignores `disabled_at` and returns the session token. Every other path under `/api/auth/` answers our JSON 404, so endpoints we do not use (e.g. `update-user`, which would let a user edit their own record past our policies) and endpoints added by future library versions stay closed. Each allowed request is turned into a Web `Request` for `auth.handler`, with the raw body string (a content-type parser scoped to that child plugin, so other routes keep normal JSON parsing and an empty body is not rejected), `x-forwarded-for` replaced by Fastify's `request.ip` (the rate-limit key; `trustProxy` reads it from Caddy), and every `Set-Cookie` forwarded as its own header.
- **Cookie**: `better-auth.session_token` (httpOnly, `SameSite=Lax`, path `/`); with an `https` `PUBLIC_URL` it is `__Secure-better-auth.session_token` with the `Secure` flag.
- The web app calls these endpoints with plain `fetch`; `better-auth/client` is not used.
- Emails go through an `EmailSender` interface: Elastic Email in every deployed environment, Mailpit in local dev and tests. The SMTP implementation (used for Mailpit) uses nodemailer; the Elastic implementation calls the Elastic Email v4 HTTP API with `fetch`.

## Consequences
- OTP and session handling are not written by hand.
- Tests read login codes from Mailpit, so they never send real mail.
- We depend on the library's data model for users and sessions; role logic and permissions stay ours (see permissions.md).
- The better-auth Drizzle adapter receives all four auth tables, including the users module's `user`: the one documented exception to the module boundary rule.
- Error bodies of the `/api/auth/` endpoints are better-auth's `{ message, code }` (`INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`, `ACCOUNT_DISABLED`; 429 has no code), not our `{ error }`.
- The rate-limit store is per process; it resets on restart, which is fine for one instance.
- An email with surrounding spaces is rejected by better-auth (`400 INVALID_EMAIL`); the login form trims it. Capitals are fine (lower-cased).
