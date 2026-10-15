# Roadmap

17 phases (0-16). Each phase ends with something that works and can be used. Update the `Status` column when a phase starts or finishes (values: `planned`, `in progress`, `done (local)`, `done`, `merged into N`). The `implement-phase` and `update-kb` skills do this.

Requirements per module: [product/](product/README.md). Phases after 1 get their own short design and plan when they start.

| # | Phase | Status | Depends on | Design/plan |
|---|---|---|---|---|
| 0 | [AI workflow & knowledge base](#phase-0--ai-workflow--knowledge-base) | done | - | [spec](superpowers/specs/2026-10-15-ehub-foundation-design.md), [plan](superpowers/plans/2026-10-15-phase-0-ai-workflow-and-kb.md) |
| 1 | [Skeleton & delivery](#phase-1--skeleton--delivery) | done (local) | 0 | [spec](superpowers/specs/2026-10-15-ehub-foundation-design.md), [plan](superpowers/plans/2026-10-15-phase-1-skeleton-and-delivery.md) |
| 2 | [Login & users](#phase-2--login--users) | done (local) | 1 | [spec](superpowers/specs/2026-10-15-phase-2-login-and-users-design.md), [plan](superpowers/plans/2026-10-15-phase-2-login-and-users.md) |
| 3 | [Groups & invites](#phase-3--groups--invites) | done (local) | 2 | [spec](superpowers/specs/2026-10-15-phase-3-groups-and-invites-design.md), [plan](superpowers/plans/2026-10-15-phase-3-groups-and-invites.md) |
| 4 | [Shared foundation](#phase-4--shared-foundation) | done (local) | 3 | [spec](superpowers/specs/2026-10-15-phase-4-shared-foundation-design.md), [plan](superpowers/plans/2026-10-15-phase-4-shared-foundation.md) |
| 5 | [Group chat](#phase-5--group-chat) | done (local) | 4 | [spec](superpowers/specs/2026-10-15-phase-5-group-chat-design.md), [plan](superpowers/plans/2026-10-15-phase-5-group-chat.md) |
| 6 | [Notifications](#phase-6--notifications) | in progress | 9 | [spec](superpowers/specs/2026-10-16-phase-6-notifications-design.md), [plan](superpowers/plans/2026-10-16-phase-6-notifications.md) |
| 7 | [Direct messages](#phase-7--direct-messages) | planned | 5, 6 | - |
| 8 | [Task board](#phase-8--task-board) | done (local) | 4 | [spec](superpowers/specs/2026-10-15-phase-8-task-board-design.md), [plan](superpowers/plans/2026-10-15-phase-8-task-board.md) |
| 9 | [Task chat & message to tasks with AI](#phase-9--task-chat--message-to-tasks-with-ai) | planned | 5, 8 | - |
| 10 | [Message to task](#phase-10--message-to-task) | merged into 9 | - | - |
| 11 | [AI split into tasks](#phase-11--ai-split-into-tasks) | merged into 9 | - | - |
| 12 | [Tickets: intake from eGrant](#phase-12--tickets-intake-from-egrant) | planned | 3, 6 | - |
| 13 | [Tickets: replies](#phase-13--tickets-replies) | planned | 12 | - |
| 14 | [Contracts](#phase-14--contracts) | planned | 3 | - |
| 15 | [Contract reminders](#phase-15--contract-reminders) | planned | 6, 14 | - |
| 16 | [Password & polish](#phase-16--password--polish) | planned | 5 | - |

Phases 8, 12 and 14 do not depend on each other, so their order can change by priority.

## Server deployment (deferred)

Owner decision (2026-10-15): build and verify locally first; deploy to the server later as one separate step.

- Until then each phase is verified on the local production-like stack (the `deploy/` compose run at https://localhost, see [runbooks/deploy.md](runbooks/deploy.md)), and its "Done when" is walked with the owner there. A phase verified this way is marked `done (local)`.
- The server step, when the owner is ready: Phase 1 Task 18 (first deploy to the Oracle test VM, GitHub `test` environment, runbooks, HSTS once the domain is final). It needs from the owner: the server, a domain and DNS record, `MAIL_FROM` verified in Elastic Email, `SUPERADMIN_EMAIL`, open ports 80/tcp, 443/tcp, 443/udp.
- Phase 1's code is complete; only its Task 18 belongs to the server step, so Phase 2 proceeds on top of it (branch `phase-2` from `phase-1`). Phases 1–3 were walked by the owner on the local stack on 2026-10-15 and are `done (local)`.
- After that step, every phase marked `done (local)` gets its "Done when" walked again on the test server and becomes `done`.

## Phase 0 — AI workflow & knowledge base

Scope:
- Git repository, `.gitignore`, private GitHub repo.
- `docs/` knowledge base: product requirements, architecture, ADRs, runbook stubs, roadmap, glossary, design rule.
- Root `CLAUDE.md` and project skills (`update-kb`, `new-module`, `implement-phase`).
- `.claude/settings.json` with the `frontend-design` plugin and a Stop hook reminding to update docs.
- `scripts/check-docs.sh` (warns when code changes without docs).

Done when: a fresh AI session, given only the repo, can explain the architecture and the next phase from `docs/`; the owner can read `docs/README.md` then `architecture/overview.md` and understand the system. No product code.

## Phase 1 — Skeleton & delivery

Scope:
- Monorepo (pnpm workspaces), shared TS config, lint, format, `packages/shared` with zod.
- `apps/server`: Fastify, validated config, Drizzle + migrations, `GET /api/health`, Socket.IO ping/pong, pg-boss, `EmailSender` and `Storage` interfaces.
- Design extraction from egrant.sk via `frontend-design` into theme tokens and `docs/design/`.
- `apps/web`: Vite, React, TanStack Router/Query, Tailwind, shadcn/ui, SK/EN switcher, PWA shell.
- Local dev with Docker Compose (Postgres, Mailpit); tests (Vitest, Playwright smoke).
- Production: multi-arch Dockerfile, `deploy/docker-compose.yml` (app, postgres, caddy + backup with nightly `pg_dump`), `deploy/Caddyfile`, `deploy/test.env.example`.
- Scripts (`ci.sh`, `build-image.sh`, `deploy.sh`, `server-setup.sh`) and a thin GitHub Actions workflow.
- Runbooks filled in (server setup, deploy, rollback, backup).

Done when: a push to `main` deploys automatically; the HTTPS shell shows DB health OK and a live socket connection, switches SK/EN, visibly matches the egrant.sk look, and can be installed as an app on phone and desktop.

## Phase 2 — Login & users

Requirements: [auth](product/auth.md), [roles-and-access](product/roles-and-access.md).

Scope:
- Module wiring: one dependencies object (db, io, email, storage, jobs) passed to every module's routes, Socket.IO attached inside `buildApp`; rewrite the `new-module` skill against `modules/users` and `features/admins` (route registration in `app.ts` under `/api`, shared re-export, lazy route in `router.tsx`, en/sk keys, test DB isolation pattern); e2e gets its own database `spolu_e2e`; socket origin check + auth.
- Hardening carried over from Phase 1: Elastic sender timeout + `EmailSendError` wrapping; Fastify `trustProxy`; `dotfiles: 'deny'` for static; `GET /api` (no slash) returns a JSON 404; `ApiError` carries the error body; pg-boss `stop` timeout below the compose grace period.
- Superadmin created on first start (email from `SUPERADMIN_EMAIL`); cannot be deleted or demoted.
- Login by one-time email code (Elastic Email), long-lived session.
- Superadmin creates other admins by email.

Done when: the superadmin logs in by email code and creates another admin who can log in.

## Phase 3 — Groups & invites

Requirements: [groups](product/groups.md), [auth](product/auth.md), [roles-and-access](product/roles-and-access.md).

Scope:
- Admin creates and edits a group: name, logo, client's eGrant URL; list of all groups.
- Invite link: client enters email, gets a code, joins the group.
- Member list; admin can remove a client.
- Client sees only their group; admin sees all.

- Carried over from Phase 2 (delivered in this phase): socket `server_error` reconnect with backoff; re-check the socket's session (disconnect a session's sockets on sign-out, re-check disabled after join); periodic cleanup of expired `verification` rows (pg-boss cron); e2e login rate-limit headroom (reuse storage state per role); DB CHECK constraints for `user.role` and lower-case `user.email`.
- Storage hardening (delivered in this phase): strict signature hex, sidecar atomicity, `/files` in the service worker `navigateFallbackDenylist`, signature not logged, files volume in the backup.

Done when: an admin creates a group with a logo and copies the invite; a client registers by email and sees only their group; the admin can remove the client.

## Order of Phases 4–9 (owner decision, 2026-10-15)

Phase 4 lays the shared base. Then Phases 5 (chat) and 8 (task board) are built **in parallel** on separate branches, both cut from Phase 4, and merged one after the other (the second regenerates its database migration). Phase 9 joins them. Phase 6 (notifications) comes last: Phases 5, 8 and 9 only record notification events, Phase 6 delivers them. The owner's brief for this block is in [task-board](product/task-board.md), [chat](product/chat.md) and [ai-task-split](product/ai-task-split.md).

## Phase 4 — Shared foundation

Requirements: [chat](product/chat.md), [task-board](product/task-board.md), [notifications](product/notifications.md).

Scope:
- Files module: upload a file into a group, download it with the group's permission check, image previews made in the browser, cleanup of files never attached.
- Notification events: one table where any module records "this user should hear about this"; nothing is delivered yet (Phase 6).
- Group rooms for admins: an admin's socket joins the room of the group they open.
- Group page tabs: Chat, Tasks, Members (Chat and Tasks are empty until Phases 5 and 8).

Done when: on the group page an admin and a client switch between the three tabs; a file uploaded through the test endpoint can be downloaded by group members only.

## Phase 5 — Group chat

Requirements: [chat](product/chat.md).

Scope:
- One chat per group, built as a reusable conversation (the task chat in Phase 9 is the same component).
- Realtime messages, catch-up after reconnect, edit and delete own messages, unread indicator.
- Message formatting; threads under messages with quoted replies inside a thread; @mentions of people and @all; attachments with image previews; opening a message by link.
- Message actions: "Reply in thread" and a slot for "Turn into tasks" (filled in Phase 9).

Done when: an admin and a client chat in real time with thread replies, mentions and files, without reloading the page, and see unread counts.

## Phase 6 — Notifications

Requirements: [notifications](product/notifications.md), [profile](product/profile.md).

Scope:
- Delivers the notification events recorded by Phases 5, 8 and 9.
- Web Push (PWA) on phone and desktop.
- Per group, the user picks a mode: all / mentions only / nothing.
- In the profile: push on by default, email can be turned on additionally.
- Notifications about replies in threads the user took part in.
- Task notifications: when a task moves to another bucket, its creator and assignees are notified (not the person who moved it); the assignees are reminded 3, 2 and 1 days before the deadline at 09:00 (Europe/Bratislava) while the task is not in Completed; an urgent task reminds its assignees every 3 hours between 08:00 and 20:00 (Europe/Bratislava) until it is in Completed or no longer urgent.
- Notifications from the task chat, with the same modes as the group chat.

Done when: a client gets a push about a new message according to their mode, and with email on, also an email; moving a task notifies its creator and assignee; a deadline reminder arrives.

## Phase 7 — Direct messages

Requirements: [direct-messages](product/direct-messages.md).

Scope:
- One-to-one chats.
- An admin can write to anyone. A client can write to admins and people from their own organization.
- Built on the conversation component of Phase 5; notifications from Phase 6.

Done when: a client writes to an admin and to a colleague from their organization, and does not see people from other organizations.

## Phase 8 — Task board

Requirements: [task-board](product/task-board.md).

Scope:
- A task board in every group with four fixed buckets (To do, eGrant review, <client> review, Completed) and custom buckets between them (admins only).
- Tasks: create, edit, delete. Fields: title, description, creator, assignees (one or more), deadline, urgent flag, attachments; a link to the source message when made from chat.
- Drag and drop of tasks between buckets and inside a bucket.
- Realtime: other users' changes appear at once.
- Clients create, edit and move tasks.

Done when: an admin and a client work on the board at the same time and see each other's changes live.

## Phase 9 — Task chat & message to tasks with AI

Requirements: [task-board](product/task-board.md), [chat](product/chat.md), [ai-task-split](product/ai-task-split.md), [integrations](product/integrations.md).

Scope:
- Task chat: the group chat's conversation component inside each task (threads, mentions, @all, files).
- Message action "Turn into tasks": the AI (OpenAI API) proposes one or more task cards from the message; the user edits each card in the full task form, approves or rejects each; approved cards go to To do.
- The source message is marked with links to the tasks created from it.

Done when: a message describing 5 jobs becomes 5 cards after the user reviews them, the message shows links to them, and each task has its own chat.

## Phase 10 — Message to task

Merged into [Phase 9](#phase-9--task-chat--message-to-tasks-with-ai) (owner decision, 2026-10-15): every conversion goes through the AI, which may return a single card.

## Phase 11 — AI split into tasks

Merged into [Phase 9](#phase-9--task-chat--message-to-tasks-with-ai).

## Phase 12 — Tickets: intake from eGrant

Requirements: [tickets](product/tickets.md), [integrations](product/integrations.md).

Scope:
- API endpoint for eGrant, authenticated by API key.
- Request fields: `subject`, `thematic_area`, `body`, `email`, `client_url`. All required; invalid requests are rejected.
- URL normalization and group lookup.
- A ticket without a group is still saved.
- Statuses: New / In progress / Resolved.
- Global ticket list for admins with filters (group, status, date, "no group").
- Manual assignment of a ticket to a group.
- "Technical support" section in the group (visible to the client too).
- Admins are notified about a new ticket.

Done when: eGrant sends an error and the ticket appears in the right group, or in the global list as "no group".

## Phase 13 — Tickets: replies

Requirements: [tickets](product/tickets.md).

Scope:
- An admin replies to a ticket from the UI.
- The reply is stored in the ticket (visible in Spolu).
- Email via Elastic Email to the client (email from the ticket) with the manager in copy, so "Reply all" reaches the manager.

Done when: the client receives an email with the reply and the conversation is visible in the ticket.

## Phase 14 — Contracts

Requirements: [contracts](product/contracts.md), [roles-and-access](product/roles-and-access.md).

Scope:
- "Contracts" module in a group, admins only. Clients do not see it at all.
- Contract: date from / to, amount, files, notes.
- Draft of the next contract with the same fields.
- Global contract list with sorting and filters.

Done when: an admin keeps the contracts of all clients and sees them in one list.

## Phase 15 — Contract reminders

Requirements: [contracts](product/contracts.md), [notifications](product/notifications.md).

Scope:
- Per contract: how many days before signing to remind.
- A background scheduler sends reminders to admins by push and email (per profile settings).
- The global list marks contracts that "expire soon" and need "communication".

Done when: on the set day the admins receive a reminder about the contract.

## Phase 16 — Password & polish

Requirements: [profile](product/profile.md), [auth](product/auth.md), [non-functional](product/non-functional.md).

Scope:
- Optional password in the profile as an alternative to code login.
- Profile: name, avatar, language.
- Search over group messages.
- Periodic cleanup of never-verified clients created by invite links (unverified users who never signed in, with their membership). Idea to consider: bind the invite token to the login code verification, so signing in proves which link the email came from.
- Database and file backups (including off-site), error monitoring. (A nightly DB backup exists since Phase 1; this adds off-site and file backups.)

Done when: the system is ready for the team to move fully from Teams.
