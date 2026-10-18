# Spolu

Spolu is the code name of **Help by eGrant** (shown as "Help", at https://help.egrant.sk; the old spolu.egrant.sk redirects there): the eGrant team's internal web app for client communication — group chat, task boards, support tickets, knowledge base, bulk email, finance and projects (direct messages are planned).
Code, packages, databases and docs say Spolu; only what users see says Help ([ADR 0018](docs/decisions/0018-visible-name-help-and-domain-redirects.md)). TypeScript monorepo (Fastify + PostgreSQL + Socket.IO server, React PWA client), self-hosted.

## Read first

- [docs/README.md](docs/README.md) — map of the knowledge base and reading order.
- [docs/roadmap.md](docs/roadmap.md) — phases, their status and what comes next.

The docs are the source of truth. This file only holds rules and pointers; do not copy docs content here.

## Rules

- English everywhere: code, comments, docs, commit messages. The UI is translated into nine languages (sk, en, cs, sl, bg, et, it, hr, uk; [ADR 0019](docs/decisions/0019-nine-languages-and-one-email-design.md)): every new text goes into all nine locale files, server texts into all nine `apps/server/src/infra/i18n/<code>.ts`.
  Use the terms of [docs/design/wording.md](docs/design/wording.md) (one word per concept, per language).
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
- `pnpm test` — unit and integration tests (Vitest) in every package. Server tests use `TEST_DATABASE_URL` (default `postgres://spolu:spolu@localhost:5432/spolu_test`, created and migrated by `apps/server/test/setup-db.ts`) plus `<that name>_explain_<volume>` clones of the `spolu_tpl_*` template databases for the EXPLAIN checks ([ADR 0040](docs/decisions/0040-explain-volumes-from-template-databases.md)).
- `pnpm test:e2e [e2e/<name>.spec.ts]` — Playwright e2e tests (Chromium) against a production-like run: builds all, starts `apps/server/dist/main.js` serving `apps/web/dist` on `E2E_PORT` (default 3000), with its own database from `DATABASE_URL` (default `spolu_e2e`, created automatically; the name must contain "e2e").
- `pnpm lint`, `pnpm typecheck`, `pnpm build` — checks and production build for every package.
- Mailpit UI (catches all dev email): http://localhost:8025.
- `pnpm --filter @spolu/web icons` — regenerate the PWA icons in `apps/web/public/icons/` from the egrant mark (commit the PNGs).
- `pnpm --filter @spolu/server db:generate` — generate a migration after changing a `schema.ts`.
- `pnpm --filter @spolu/server vapid:generate` — a VAPID key pair for push (once per environment, see `docs/runbooks/deploy.md`).
- `bash scripts/ci.sh` — every CI check in one go (install, shellcheck, script tests, lint, typecheck, tests, e2e, docs check); needs Docker. It is the merge gate (GitHub runs no CI now). `--bench` (or `RUN_BENCH=1`) also runs the wall-clock benchmarks; off by default, use it on a quiet machine.
- `scripts/deploy-local.sh [--force-ref] [<env> [<sha>]]` — how test is deployed now (from the orchestrator's Mac, no GitHub or registry); see `docs/runbooks/deploy.md`, "Local deploy". For `build-image.sh`, `deploy.sh` and `server-setup.sh` see `docs/runbooks/`.
- `bash scripts/check-docs.sh <base-ref>` — warns when code changed without docs.
- `bash scripts/tests/<name>.test.sh` — tests of the scripts, `lib.sh` helpers and hooks (files in `scripts/tests/`); `ci.sh` runs them all.

## Tips for agents

- **Own test database per agent:** `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_<branch> pnpm test` (its `_explain_<volume>` clones are created and dropped by the explain run).
- **Shared machine:** cap Vitest, e.g. `pnpm --filter @spolu/server exec vitest run --maxWorkers 2 [file]`.
- **One e2e spec in isolation:** `E2E_PORT=<free port> DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_e2e_<branch> E2E_SUPERADMIN_EMAIL=admin-<branch>@example.com pnpm test:e2e e2e/<name>.spec.ts`. A bare `pnpm test:e2e` uses :3000 and `spolu_e2e`, and reuses any server already listening there.
- **`bash scripts/ci.sh` is parallel-safe:** each worktree gets its own databases, e2e port and superadmin, dropped at the end. Run it (or a full e2e run) only when told to.
- **Before pushing:** `rtk proxy pnpm exec prettier --check .` (ci.sh fails on format; fix with `pnpm exec prettier --write <files>`).
- **Plain `git` blocked by a hook:** use `/usr/bin/git`.
- **Migrations:** check the latest number on `origin/main` (`apps/server/src/infra/db/migrations/`) before generating. After a rebase brings in the same number, delete yours (SQL, `meta/` snapshot, journal entry) and run `db:generate` again.
- **Locales:** after a rebase, every new key must exist in all nine languages (the locale tests fail otherwise).
- **Leftover worktrees:** once your branch is pushed and its PR merged (or superseded by a rebased push), remove your worktree: `/usr/bin/git worktree remove <path>` (never `--force`: a refusal means uncommitted work, look first), then `git worktree prune`. Keep only the main checkout and the CI/deploy worktrees. Not while a `ci.sh` runs: mass removal slows the disk.
- **Leftover databases** (aborted runs, old branches) slow Postgres down; drop them with `docker exec spolu-postgres-1 psql -U spolu -d postgres -c "drop database if exists <name>"` (there is no local `psql`). The `spolu_tpl_*` EXPLAIN templates are reused by every run and prune themselves; to drop one by hand, `alter database <name> is_template false` first.
- RTK rewrites command output, Vitest's too; `rtk proxy <cmd>` gives the raw output.

## Where things live

- `docs/` — knowledge base: product requirements, architecture, ADRs, design, runbooks, integrations, roadmap, glossary.
- `.claude/` — project settings, hooks and skills (`.claude/skills/<name>/SKILL.md`; vendored third-party skills are listed in `.claude/skills/THIRD_PARTY.md`).
- `apps/web/src/locales/` — every UI string, as i18n keys; never hardcode UI text. `<code>.json` (nine languages) hold the eager shell (header, menus, errors); only sk and en are in the initial JS, the others load on use. Feature texts live in lazy namespaces `<name>/<code>.json`, loaded with their routes (`withNamespaces` in `router.tsx`, see `src/i18n/namespaces.ts`).
- `apps/` — `server` (Fastify API, Socket.IO, jobs) and `web` (React + Vite PWA).
- `packages/` — `shared` (zod schemas and types used by server and web).
- `.env.example` — every environment variable with dev defaults; copy to `.env`.
- `scripts/` — shell scripts that hold all CI/CD logic (`ci.sh`, `deploy-local.sh`, `build-image.sh`, `deploy.sh`, `server-setup.sh`, `check-docs.sh`, `cloud-session.sh` for the SessionStart hook, shared helpers in `lib.sh`); CI only calls them. Tests in `scripts/tests/`.
- `deploy/` — Docker Compose, Caddyfile, backup script and env examples for servers. The root `Dockerfile` builds the production image.
- `e2e/` — Playwright end-to-end tests; config in the root `playwright.config.ts`.
