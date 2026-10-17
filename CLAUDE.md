# Spolu

Spolu is the code name of **Help by eGrant** (shown as "Help", at https://help.egrant.sk; the old spolu.egrant.sk redirects there): the eGrant team's internal web app for client communication — group chat, task boards, support tickets, knowledge base, bulk email (direct messages and contracts are planned).
Code, packages, databases and docs say Spolu; only what users see says Help ([ADR 0018](docs/decisions/0018-visible-name-help-and-domain-redirects.md)). TypeScript monorepo (Fastify + PostgreSQL + Socket.IO server, React PWA client), self-hosted.

## Read first

- [docs/README.md](docs/README.md) — map of the knowledge base and reading order.
- [docs/roadmap.md](docs/roadmap.md) — phases, their status and what comes next.

The docs are the source of truth. This file only holds rules and pointers; do not copy docs content here.

## Rules

- English everywhere: code, comments, docs, commit messages. The UI is translated into nine languages (sk, en, cs, sl, bg, et, it, hr, uk; [ADR 0019](docs/decisions/0019-nine-languages-and-one-email-design.md)): every new text goes into all nine locale files, server texts into all nine `apps/server/src/infra/i18n/<code>.ts`.
- Test-first for server logic and permission rules (`test-driven-development`).
- Every change updates the affected docs in the same commit (`update-kb` skill).
- Permissions are checked server-side, only through each module's policy functions; the client is never trusted. See [docs/architecture/permissions.md](docs/architecture/permissions.md).
- Writes go through the HTTP API; sockets only push events after a successful write. See [docs/architecture/realtime.md](docs/architecture/realtime.md).
- Modules talk through exported service functions, never by touching another module's tables.
- CI logic lives in `scripts/`, never only in CI YAML. CI YAML only calls scripts.
- A new dependency or a changed technical approach needs an ADR in [docs/decisions/](docs/decisions/README.md).
- The UI replicates the design of https://egrant.sk. Any design work — scraping or analysing egrant.sk, copying its components, drawing or restyling any screen — MUST start by invoking the `frontend-design` skill.
  The skill lives in `.claude/skills/frontend-design/`. See [docs/design/README.md](docs/design/README.md).
- Performance is a top priority: lazy-loaded screens, small bundles, indexed queries, no N+1, paginated lists. No fancy visual effects. Readable code still comes first. See [docs/architecture/performance.md](docs/architecture/performance.md).
- The initial JS budget is 200 kB gzip and is practically full (measure it as in performance.md, "How to check"). New UI texts go into a lazy namespace, never into the eager `locales/<code>.json`; new code that every screen does not need goes into a lazy chunk.
- No wall-clock budgets in CI tests: use ratios, counts or opt-in benchmarks. See [docs/architecture/performance.md](docs/architecture/performance.md).
- Keep the system easy to extend: same module pattern everywhere, simple code over clever abstractions.

## Workflow

- Never push to `main`: `main` is what runs on help.egrant.sk. Work on a branch from a fresh `origin/main` and open a pull request. Since 2026-10-18 GitHub Actions run only by hand (minutes exhausted): the orchestrator merges after a green local `scripts/ci.sh` and deploys with `scripts/deploy-local.sh`. Cloud sessions: see [docs/runbooks/cloud-sessions.md](docs/runbooks/cloud-sessions.md).
- Owner briefs (work not yet specced) are in `docs/superpowers/briefs/`; each says at the top whether it is done.
- Start any phase with the `implement-phase` skill.
- Add a server module or web feature with the `new-module` skill.
- After any change run `update-kb`, before committing.
- Specs go to `docs/superpowers/specs/`, plans to `docs/superpowers/plans/`; both are linked from `docs/roadmap.md`.

## Commands

One-time setup: `pnpm install`, `cp .env.example .env`, `pnpm exec playwright install chromium`.

- `docker compose -f docker-compose.dev.yml up -d --wait` — local PostgreSQL 17 (5432, container `spolu-postgres-1`) and Mailpit (SMTP 1025). Server tests and e2e need it running.
- `pnpm dev` — server (:3000, reload, reads the root `.env`) and web (Vite on :5173, proxies `/api` and `/socket.io`) in parallel. Open http://localhost:5173.
- `pnpm test` — unit and integration tests (Vitest) in every package. Server tests use `TEST_DATABASE_URL` (default `postgres://spolu:spolu@localhost:5432/spolu_test`, created and migrated by `apps/server/test/setup-db.ts`) plus `<that name>_explain` for the EXPLAIN checks.
- `pnpm test:e2e` — Playwright e2e tests (Chromium) against a production-like run: builds all, starts `apps/server/dist/main.js` serving `apps/web/dist` on :3000, with its own database `spolu_e2e` (created automatically; the name comes from `DATABASE_URL` and must contain "e2e").
- `pnpm lint`, `pnpm typecheck`, `pnpm build` — checks and production build for every package.
- Mailpit UI (catches all dev email): http://localhost:8025.
- `pnpm --filter @spolu/web icons` — regenerate the PWA icons in `apps/web/public/icons/` from the egrant mark (commit the PNGs).
- `pnpm --filter @spolu/server db:generate` — generate a migration after changing a `schema.ts`.
- `pnpm --filter @spolu/server vapid:generate` — a VAPID key pair for push (once per environment, see `docs/runbooks/deploy.md`).
- `bash scripts/ci.sh` — every CI check in one go (install, shellcheck, script tests, lint, typecheck, tests, e2e, docs check); needs Docker. Run it before pushing. `--bench` (or `RUN_BENCH=1`) also runs the wall-clock benchmarks; off by default, use it on a quiet machine.
- `scripts/build-image.sh`, `scripts/deploy.sh`, `scripts/server-setup.sh` — build/push the image, deploy an env, prepare a server; see `docs/runbooks/`.
- `scripts/deploy-local.sh [--force-ref] [<env> [<sha>]]` — deploy test from the Mac without GitHub or a registry (build for the server's arch, `docker save | ssh docker load`); settings in `~/.config/spolu/<env>.deploy` (chmod 600), see `docs/runbooks/deploy.md`, "Local deploy".
- `bash scripts/check-docs.sh <base-ref>` — warns when code changed without docs.
- `bash scripts/tests/<name>.test.sh` — tests of the scripts and hooks (`check-docs`, `docs-reminder`, `deploy-env`, `deploy-local`, `caddy-redirects`, `cloud-session`, `run-parallel`, `ci-bench`, `limit-parallelism`, `isolate-run`); `ci.sh` runs them all.

## Tips for agents

- **Parallel agents** (several worktrees at once): `bash scripts/ci.sh` is safe to run from several worktrees at the same time: each run gets its own test databases (`spolu_test_ci_<id>`, `_explain`), e2e database (`spolu_e2e_<id>`), a free e2e port and its own e2e superadmin address (Mailpit and PostgreSQL are shared), and drops its databases at the end. The id comes from the worktree directory name. Plain `pnpm test` still needs its own database, e.g. `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_<branch> pnpm test`. Never run a bare `pnpm test:e2e` while another one runs (port 3000 and `spolu_e2e`); use `ci.sh`. Agents still run e2e or `ci.sh` only when told to.
- After an aborted `ci.sh` its `spolu_*_ci_*` and `spolu_e2e_*` databases may stay behind (the next run of the same worktree drops its own). After an aborted bare `pnpm test:e2e`, drop the e2e database: `docker exec spolu-postgres-1 psql -U spolu -d postgres -c "drop database if exists spolu_e2e"` (there is no local `psql`; use `docker exec`). Drop old `spolu_test_*` and `spolu_e2e_*` databases now and then the same way: dozens of them slow Postgres down.
- RTK (if installed) rewrites command output, Vitest's too; use `rtk proxy <cmd>` for the raw output.
- **Migrations:** before generating one, check the latest number on `origin/main` (`apps/server/src/infra/db/migrations/`). After a rebase that brings in a migration with the same number, delete yours (the SQL, its `meta/` snapshot and journal entry) and run `db:generate` again.
- **Locales:** a parallel branch that adds UI texts conflicts in the locale files; after the rebase make sure every new key exists in all nine languages (the locale tests fail otherwise).
- Assert behaviour, not wall time: timing-based tests flake on the loaded CI runner.

## Where things live

- `docs/` — knowledge base: product requirements, architecture, ADRs, design, runbooks, integrations, roadmap, glossary.
- `.claude/` — project settings, hooks and skills (`.claude/skills/<name>/SKILL.md`; vendored third-party skills are listed in `.claude/skills/THIRD_PARTY.md`).
- `apps/web/src/locales/` — every UI string, as i18n keys; never hardcode UI text. `<code>.json` (nine languages) hold the eager shell (header, menus, errors); only sk and en are in the initial JS, the others load on use. Feature texts live in lazy namespaces `<name>/<code>.json`, loaded with their routes (`withNamespaces` in `router.tsx`, see `src/i18n/namespaces.ts`).
- `apps/` — `server` (Fastify API, Socket.IO, jobs) and `web` (React + Vite PWA).
- `packages/` — `shared` (zod schemas and types used by server and web).
- `.env.example` — every environment variable with dev defaults; copy to `.env`.
- `scripts/` — shell scripts that hold all CI/CD logic (`ci.sh`, `build-image.sh`, `deploy.sh`, `server-setup.sh`, `check-docs.sh`, `cloud-session.sh` for the SessionStart hook, shared helpers in `lib.sh`); CI only calls them. Tests in `scripts/tests/`.
- `deploy/` — Docker Compose, Caddyfile, backup script and env examples for servers. The root `Dockerfile` builds the production image.
- `e2e/` — Playwright end-to-end tests; config in the root `playwright.config.ts`.
