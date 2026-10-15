# Phase 1 — Skeleton & Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A walking skeleton — monorepo, server with health/socket/jobs/email/storage foundations, PWA shell styled like egrant.sk with SK/EN — deployed automatically from `main` to the Oracle test server over HTTPS.

**Architecture:** pnpm monorepo (`apps/server`, `apps/web`, `packages/shared`). One Node process (Fastify + Socket.IO + pg-boss) serves API, websocket and the built web app; PostgreSQL for data and queue; Caddy for TLS. CI/CD logic lives in `scripts/*.sh`; GitHub Actions only calls them.

**Tech Stack:** Node 24 LTS, TypeScript (strict), pnpm, Fastify, Drizzle ORM + drizzle-kit, postgres.js, zod, Socket.IO, pg-boss, nodemailer, React, Vite, TanStack Router + Query, Tailwind CSS v4, shadcn/ui, react-i18next, vite-plugin-pwa, Vitest, Testing Library, Playwright, Docker (buildx), Caddy 2, PostgreSQL 17, Mailpit.

**Spec:** `docs/superpowers/specs/2026-10-15-ehub-foundation-design.md` (sections 3, 4, 4a, 5, 9). Requirements: `docs/product/non-functional.md`.

## Global Constraints

- English everywhere (code, comments, docs, commits). UI strings only via i18n keys, SK + EN.
- TypeScript `strict: true` in every package; `pnpm typecheck` must pass.
- Library versions: latest stable at implementation time; Node `>=24` (`.nvmrc` = `24`); Docker base `node:24-bookworm-slim`.
- Images built for `linux/amd64` and `linux/arm64`, tagged with the full git SHA (and `latest` for the env).
- CI/CD logic only in `scripts/`; workflow YAML only checks out, sets env, calls scripts.
- Scripts take an environment name; the only env now is `test`.
- Dev/test email never leaves the machine (Mailpit). Deployed envs use `EMAIL_DRIVER=elastic`.
- Any UI/design work starts by invoking `frontend-design:frontend-design`; the UI replicates https://egrant.sk.
- Every task that changes behavior/infra updates docs via the `update-kb` skill in the same commit.
- Health contract: `GET /api/health` → `200 {"status":"ok","db":"ok","version":"<sha>"}`; DB unreachable → `503 {"status":"degraded","db":"down","version":"<sha>"}`.
- Socket contract: event `system:ping` with ack → `{ pong: true, at: <ISO string> }`.

## Review Focus

- Server started with a missing/invalid env var: must exit at boot with a message naming the variable (Task 3 test).
- Postgres down at runtime: health returns 503, not a crash (Task 5 test).
- Deep link / page refresh on a client route (e.g. `/settings`) in production returns the SPA, while unknown `/api/*` returns JSON 404 (Task 9 test).
- Storage key with `../` or absolute path must be rejected (Task 8 test).
- Language preference: stored choice wins on reload; first visit picks `sk` when browser language starts with `sk`, else `en` (Task 12 test).

---

### Task 1: Monorepo tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.npmrc`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.editorconfig`

**Interfaces:**
- Produces root scripts: `dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`, `format` — each fans out with `pnpm -r --if-present <script>` (dev uses `pnpm -r --parallel dev`).

- [ ] **Step 1:** Install pnpm if missing: `npm install -g pnpm` (owner's machine has no corepack). Set `"packageManager": "pnpm@<installed version>"` in root `package.json`, `"engines": {"node": ">=24"}`, `"private": true`, `"type": "module"`.
- [ ] **Step 2:** `pnpm-workspace.yaml`: `apps/*`, `packages/*`.
- [ ] **Step 3:** `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `module`/`moduleResolution` `NodeNext` (web overrides to `Bundler`), `target ES2023`, `skipLibCheck`.
- [ ] **Step 4:** ESLint flat config with `typescript-eslint` recommended + `eslint-config-prettier`; Prettier defaults with `singleQuote: true`, `printWidth: 100`.
- [ ] **Step 5:** Verify `pnpm install && pnpm lint && pnpm typecheck` exit 0 (no packages yet).
- [ ] **Step 6:** Commit `chore: set up pnpm monorepo tooling`.

---

### Task 2: `packages/shared`

**Files:**
- Create: `packages/shared/package.json` (name `@ehub/shared`), `tsconfig.json`, `src/index.ts`, `src/health.ts`, `src/socket.ts`, `src/health.test.ts`

**Interfaces:**
- Produces:
  - `HealthResponseSchema` (zod): `{ status: 'ok' | 'degraded', db: 'ok' | 'down', version: string }`; `type HealthResponse`.
  - `SocketEvents = { ping: 'system:ping' } as const`; `type PingAck = { pong: true; at: string }`.
- Consumed as source by server and web (`"exports": {".": "./src/index.ts"}`; server bundles it at build).

- [ ] **Step 1: Failing test** `health.test.ts`: `HealthResponseSchema.parse({status:'ok',db:'ok',version:'abc'})` succeeds; `{status:'fine',...}` throws; missing `version` throws.
- [ ] **Step 2:** `pnpm --filter @ehub/shared test` → FAIL.
- [ ] **Step 3:** Implement `health.ts`, `socket.ts`, re-export from `index.ts`.
- [ ] **Step 4:** Test → PASS. Commit `feat(shared): add health schema and socket event names`.

---

### Task 3: Server config

**Files:**
- Create: `apps/server/package.json` (name `@ehub/server`), `tsconfig.json`, `vitest.config.ts`, `src/infra/config/config.ts`, `src/infra/config/config.test.ts`, `.env.example` (repo root)

**Interfaces:**
- Produces `loadConfig(env: NodeJS.ProcessEnv): Config` (throws `ConfigError` whose message lists every invalid variable name) and `type Config`:
  `{ nodeEnv: 'development'|'test'|'production', port: number (default 3000), publicUrl: string (URL), databaseUrl: string, superadminEmail: string (email), appSecret: string (min 32 chars), appVersion: string (env APP_VERSION, default 'dev'), filesDir: string (default './data/files'), webDistDir: string | undefined, email: { driver: 'smtp', host: string, port: number, from: string } | { driver: 'elastic', apiKey: string, from: string } }`.
  Env names: `NODE_ENV, PORT, PUBLIC_URL, DATABASE_URL, SUPERADMIN_EMAIL, APP_SECRET, APP_VERSION, FILES_DIR, WEB_DIST_DIR, EMAIL_DRIVER, SMTP_HOST, SMTP_PORT, ELASTIC_EMAIL_API_KEY, MAIL_FROM`.

- [ ] **Step 1: Failing tests:**
  - valid smtp env → `config.email.driver === 'smtp'`, `port === 3000` when `PORT` unset;
  - `EMAIL_DRIVER=elastic` without `ELASTIC_EMAIL_API_KEY` → throws, message contains `ELASTIC_EMAIL_API_KEY`;
  - missing `DATABASE_URL` and short `APP_SECRET` → one error naming both;
  - `SUPERADMIN_EMAIL=not-an-email` → throws naming it.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with a zod schema + discriminated union on `EMAIL_DRIVER`. **Step 4:** Run → PASS.
- [ ] **Step 5:** `.env.example` documents every variable above plus `DOMAIN` and `POSTGRES_PASSWORD` (used by compose/Caddy), each with a one-line comment and dev defaults (`DATABASE_URL=postgres://ehub:ehub@localhost:5432/ehub`, `SMTP_HOST=localhost`, `SMTP_PORT=1025`).
- [ ] **Step 6:** Commit `feat(server): validated env config`.

---

### Task 4: Local dev services and database layer

**Files:**
- Create: `docker-compose.dev.yml`, `apps/server/drizzle.config.ts` (with `schema: './src/**/schema.ts'` so module-owned tables, e.g. from the new-module skill, are picked up), `src/infra/db/client.ts`, `src/infra/db/schema.ts`, `src/infra/db/migrate.ts`, `src/infra/db/migrations/0000_*.sql` (generated), `src/infra/db/db.test.ts`, `apps/server/test/setup-db.ts`

**Interfaces:**
- Produces: `createDb(databaseUrl: string): { db: Db; close(): Promise<void> }` (drizzle over postgres.js); `runMigrations(databaseUrl: string): Promise<void>`; `pingDb(db: Db): Promise<boolean>` (runs `select 1`, false on error, 2s timeout).
- `schema.ts` defines `appMeta` table (`key text primary key`, `value text not null`) — baseline migration only.
- Test DB: `ehub_test` on the dev Postgres; `setup-db.ts` (Vitest globalSetup) creates it if missing and runs migrations. Env `TEST_DATABASE_URL` default `postgres://ehub:ehub@localhost:5432/ehub_test`.

- [ ] **Step 1:** `docker-compose.dev.yml`: `postgres:17` (user/pass/db `ehub`, port 5432, named volume, healthcheck `pg_isready`), `axllent/mailpit` (ports 1025, 8025). Verify `docker compose -f docker-compose.dev.yml up -d --wait` succeeds.
- [ ] **Step 2: Failing tests** `db.test.ts`: after migrations, `insert into app_meta` + select round-trips; `pingDb` true on the test DB; `pingDb` false for `postgres://x:x@localhost:1/x`.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement; generate migration with `drizzle-kit generate`; `runMigrations` uses `drizzle-orm/postgres-js/migrator` with the migrations folder resolved relative to the file (works in `dist` too — copy migrations in build).
- [ ] **Step 5:** Run → PASS. Commit `feat(server): database client, migrations, dev compose`.

---

### Task 5: Fastify app and health endpoint

**Files:**
- Create: `src/app.ts`, `src/modules/system/routes.ts`, `src/modules/system/routes.test.ts`

**Interfaces:**
- Consumes: `Config`, `Db`, `pingDb`, `HealthResponseSchema`.
- Produces: `buildApp(deps: { config: Config; db: Db }): Promise<FastifyInstance>` — registers `/api` routes, JSON 404 for unknown `/api/*` (`{"error":"not_found"}`), pino logger (silent when `nodeEnv==='test'`).

- [ ] **Step 1: Failing tests** (`app.inject`): health with real test DB → 200 and body equals `{status:'ok',db:'ok',version:<config.appVersion>}` (validate with schema); with `pingDb` stubbed to false (inject a db whose ping fails — use `createDb` on an unreachable URL) → 503 `{status:'degraded',db:'down',...}`; `GET /api/nope` → 404 `{error:'not_found'}`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Commit `feat(server): fastify app with health endpoint`.

---

### Task 6: Socket.IO ping

**Files:**
- Create: `src/infra/realtime/socket.ts`, `src/infra/realtime/socket.test.ts`

**Interfaces:**
- Produces: `attachSocket(app: FastifyInstance, config: Config): SocketIOServer` — path `/socket.io`, CORS only for `config.publicUrl` in production (any origin in dev), handles `SocketEvents.ping` with ack `PingAck`.

- [ ] **Step 1: Failing test:** start app on port 0, connect `socket.io-client`, `emitWithAck('system:ping')` → `{pong:true}` and `at` parses as a date within 5s of now.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS. Commit `feat(server): socket.io with ping`.

---

### Task 7: Email senders

**Files:**
- Create: `src/infra/email/email.ts`, `smtp-sender.ts`, `elastic-sender.ts`, `index.ts`, `email.test.ts`

**Interfaces:**
- Produces: `interface EmailSender { send(msg: EmailMessage): Promise<void> }`; `type EmailMessage = { to: string[]; cc?: string[]; subject: string; html: string; text: string }`; `createEmailSender(config: Config['email'], fetchImpl = fetch): EmailSender`.
- Elastic Email v4: `POST https://api.elasticemail.com/v4/emails/transactional`, header `X-ElasticEmail-ApiKey`, body `{ Recipients: { To, CC }, Content: { From, Subject, Body: [{ContentType:'HTML',Content},{ContentType:'PlainText',Content}] } }`; non-2xx → throw `EmailSendError` including status and response text. (Verify field names against current Elastic Email docs before implementing.)

- [ ] **Step 1: Failing tests:**
  - smtp sender to Mailpit: send, then `GET http://localhost:8025/api/v1/search?query=subject:"<unique>"` → 1 message with the To and Cc addresses;
  - elastic sender with a fake `fetchImpl`: asserts URL, header, body shape (To and CC present);
  - elastic sender with fetch returning 400 → rejects with `EmailSendError` mentioning `400`.
- [ ] **Step 2:** FAIL → **Step 3:** implement (nodemailer for smtp) → **Step 4:** PASS. Commit `feat(server): email sender abstraction (smtp, elastic)`.

---

### Task 8: Disk storage

**Files:**
- Create: `src/infra/storage/storage.ts`, `disk-storage.ts`, `storage.test.ts`

**Interfaces:**
- Produces: `interface Storage { put(key: string, data: Buffer | Readable, contentType: string): Promise<void>; get(key: string): Promise<{ stream: Readable; contentType: string; size: number }>; delete(key: string): Promise<void>; exists(key: string): Promise<boolean>; signUrl(key: string, ttlSeconds: number): string; verifySignature(key: string, expires: number, sig: string): boolean }`; `createDiskStorage(rootDir: string, secret: string): Storage`.
- Keys: `[a-z0-9/_.-]+`, no `..` segments, not absolute → else throw `InvalidStorageKeyError`. Content type stored in a sidecar `<key>.meta.json`. Signed URL format: `/files/<key>?expires=<unix>&sig=<hex HMAC-SHA256(secret, key + ':' + expires)>`. (Route serving it comes with the first feature that uploads files — Phase 3.)

- [ ] **Step 1: Failing tests** (temp dir): put→get round-trip returns same bytes and contentType; delete → `exists` false; `put('../x')`, `put('/etc/x')`, `put('a/../../x')` throw `InvalidStorageKeyError`; `signUrl` → `verifySignature` true; tampered sig false; expired (`ttl -1`) false.
- [ ] **Step 2:** FAIL → **Step 3:** implement (timing-safe compare) → **Step 4:** PASS. Commit `feat(server): disk storage with signed urls`.

---

### Task 9: Server entry, jobs, static web serving

**Files:**
- Create: `src/infra/jobs/jobs.ts`, `src/infra/jobs/jobs.test.ts`, `src/main.ts`, `src/static.ts`, `src/static.test.ts`, `apps/server/tsup.config.ts` (or esbuild script)

**Interfaces:**
- Produces: `startJobs(databaseUrl: string): Promise<PgBoss>`; `registerStatic(app: FastifyInstance, webDistDir: string): Promise<void>` — serves files, falls back to `index.html` for non-`/api`, non-`/socket.io`, non-file GET requests; `main.ts` order: `loadConfig(process.env)` (on error: print message, exit 1) → `runMigrations` → `createDb` → `startJobs` → `buildApp` → `registerStatic` if `webDistDir` → `attachSocket` → listen `0.0.0.0:port`; SIGTERM/SIGINT → close app, boss, db.
- Server scripts: `dev` (`tsx watch src/main.ts`, loads root `.env`), `build` (bundle to `dist/main.js` incl. `@ehub/shared`, copy migrations), `start`, `test`.

- [ ] **Step 1: Failing tests:** jobs — `startJobs` then `boss.send('test-job',{a:1})` + `boss.work` receives `{a:1}` within 5s; static — temp dir with `index.html` + `assets/a.js`: `GET /` and `GET /settings` → index.html (200, text/html), `GET /assets/a.js` → the file, `GET /api/nope` → JSON 404 (not index.html).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Manual: `cp .env.example .env`, `pnpm --filter @ehub/server dev`; `curl localhost:3000/api/health` → `{"status":"ok",...}`. Unset `DATABASE_URL` → process exits 1 printing `DATABASE_URL`.
- [ ] **Step 6:** Commit `feat(server): entrypoint with jobs and static serving`.

---

### Task 10: egrant.sk design extraction

**Files:**
- Create: `docs/design/tokens.md`, `docs/design/screenshots/` (reference captures), `apps/web/src/styles/theme.css`, `apps/web/public/brand/` (logo/favicon assets as allowed)
- Modify: `docs/design/README.md`

**Interfaces:**
- Produces CSS variables in `theme.css` consumed by Tailwind v4 `@theme` and shadcn: `--background, --foreground, --primary, --primary-foreground, --secondary, --secondary-foreground, --muted, --muted-foreground, --accent, --accent-foreground, --destructive, --border, --input, --ring, --radius`, plus `--font-sans` (and `--font-heading` if egrant.sk uses a distinct one), font loading (self-hosted files or the same provider egrant.sk uses).

- [ ] **Step 1:** Invoke `frontend-design:frontend-design`. Following it, analyse https://egrant.sk (browser automation or fetch HTML/CSS): palette, fonts and weights, heading scale, radii, shadows, spacing rhythm, button/input/card/link styles, header/navigation pattern, logo usage. Save 3–5 reference screenshots.
- [ ] **Step 2:** Write `docs/design/tokens.md`: each token with value, where it was observed on egrant.sk, and its shadcn variable; component notes (buttons, inputs, cards, header).
- [ ] **Step 3:** Write `theme.css` with those values. Ask the owner for official logo files if the site's assets are not suitable to reuse.
- [ ] **Step 4:** Commit `docs(design): extract egrant.sk design tokens`.

---

### Task 11: Web app scaffold

**Files:**
- Create: `apps/web/package.json` (name `@ehub/web`), `vite.config.ts`, `tsconfig.json`, `index.html`, `components.json` (shadcn), `src/main.tsx`, `src/router.tsx`, `src/routes/root.tsx`, `src/routes/home.tsx`, `src/lib/api.ts`, `src/lib/socket.ts`, `src/styles/index.css`, `vitest.config.ts`, `src/test/setup.ts`

**Interfaces:**
- Consumes: `theme.css` (Task 10), `@ehub/shared`.
- Produces: `apiGet<T>(path: string, schema: ZodType<T>): Promise<T>` (fetch `/api${path}`, credentials `include`, parses with schema; health 503 still returns parsed body); `getSocket(): Socket` (singleton, same origin); routes `/` (home) and a placeholder `/settings`; Vite dev proxy `/api` and `/socket.io` (ws) → `http://localhost:3000`.

- [ ] **Step 1:** Scaffold Vite React-TS, Tailwind v4 (`@tailwindcss/vite`), shadcn init using the CSS variables from `theme.css`; add shadcn `button`, `card`, `badge`, `dropdown-menu`.
- [ ] **Step 2: Failing test** `api.test.ts`: `apiGet('/health', HealthResponseSchema)` with mocked fetch returning 503 + degraded body resolves to the degraded object; returning malformed JSON rejects.
- [ ] **Step 3:** FAIL → implement → PASS. `pnpm --filter @ehub/web build` succeeds.
- [ ] **Step 4:** Commit `feat(web): scaffold vite react app with router, query, shadcn`.

---

### Task 12: i18n SK/EN with switcher

**Files:**
- Create: `src/i18n/index.ts`, `src/i18n/detect.ts`, `src/i18n/detect.test.ts`, `src/locales/en.json`, `src/locales/sk.json`, `src/components/language-switcher.tsx`, `src/components/language-switcher.test.tsx`

**Interfaces:**
- Produces: `detectInitialLanguage(stored: string | null, navigatorLanguages: readonly string[]): 'sk' | 'en'`; storage key `ehub.lang`; `<LanguageSwitcher />` (dropdown with "Slovenčina" / "English"), sets `i18n.changeLanguage`, `localStorage`, and `document.documentElement.lang`.

- [ ] **Step 1: Failing tests:** `detectInitialLanguage('en', ['sk-SK'])` → `'en'`; `(null, ['sk-SK','en'])` → `'sk'`; `(null, ['de-DE'])` → `'en'`; `('xx', ['sk'])` → `'sk'` (invalid stored ignored). Switcher test: choosing English updates rendered text from the SK string to the EN string and writes `ehub.lang=en`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Add a key-parity test: `en.json` and `sk.json` have identical key sets.
- [ ] **Step 4:** Commit `feat(web): i18n sk/en with persisted switcher`.

---

### Task 13: Shell page and PWA

**Files:**
- Create: `src/components/app-header.tsx`, `src/features/system/status-card.tsx`, `src/features/system/status-card.test.tsx`, `public/icons/*` (192, 512, maskable 512, apple-touch 180), `scripts/generate-icons.mjs`
- Modify: `vite.config.ts` (vite-plugin-pwa), `src/routes/home.tsx`, locales

**Interfaces:**
- Consumes: `apiGet`, `getSocket`, `SocketEvents`, `LanguageSwitcher`, theme tokens.
- Produces: home page = header (eHub logo/wordmark in egrant.sk style + language switcher) and a status card showing: server version, DB status badge (ok/down), socket status (`connected` after successful `system:ping` round-trip, `disconnected` otherwise, with last ping time).

- [ ] **Step 1:** Invoke `frontend-design:frontend-design` for the header and status card, using `docs/design/tokens.md`.
- [ ] **Step 2: Failing test** `status-card.test.tsx`: mocked `apiGet` returning ok + a fake socket whose ping acks → shows translated "Database: OK" and "Realtime: connected"; health degraded → shows "Database: unavailable" with destructive badge.
- [ ] **Step 3:** FAIL → implement → PASS.
- [ ] **Step 4:** PWA: `registerType: 'autoUpdate'`, manifest `name: "eHub"`, `short_name: "eHub"`, `display: "standalone"`, `start_url: "/"`, `theme_color`/`background_color` from tokens, icons from `public/icons`; `navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/]`. `generate-icons.mjs` builds icons from the brand asset with sharp.
- [ ] **Step 5:** `pnpm --filter @ehub/web build` → `dist/manifest.webmanifest` and `dist/sw.js` exist.
- [ ] **Step 6:** Commit `feat(web): shell page with status card, installable pwa`.

---

### Task 14: Unified dev command and e2e smoke

**Files:**
- Create: `playwright.config.ts` (root), `e2e/smoke.spec.ts`
- Modify: root `package.json`, `CLAUDE.md` (Commands section)

**Interfaces:**
- Root `pnpm dev` → server + web in parallel (web on 5173 proxying to 3000). `pnpm test:e2e` → Playwright against a production-like run: build all, start `node apps/server/dist/main.js` with `WEB_DIST_DIR=apps/web/dist` on port 3000 (Playwright `webServer`).

- [ ] **Step 1: Write** `smoke.spec.ts`: open `/` → status card shows DB OK and realtime connected within 10s; switch to English → header text changes to EN and persists after reload; `GET /settings` directly renders the app (no 404); `/manifest.webmanifest` returns JSON with `name: "eHub"`.
- [ ] **Step 2:** `pnpm test:e2e` → PASS (dev compose running).
- [ ] **Step 3:** `CLAUDE.md` Commands: `docker compose -f docker-compose.dev.yml up -d`, `pnpm dev`, `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`, Mailpit UI `http://localhost:8025`.
- [ ] **Step 4:** Commit `test: e2e smoke and dev command`.

---

### Task 15: Production image and compose

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/test.env.example`, `deploy/backup/backup.sh`

**Interfaces:**
- Image: multi-stage (deps → build → runtime `node:24-bookworm-slim`, non-root `node` user), contains `apps/server/dist`, migrations, `apps/web/dist`; env `WEB_DIST_DIR=/app/web`, `FILES_DIR=/data/files`; `EXPOSE 3000`; `HEALTHCHECK` curling `/api/health` (or node fetch one-liner); `CMD ["node","server/main.js"]`; build arg `APP_VERSION` → env.
- `deploy/docker-compose.yml` services: `app` (image `${IMAGE}:${TAG}`, env_file `.env`, volume `files:/data/files`, depends on postgres healthy), `postgres` (`postgres:17`, volume `pgdata`, healthcheck), `caddy` (`caddy:2`, ports 80/443 incl. 443/udp, `Caddyfile`, volumes `caddy_data`, `caddy_config`), `backup` (`postgres:17`, runs `backup.sh` loop: nightly `pg_dump -Fc` to volume `backups`, keep 14 newest).
- `Caddyfile`: `{$DOMAIN} { encode zstd gzip; reverse_proxy app:3000 }` (websocket proxied automatically).

- [ ] **Step 1:** Write files. Local check: `docker buildx build --platform linux/arm64,linux/amd64 .` succeeds (no push).
- [ ] **Step 2:** Local prod-like run: build image for host arch, `DOMAIN=localhost` with test env → `curl -k https://localhost/api/health` → `"status":"ok"`; page loads.
- [ ] **Step 3:** Commit `build: production image and compose`.

---

### Task 16: CI/CD scripts

**Files:**
- Create: `scripts/ci.sh`, `scripts/build-image.sh`, `scripts/deploy.sh`, `scripts/server-setup.sh`, `scripts/lib.sh`

**Interfaces:**
- `ci.sh` — `pnpm install --frozen-lockfile`, start `docker-compose.dev.yml` (`--wait`), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm exec playwright install --with-deps chromium`, `pnpm test:e2e`, `scripts/check-docs.sh "${CI_BASE_REF:-origin/main}"`; tears down compose on exit (trap).
- `build-image.sh <tag>` — env `IMAGE` (e.g. `ghcr.io/<owner>/ehub`), registry login done by caller; `docker buildx build --platform linux/amd64,linux/arm64 --build-arg APP_VERSION=<tag> -t $IMAGE:<tag> --push .`
- `deploy.sh <env> <tag>` — needs `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (path), `IMAGE`, and the env file content in `DEPLOY_ENV_FILE` (path); copies `deploy/docker-compose.yml`, `Caddyfile`, `backup/`, env file → `/opt/ehub/<env>/`; remote: `docker login` (if `REGISTRY_TOKEN` set), `TAG=<tag> docker compose pull && up -d --remove-orphans`; then polls `https://$DOMAIN/api/health` up to 120s until `version == <tag>`; non-zero exit on timeout.
- `server-setup.sh` — run once as root on the VM: detects Ubuntu vs Oracle Linux; installs Docker Engine + compose plugin; opens 80/tcp, 443/tcp, 443/udp in iptables/firewalld and persists rules; creates `deploy` user in `docker` group with the provided public key; creates `/opt/ehub`. Idempotent.
- All scripts: `set -euo pipefail`, usage message on missing args, `shellcheck` clean.

- [ ] **Step 1:** Write scripts; `shellcheck scripts/*.sh` → no errors.
- [ ] **Step 2:** `bash scripts/ci.sh` locally → exit 0.
- [ ] **Step 3:** Commit `ci: ci-agnostic build, test and deploy scripts`.

---

### Task 17: GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy-test.yml`

**Interfaces:**
- `ci.yml`: on `pull_request` → checkout (fetch-depth 0), setup Node 24 + pnpm, `CI_BASE_REF=origin/${{ github.base_ref }} scripts/ci.sh`.
- `deploy-test.yml`: on push to `main` and on `workflow_dispatch` with a `ref` input (branch/SHA to deploy, so any branch can be deployed to the test env before merge; checkout uses `inputs.ref` when set) → job `ci` (same as above) → job `deploy` (needs ci, `environment: test`): setup buildx + QEMU, login to GHCR with `GITHUB_TOKEN` (`packages: write`), `scripts/build-image.sh ${{ github.sha }}`, write secrets `TEST_SSH_KEY` and `TEST_ENV_FILE` to temp files, `scripts/deploy.sh test ${{ github.sha }}` with `DEPLOY_HOST`/`DEPLOY_USER`/`DOMAIN` from environment variables. Concurrency group `deploy-test`.
- No logic in YAML beyond env wiring.

- [ ] **Step 1:** Write workflows. **Step 2:** Push a branch + open PR → `ci` green. **Step 3:** Commit `ci: github actions wrappers`.

---

### Task 18: First deploy to Oracle and runbooks

**Files:**
- Modify: `docs/runbooks/server-setup.md`, `deploy.md`, `rollback.md`, `backup.md`, `docs/roadmap.md`, `docs/architecture/overview.md` (if anything changed), `CLAUDE.md`

- [ ] **Step 1:** Ask the owner for: VM public IP, OS, SSH access, the temporary domain, DNS control, Elastic Email API key + verified sender address (`MAIL_FROM`), `SUPERADMIN_EMAIL`. Have them add the Oracle Console Security List ingress rules for 80/tcp, 443/tcp, 443/udp.
- [ ] **Step 2:** Run `server-setup.sh` on the VM; point the domain's A record at the VM.
- [ ] **Step 3:** Create GitHub environment `test` with secrets `TEST_SSH_KEY`, `TEST_ENV_FILE` and variables `DEPLOY_HOST`, `DEPLOY_USER`, `DOMAIN`, `IMAGE`.
- [ ] **Step 4:** Deploy the phase branch BEFORE merging: run `deploy-test` via `workflow_dispatch` with `ref` = the phase branch (or `scripts/deploy.sh test <sha>`). Verify: `curl https://<domain>/api/health` → `"status":"ok"` and `version` = that SHA. Merge to `main` only after the Step 6 owner walkthrough; the push-to-main deploy then re-runs and is verified the same way.
- [ ] **Step 5:** Write the runbooks (exact commands from Tasks 15–18, incl. the Security List step, rollback = `scripts/deploy.sh test <previous-sha>`, restore = `pg_restore` from the `backups` volume). Run `update-kb` for the whole phase; set Phase 1 status `done` only after Step 6.
- [ ] **Step 6: Done-when walkthrough with the owner** (`superpowers:verification-before-completion`): HTTPS page opens; DB OK and realtime connected; SK/EN switch persists; looks like egrant.sk (owner judges); installs as an app on phone and desktop; a trivial push to `main` redeploys automatically.
- [ ] **Step 7:** Commit `docs: runbooks and phase 1 completion`, push.
