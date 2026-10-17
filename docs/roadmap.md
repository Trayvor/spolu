# Roadmap

28 phases (0-27). Each phase ends with something that works and can be used. Update the `Status` column when a phase starts or finishes (values: `planned`, `in progress`, `done` = merged into `main`, which deploys it to the test server https://help.egrant.sk, `merged into N`). What the owner still has to walk by hand is written in the phase's section. The `implement-phase` and `update-kb` skills do this.

Requirements per module: [product/](product/README.md). Phases after 1 get their own short design and plan when they start.

| # | Phase | Status | Depends on | Design/plan |
|---|---|---|---|---|
| 0 | [AI workflow & knowledge base](#phase-0--ai-workflow--knowledge-base) | done | - | [spec](superpowers/specs/2026-10-15-ehub-foundation-design.md), [plan](superpowers/plans/2026-10-15-phase-0-ai-workflow-and-kb.md) |
| 1 | [Skeleton & delivery](#phase-1--skeleton--delivery) | done | 0 | [spec](superpowers/specs/2026-10-15-ehub-foundation-design.md), [plan](superpowers/plans/2026-10-15-phase-1-skeleton-and-delivery.md) |
| 2 | [Login & users](#phase-2--login--users) | done | 1 | [spec](superpowers/specs/2026-10-15-phase-2-login-and-users-design.md), [plan](superpowers/plans/2026-10-15-phase-2-login-and-users.md) |
| 3 | [Groups & invites](#phase-3--groups--invites) | done | 2 | [spec](superpowers/specs/2026-10-15-phase-3-groups-and-invites-design.md), [plan](superpowers/plans/2026-10-15-phase-3-groups-and-invites.md) |
| 4 | [Shared foundation](#phase-4--shared-foundation) | done | 3 | [spec](superpowers/specs/2026-10-15-phase-4-shared-foundation-design.md), [plan](superpowers/plans/2026-10-15-phase-4-shared-foundation.md) |
| 5 | [Group chat](#phase-5--group-chat) | done | 4 | [spec](superpowers/specs/2026-10-15-phase-5-group-chat-design.md), [plan](superpowers/plans/2026-10-15-phase-5-group-chat.md) |
| 6 | [Notifications](#phase-6--notifications) | done | 9 | [spec](superpowers/specs/2026-10-16-phase-6-notifications-design.md), [plan](superpowers/plans/2026-10-16-phase-6-notifications.md) |
| 7 | [Direct messages](#phase-7--direct-messages) | planned | 5, 6 | - |
| 8 | [Task board](#phase-8--task-board) | done | 4 | [spec](superpowers/specs/2026-10-15-phase-8-task-board-design.md), [plan](superpowers/plans/2026-10-15-phase-8-task-board.md) |
| 9 | [Task chat & message to tasks with AI](#phase-9--task-chat--message-to-tasks-with-ai) | done | 5, 8 | [spec](superpowers/specs/2026-10-15-phase-9-task-chat-and-ai-design.md), [plan](superpowers/plans/2026-10-15-phase-9-task-chat-and-ai.md) |
| 10 | [Message to task](#phase-10--message-to-task) | merged into 9 | - | - |
| 11 | [AI split into tasks](#phase-11--ai-split-into-tasks) | merged into 9 | - | - |
| 12 | [Tickets: intake from eGrant](#phase-12--tickets-intake-from-egrant) | merged into 21 | - | - |
| 13 | [Tickets: replies](#phase-13--tickets-replies) | merged into 21 | - | - |
| 14 | [Contracts](#phase-14--contracts) | planned | 3 | - |
| 15 | [Contract reminders](#phase-15--contract-reminders) | planned | 6, 14 | - |
| 16 | [Password & polish](#phase-16--password--polish) | planned | 5 | - |
| 17 | [Knowledge base](#phase-17--knowledge-base) | done | 9, 6 | [spec](superpowers/specs/2026-10-16-phase-17-knowledge-base-design.md), [plan](superpowers/plans/2026-10-16-phase-17-knowledge-base.md) |
| 18 | [Client managers](#phase-18--client-managers) | done | 9, 6 | [spec](superpowers/specs/2026-10-16-phase-18-client-managers-design.md), [plan](superpowers/plans/2026-10-16-phase-18-client-managers.md) |
| 19 | [Task reminders](#phase-19--task-reminders) | done | 17 | [spec](superpowers/specs/2026-10-16-phase-19-task-reminders-design.md), [plan](superpowers/plans/2026-10-16-phase-19-task-reminders.md) |
| 20 | [Admin home](#phase-20--admin-home) | done | 17, 18 | [spec](superpowers/specs/2026-10-16-phase-20-admin-home-design.md), [plan](superpowers/plans/2026-10-16-phase-20-admin-home.md) |
| 21 | [Tickets & the ziadatel role](#phase-21--tickets--the-ziadatel-role) | done | 18, 20; item C for 21.6 | [spec](superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md), [plan](superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md) |
| 22 | [Members & groups page](#phase-22--members--groups-page) | done | 18, 20, 21.1 | [plan](superpowers/plans/2026-10-16-phase-22-members-and-groups-page.md) |
| 23 | [Bulk email](#phase-23--bulk-email) | done | 3, 18, 21.1 | [spec](superpowers/specs/2026-10-16-phase-23-bulk-email-design.md), [plan](superpowers/plans/2026-10-16-phase-23-bulk-email.md) |
| 24 | [Knowledge folders](#phase-24--knowledge-folders) | done | 17 | [spec](superpowers/specs/2026-10-16-phase-24-knowledge-folders-design.md), [plan](superpowers/plans/2026-10-16-phase-24-knowledge-folders.md) |
| 25 | [Chat files in the knowledge base](#phase-25--chat-files-in-the-knowledge-base) | done | 17, 24 | [spec](superpowers/specs/2026-10-16-knowledge-chat-files-design.md), [plan](superpowers/plans/2026-10-16-knowledge-chat-files.md) |
| 26 | [One email design and nine languages](#phase-26--one-email-design-and-nine-languages) | done | 23 | [ADR 0019](decisions/0019-nine-languages-and-one-email-design.md) |
| 27 | [Whole-project review: performance and cleanup](#phase-27--whole-project-review-performance-and-cleanup) | planned | the UI/UX polish work | - |
| 28 | [Chat editor and AI text tools](#phase-28--chat-editor-and-ai-text-tools) | in progress | 27 | [editor spec](superpowers/specs/2026-10-17-phase-28-chat-editor-design.md), [ADR 0025](decisions/0025-prosemirror-chat-editor.md), [AI text tools and voice spec](superpowers/specs/2026-10-17-phase-28-ai-text-tools-and-voice-design.md) |
| 29 | [Solve with AI](#phase-29--solve-with-ai) | done | 21 | [spec](superpowers/specs/2026-10-17-phase-29-open-in-claude-design.md) |
| 31 | [Bulk email builder v2](#phase-31--bulk-email-builder-v2) | in progress (PR #59) | 23 | [spec](superpowers/specs/2026-10-17-phase-31-bulk-email-builder-v2-design.md), [plan](superpowers/plans/2026-10-17-phase-31-bulk-email-builder-v2.md) |

Phases 8 and 14 do not depend on each other, so their order can change by priority.

**Owner brief of 2026-10-16** ([superpowers/briefs/2026-10-16-next-work.md](superpowers/briefs/2026-10-16-next-work.md)), all done:
- A: the "only where I take part" filter on the global task board (a small change, no spec; see [product/task-board.md](product/task-board.md));
- C: notification groups in the profile ([spec](superpowers/specs/2026-10-16-notification-groups-design.md), [plan](superpowers/plans/2026-10-16-notification-groups.md));
- B: the tickets module with the `ziadatel` role, which supersedes Phases 12–13: [Phase 21](#phase-21--tickets--the-ziadatel-role).

Also done outside the numbered phases: the visible name **Help by eGrant** and the move to https://help.egrant.sk with a redirect from spolu.egrant.sk ([ADR 0018](decisions/0018-visible-name-help-and-domain-redirects.md), pull request #31; see [runbooks/deploy.md](runbooks/deploy.md#moving-to-a-new-domain)).

Also agreed on 2026-10-16: the global task board shows the chosen clients' custom buckets as their own columns (owner decision, a small change with no spec; see [product/admin-home.md](product/admin-home.md#custom-bucket-columns-owner-decision-2026-10-16)).

## Server deployment

Owner decision (2026-10-15): build and verify locally first, deploy to the server as one separate step. That step is done: the first deploy to the Oracle test VM ran on 2026-10-15 (Phase 1 Task 18), and since then every merge into `main` deploys to the test server, now https://help.egrant.sk ([runbooks/deploy.md](runbooks/deploy.md)). The status `done (local)` is retired: the phases verified locally before that are `done`. Still open from the server step: the Phase 6 check on real devices ([runbooks/deploy.md](runbooks/deploy.md#phase-6-check-on-real-devices)) and HSTS.

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

Already built elsewhere: the profile name (Phase 6, `/settings`) and the stored language (Phase 26); search over the knowledge base (Phase 17), not yet over messages.

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

Status: done (merged; end-to-end test `e2e/task-reminders.spec.ts`).

## Phase 20 — Admin home

Requirements: [admin-home](product/admin-home.md).

Scope: the admin dashboard (assigned tasks, upcoming reminders, unread mentions), the client sidebar with unread and assigned counts, the yellow assigned count on the Tasks tab, and the global task board across clients.

Done when: an admin sees their tasks, reminders and mentions on the home page, opens each from there, and filters the global board by client.

Follow-up (owner request, 2026-10-17): a **Tickets** card in the dashboard's first row (active tickets of the clients I manage and without a client, New marked), the tasks card renamed **My tasks** in the next row, and counts beside the header's Tasks and Tickets links. See [admin-home](product/admin-home.md#tickets-card-and-header-counts-owner-request-2026-10-17).

## Phase 21 — Tickets & the ziadatel role

Requirements: [tickets](product/tickets.md), [roles-and-access](product/roles-and-access.md), [groups](product/groups.md). Owner brief: [item B](superpowers/briefs/2026-10-16-next-work.md). Supersedes Phases 12 and 13.

Scope: clients in several groups and a membership role (`client`, `ziadatel`); tickets from the eGrant API (Bearer key), from clients and from admins, assigned to a client by the instance link or by hand; statuses New / In progress / Resolved; a chat per ticket; following and notifications through the `tickets` notification group of item C; turning a ticket into tasks with AI; requesters who are not clients yet get a `ziadatel` membership that sees only their own tickets.

Built in 7 parts, one pull request each (21.1 memberships first; 21.3, 21.4 and 21.6 in parallel after 21.2; 21.6 also waits for item C). The plan holds a ready prompt per part.

Done when: eGrant sends a ticket, a new requester gets the email, logs in with a code and sees only that ticket and its chat; an admin replies and the requester is notified; the ticket becomes tasks that link back to it; a client works in two groups.

Status: done. All seven parts are merged into `main`: 21.1 memberships, 21.2 tickets server core, 21.3 ticket chat, 21.4 ticket screens, 21.5 ticket to tasks with AI, 21.6 following and notifications, 21.7 e2e and wrap-up (`e2e/tickets.spec.ts` walks the whole "Done when" flow; the intake's `request_id` for safe retries; mentions of unreadable tickets dropped from the admin home; task changes refresh the ticket page; the [eGrant integration guide](integrations/egrant-ticket-intake.md)).

Follow-up (owner decision 2026-10-16, branch `ticket-intake-files`): the intake takes the files themselves as base64 (`files`, up to 10, 10 MiB each, 20 MiB per request; body limit 28 MiB on the intake only), stored in the client's files and attached to the ticket; `file_links` is removed everywhere (migration 0023). See [ADR 0017](decisions/0017-intake-files-as-base64.md) and the [integration guide](integrations/egrant-ticket-intake.md).

## Phase 22 — Members & groups page

Requirements: [groups](product/groups.md), [client-managers](product/client-managers.md). Owner decisions (2026-10-16) are in the [plan](superpowers/plans/2026-10-16-phase-22-members-and-groups-page.md), split into two parts.

**22a — managers and the Groups page** (merged, pull request #10):
- The Members tab: admins add any active admin as the group's manager and remove any manager (`PUT`/`DELETE /api/groups/:id/managers/:userId`); the link to the Groups page is gone.
- The Groups page: the member count links to the Members tab, manager names in a tooltip, a filter by manager (`?manager=me|none|<adminId>`), my groups first, and a group count.
- The client filter's "Predvolené" sits in the filter row on Úlohy and Znalosti.

**22b — invites by email (merged, pull request #16; redesigned for Phase 21.1; e2e `member-invites.spec.ts`):** admins add members by email on the Members tab. A new or never-signed-in person gets an invitation with a login link (`/login?email=`) and shows as "Pozvaný" (resend, cancel) until the first sign-in; a client of another group is added at once and told by email. An admin's invite is a client membership created directly (no `pending_invites` row, no migration). Cancel deletes the membership, or turns a former requester back to ziadatel. The owner confirmed the plan's Part 22b decisions.

Done when: (22a) an admin adds a manager on the Members tab and the Groups page filters by manager with the count; (22b) an admin invites a member, the member gets the email and signs in.

## Phase 23 — Bulk email

Requirements: [product/bulk-email.md](product/bulk-email.md) and the [design](superpowers/specs/2026-10-16-phase-23-bulk-email-design.md). Owner brief: [bulk email](superpowers/briefs/2026-10-16-bulk-email.md), with the owner update for the first version.

Scope: admins write an email from blocks (heading, text, image, button, divider, eGrant logo) with a computer and phone preview, send a test to themselves, pick recipients among Spolu's people (client groups, managers' groups, roles client / ziadatel / admin, individual people), and send through a pg-boss queue in batches via Elastic Email (`POST /v4/emails`, one call per person). Every email has an unsubscribe link to Spolu and `List-Unsubscribe`; people who unsubscribed are left out until they tick "Receive mailings" again. A report shows recipients, sent, failed, skipped and unsubscribed per campaign and per person. First version: the existing egrant.sk sender, no webhooks, no open or click tracking (these come later, see the spec's "Later").

Built in 7 parts, one pull request each (23.1 first; 23.2, 23.3 and 23.4 in parallel; then 23.5 and 23.6 in parallel; 23.7 last). The owner answered the five open decisions on 2026-10-16 (spec, P1–P5): people who never signed in are included, Spolu is the source of truth for unsubscribing, and a "Receive mailings" checkbox in Settings lets people subscribe again.

Status: parts 23.1 (foundation), 23.2 (campaigns and audience API), 23.3 (renderer, public images, preview, email logo PNG) 23.4 (unsubscribe page and API, one-click, subscribe again, the "Receive mailings" checkbox, Elastic suppression lift and daily sync), 23.5 (test send, start sending, the batch job and daily sweep, cancel, the per-person report API) 23.6 (web: campaign list, block builder with preview, audience builder, test send button) and 23.7 (web: the Send step with its confirm dialog, the report with live progress, the per-person list and Cancel sending; e2e `e2e/bulk-email.spec.ts`; docs) are merged: Phase 23 is done. Before the first real send the owner works through the [pre-launch checklist](runbooks/deploy.md#bulk-email-pre-launch-checklist) (Elastic plan and key, `MAIL_FROM_BULK`, the List-Unsubscribe setting, the live sender check and the P5 check).

Done when: an admin sends a campaign to a client group, each client gets it with their name, one client unsubscribes through the link and the next campaign skips them, and the report shows the counts.

## Phase 24 — Knowledge folders

Requirements: [knowledge-base](product/knowledge-base.md) and the [design](superpowers/specs/2026-10-16-phase-24-knowledge-folders-design.md) (owner decisions of 2026-10-16 and the defaults we took).

Scope: folders and subfolders in each group's knowledge base, with breadcrumbs; admins and the group's clients create, rename, move and delete them; a folder can be admins-only, and everything inside it is then admins-only too; "Move to…" for items and folders; the admins' global view browses client → folders → items, and search stays a flat list across folders with each result's client and folder path.

Status: done (pull request #26: server, web, end-to-end test in `e2e/knowledge.spec.ts`); migration 0022.

Done when: an admin and a client sort a group's knowledge into folders, the client never sees an admins-only folder or anything in it, and a search finds an item in a subfolder and shows its path.

## Phase 25 — Chat files in the knowledge base

Requirements: [knowledge-base](product/knowledge-base.md) and the [design](superpowers/specs/2026-10-16-knowledge-chat-files-design.md) (owner request of 2026-10-16 and the defaults we took).

Scope: every file attached to a chat message (group chat, task chat, ticket chat) becomes a read-only knowledge item of the type "From chat" ("Z chatu"), created automatically, removed with the message, and opening the chat at that message; the type filter and a "tasks and tickets too" checkbox in the group's tab and the admins' global view; a backfill for files already in chats.

Status: done (pull request #32: server, web, end-to-end test in `e2e/knowledge.spec.ts`); migration 0024 with the backfill. Waiting for the owner's walkthrough.

Done when: a client uploads a file in the group chat, an admin finds it under "From chat" in the client's Knowledge tab and in the global view, opens the chat at the message from it, and the entry disappears when the message is deleted.

## Phase 26 — One email design and nine languages

Requirements: [non-functional](product/non-functional.md) (interface languages) and [ADR 0019](decisions/0019-nine-languages-and-one-email-design.md) (owner request of 2026-10-17).

Scope: every system email (login and email-change codes, admin and member invites, notification digests, "ticket created") rendered by the bulk email renderer, so all email has one design (logo, heading, card, one pill button, muted footer), still transactional (no unsubscribe link, no tracking, a plain-text part); Czech, Slovenian, Bulgarian, Estonian, Italian, Croatian and Ukrainian next to Slovak and English in the UI, the language menu, the stored account language (migration 0025) and every email and push, with only Slovak and English in the initial JS.

Status: done (pull request #34: server, web, the e2e language case in `e2e/smoke.spec.ts`); migration 0025. The new translations wait for a native speaker's review.

Done when: a user picks Čeština in the language menu, the app and their next notification email are in Czech, and a login code email looks like a bulk email.

## Phase 27 — Whole-project review: performance and cleanup

Owner request (2026-10-17). Starts after the UI/UX polish work is merged. Requirements: [architecture/performance.md](architecture/performance.md), [product/non-functional.md](product/non-functional.md) ("Performance is a top priority", "Easy to extend").

Scope: review the whole project for places where performance can sag, for dead or unneeded code, and for other optimizations. First a findings report as the spec (`docs/superpowers/specs/`), each finding with where it is, a measurement and a proposed fix; then the fixes in small pull requests, each measured before and after. Areas to check:
- **Server:** slow or unindexed queries (`EXPLAIN` on realistic data, like `modules/home/explain.test.ts`), N+1 patterns, lists without pagination, heavy pg-boss jobs (digests, reminders, bulk email, backfills), socket fan-out (who gets which event, payload sizes), memory use of the one process.
- **Web:** the initial JS (200 kB gzip budget, practically full): what can leave the entry chunk; needless re-renders; long lists without virtualization; query invalidation storms after socket events; image and asset sizes (fonts, icons, logos).
- **Dead code:** unused exports, files, dependencies and locale keys (in all nine languages).
- **Duplication:** the same logic repeated across modules that should share one helper.
- **Tests and CI:** test-suite speed (`scripts/ci.sh` takes about 12 minutes), slow or flaky tests.
- **Docker image:** its size and build time.

Done when: the findings report is written and agreed with the owner, every accepted finding is fixed in its own merged pull request with before/after numbers, and the remaining ones are listed as later work.

Status: findings report written ([2026-10-17 findings](superpowers/specs/2026-10-17-phase-27-review-findings.md)): 8 fix batches (foreign-key indexes, JIT off, faster web tests, entry chunk, precache, first-join refetch, dead code, Docker image) in their own pull requests; the rest is listed there as proposed, for the owner to decide.

## Phase 28 — Chat editor and AI text tools

Owner request (2026-10-17). Starts after Phase 27. Needs a spec (brainstorming) and an ADR for the editor library.

- **Rich text editor in every chat** (group chat, ticket chat, task chat): formatting shows while typing (WYSIWYG, not a preview), with full Markdown support: typing Markdown syntax (`**bold**`, `_italic_`, `` `code` ``, lists, quotes, links, headings, code blocks) turns into formatting at once, pasted Markdown renders, and messages are stored as Markdown so the existing rendering, search, notifications and digests keep working. Mentions and file attachments keep working inside it. The bulk email builder is out of scope (emails take HTML only). The editor is lazy-loaded so the initial JS budget holds.
- **AI text tools, for admins and clients** (owner change 2026-10-17: clients get them by the same rules): an AI button next to Send (like Telegram's) offers:
  1. **Fix mistakes** — only commas, full stops, diacritics, typos; nothing else changes.
  2. **Make it formal** — a professional tone, but explicitly not an email (no greeting/sign-off unless the text already looks like an email); keeps natural, human wording and allows anglicisms. It also structures the text the way a person would write it: spoken enumerations ("task one: …, task two: …", common in voice input) become a numbered list ("1. … 2. …"), run-on dictation is split into sentences and paragraphs, and lists, steps or questions get Markdown list formatting where that reads better. The meaning and the facts never change.
  3. **Translate** — shown only in groups whose eGrant instance link is not a `.sk` domain, with two options: to English and to the client's language (decide in the spec how the client's language is found: the instance's TLD or the client members' profile language).
  The result replaces the draft for review before sending (undo available); nothing is sent automatically. Available in group chat, ticket chat and task chat.
- **Model:** a fast, cheap OpenAI model so the result comes back in about a second (check OpenAI's current small models when the spec is written; low reasoning effort, streaming if it helps). Configurable separately from the task-split model (e.g. `OPENAI_TEXT_MODEL`). Prompts live in the server; the browser never sends a prompt, only the text and the chosen action. Rate-limited per user.
- **Reactions** (owner request 2026-10-17), in every chat (group, ticket, task): an emoji reaction on any message — a quick row of common ones (👍 ❤️ 😂 😮 😢 🙏 ✅) plus a lightweight picker for others; chips under the message with counts, mine highlighted, tap to toggle, a long press or hover lists who reacted. Live over the socket (pushed after the HTTP write). No push or email notification for a reaction (or at most a quiet one to the author — decide in the spec). On phones the reaction row opens from the existing message action sheet.
- **Attach a knowledge item** (owner request 2026-10-17): in a group's chats (group chat, and the task and ticket chats of that group) a message can carry one or more items from that group's knowledge base, picked from a search dialog next to the file button. Only items visible to everyone in the group can be attached (never "admins only" items or items in admins-only folders); the server checks this on send and again when the message is shown (an item later made admins-only, moved or deleted shows as unavailable). The message shows a card with the item's type icon, title and folder, opening the item. In a ticket chat a žiadateľ (who does not see the knowledge base) gets no picker, but sees the attached items and can open and read them (owner decision 2026-10-17): read-only, only the attached item itself — no browsing the folder or the rest of the knowledge base, no edits, comments or reminders. The server grants that access through the message the item is attached to.
- **Voice input** (owner request 2026-10-17), for everyone in every chat: a microphone button records; the person decides when to stop (tap again, like Claude's voice input; no automatic cut-off on silence), sees a timer while recording, can cancel, and the speech is transcribed into the draft (not sent) for review. Transcription on the server with the transcription provider of the knowledge meetings phase (`TRANSCRIPTION_PROVIDER`), so no browser speech API differences; a length limit (e.g. 5 minutes) and a per-user rate limit.

Status: the AI text tools and voice input are built ([design](superpowers/specs/2026-10-17-phase-28-ai-text-tools-and-voice-design.md), its "Owner decisions" list what to confirm: the client's language rule, no text tools for a ziadatel, `gpt-5.4-mini`, the rate limits). The owner still has to try them on a phone and a computer with the real OpenAI key (Safari's recording format included). The rich editor is built too ([spec](superpowers/specs/2026-10-17-phase-28-chat-editor-design.md) with the owner's decisions in its last section, [ADR 0025](decisions/0025-prosemirror-chat-editor.md): ProseMirror core in a lazy `chat-editor` chunk, about 70 kB gzip; initial JS +0.2 kB). The composer exposes the draft as Markdown (`ComposerHandle`: `getMarkdown`, `setMarkdown`, `focus`, and an `extraActions` slot before Send); the AI and voice buttons read and replace the draft through the editor (an AI answer is one undo step, a transcript is appended at the end). To walk after the merge on https://help.egrant.sk: in a group chat, a ticket chat and a task chat, type `**bold**`, `_italic_`, `- ` and `1. ` lists, `> `, `# ` and ```` ``` ````, mention someone, attach a file, paste Markdown from a text editor and formatted text from a web page, edit a sent message, run "Make it formal" on a dictated list and check it shows as a numbered list; on a phone check that Enter makes a new line and Send sends. Reactions and knowledge attachments are separate slices.

## Phase 29 — Solve with AI

Owner decision (2026-10-17). Starts after Phase 27 (order with Phase 28 by the owner's priority).

- On tickets and tasks, admins get an **"Otvoriť v Claude"** button: it opens claude.ai with a prefilled prompt carrying the full context — the ticket or task, its chat, file names, the eGrant instance link — and the instruction to solve it with the eGrant MCP that admins already have connected in Claude. It uses the admin's own Claude subscription; nothing runs on the server, no API cost.
- When the prompt is too long for a URL, the button copies it to the clipboard and opens an empty Claude chat with a short note.
- Test the prompt against the eGrant MCP only on the instance **Supermesto** (owner rule).

Requirements: [product/solve-with-claude.md](product/solve-with-claude.md); [design](superpowers/specs/2026-10-17-phase-29-open-in-claude-design.md) with the owner decisions (§5). Built as "Vyriešiť s Claude": a dialog with optional notes, then "Otvoriť v Claude" (`claude.ai/new?q=…` up to 8 000 characters, else the clipboard and an empty chat), "Kopírovať prompt", and the reminder to attach the files by hand with a download link each. The prompt asks Claude for a first reply with the cause, the impact, the steps, the risks and the question whether to fix it, and forbids writes until the admin confirms. Admins only (`canOpenInClaude`); no migration. Built ahead of Phase 27 at the owner's request (night run).

Status: done (server, web, tests; e2e `e2e/open-in-claude.spec.ts` is run by the orchestrator).

Owner walks on https://help.egrant.sk: open a Supermesto ticket as an admin, press "Vyriešiť s Claude", generate without notes, then with a note, open in Claude and check that Claude finds the instance, reads only, and answers with (a)–(e) before touching anything; open a ticket with a long chat and check the paste note; check that a client sees no button.

## Phase 30 — Knowledge: meetings with AI summary

Owner request (2026-10-17, approved overnight). Requirements: [knowledge-base](product/knowledge-base.md) ("Meetings") and the [design](superpowers/specs/2026-10-17-knowledge-meetings-design.md); [ADR 0023](decisions/0023-ffmpeg-static-build-for-meeting-audio.md) for ffmpeg in the image.

Scope: a knowledge type **Meeting** ("Stretnutie": date and time, meeting, recording and transcript links, notes, a transcript pasted or read from .txt/.vtt/.srt/.docx, an optional reminder); a recording upload of up to 2 GB, streamed, transcoded by a job to compact speech audio (AAC mono 32 kbps) while the original is deleted; "Spracovať s AI" for admins: a pg-boss job transcribes the stored audio in 20-minute parts (`TranscriptionProvider`: OpenAI `gpt-transcribe` by default, ElevenLabs Scribe, a fake; `TRANSCRIPTION_PROVIDER`) and the LLM writes a structured, editable summary (summary, decisions, action items, open questions) in the meeting's language; "Vytvoriť úlohy" sends the action items through the task review dialog into a chosen bucket; a "Meetings" card on the admin home (the next 7 days and recent meetings without a summary).

Status: in progress (one pull request: server, web, e2e `e2e/meetings.spec.ts`); migration 0029.

Done when: an admin adds a meeting with its Teams link to a client's knowledge base, uploads the call's video, sees it kept as audio, presses "Spracovať s AI", gets a summary with action items, creates two tasks from them in the client's board, and finds the meeting on the dashboard's Meetings card.

## Phase 31 — Bulk email builder v2

Owner request (2026-10-17, approved to build the same night). Requirements: [product/bulk-email.md](product/bulk-email.md); [design](superpowers/specs/2026-10-17-phase-31-bulk-email-builder-v2-design.md), [plan](superpowers/plans/2026-10-17-phase-31-bulk-email-builder-v2.md), [ADR 0024](decisions/0024-bulk-email-content-v2.md).

Scope: text formatting in text blocks (bold, italic, underline, strikethrough, links, lists, headings 2/3, alignment, palette colours; stored as a document tree, never HTML); image size, alignment and shape; a space block; a split container with two columns (ratio, divider, vertical alignment; stacked on phones); a phone version that follows the computer one until it is edited in Phone mode, with "Return to the computer version"; a one-time "check on a phone" warning before the first send; the content version (migration 0030) with an upgrade on read, so older campaigns render byte for byte as before.

Status: built locally on `feat/bulk-email-builder-v2` (server, web, tests; e2e `e2e/bulk-email-builder.spec.ts` written, run by the owner). Decisions for the owner are listed in the spec §9.

Done when: an admin formats a text, builds a split container with an image and a button, edits the phone version separately, sends, and the email shows the computer version in Outlook and Gmail on a computer and the phone version on a phone.
