# Product requirements

Requirements for Spolu, one topic per file. The product name is "Spolu" (full brand "Spolu by eGrant"), formerly the working title eHub. Written for AI agents and the product owner. Phase numbers follow `docs/roadmap.md`.

| file | what it covers | phase(s) |
|---|---|---|
| `overview.md` | what Spolu is, general principles, out of scope | all |
| `roles-and-access.md` | Administrator and Client roles, what each sees | 2, 3, 14 |
| `auth.md` | invite registration, email-code login, superadmin, admins, optional password | 2, 3, 16 |
| `groups.md` | groups, fields, invite links, members, removing a client | 3 |
| `chat.md` | group chat, threads, mentions, attachments, edit/delete, unread | 4, 5, 10, 11 |
| `direct-messages.md` | one-to-one chats and who can write to whom | 7 |
| `task-board.md` | Kanban board, buckets, task card, task chat, message to task | 8, 9, 10 |
| `knowledge-base.md` | Knowledge tab (notes, files, links, reminders), visibility, global list | 17 |
| `reminders.md` | reminders of knowledge items (and tasks), recipients, calendar export | 17, 19 |
| `ai-task-split.md` | AI split of one message into several tasks | 11 |
| `tickets.md` | tickets from eGrant, URL normalization, statuses, replies | 12, 13 |
| `contracts.md` | admin-only contracts, next-contract draft, reminders, global list | 14, 15 |
| `notifications.md` | modes per group, push and email channels | 6 (and 7, 9, 12, 15) |
| `profile.md` | name, avatar, language, password, message search | 16 |
| `integrations.md` | eGrant, Elastic Email, LLM API | 2, 11, 12, 13 |
| `non-functional.md` | PWA, languages, realtime, backups (DB nightly in 1; off-site and files in 16), monitoring (16), design rule | 1, 16 |
