# 0060 Opening a subject reads its notifications: a subject key and a partial index of unread items

Date: 2026-10-19
Status: accepted

## Context
[ADR 0058](0058-notification-read-on-open.md) let the person read one notification centre item by opening that notification (a click in the bell's list or on a push). Opening the task, ticket or chat by any other route (the board, a list, search, a direct link) left its notifications unread, so the bell kept counting what the person had already looked at. The owner asked that opening a subject by any route read all of the person's unread notifications about it, the bell's count drop live, and the task and ticket lists mark what still has unread notifications.

## Decision
- **A subject key per event**, computed in SQL from the kind and the payload (`notificationSubjectSql`, `modules/notifications/subject-read.ts`), the same subject the push's device tag names: `ticket:<ticketId>` first (a mention in a ticket chat carries it), then `task:<taskId>` (its chat's messages too), `knowledge:<itemId>` for a meeting, `<subjectKind>:<subjectId>` for a description mention or a reminder (`project`, `knowledge`, `event`, `finance`), and last `chat:<channelId>` for a group chat message or thread reply. No new column: the table is the largest one and a stored column would rewrite it.
- **A partial expression index of unread items**: `notification_events_unread_subject_idx` on `(user_id, <subject key>, created_at) where in_centre and read_at is null` (migration 0066). It holds only unread centre items, so it stays small, and both the write and the lists' check are one index range.
- **The existing open writes read it**, so one HTTP write does both: `POST /tasks/:id/seen`, `POST /tickets/:id/seen`, `POST /projects/:id/seen`, `POST /knowledge/:id/seen`, `POST /channels/:id/read` and `/read-all` (a group chat), and a new `POST /project-events/:id/seen` (the event sheet; it has no seen table, it only reads notifications). Each first checks the person may open the subject (404 otherwise) and only updates the person's own rows newer than their "Mark all as read". When anything was read the server emits `notifications:read` `{ id: null, subject }` to the person's user room; one item read from the bell now carries its `subject` too.
- **The lists' marks include unread items**: the unseen mark of a task or ticket (`taskUnseenSql`, `ticketUnseenSql`, the board's `boardUnseenSql`) is also set (`change`, the plain dot) when the person has an unread centre item about it, whatever its kind (an urgent-task reminder, a time request, a rating). The header counts, the sidebar and the workload card still count unseen changes only. The web lists refetch their marks on `notifications:read`.

## Consequences
- Opening a task's panel, a ticket's page, a group chat, a project, a knowledge item or a project event reads its notifications; no client change was needed for the routes that already marked a subject seen. A finance item has no open route that reads its reminders yet.
- One more indexed update per open (a no-op when there is nothing unread), and one index probe per row of a list page for the mark.
- A group chat read reads every item of the channel, its thread replies too, not only those up to the read time.
