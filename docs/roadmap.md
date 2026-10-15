# Roadmap

17 phases (0-16). Each phase ends with something that works and can be used. Update the `Status` column when a phase starts or finishes (values: `planned`, `in progress`, `done`). The `implement-phase` and `update-kb` skills do this.

Requirements per module: [product/](product/README.md). Phases after 1 get their own short design and plan when they start.

| # | Phase | Status | Depends on | Design/plan |
|---|---|---|---|---|
| 0 | [AI workflow & knowledge base](#phase-0--ai-workflow--knowledge-base) | in progress | - | [spec](superpowers/specs/2026-10-15-ehub-foundation-design.md), [plan](superpowers/plans/2026-10-15-phase-0-ai-workflow-and-kb.md) |
| 1 | [Skeleton & delivery](#phase-1--skeleton--delivery) | planned | 0 | [spec](superpowers/specs/2026-10-15-ehub-foundation-design.md), [plan](superpowers/plans/2026-10-15-phase-1-skeleton-and-delivery.md) |
| 2 | [Login & users](#phase-2--login--users) | planned | 1 | - |
| 3 | [Groups & invites](#phase-3--groups--invites) | planned | 2 | - |
| 4 | [Group chat: core](#phase-4--group-chat-core) | planned | 3 | - |
| 5 | [Chat: threads, mentions, files](#phase-5--chat-threads-mentions-files) | planned | 4 | - |
| 6 | [Notifications](#phase-6--notifications) | planned | 5 | - |
| 7 | [Direct messages](#phase-7--direct-messages) | planned | 3, 6 | - |
| 8 | [Task board: core](#phase-8--task-board-core) | planned | 3 | - |
| 9 | [Task attachments & task chat](#phase-9--task-attachments--task-chat) | planned | 8 | - |
| 10 | [Message to task](#phase-10--message-to-task) | planned | 5, 8 | - |
| 11 | [AI split into tasks](#phase-11--ai-split-into-tasks) | planned | 10 | - |
| 12 | [Tickets: intake from eGrant](#phase-12--tickets-intake-from-egrant) | planned | 3 | - |
| 13 | [Tickets: replies](#phase-13--tickets-replies) | planned | 12 | - |
| 14 | [Contracts](#phase-14--contracts) | planned | 3 | - |
| 15 | [Contract reminders](#phase-15--contract-reminders) | planned | 6, 14 | - |
| 16 | [Password & polish](#phase-16--password--polish) | planned | 5 | - |

Phases 8, 12 and 14 do not depend on each other, so their order can change by priority.

## Phase 0 - AI workflow & knowledge base

Scope:
- Git repository, `.gitignore`, private GitHub repo.
- `docs/` knowledge base: product requirements, architecture, ADRs, runbook stubs, roadmap, glossary, design rule.
- Root `CLAUDE.md` and project skills (`update-kb`, `new-module`, `implement-phase`).
- `.claude/settings.json` with the `frontend-design` plugin and a Stop hook reminding to update docs.
- `scripts/check-docs.sh` (warns when code changes without docs).

Done when: a fresh AI session, given only the repo, can explain the architecture and the next phase from `docs/`; the owner can read `docs/README.md` then `architecture/overview.md` and understand the system. No product code.

## Phase 1 - Skeleton & delivery

Scope:
- Monorepo (pnpm workspaces), shared TS config, lint, format, `packages/shared` with zod.
- `apps/server`: Fastify, validated config, Drizzle + migrations, `GET /api/health`, Socket.IO ping/pong, pg-boss, `EmailSender` and `Storage` interfaces.
- Design extraction from egrant.sk via `frontend-design` into theme tokens and `docs/design/`.
- `apps/web`: Vite, React, TanStack Router/Query, Tailwind, shadcn/ui, SK/EN switcher, PWA shell.
- Local dev with Docker Compose (Postgres, Mailpit); tests (Vitest, Playwright smoke).
- Production: multi-arch Dockerfile, `docker-compose.prod.yml` (app, postgres, caddy), `.env.example`.
- Scripts (`ci.sh`, `build-image.sh`, `deploy.sh`, `server-setup.sh`) and a thin GitHub Actions workflow.
- Runbooks filled in (server setup, deploy, rollback, backup).

Done when: a push to `main` deploys automatically; the HTTPS shell shows DB health OK and a live socket connection, switches SK/EN, visibly matches the egrant.sk look, and can be installed as an app on phone and desktop.

## Phase 2 - Login & users

Requirements: [auth](product/auth.md), [roles-and-access](product/roles-and-access.md).

Scope:
- Superadmin created on first start (email from `SUPERADMIN_EMAIL`); cannot be deleted or demoted.
- Login by one-time email code (Elastic Email), long-lived session.
- Superadmin creates other admins by email.

Done when: the superadmin logs in by email code and creates another admin who can log in.

## Phase 3 - Groups & invites

Requirements: [groups](product/groups.md), [auth](product/auth.md), [roles-and-access](product/roles-and-access.md).

Scope:
- Admin creates and edits a group: name, logo, client's eGrant URL; list of all groups.
- Invite link: client enters email, gets a code, joins the group.
- Member list; admin can remove a client.
- Client sees only their group; admin sees all.

Done when: an admin creates a group with a logo and copies the invite; a client registers by email and sees only their group; the admin can remove the client.

## Phase 4 - Group chat: core

Requirements: [chat](product/chat.md).

Scope:
- One chat per group, realtime messages (WebSocket).
- Missed messages are loaded after reconnect.
- Edit and delete own messages.
- Unread indicator.

Done when: realtime messages work, catch-up after reconnect works, own messages can be edited and deleted, unread indicator shows.

## Phase 5 - Chat: threads, mentions, files

Requirements: [chat](product/chat.md).

Scope:
- Threads under messages.
- @mentions of users.
- Attachments (files and images, with image previews).

Done when: a client chats with thread replies, mentions and files without reloading the page.

## Phase 6 - Notifications

Requirements: [notifications](product/notifications.md), [profile](product/profile.md).

Scope:
- Web Push (PWA) on phone and desktop.
- Per group, the user picks a mode: all / mentions only / nothing.
- In the profile: push on by default, email can be turned on additionally.
- Notifications about replies in threads the user took part in.

Done when: a client gets a push about a new message according to their mode, and with email on, also an email.

## Phase 7 - Direct messages

Requirements: [direct-messages](product/direct-messages.md).

Scope:
- One-to-one chats.
- An admin can write to anyone. A client can write to admins and people from their own organization.
- Realtime, attachments, unread, notifications (from phase 6).

Done when: a client writes to an admin and to a colleague from their organization, and does not see people from other organizations.

## Phase 8 - Task board: core

Requirements: [task-board](product/task-board.md).

Scope:
- A task board in every group.
- Buckets: create, rename, delete, reorder.
- Tasks: create, edit, delete. Fields: title, description, assignee, deadline, priority, labels.
- Drag and drop of tasks between buckets and inside a bucket.
- Realtime: other users' changes appear at once.
- Clients can create and edit tasks.

Done when: an admin and a client work on the board at the same time and see each other's changes live.

## Phase 9 - Task attachments & task chat

Requirements: [task-board](product/task-board.md).

Scope:
- Attachments (files, images) on the task card.
- Task chat with threads, mentions and attachments.
- Notifications from the task chat.

Done when: a task can be discussed with threads and files can be attached.

## Phase 10 - Message to task

Requirements: [task-board](product/task-board.md), [chat](product/chat.md).

Scope:
- Message action "Create task".
- A form opens first: edit the task fields and pick a bucket.
- The task links to the source message; the message is marked "converted to task".

Done when: a task can be created from any message in 2 clicks.

## Phase 11 - AI split into tasks

Requirements: [ai-task-split](product/ai-task-split.md), [integrations](product/integrations.md).

Scope:
- Action "Split into tasks with AI".
- AI returns a list of tasks (title and description).
- Preview: edit, delete and add tasks, pick a bucket.
- Cards are created only after confirmation.

Done when: a message with 5 jobs becomes 5 cards after the user reviews them.

## Phase 12 - Tickets: intake from eGrant

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

## Phase 13 - Tickets: replies

Requirements: [tickets](product/tickets.md).

Scope:
- An admin replies to a ticket from the UI.
- The reply is stored in the ticket (visible in eHub).
- Email via Elastic Email to the client (email from the ticket) with the manager in copy, so "Reply all" reaches the manager.

Done when: the client receives an email with the reply and the conversation is visible in the ticket.

## Phase 14 - Contracts

Requirements: [contracts](product/contracts.md), [roles-and-access](product/roles-and-access.md).

Scope:
- "Contracts" module in a group, admins only. Clients do not see it at all.
- Contract: date from / to, amount, files, notes.
- Draft of the next contract with the same fields.
- Global contract list with sorting and filters.

Done when: an admin keeps the contracts of all clients and sees them in one list.

## Phase 15 - Contract reminders

Requirements: [contracts](product/contracts.md), [notifications](product/notifications.md).

Scope:
- Per contract: how many days before signing to remind.
- A background scheduler sends reminders to admins by push and email (per profile settings).
- The global list marks contracts that "expire soon" and need "communication".

Done when: on the set day the admins receive a reminder about the contract.

## Phase 16 - Password & polish

Requirements: [profile](product/profile.md), [auth](product/auth.md), [non-functional](product/non-functional.md).

Scope:
- Optional password in the profile as an alternative to code login.
- Profile: name, avatar, language.
- Search over group messages.
- Database and file backups (including off-site), error monitoring.

Done when: the system is ready for the team to move fully from Teams.
