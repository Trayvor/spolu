# eHub — Foundation Design (Phase 0 & Phase 1, plus target architecture)

Date: 2026-10-15 · Status: draft for approval

Product requirements live in `SPEC.md` (what the product must do). This document
decides **how** it is built and details the first two phases. Where this document
and the "Technical base" section of `SPEC.md` disagree, this document wins.

---

## 1. Intent

eHub replaces Microsoft Teams for communication between our company (admins) and
our clients (organizations using eGrant). Each client organization gets a group
with chat, task board, support tickets; admins additionally manage contracts.

The product is built and maintained **by one person working with AI agents**, for
years. That single fact drives most decisions below:

- the stack must be something AI agents write reliably without hand-holding;
- as few moving parts to operate as possible;
- strong typing and automated tests catch regressions instead of a human reviewer;
- a knowledge base keeps context across AI sessions and lets the owner understand
  the architecture without reading code.

The product launches to clients only when **all** phases are done. Phases exist to
build incrementally, each ending in something deployed and manually checkable.

## 2. Goals, non-goals, anti-goals

**Goals**
- Target architecture that all later phases (chat, DMs, tasks, tickets, contracts,
  notifications, AI) fit into without rework.
- Phase 0: AI workflow and knowledge base in place before any product code.
- Phase 1: walking skeleton deployed via CI/CD to the test server over HTTPS.

**Non-goals**
- Horizontal scaling. One server handles tens of client organizations easily.
- Calls / video calls (out of scope for the whole product).
- Inventing our own visual identity — the look is copied from egrant.sk (see section 4a).

**Anti-goals (would be a failure even if it "works")**
- CI/CD logic locked into GitHub Actions YAML (migration to GitLab + Jenkins planned).
- Knowledge base that drifts from code or is unreadable for the owner.
- Client data stored outside our own infrastructure (no SaaS databases/storage).

## 3. Constraints

- **Language:** everything in English — code, comments, docs, commit messages.
  UI is translated (SK, EN).
- **Hosting:** self-hosted only. Test server: Oracle Cloud Free Tier VM, clean
  (nothing installed), likely ARM (Ampere), temporary domain available.
- **Code hosting / CI:** GitHub + GitHub Actions now; later GitLab + Jenkins on a
  different server.
- **Email:** Elastic Email (existing account) in production.
- **Owner's local machine:** macOS, Node 26, Docker installed, pnpm not installed yet.

## 4. Technology decisions

| Area | Choice | Why |
|---|---|---|
| Repo | One git repo, pnpm workspaces: `apps/web`, `apps/server`, `packages/shared` | Shared zod schemas/types between client and server; one place for docs. |
| Language | TypeScript everywhere, `strict` | Best-known stack for AI agents; compiler catches cross-boundary breaks. |
| Backend | Node.js LTS + Fastify | Mature, fast, good plugin model, well known. |
| DB | PostgreSQL 17 | Single source of truth, also hosts the job queue. |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL migrations committed) | Close to SQL, typed, lightweight. |
| Validation | zod (schemas in `packages/shared`) | Same schemas validate API input and forms. |
| Auth | better-auth with email-OTP plugin, DB sessions in httpOnly cookie, long-lived (e.g. 60 days, sliding) | Avoid hand-rolled auth; OTP + sessions out of the box. Roles are ours (see 6). |
| Realtime | Socket.IO, single instance, no Redis adapter | Rooms per group/conversation; reconnection built in. |
| Missed-message catch-up | Every message has a per-channel increasing `seq`; on reconnect client sends last seen `seq`, server returns the rest | Simple, reliable, no event log needed. |
| Jobs / cron | pg-boss (queue in Postgres) | Retries for email/push, scheduled contract reminders; no Redis to operate. |
| Files | Local disk volume behind a `Storage` interface (put/get/delete/signed URL); thumbnails via sharp | No MinIO to operate now; switch to S3-compatible later by swapping the implementation. |
| Email | Elastic Email HTTP API behind an `EmailSender` interface, chosen by `EMAIL_DRIVER=elastic|smtp`. Local dev and automated tests use Mailpit (SMTP). **Every deployed environment, including the Oracle test server, sends real mail via Elastic Email** (needed so login codes arrive). | Dev/test never send real mail; tests read OTP codes from Mailpit. Sender address/domain is provided by the owner at the start of Phase 2. |
| Frontend | React + Vite + TypeScript, TanStack Router, TanStack Query | Typed routing, server-state caching. |
| UI kit | Tailwind CSS + shadcn/ui | Owned components, AI-friendly. |
| i18n | react-i18next, SK + EN, language switcher, keys in `apps/web/src/locales/{sk,en}.json` | — |
| PWA | vite-plugin-pwa (manifest, icons, service worker; push added in a later phase) | Installable on phone and desktop. |
| Tests | Vitest (unit + API integration against real Postgres in Docker), Playwright (end-to-end flows) | Primary safety net against AI regressions. |
| Lint/format | ESLint + Prettier, `tsc --noEmit` in CI | — |
| Deploy | Docker Compose: `app` (serves API, WebSocket and built web), `postgres`, `caddy` (auto HTTPS) | Three containers total. |
| LLM (later phase) | Claude API behind an `LlmClient` interface | Decided in that phase; interface keeps it swappable. |

Explicitly **dropped** from the original spec: Redis, BullMQ, MinIO (not needed at
this scale; each can be introduced later behind the existing interfaces).

## 4a. Visual design

- **eHub must look like https://egrant.sk** — our company website. Colors, typography,
  spacing, buttons, form controls, cards, icons style, logo usage: replicate that
  design, adapted to an app (chat, boards, lists) where the website has no equivalent.
- **All design work goes through the `frontend-design` plugin skill — mandatory.**
  This covers scraping/analysing egrant.sk, extracting design tokens, copying its
  components, and drawing/building any new screen or component. No UI is designed
  or restyled without invoking it first. This rule goes into `CLAUDE.md` and the
  `implement-phase` / `new-module` skills.
- The plugin is enabled in the project's `.claude/settings.json`
  (`frontend-design@claude-plugins-official`) so every session has it.
- The extracted design lives in code as Tailwind theme tokens + shadcn/ui theme
  (CSS variables), and in docs as `docs/design/` (see Phase 0/1).

## 5. Architecture

```
Browser / installed PWA
   │  HTTPS + WSS
Caddy (TLS, reverse proxy)
   │
app container (Node)
   ├─ Fastify HTTP API  (/api/...)
   ├─ Socket.IO          (/socket.io)
   ├─ static web build   (/)
   ├─ pg-boss workers    (email, later push/reminders)
   └─ Storage → /data/files volume
   │
PostgreSQL (data + job queue)
```

One Node process runs API, realtime, and workers. Splitting workers into a
separate container later is a config change, not a rewrite.

**Server code layout — modules by feature:**
```
apps/server/src/
  modules/
    auth/        users/       groups/      chat/
    (later) dm/  tasks/       tickets/     contracts/   notifications/
  infra/  db/ email/ storage/ jobs/ realtime/ config/
```
Each module owns its routes, service logic, DB tables, socket events and tests.
Modules talk to each other through exported service functions, never by reaching
into another module's tables.

**Permissions** are enforced server-side in one place per module (a policy
function like `canReadGroup(user, groupId)`), used by both HTTP routes and socket
room joins. The client hides UI but never is trusted.

**Realtime pattern:** a write goes through the HTTP API (validation, permissions,
DB transaction), then the server emits an event to the relevant room. Sockets are
read-only push channels; this keeps one write path to test.

## 6. Domain model (target, all phases)

Sketch for later phases; only Phase 1–3 tables are created early, the rest when
their phase comes. Fields are indicative, not final.

- **User** — id, email (unique), name?, avatar?, locale, role: `superadmin | admin | client`, createdAt.
  Superadmin is created on first start from `SUPERADMIN_EMAIL`, cannot be deleted or demoted.
- **Group** — id, name, logoFileId?, egrantUrl, egrantUrlNormalized (unique-ish index), inviteToken.
- **GroupMember** — groupId, userId. Clients belong to exactly one group; admins see all groups without membership rows.
- **Channel** — id, kind: `group | dm | task`, groupId? / taskId?. One abstraction for group chat, DMs and task chat, so threads/mentions/attachments/unread are built once.
- **Message** — id, channelId, seq, authorId, body, parentMessageId? (thread), editedAt?, deletedAt?, convertedToTaskId?.
- **Mention**, **Attachment** (fileId linked to message/task/contract/ticket), **File** (storage key, mime, size, thumbnail key).
- **ReadState** — userId, channelId, lastReadSeq (drives unread counts).
- **Bucket**, **Task** (title, description, assigneeId, dueDate, priority, labels, position, sourceMessageId?).
- **Ticket**, **TicketReply** — status `new | in_progress | resolved`, groupId nullable.
- **Contract** — groupId, from, to, amount, notes, reminderDaysBefore, draftOfId?.
- **NotificationPref** — per user per group: `all | mentions | none`; profile: push on, email off by default.
- **ApiKey** — for eGrant ticket ingestion.

## 7. Phase plan (revised)

The original roadmap's Phase 1 is split into five smaller phases. Later phases keep
the original order.

| # | Phase | Done when |
|---|---|---|
| 0 | AI workflow & knowledge base | `docs/`, `CLAUDE.md`, project skills, hooks exist; no product code |
| 1 | Skeleton & delivery | monorepo, CI/CD, deploy to Oracle over HTTPS, installable PWA shell, SK/EN switcher works |
| 2 | Login & users | superadmin logs in by email code and creates another admin who can log in |
| 3 | Groups & invites | admin creates group with logo, copies invite; client registers by email, sees only their group; admin can remove client |
| 4 | Group chat: core | realtime messages, catch-up after reconnect, edit/delete own, unread indicator |
| 5 | Chat: threads, mentions, files | thread replies, @mentions, attachments with image previews |
| 6 | Notifications | (original phase 2) |
| 7 | Direct messages | (original phase 3) |
| 8 | Task board: core | (original phase 4) |
| 9 | Task attachments & task chat | (original phase 5) |
| 10 | Message → task | (original phase 6) |
| 11 | AI split into tasks | (original phase 7) |
| 12 | Tickets: intake from eGrant | (original phase 8) |
| 13 | Tickets: replies | (original phase 9) |
| 14 | Contracts | (original phase 10) |
| 15 | Contract reminders | (original phase 11) |
| 16 | Password & polish | (original phase 12) |

`ROADMAP.md` is replaced by `docs/roadmap.md` with this table and status per phase.
Each phase after 1 gets its own short design/plan when it starts.

## 8. Phase 0 — AI workflow & knowledge base

**Deliverables**

1. `git init`, `.gitignore`, GitHub repository (private) created and pushed.
2. `docs/` knowledge base — written for AI agents first, readable by the owner:
   short documents, plain English, Mermaid diagrams.
   - `docs/README.md` — map: what lives where, reading order.
   - `docs/product/` — one file per module, translated to English from `SPEC.md`
     **and** the requirement-level details that exist only in `ROADMAP.md` (thread-reply
     notifications, admin notification on new ticket, "converted to task" marker,
     message search, profile name/avatar/language, error monitoring, superadmin rules).
     Both `SPEC.md` and `ROADMAP.md` are removed afterwards; `docs/product/` is the
     source of truth for requirements.
   - `docs/architecture/overview.md` — the diagram and layering from section 5.
   - `docs/architecture/data-model.md` — entities and relations (Mermaid ER), marked
     "planned" vs "implemented".
   - `docs/architecture/realtime.md`, `docs/architecture/permissions.md`.
   - `docs/decisions/NNNN-title.md` — ADRs; seed with the decisions in section 4
     (stack, Postgres queue instead of Redis, disk storage behind interface,
     scripts-first CI, single process).
   - `docs/runbooks/` — placeholders filled in Phase 1 (server setup, deploy, rollback, backup).
   - `docs/roadmap.md` — section 7 table with status, each phase keeping its scope
     bullets and "done when" from `ROADMAP.md`.
   - `docs/glossary.md`.
   - `docs/design/README.md` — the design rule (egrant.sk look, `frontend-design`
     mandatory) and where tokens live; filled with actual tokens in Phase 1.
3. `CLAUDE.md` at repo root — short: project purpose, rules, commands, pointers into
   `docs/`. No duplication of docs content. Rules include:
   - English everywhere;
   - test-first for server logic and permission rules;
   - every change updates affected docs in the same commit;
   - permissions checked server-side via module policy functions;
   - CI logic lives in `scripts/`, never only in CI YAML;
   - UI must replicate egrant.sk; any design work (scraping, copying, drawing,
     restyling) must invoke the `frontend-design` skill first.
4. Project skills in `.claude/skills/`. They **build on the superpowers plugin**
   (enabled in the project's `.claude/settings.json`, so every fresh session has it):
   brainstorming, writing-plans, TDD, code review come from superpowers; project
   skills add eHub-specific steps. Per-phase designs and plans live in
   `docs/superpowers/specs/` and `docs/superpowers/plans/`, linked from `docs/roadmap.md`.
   - `update-kb` — after a change: find affected docs (product, architecture,
     data model, runbooks, roadmap status), update them, add an ADR if a decision was made.
   - `new-module` — how to add a server module + web feature: folders, policy,
     tests, socket events, docs page.
   - `implement-phase` — full cycle for a phase: design → plan → TDD implementation →
     `update-kb` → verification (tests, deploy, manual check list) → roadmap status.
5. `.claude/settings.json`: enable `frontend-design@claude-plugins-official` next to superpowers.
   Hooks in `.claude/settings.json`:
   - Stop hook: if files under `apps/` or `packages/` changed in the working tree
     but nothing under `docs/` did, return a reminder to run `update-kb`.
6. A matching CI check script (`scripts/check-docs.sh`) — warns (not fails) when a
   PR changes code without touching `docs/`. Script lands in Phase 0, wired into CI in Phase 1.

**Done when:** a fresh AI session, given only the repo, can explain the architecture
and the next phase from `docs/`, and the owner can read `docs/README.md` →
`architecture/overview.md` and understand the system.

## 9. Phase 1 — Skeleton & delivery

**Deliverables**

1. Monorepo: pnpm workspaces, root `package.json` scripts (`dev`, `build`, `test`,
   `lint`, `typecheck`), shared TS config, ESLint, Prettier.
2. `packages/shared` with zod and one example schema used by both sides.
3. `apps/server`: Fastify app with
   - config loaded and validated from env (zod) — fails fast on missing vars;
   - Drizzle connected, migration runner on startup, one initial migration;
   - `GET /api/health` (checks DB) ;
   - Socket.IO attached, with a trivial `ping`/`pong` to prove WSS works through Caddy;
   - pg-boss started;
   - `EmailSender` (Elastic Email + Mailpit/SMTP implementations) and `Storage`
     (disk) interfaces with tests — not yet used by features;
   - serves the built web app.
4. Design extraction (via `frontend-design`): analyse egrant.sk, capture its palette,
   fonts, radii, shadows, spacing, button/input/card styles and logo usage into
   Tailwind/shadcn theme tokens and `docs/design/` (tokens + screenshots/notes).
5. `apps/web`: Vite + React + TanStack Router/Query + Tailwind + shadcn/ui,
   i18n SK/EN with switcher (choice persisted), PWA manifest + icons + service worker,
   a shell page showing server health and live socket status, styled with the
   egrant.sk tokens (app header, language switcher, a card) so the look is
   verified from day one.
6. Local development: `docker-compose.dev.yml` with Postgres and Mailpit;
   `pnpm dev` runs server and web with hot reload.
7. Tests: Vitest for server (health, config, storage, email sender), Playwright
   smoke test (page loads, language switch, health shows OK).
8. Production: multi-stage `Dockerfile` producing one image for `linux/amd64` and
   `linux/arm64`; `docker-compose.prod.yml` (app, postgres, caddy) with volumes for
   DB, files, Caddy data; `.env.example` documenting every variable
   (`DOMAIN`, `DATABASE_URL`, `SUPERADMIN_EMAIL`, `ELASTIC_EMAIL_API_KEY`, `MAIL_FROM`, …).
9. Scripts (the real CI/CD logic, CI-agnostic):
   - `scripts/ci.sh` — install, lint, typecheck, unit/integration tests, e2e;
   - `scripts/build-image.sh` — multi-arch build and push to a registry;
   - `scripts/deploy.sh <env>` — over SSH: copy compose/env, `docker compose pull && up -d`, wait for health;
   - `scripts/server-setup.sh` — one-time on a fresh Ubuntu/Oracle Linux VM:
     Docker, iptables rules for 80/443, deploy user, directories.
   Environments: only one exists now (`test` = Oracle server), but scripts take the
   environment name and read `deploy/<env>.env` / per-env CI secrets, so adding
   `production` later is configuration, not a refactor. Images are tagged with the
   git SHA; promotion to another environment = deploying an existing tag.
10. GitHub Actions: thin workflow calling the scripts. On PR: `ci.sh`. On push to
   `main`: `ci.sh` → `build-image.sh` (push to GHCR) → `deploy.sh`. Secrets: SSH key,
   host, registry credentials, production `.env` values.
11. Runbooks filled in: server setup (including the Oracle Console Security List
    step for ports 80/443), deploy, rollback (redeploy previous image tag), DB backup
    (nightly `pg_dump` to a volume via cron in a container — simple version now,
    off-site backup in the polish phase).

**Done when:** a push to `main` deploys automatically; `https://<temp-domain>` opens
the shell over HTTPS, shows DB health OK and a live socket connection, switches
SK/EN, visibly matches the egrant.sk look, and can be installed as an app on
phone and desktop.

## 10. Left to the builder

- Exact library versions (latest stable at the time), folder names inside modules,
  lint rules, shadcn component selection.
- Layout of app-specific screens that egrant.sk has no counterpart for — designed
  in the egrant.sk style via `frontend-design` when each phase starts.
- Whether the owner's server runs Ubuntu or Oracle Linux — `server-setup.sh` should
  detect or document both; ask the owner at the start of Phase 1 for SSH access details.
- Session duration specifics, as long as the session is long-lived and sliding.
