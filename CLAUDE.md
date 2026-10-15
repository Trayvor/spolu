# eHub

eHub is the eGrant team's internal web app for client communication: group chat, direct messages, task boards, support tickets and contracts.
It replaces Microsoft Teams. TypeScript monorepo (Fastify + PostgreSQL + Socket.IO server, React PWA client), self-hosted.

## Read first

- [docs/README.md](docs/README.md) — map of the knowledge base and reading order.
- [docs/roadmap.md](docs/roadmap.md) — phases, their status and what comes next.

The docs are the source of truth. This file only holds rules and pointers; do not copy docs content here.

## Rules

- English everywhere: code, comments, docs, commit messages. The UI is translated (SK, EN).
- Test-first for server logic and permission rules (`superpowers:test-driven-development`).
- Every change updates the affected docs in the same commit (`update-kb` skill).
- Permissions are checked server-side, only through each module's policy functions; the client is never trusted. See [docs/architecture/permissions.md](docs/architecture/permissions.md).
- Writes go through the HTTP API; sockets only push events after a successful write. See [docs/architecture/realtime.md](docs/architecture/realtime.md).
- Modules talk through exported service functions, never by touching another module's tables.
- CI logic lives in `scripts/`, never only in CI YAML. CI YAML only calls scripts.
- A new dependency or a changed technical approach needs an ADR in [docs/decisions/](docs/decisions/README.md).
- The UI replicates the design of https://egrant.sk. Any design work — scraping or analysing egrant.sk, copying its components, drawing or restyling any screen — MUST start by invoking the `frontend-design` skill.
  The skill's full name is `frontend-design:frontend-design`. See [docs/design/README.md](docs/design/README.md).

## Workflow

- Start any phase with the `implement-phase` skill.
- Add a server module or web feature with the `new-module` skill.
- After any change run `update-kb`, before committing.
- Specs go to `docs/superpowers/specs/`, plans to `docs/superpowers/plans/`; both are linked from `docs/roadmap.md`.

## Commands

Filled in Phase 1.

## Where things live

- `docs/` — knowledge base: product requirements, architecture, ADRs, design, runbooks, roadmap, glossary.
- `.claude/` — project settings, hooks and skills (`.claude/skills/<name>/SKILL.md`).
- `apps/` — `server` (Fastify API, Socket.IO, jobs) and `web` (React PWA). Arrives in Phase 1.
- `packages/` — `shared` (zod schemas and types used by server and web). Arrives in Phase 1.
- `scripts/` — shell scripts that hold all CI/CD logic; CI only calls them. Starts with `check-docs.sh` (Phase 0).
- `deploy/` — Docker Compose, Caddyfile and env examples for servers. Arrives in Phase 1.
- `e2e/` — Playwright end-to-end tests. Arrives in Phase 1.
