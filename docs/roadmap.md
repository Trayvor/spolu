# Roadmap

35 phases (0-34). Each phase ends with something that works and can be used. Update the `Status` column when a phase starts or finishes (values: `planned`, `in progress`, `done` = merged into `main`, which is deployed to the test server https://help.egrant.sk, `merged into N`). What the owner still has to walk by hand is written in the phase's section. The `implement-phase` and `update-kb` skills do this.

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
| 14 | [Contracts](#phase-14--contracts) | merged into 32 | 3 | - |
| 15 | [Contract reminders](#phase-15--contract-reminders) | merged into 32 | 6, 14 | - |
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
| 27 | [Whole-project review: performance and cleanup](#phase-27--whole-project-review-performance-and-cleanup) | done | the UI/UX polish work | - |
| 28 | [Chat editor and AI text tools](#phase-28--chat-editor-and-ai-text-tools) | done | 27 | [editor spec](superpowers/specs/2026-10-17-phase-28-chat-editor-design.md), [ADR 0025](decisions/0025-prosemirror-chat-editor.md), [AI text tools and voice spec](superpowers/specs/2026-10-17-phase-28-ai-text-tools-and-voice-design.md) |
| 29 | [Solve with AI](#phase-29--solve-with-ai) | done | 21 | [spec](superpowers/specs/2026-10-17-phase-29-open-in-claude-design.md) |
| 30 | [Knowledge: meetings with AI summary](#phase-30--knowledge-meetings-with-ai-summary) | done | 17 | [spec](superpowers/specs/2026-10-17-knowledge-meetings-design.md), [ADR 0023](decisions/0023-ffmpeg-static-build-for-meeting-audio.md) |
| 31 | [Bulk email builder v2](#phase-31--bulk-email-builder-v2) | done | 23 | [spec](superpowers/specs/2026-10-17-phase-31-bulk-email-builder-v2-design.md), [plan](superpowers/plans/2026-10-17-phase-31-bulk-email-builder-v2.md), [layout spec](superpowers/specs/2026-10-17-bulk-email-builder-layout-design.md) |
| 32 | [Finančná správa](#phase-32--finančná-správa) | done | 17, 19, 20, 24 | [spec](superpowers/specs/2026-10-17-finance-module-design.md), [plan](superpowers/plans/2026-10-17-finance-module.md), [E spec](superpowers/specs/2026-10-18-finance-org-expenses-design.md), [E plan](superpowers/plans/2026-10-18-finance-org-expenses.md) |
| 33 | [Projects per client and closer eGrant integration](#phase-33--projects-per-client-and-closer-egrant-integration) | in progress (P3 open as #113, waiting for eGrant) | 32 (P6 only), 28 | [spec](superpowers/specs/2026-10-17-phase-33-projects-design.md), [plan](superpowers/plans/2026-10-17-phase-33-projects.md) |
| 34 | [Internal admin group](#phase-34--internal-admin-group) | done | 33, 32 (P34-E only), 28 | [spec](superpowers/specs/2026-10-17-phase-34-admin-group-design.md), [plan](superpowers/plans/2026-10-17-phase-34-admin-group.md) |

Phases 8 and 14 do not depend on each other, so their order can change by priority.

**Owner brief of 2026-10-16** ([superpowers/briefs/2026-10-16-next-work.md](superpowers/briefs/2026-10-16-next-work.md)), all done:
- A: the "only where I take part" filter on the global task board (a small change, no spec; see [product/task-board.md](product/task-board.md));
- C: notification groups in the profile ([spec](superpowers/specs/2026-10-16-notification-groups-design.md), [plan](superpowers/plans/2026-10-16-notification-groups.md));
- B: the tickets module with the `ziadatel` role, which supersedes Phases 12–13: [Phase 21](#phase-21--tickets--the-ziadatel-role).

Also done outside the numbered phases: the visible name **Help by eGrant** and the move to https://help.egrant.sk with a redirect from spolu.egrant.sk ([ADR 0018](decisions/0018-visible-name-help-and-domain-redirects.md), pull request #31; see [runbooks/deploy.md](runbooks/deploy.md#moving-to-a-new-domain)).

Also agreed on 2026-10-16: the global task board shows the chosen clients' custom buckets as their own columns (owner decision, a small change with no spec; see [product/admin-home.md](product/admin-home.md#custom-bucket-columns-owner-decision-2026-10-16)).

**MCP server** (owner request 2026-10-18, outside the numbered phases; merged in PR #121): an AI client connects to `/mcp` with a personal token and reads and changes everything its user may; finance in full for finance holders (owner decision 2026-10-18). [Spec](superpowers/specs/2026-10-18-mcp-server-design.md), [plan](superpowers/plans/2026-10-18-mcp-server.md), [ADR 0033](decisions/0033-mcp-server-over-the-http-api.md), guide [integrations/mcp.md](integrations/mcp.md). **OAuth** for Claude's custom connectors (add Help in claude.ai or Claude Desktop with just the URL; merged in PR #125): [spec](superpowers/specs/2026-10-18-mcp-oauth-design.md), [ADR 0034](decisions/0034-mcp-oauth-authorization-server.md), migration 0047.

## In flight (2026-10-18)

Work outside the numbered phases that is not merged yet:
- **eGrant managers webhook** (`PUT /api/egrant/managers`, merged in PR #123, [guide](integrations/egrant-managers.md)): being reworked (owner correction, PR #126): an eGrant "manager" is the client's own person, so the call will add or remove a client member of the instance's group, not a Help admin manager.
- **eGrant guide**: PR #127.
- **Security hardening**: PR #132.
- **Web performance**: PR #133.
- **eGrant groups webhook and group deactivation** (`PUT /api/egrant/groups`, `POST /api/groups/:id/deactivate|reactivate`, [guide](integrations/egrant.md#groups), [rules](product/groups.md), [eGrant side spec](integrations/egrant-agent-tz.md), ADR 0038): branch `feat/egrant-groups-webhook`.
- **Claude prompt author**: PR #131.
- **Teams spec**: PR #130 (T1 in progress).
- **Phase 33, P3**: PR #113, waiting for eGrant.
- **Notification noise** (UX review batches 1 and 2, owner decisions 2026-10-18; branch `ux/notifications-noise`, migration 0051): silent push replacements except for what is addressed to the person, one digest email per person with a section per place and clear subjects, task chat messages only to the task's people, new `task.due_changed`, `task.overdue` and `ticket.resolved`. Kept as on main by the owner: the urgent reminder cadence, eGrant tím on All messages, deadline reminders 3, 2 and 1 days before, no quiet hours or weekend silence. Rules in `product/notifications.md`.

**Microsoft Teams integration** (owner request 2026-10-18, outside the numbered phases): Teams meetings created from a knowledge meeting record (calendar events with invitations, a public add-to-calendar page), the transcript attached to the record automatically after the call (also for meetings made in Teams, connected by their link), then tighter ideas (automatic AI summary, the link in the group chat, records from the calendar). Status: **T1 (MVP) built** on `feat/teams-t1` (2026-10-18, after the owner's answers): Create Teams meeting and Connect Teams link on the knowledge call, the transcript import (admins-only until shared), the public `/m/<token>` calendar page, migration 0048, [ADR 0036](decisions/0036-teams-graph-app-only-plain-fetch.md); inactive until the owner does the [setup](integrations/teams.md) and the server has the `TEAMS_*` values. The owner must update the client contracts and the privacy notice for recording (spec "Legal"). T2 (change notifications, Outlook sync and cancel, transcript notifications, automatic AI summary, the link in the group chat) and T3 are planned. [Spec](superpowers/specs/2026-10-18-teams-integration-design.md).

## Server deployment

Owner decision (2026-10-15): build and verify locally first, deploy to the server as one separate step. That step is done: the first deploy to the Oracle test VM ran on 2026-10-15 (Phase 1 Task 18), and since then `main` is deployed to the test server (on every merge until 2026-10-18, then by hand with `scripts/deploy-local.sh`), now https://help.egrant.sk ([runbooks/deploy.md](runbooks/deploy.md)). The status `done (local)` is retired: the phases verified locally before that are `done`. Still open from the server step: the Phase 6 check on real devices ([runbooks/deploy.md](runbooks/deploy.md#phase-6-check-on-real-devices)) and HSTS.

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

Merged into [Phase 32](#phase-32--finančná-správa) (owner decision 3, accepted 2026-10-17): contracts live in Finance and only finance admins see them; the global contract list with its "Ending soon" marks is the Contracts card of `/finance`. The same applies to Phase 15 (the contract reminders are Finance reminders).

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

Follow-up (owner decision 2026-10-17, branch `feat/tickets-watch-until-assigned`): "Watch tickets" (per client) now also brings every update of a ticket while it has no riešiteľ; once it has one, its updates go only to its riešitelia (and its initiator; every admin for a ticket without a client and riešiteľ). Per-ticket following is removed everywhere (migration 0033 drops `ticket_followers`). See the [ADR 0021 amendment](decisions/0021-ticket-riesitelia-and-watching.md) and [tickets](product/tickets.md).

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

Status: done (pull request #32: server, web, end-to-end test in `e2e/knowledge.spec.ts`); migration 0024 with the backfill. Waiting for the owner's walkthrough. Follow-up (owner request of 2026-10-17): "Save as a file" turns a chat file into a normal file item with its own copy of the file (no migration; see the design, "Save as a file").

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

Status: done. Findings report ([2026-10-17 findings](superpowers/specs/2026-10-17-phase-27-review-findings.md)); every accepted batch is merged (PRs #44–#66, with before/after numbers in the report's table); the rest is listed there as proposed, for the owner to decide. Batch 2 (`perf/phase-27-batch-2`, accepted by the owner): S5 (no notification event for a category set to none), S8 (the group board's Completed column paged by 15), W5 (the global board keeps its "Show 50 more" pages) and, by owner request, remembered filters on every list (see [product/non-functional.md](product/non-functional.md), "Lists remember their filters").

Follow-up, owner request (2026-10-17): **the dashboard follows the notification settings** ([spec](superpowers/specs/2026-10-17-dashboard-follows-notifications-design.md)). The Mentions card and the sidebar's unread counts show only what would notify the admin (channel None or group mode Off hide them, as delivery decides), and a new **Meetings** notification group (meeting scheduled or moved, the AI summary result, a meeting's reminder) lets the Meetings card follow the same rule. No migration. Status: merged (PR #69).

Follow-up, owner request (2026-10-17): **unseen changes** ([spec](superpowers/specs/2026-10-17-unseen-changes-design.md)). A task or ticket with a notification after I last opened it has an unseen change: the header counts them, the sidebar's one black badge adds them to the unread messages (no yellow pill), and the global and group boards, the global ticket list and the My tasks and Tickets cards mark them. Migration 0036 (`task_seen`, `ticket_seen`, two partial indexes on `notification_events`). Status: merged (PR #92). Follow-up (owner, 2026-10-18): the marks became yellow markers (a ring for a chat message, a dot otherwise) with a "what changed" tooltip from the viewer's own events (`GET /api/tasks/:id/unseen-summary`, `GET /api/tickets/:id/unseen-summary`) and the same lines in a yellow banner when the task or ticket is opened, before it is marked seen (spec, "Yellow markers and what changed"). Status: merged (PR #106).

Follow-up of F16 (2026-10-18, deferred by the saved views / mentions in descriptions PR #156): **mentions in descriptions on the dashboard**. The Mentions card, its count and the MCP tool `list_mentions` include the mentions in task, ticket, project and knowledge descriptions, each linking to its subject and listed until the person opens it (new `project_seen` and `knowledge_seen` marks); a task's or ticket's also counts as an unseen change of it. Migration 0057 (the two tables, a partial index for the card, the unseen indexes rebuilt). See `product/admin-home.md`. Status: in review (`feat/mentions-card-descriptions`, stacked on #156).

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

Status: the AI text tools and voice input are built ([design](superpowers/specs/2026-10-17-phase-28-ai-text-tools-and-voice-design.md), its "Owner decisions" list what to confirm: the client's language rule, no text tools for a ziadatel, `gpt-5.4-mini`, the rate limits). The owner still has to try them on a phone and a computer with the real OpenAI key (Safari's recording format included). The rich editor is built too ([spec](superpowers/specs/2026-10-17-phase-28-chat-editor-design.md) with the owner's decisions in its last section, [ADR 0025](decisions/0025-prosemirror-chat-editor.md): ProseMirror core in a lazy `chat-editor` chunk, about 70 kB gzip; initial JS +0.2 kB). The composer exposes the draft as Markdown (`ComposerHandle`: `getMarkdown`, `setMarkdown`, `focus`, and an `extraActions` slot before Send); the AI and voice buttons read and replace the draft through the editor (an AI answer is one undo step, a transcript is appended at the end). To walk after the merge on https://help.egrant.sk: in a group chat, a ticket chat and a task chat, type `**bold**`, `_italic_`, `- ` and `1. ` lists, `> `, `# ` and ```` ``` ````, mention someone, attach a file, paste Markdown from a text editor and formatted text from a web page, edit a sent message, run "Make it formal" on a dictated list and check it shows as a numbered list; on a phone check that Enter makes a new line and Send sends.

Status: reactions and attached knowledge items merged (PR #65; [design](superpowers/specs/2026-10-17-phase-28-reactions-and-attachments-design.md): server, web, e2e `e2e/chat-reactions.spec.ts`; migration 0031).

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

Status: merged (PR #51); migration 0029.

Follow-up (owner request, 2026-10-17, merged in PR #68): a **card view** of the knowledge lists (a List / Cards toggle remembered per person; cards show up to five lines of the text from a 360-character plain-text excerpt; folders stay rows above). [Design](superpowers/specs/2026-10-17-knowledge-card-view-design.md); requirements in [knowledge-base](product/knowledge-base.md), "Card view". E2E in `e2e/knowledge.spec.ts`, run by the orchestrator.

Done when: an admin adds a meeting with its Teams link to a client's knowledge base, uploads the call's video, sees it kept as audio, presses "Spracovať s AI", gets a summary with action items, creates two tasks from them in the client's board, and finds the meeting on the dashboard's Meetings card.

## Phase 31 — Bulk email builder v2

Owner request (2026-10-17, approved to build the same night). Requirements: [product/bulk-email.md](product/bulk-email.md); [design](superpowers/specs/2026-10-17-phase-31-bulk-email-builder-v2-design.md), [plan](superpowers/plans/2026-10-17-phase-31-bulk-email-builder-v2.md), [ADR 0024](decisions/0024-bulk-email-content-v2.md).

Scope: text formatting in text blocks (bold, italic, underline, strikethrough, links, lists, headings 2/3, alignment, palette colours; stored as a document tree, never HTML); image size, alignment and shape; a space block; a split container with two columns (ratio, divider, vertical alignment; stacked on phones); a phone version that follows the computer one until it is edited in Phone mode, with "Return to the computer version"; a one-time "check on a phone" warning before the first send; the content version (migration 0030) with an upgrade on read, so older campaigns render byte for byte as before.

Status: v2 merged and deployed (PR #59; decisions for the owner in the spec §9). Follow-up of the same day, merged (PR #67) ([layout spec](superpowers/specs/2026-10-17-bulk-email-builder-layout-design.md), [ADR 0026](decisions/0026-bulk-email-wide-layout-and-linked-preview.md)): the builder page uses the full window width with the blocks on the left and a sticky live preview on the right (Blocks / Preview tabs on tablets and phones), the hovered or edited block is outlined in the preview and a click in the preview selects it, the split container's controls no longer overlap, and an email with a split container is 680 px wide on a computer instead of 600 px. E2E `e2e/bulk-email-builder.spec.ts` updated, run by the orchestrator. Owner to check: a real send of a container email in Outlook for Windows, Gmail and Apple Mail.

Done when: an admin formats a text, builds a split container with an image and a button, edits the phone version separately, sends, and the email shows the computer version in Outlook and Gmail on a computer and the phone version on a phone.

## Phase 32 — Finančná správa

Owner request (2026-10-17). Design: [spec](superpowers/specs/2026-10-17-finance-module-design.md) with the **Owner decisions** table at its top; [plan](superpowers/plans/2026-10-17-finance-module.md).

Scope: a finance right that only the superadmin grants, to admins only; a **Financie** tab per client for finance admins with three cards (Overview: money paid and to be paid by contract, the cost of the work, hours per admin as charts; Documents: contracts with amount, currency, period and reminders, documents, notes and folders; Work log: the hours by month and day with totals per admin and cost); a time question when an admin assignee completes a task, a notification to the other admin assignees and a "fill in your time" row on their dashboard until they answer; hourly rates with effective dates; manual entries; a system-wide page `/finance` with a client filter and rankings of clients by money paid and by hours or cost. Money is integer minor units with a currency code (EUR now, UAH later, never converted). Finance data lives in its own tables, room and finance-only files, so it never reaches the knowledge base, search, chat, digests or clients.

Built in five pull requests: A1 foundation first (schema, permission, empty screens), then A2 (time on done), B (documents and contracts) and C (overview, work log, rates, charts) in parallel, then D (system-wide page and rankings). Proposes to replace Phases 14–15 (owner decision 3).

Status: approved by the owner on 2026-10-17 (every recommendation of the Owner decisions table accepted as written), and extended the same day with time on tickets (spec request item 6, decisions 23–26; decision 24 decided by the owner the same day: time on tickets without a client is recorded without a client). **Part A1 (foundation) done** on `feat/finance-a1-foundation`: migration 0034 with every finance table (time entries for tasks, tickets and manual entries), the finance right with the superadmin's switch on the Admins page, `requireFinance`, the `finance` room and events, finance-only files, the Finance notification group, the shared money, duration and DTO schemas, the empty Financie tab and `/finance` page, the four locale namespaces and [ADR 0027](decisions/0027-sealed-finance-module.md). **Part A2 (time on done) done** on `feat/finance-a2-time`: the task and ticket hooks, `askTime`, the time dialog and its queue, My time in the task panel and on the ticket page, `task.time_missing` / `ticket.time_missing`, the "Vyplňte svoj čas" rows on My tasks, the time routes, migration 0035 (time without a client). **Part C (overview, work log, rates, manual entries) done** on `feat/finance-c-overview`: the Overview card (money by contract start month against the cost of the work, totals and balance per currency; hours as one chart per admin), the Work log card (months oldest at the top, month totals, ticket units, requests waiting for time, period filter, Show earlier), manual entries and corrections, hourly rates with effective dates, our own SVG charts ([ADR 0028](decisions/0028-finance-charts-own-svg.md)) and the EXPLAIN test on the seeded volume. **Part B (documents and contracts) done** on `feat/finance-b-documents`: the Documents card (contracts with number, EUR amount, period and files, documents, notes, folders, search, the type filter), finance-only uploads, contract reminders through the reminders module (kind `finance`, finance admins only, proposed 30 days before the end at 09:00, the Finance notification group), and its leak tests; see [finance.md](product/finance.md#documents-and-contracts). **Part D (system-wide page and rankings) done** on `feat/finance-d-system`: `/finance` with the remembered client filter (every client by default) and the Hourly rates button; the Overview and Work log across the chosen clients (each entry names its client, each month its top clients, the time without a client as "Bez klienta" on the all-clients view); the Contracts card (contracts of the chosen clients as a table, sorted by start, end or amount, "Ending soon" / "Ended", a search over every finance document and note); the rankings **Clients by money paid** (year and month, one currency) and **Clients by hours** (period, admin, Hours · Money); the phone segment Rankings; the EXPLAIN cases of the system-wide queries; see [finance.md](product/finance.md#system-wide). **Follow-up of part D done** on `feat/finance-system-add-time`: **Pridať čas** in the Work log of `/finance` with a client picker (every client or **Bez klienta**, `POST /api/finance/time-entries`, migration 0041 lets a manual entry lack a client) and one remembered **page period** (this year by default) that drives the Overview, Contracts (the contracts running in it), Work log and both rankings (which now take months or all time); EXPLAIN cases for the all-time rankings and the period contracts. Phases 14 and 15 are merged into this phase. Owner to check after the merge on https://help.egrant.sk: turn Finance on for one admin on the Admins page; that admin sees the Financie tab and header link at once (empty cards); another admin and a client do not, and get "Page not found" at `/finance`. For part C: in a client's Financie tab open **Hodinové sadzby**, set two admins' rates, add a time entry with **Pridať čas**, and check the cost in the work log, the month header and the Overview (Money and Hours). For part D: open **Financie** in the header; compare a client's numbers in its tab with `/finance` filtered to that client (they match); the rankings: this year's paid ranking lists the clients with contracts started this year, the hours ranking with one admin and **Peniaze** ranks by that admin's cost; on a phone the segment **Rebríčky** shows both; a ticket without a client resolved with time shows as "Bez klienta" on `/finance` only. For the follow-up: on `/finance` add time with **Pridať čas** for a chosen client and once with **Bez klienta** (both appear in the work log at once, the second in no client's tab); switch the page period to **Minulý rok** and see every card follow; reload and it is remembered.

**Part E (finance at organisation level, owner request of 2026-10-18) done** (PR #115): expenses (výdavky: an admin's salary or any other payment, with reminders) on `/finance` only, organisation documents, notes and folders without a client, contracts of several clients with a payer ("Nadradená organizácia") and shares that add up to the amount, each client's tab showing only its share, the `/finance` ledger with a type filter, the balance paid − expenses on `/finance` with every client, the paid ranking split by shares. [Spec](superpowers/specs/2026-10-18-finance-org-expenses-design.md) (decisions O1–O7, E1–E22), [plan](superpowers/plans/2026-10-18-finance-org-expenses.md), migration 0044.

Done when: a superadmin grants Finance to an admin; that admin keeps a client's contract with its reminder, completed tasks fill the work log (the other admin assignee is asked and fills 0), rates turn hours into cost, and `/finance` ranks the clients by money paid and by hours; no client and no admin without the right sees any of it.

## Phase 33 — Projects per client and closer eGrant integration

Owner request (2026-10-17), one of the last two big phases before the final testing. Design: [spec](superpowers/specs/2026-10-17-phase-33-projects-design.md) with the **Owner decisions** table at its top; [plan](superpowers/plans/2026-10-17-phase-33-projects.md).

Scope: a new first tab **Prehľad** in every group with **projects** (name, description, files) and their dated **events**; tasks and tickets placed on a project and an event (set by hand; projects and events created and updated by an eGrant webhook with pending changes reviewed field by field; tickets linked by the intake's new `project_id`); a **timeline** card (a straight line of events, Today marker, each event's open tasks and tickets and a done pile; one project's whole life or all projects; on phones a tap opens the event); cards of the client's active tickets and tasks with mine first; project and event filters on the Tasks and Tickets tabs; the Phase 28 **AI text tools, voice input and knowledge attachments in every description field** (one lazy description editor); Finance costs filtered by project and event (after Phase 32 C and D).

Built in six pull requests: P1 foundation first (the one migration, policy, projects API, empty tab), then P2 (task and ticket fields, filters), P3 (eGrant intake matching), P4 (timeline and cards) and P5 (description editor) in parallel, then P6 (finance filters). The joint merge order with Phases 32 and 34 is at the end of the plan.

Small feature with this phase (owner request 2026-10-17): a knowledge item of type "From chat" can be changed to a plain file; built separately on `feat/knowledge-chat-file-to-file` (spec §15).

Status: spec approved by the owner on 2026-10-17, with these amendments of the same day:

- Changes from the eGrant project webhook are never applied silently: they are pending changes on the project, reviewed field by field (decision 6).
- The group's clients create, edit, archive, merge and delete projects and events, and set them on tasks and tickets; a žiadateľ stays read-only (decisions 8, 8a).

Final eGrant API:

- Projects arrive by their own webhook `PUT /api/egrant/projects/:project_id`, which creates and updates them. It carries the name, the description and the full events list with `dd.mm.yyyy` dates; there are no event ids.
- The ticket intake sends only `project_id`. It links the new ticket to its project, now or when the project arrives. It never sets an event, and eGrant never updates a ticket.

The API is planned in [the integration guide](integrations/egrant-ticket-intake.md#projects-planned).

**Part P1 (foundation) done** on `feat/projects-foundation`: migration 0038 with every table of the phase (projects, events, files, name keys, eGrant changes and inbox, `knowledge_links`, the task and ticket columns with composite FKs, [ADR 0030](decisions/0030-projects-composite-keys-and-egrant-matching.md)), the policy, the projects API with name keys and aliases, the shared types of every part, the stubs of P2–P5, and the Prehľad tab with the projects card, the project sheet and the project and event dialogs; see [projects.md](product/projects.md#foundation-part-p1). Merge is part P3's. Next: P2, P3, P4, P5 in parallel. Owner to check after the merge on https://help.egrant.sk: in a client group open **Prehľad** (the first pill), create a project with a file, add two events in its sheet, then as a client of that group add a third event and archive the project (it moves to **Archivované**); a client of another group gets "Stránka sa nenašla" for the tab.

**Part P4 (timeline and cards) done** on `feat/projects-timeline` (after P1): the timeline with Today, gaps, Earlier/Later, the project select, each event's open tasks and tickets and done pile, the event sheet, the phone variant, the task panel over the tab, and the Tickets and Tasks cards with mine first; see [projects.md](product/projects.md#timeline-and-cards-part-p4). With part P2 in, "Show all" opens the Tasks (or Tickets) tab filtered by the event, and tasks and tickets get an event through P2's fields. Owner to check after the merge on https://help.egrant.sk: in a client's **Prehľad** add a project with an event last month, one today and one next year; the timeline shows them in order with **Dnes** between and a "mesiacov" gap mark; switch the select to that project and back; click an event's name for its sheet; on a phone the line shows dots only and a tap opens the sheet. The **Tikety** and **Úlohy** cards list your own ticket and task first.

**Part P2 (tasks and tickets on projects) done** on `feat/projects-links` (after P1, no migration): project and event selects on tasks (form, panel, review cards, which inherit a ticket's pair) and tickets (page, new-ticket dialog; a žiadateľ sees the name only), chips on cards and rows, Project and Event filters on the Tasks and Tickets tabs and a Project filter on the global board and global tickets list with one client; see [projects.md](product/projects.md#links-and-filters-part-p2). Owner to check after the merge on https://help.egrant.sk: in a client group with a project and an event, open a task, choose **Projekt** and **Udalosť**, save; on the Tasks tab choose **Projekt: …** and **Udalosť: …**: only that task stays; open a ticket of the client, set the same project and event, and filter the Tickets tab the same way.

**Part P5 (description editor) done** on `feat/description-editor` (after P1): the group AI routes, `knowledge/links.ts` with the žiadateľ read-through, and the description editor in every field of spec §10.1; see [projects.md](product/projects.md#description-editor-part-p5). Owner to check: open a task, press the microphone, dictate, then **AI nástroje → Formálnejšie**, attach a note with the book button and save; a client of the group sees the note card under the description.

**Part P6 (finance by project and event) done** on `feat/finance-projects` (after P2 and Phase 32 C, D, E; migration 0045): Project and Event filters on a client's Overview and Work log, a Project filter on `/finance` with one client, a contract's project, a manual entry's project and event; time entries keep their own copy of the pair (completion hooks, `onSubjectProjectChanged`, the merge hook that part P3's merge must call, the startup job `finance.backfill-projects`); see [finance.md](product/finance.md#finance-by-project-and-event). Owner to check: on a client's Financie tab pick a project in the Overview's Project pill, then an event, and compare the hours with the Work log under the same filters.

**Part P3 (eGrant project webhook, ticket links, merge)** is the last part: open as PR #113, waiting for eGrant to confirm the API. The phase is `done` when it merges.

Done when: eGrant's project call creates a client's project with its events and later changes wait for review, a ticket with its `project_id` lands in that project by itself, an admin puts it and a task on an event, the client and the admin browse the project's life on the timeline with Today marked, both tabs filter by the project, every description field offers AI, voice and knowledge, and a finance admin sees the project's cost.

## Phase 34 — Internal admin group

Owner request (2026-10-17), the second of the last two big phases. Design: [spec](superpowers/specs/2026-10-17-phase-34-admin-group-design.md) with the **Owner decisions** table; [plan](superpowers/plans/2026-10-17-phase-34-admin-group.md).

Scope: one internal group **"eGrant tím"** (a `groups` row with `kind = 'admin'`) whose members are all admins, without Tickets and Members tabs, with chat, tasks, knowledge, the Phase 33 projects dashboard and its own Finance tab; pinned first for admins; knowledge from it attachable to client places only when marked "Shareable with clients", read-only there and marked "eGrant tím"; the **three-tab attachment picker** (Knowledge, Tasks, Tickets) in every chat, limited to the client in client groups and across all clients with a client filter marking my clients in the admin group, with task and ticket cards and the žiadateľ rules.

Built in five pull requests: P34-A (the picker in client groups, can start before the rest) and P34-B (the admin group) first, then P34-C (knowledge sharing), P34-D (the picker in the admin group) and P34-E (finance in the admin group).

Status: spec approved by the owner on 2026-10-17 (every decision as written). **P34-B done** (branch `feat/admin-group`, migration 0037, [ADR 0029](decisions/0029-admin-group-as-a-group-row.md)): the admin group row with `kind`, the refusals (`409 admin_group`, `400 invalid_group`, `404`), every admin pickable there, All messages by default, the sidebar's Internal section, the pinned `/groups` row, the tabs without Tickets and Members, the client filter option. **P34-A done** (branch `feat/chat-attach-work`, migration 0039, the three-tab picker in client groups; in the admin group it works for its own tasks, and its Tickets tab stays empty until P34-D). **P34-C done** (branch `feat/admin-group-knowledge`, migration 0042, data only): "Only eGrant" / "Shareable with clients" in the admin group, `isShareableInto` for every attach and display check, the "eGrant tím" badge and the picker's source switch (admins), read-only opening through the message or description (`GET /api/knowledge-links/…`). **P34-D done** (branch `feat/admin-group-picker`, migration 0043, an index only): in the admin group the picker attaches every client's tasks, tickets (also without a client) and knowledge (admins-only too) under the client filter with my clients marked, and the cards name their client. **P34-E done** (branch `feat/admin-group-finance`, no migration): the admin group's Financie tab is the organisation's (reconciled with Phase 32 E: the Organizácia items, the internal time and the organisation's expenses; no store of its own, `409 admin_group`), `/finance` includes it in every client by default with an "eGrant tím" option to untick (owner decision of 2026-10-18), and the rankings never list it.

To walk on https://help.egrant.sk after the P34-C merge: in "eGrant tím" a new note says "Only eGrant"; in a client's chat the picker's Knowledge tab has "eGrant tím", which does not list it; switch the note to "Shareable with clients" (the dialog says what that means), it is listed, attach it; the client sees the card with the "eGrant tím" badge and opens it read-only; switch it back and the card reads "Item unavailable".

To walk on https://help.egrant.sk after the P34-B merge: "eGrant tím" is first in the home sidebar under Internal and pinned on `/groups`; its tabs are Chat, Tasks, Knowledge (and Financie for finance admins); a second admin hears its messages without touching the bell; every admin is offered as an assignee; a client opening its address gets "Page not found"; rename it from its header (name and logo only).

Done when: every admin works in "eGrant tím" (chat, tasks, projects, knowledge, finance for finance admins) with no way in for a client; an admin shares one internal note with a client chat on purpose and the client opens only that; a message in a client chat carries a task and a ticket card, and in the admin group any client's work with the client filter.
