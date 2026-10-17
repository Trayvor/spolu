# Product requirements

Requirements for Spolu, one topic per file. The product is shown to users as "Help" (full brand and wordmark "Help by eGrant", since 2026-10-16; before that "Spolu by eGrant"); Spolu stays the code name in code, packages, databases and these docs. Formerly the working title eHub. Written for AI agents and the product owner. Phase numbers follow `docs/roadmap.md`.

| file | what it covers | phase(s) |
|---|---|---|
| [overview.md](overview.md) | what Spolu is, general principles, naming, out of scope | all |
| [roles-and-access.md](roles-and-access.md) | Administrator and Client roles, the `ziadatel` membership, what each sees | 2, 3, 14, 21 |
| [auth.md](auth.md) | invite registration, email-code login, superadmin, admins, optional password | 2, 3, 16 |
| [groups.md](groups.md) | groups, fields, invite links, members, invites by email, the Groups page | 3, 21, 22 |
| [client-managers.md](client-managers.md) | admins who manage a client: mentions, assignees, notifications | 18, 22 |
| [chat.md](chat.md) | group chat, threads, mentions, attachments, edit/delete, unread | 4, 5, 9 |
| [direct-messages.md](direct-messages.md) | one-to-one chats and who can write to whom | 7 |
| [task-board.md](task-board.md) | Kanban board, buckets, task card, task chat, message to task | 8, 9, 19 |
| [admin-home.md](admin-home.md) | the admin dashboard, the client sidebar, the global task board | 20 |
| [knowledge-base.md](knowledge-base.md) | Knowledge tab (notes, files, links, reminders, files from chats), folders, visibility, global list | 17, 24, 25 |
| [reminders.md](reminders.md) | reminders of knowledge items and tasks, recipients, calendar export | 17, 19 |
| [ai-task-split.md](ai-task-split.md) | AI split of one message (or ticket) into several tasks | 9, 21 |
| [tickets.md](tickets.md) | tickets from eGrant, clients and admins, statuses, ticket chat, riešitelia and watching | 21 |
| [solve-with-claude.md](solve-with-claude.md) | admins open a ticket or task in Claude with its context and the eGrant MCP instructions | 29 |
| [contracts.md](contracts.md) | admin-only contracts, next-contract draft, reminders, global list (to be replaced by Finance, spec decision 3) | 14, 15 |
| [projects.md](projects.md) | projects and dated events per client, the Prehľad tab; later the timeline, eGrant projects and filters | 33 |
| [finance.md](finance.md) | Finance (Finančná správa): the finance right, the client tab and `/finance`, time on tasks and tickets, contracts, work log, rates | 32 |
| [bulk-email.md](bulk-email.md) | admins' bulk email: campaigns, drafts, audience rules, unsubscribe, report | 23 |
| [notifications.md](notifications.md) | notification groups, modes per group, push and email channels | 6 (and 7, 15, 21) |
| [profile.md](profile.md) | name, avatar, language, password, message search | 6, 16, 26 |
| [integrations.md](integrations.md) | eGrant, Elastic Email, LLM API | 2, 9, 21, 23 |
| [non-functional.md](non-functional.md) | PWA, nine languages, realtime, backups (DB nightly in 1; off-site and files in 16), monitoring (16), design rule | 1, 16, 26 |
