# Roadmap

24 phases (0-23). Each phase ends with something that works and can be used. Update the `Status` column when a phase starts or finishes (values: `planned`, `in progress`, `done (local)`, `done`, `merged into N`). The `implement-phase` and `update-kb` skills do this.

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
| 9 | [Task chat & message to tasks with AI](#phase-9--task-chat--message-to-tasks-with-ai) | in progress | 5, 8 | [spec](superpowers/specs/2026-10-15-phase-9-task-chat-and-ai-design.md), [plan](superpowers/plans/2026-10-15-phase-9-task-chat-and-ai.md) |
| 10 | [Message to task](#phase-10--message-to-task) | merged into 9 | - | - |
| 11 | [AI split into tasks](#phase-11--ai-split-into-tasks) | merged into 9 | - | - |
| 12 | [Tickets: intake from eGrant](#phase-12--tickets-intake-from-egrant) | merged into 21 | - | - |
| 13 | [Tickets: replies](#phase-13--tickets-replies) | merged into 21 | - | - |
| 14 | [Contracts](#phase-14--contracts) | planned | 3 | - |
| 15 | [Contract reminders](#phase-15--contract-reminders) | planned | 6, 14 | - |
| 16 | [Password & polish](#phase-16--password--polish) | planned | 5 | - |
| 17 | [Knowledge base](#phase-17--knowledge-base) | in progress | 9, 6 | [spec](superpowers/specs/2026-10-16-phase-17-knowledge-base-design.md), [plan](superpowers/plans/2026-10-16-phase-17-knowledge-base.md) |
| 18 | [Client managers](#phase-18--client-managers) | in progress | 9, 6 | [spec](superpowers/specs/2026-10-16-phase-18-client-managers-design.md), [plan](superpowers/plans/2026-10-16-phase-18-client-managers.md) |
| 19 | [Task reminders](#phase-19--task-reminders) | in progress | 17 | [spec](superpowers/specs/2026-10-16-phase-19-task-reminders-design.md), [plan](superpowers/plans/2026-10-16-phase-19-task-reminders.md) |
| 20 | [Admin home](#phase-20--admin-home) | in progress | 17, 18 | [spec](superpowers/specs/2026-10-16-phase-20-admin-home-design.md), [plan](superpowers/plans/2026-10-16-phase-20-admin-home.md) |
| 21 | [Tickets & the ziadatel role](#phase-21--tickets--the-ziadatel-role) | in progress | 18, 20; item C for 21.6 | [spec](superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md), [plan](superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md) |
| 22 | [Members & groups page](#phase-22--members--groups-page) | in progress | 18, 20, 21.1 | [plan](superpowers/plans/2026-10-16-phase-22-members-and-groups-page.md) |
| 23 | [Bulk email](#phase-23--bulk-email) | in progress | 3, 18, 21.1 | [spec](superpowers/specs/2026-10-16-phase-23-bulk-email-design.md), [plan](superpowers/plans/2026-10-16-phase-23-bulk-email.md) |

Phases 8 and 14 do not depend on each other, so their order can change by priority.

**Next (owner brief, 2026-10-16):** [superpowers/briefs/2026-10-16-next-work.md](superpowers/briefs/2026-10-16-next-work.md). In order:
- A: the "only where I take part" filter on the global task board (done: a small change, no spec, agreed in the session; see [product/task-board.md](product/task-board.md));
- C: notification groups in the profile ([spec](superpowers/specs/2026-10-16-notification-groups-design.md), [plan](superpowers/plans/2026-10-16-notification-groups.md));
- B: the tickets module with the `ziadatel` role, which supersedes Phases 12–13: [Phase 21](#phase-21--tickets--the-ziadatel-role) ([spec](superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md), [plan](superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md)).

Each one needs a spec and a plan before code.

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
- Per group, the user picks a mode: All messages / Mentions and replies / Off (defaults: clients All messages, admins Mentions and replies).
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

Merged into [Phase 21](#phase-21--tickets--the-ziadatel-role) (owner brief, 2026-10-16). The original scope is kept below for reference.

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

Merged into [Phase 21](#phase-21--tickets--the-ziadatel-role): replies are written in the ticket chat and reach the requester through the ticket notification group, not as a direct email with the manager in copy.

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

## Phase 17 — Knowledge base

Requirements: [knowledge-base](product/knowledge-base.md), [reminders](product/reminders.md). Owner brief: [phases 17–20](superpowers/specs/2026-10-16-phases-17-20-brief.md).

Scope: a Knowledge tab in each group with notes, files, links and reminders (public or admins-only); an admin list of all knowledge across clients with client and type filters and search; a reminders module with several times, recipients, self-subscription and calendar export.

Done when: an admin and a client create each type, the client never sees admins-only items, a reminder arrives at its time and exports to a calendar, and the admin finds an item through the global search.

## Phase 18 — Client managers

Requirements: [client-managers](product/client-managers.md).

Scope: an admin becomes or stops being a client's manager; only clients and managers can be mentioned, assigned or reached by @all; becoming a manager turns that client's notifications to All.

Done when: an admin becomes manager of a client, is offered in its mention and assignee lists, gets all its messages; a non-manager admin still reads and writes but is not offered.

## Phase 19 — Task reminders

Requirements: [reminders](product/reminders.md), [task-board](product/task-board.md).

Scope: custom reminders on tasks with recipients and subscription, beside the automatic deadline and urgent reminders; calendar export of the deadline and reminders.

Done when: a task reminder arrives at its time for its recipients and the task exports to a calendar.

Status: built locally on branch `phase-19` (all tasks of the plan; unit, integration and web tests pass); the end-to-end test `e2e/task-reminders.spec.ts` is written but not yet run, and the owner walkthrough is pending.

## Phase 20 — Admin home

Requirements: [admin-home](product/admin-home.md).

Scope: the admin dashboard (assigned tasks, upcoming reminders, unread mentions), the client sidebar with unread and assigned counts, the yellow assigned count on the Tasks tab, and the global task board across clients.

Done when: an admin sees their tasks, reminders and mentions on the home page, opens each from there, and filters the global board by client.

## Phase 21 — Tickets & the ziadatel role

Requirements: [tickets](product/tickets.md), [roles-and-access](product/roles-and-access.md), [groups](product/groups.md). Owner brief: [item B](superpowers/briefs/2026-10-16-next-work.md). Supersedes Phases 12 and 13.

Scope: clients in several groups and a membership role (`client`, `ziadatel`); tickets from the eGrant API (Bearer key), from clients and from admins, assigned to a client by the instance link or by hand; statuses New / In progress / Resolved; a chat per ticket; following and notifications through the `tickets` notification group of item C; turning a ticket into tasks with AI; requesters who are not clients yet get a `ziadatel` membership that sees only their own tickets.

Built in 7 parts, one pull request each (21.1 memberships first; 21.3, 21.4 and 21.6 in parallel after 21.2; 21.6 also waits for item C). The plan holds a ready prompt per part.

Done when: eGrant sends a ticket, a new requester gets the email, logs in with a code and sees only that ticket and its chat; an admin replies and the requester is notified; the ticket becomes tasks that link back to it; a client works in two groups.

Status: part 21.1 (clients in several groups, membership roles, invites applied on sign-in) built on branch `phase-21-1-memberships`; part 21.2 (tickets server core) built on branch `phase-21-2-tickets-core`, stacked on 21.1; part 21.3 (ticket chat, server) on `phase-21-3-ticket-chat`, stacked on 21.2; part 21.4 (ticket screens: lists, ticket page with its chat, new-ticket dialog, requester shell, Requesters section, task line, ticket uploads) on `phase-21-4-tickets-web`, stacked on 21.3; part 21.6 (notifications) on its own branch; part 21.5 (ticket to tasks with AI) on `phase-21-5-ticket-tasks`; part 21.7 not started.

## Phase 22 — Members & groups page

Requirements: [groups](product/groups.md), [client-managers](product/client-managers.md). Owner decisions (2026-10-16) are in the [plan](superpowers/plans/2026-10-16-phase-22-members-and-groups-page.md), split into two parts.

**22a — managers and the Groups page** (built on branch `phase-22a-managers-groups-page`, stacked on `phase-21-3-ticket-chat`):
- The Members tab: admins add any active admin as the group's manager and remove any manager (`PUT`/`DELETE /api/groups/:id/managers/:userId`); the link to the Groups page is gone.
- The Groups page: the member count links to the Members tab, manager names in a tooltip, a filter by manager (`?manager=me|none|<adminId>`), my groups first, and a group count.
- The client filter's "Predvolené" sits in the filter row on Úlohy and Znalosti.

**22b — invites by email (built on branch `phase-22b-member-invites`, redesigned for Phase 21.1; e2e `member-invites.spec.ts` written, run by the orchestrator):** admins add members by email on the Members tab. A new or never-signed-in person gets an invitation with a login link (`/login?email=`) and shows as "Pozvaný" (resend, cancel) until the first sign-in; a client of another group is added at once and told by email. An admin's invite is a client membership created directly (no `pending_invites` row, no migration). Cancel deletes the membership, or turns a former requester back to ziadatel. The owner confirmed the plan's Part 22b decisions.

Done when: (22a) an admin adds a manager on the Members tab and the Groups page filters by manager with the count; (22b) an admin invites a member, the member gets the email and signs in.

## Phase 23 — Bulk email

Requirements: the [design](superpowers/specs/2026-10-16-phase-23-bulk-email-design.md) (a `product/bulk-email.md` is written by part 23.2). Owner brief: [bulk email](superpowers/briefs/2026-10-16-bulk-email.md), with the owner update for the first version.

Scope: admins write an email from blocks (heading, text, image, button, divider, eGrant logo) with a computer and phone preview, send a test to themselves, pick recipients among Spolu's people (client groups, managers' groups, roles client / ziadatel / admin, individual people), and send through a pg-boss queue in batches via Elastic Email (`POST /v4/emails`, one call per person). Every email has an unsubscribe link to Spolu and `List-Unsubscribe`; people who unsubscribed are left out until they tick "Receive mailings" again. A report shows recipients, sent, failed, skipped and unsubscribed per campaign and per person. First version: the existing egrant.sk sender, no webhooks, no open or click tracking (these come later, see the spec's "Later").

Built in 7 parts, one pull request each (23.1 first; 23.2, 23.3 and 23.4 in parallel; then 23.5 and 23.6 in parallel; 23.7 last). The owner answered the five open decisions on 2026-10-16 (spec, P1–P5): people who never signed in are included, Spolu is the source of truth for unsubscribing, and a "Receive mailings" checkbox in Settings lets people subscribe again.

Done when: an admin sends a campaign to a client group, each client gets it with their name, one client unsubscribes through the link and the next campaign skips them, and the report shows the counts.
