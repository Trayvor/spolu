# Spolu

Spolu is the eGrant team's internal web app for client communication: group chat, direct messages, task boards, support tickets and contracts.
It replaces Microsoft Teams. TypeScript monorepo (Fastify + PostgreSQL + Socket.IO server, React PWA client), self-hosted.

## Read first

- [docs/README.md](docs/README.md) — map of the knowledge base and reading order.
- [docs/roadmap.md](docs/roadmap.md) — phases, their status and what comes next.

The docs are the source of truth. This file only holds rules and pointers; do not copy docs content here.

## Rules

- English everywhere: code, comments, docs, commit messages. The UI is translated (SK, EN).
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
- Keep the system easy to extend: same module pattern everywhere, simple code over clever abstractions.

## Workflow

- Never push to `main` from a session: every push to `main` deploys to spolu.egrant.sk. Work on a branch and open a pull request; merging deploys it. Cloud sessions: see [docs/runbooks/cloud-sessions.md](docs/runbooks/cloud-sessions.md).
- Open owner briefs (work not yet specced) are in `docs/superpowers/briefs/`; read them before planning new work.

- Start any phase with the `implement-phase` skill.
- Add a server module or web feature with the `new-module` skill.
- After any change run `update-kb`, before committing.
- Specs go to `docs/superpowers/specs/`, plans to `docs/superpowers/plans/`; both are linked from `docs/roadmap.md`.

## Commands

One-time setup: `pnpm install`, `cp .env.example .env`, `pnpm exec playwright install chromium`.

- `docker compose -f docker-compose.dev.yml up -d --wait` — local PostgreSQL 17 (5432) and Mailpit (SMTP 1025). Server tests and e2e need it running.
- `pnpm dev` — server (:3000, reload, reads the root `.env`) and web (Vite on :5173, proxies `/api` and `/socket.io`) in parallel. Open http://localhost:5173.
- `pnpm test` — unit and integration tests (Vitest) in every package.
- `pnpm test:e2e` — Playwright e2e tests (Chromium) against a production-like run: builds all, starts `apps/server/dist/main.js` serving `apps/web/dist` on :3000, with its own database `spolu_e2e` (created automatically; the name comes from `DATABASE_URL` and must contain "e2e").
- `pnpm lint`, `pnpm typecheck`, `pnpm build` — checks and production build for every package.
- Mailpit UI (catches all dev email): http://localhost:8025.
- `pnpm --filter @spolu/web icons` — regenerate the PWA icons in `apps/web/public/icons/` from the egrant mark (commit the PNGs).
- `pnpm --filter @spolu/server db:generate` — generate a migration after changing a `schema.ts`.
- `bash scripts/ci.sh` — every CI check in one go (install, shellcheck, script tests, lint, typecheck, tests, e2e, docs check); needs Docker. Run it before pushing.
- `scripts/build-image.sh`, `scripts/deploy.sh`, `scripts/server-setup.sh` — build/push the image, deploy an env, prepare a server; see `docs/runbooks/`.
- `bash scripts/check-docs.sh <base-ref>` — warns when code changed without docs.
- `bash scripts/tests/check-docs.test.sh`, `bash scripts/tests/docs-reminder.test.sh` — tests for the docs scripts.

## Where things live

- `docs/` — knowledge base: product requirements, architecture, ADRs, design, runbooks, roadmap, glossary.
- `.claude/` — project settings, hooks and skills (`.claude/skills/<name>/SKILL.md`).
- `apps/web/src/locales/` — every UI string, as i18n keys; never hardcode UI text. `{en,sk}.json` hold the eager shell (header, menus, sign-in, errors); feature texts live in lazy namespaces `<name>/{en,sk}.json`, loaded with their routes (`withNamespaces` in `router.tsx`, see `src/i18n/namespaces.ts`).
- `apps/` — `server` (Fastify API, Socket.IO, jobs) and `web` (React + Vite PWA).
- `packages/` — `shared` (zod schemas and types used by server and web).
- `.env.example` — every environment variable with dev defaults; copy to `.env`.
- `scripts/` — shell scripts that hold all CI/CD logic (`ci.sh`, `build-image.sh`, `deploy.sh`, `server-setup.sh`, `check-docs.sh`, shared helpers in `lib.sh`); CI only calls them. Tests in `scripts/tests/`.
- `deploy/` — Docker Compose, Caddyfile, backup script and env examples for servers. The root `Dockerfile` builds the production image.
- `e2e/` — Playwright end-to-end tests; config in the root `playwright.config.ts`.
