# Spolu — Phase 8: Task board (design)

Date: 2026-10-15 · Status: approved by the owner in brainstorming, written spec awaiting review

Requirements: [task-board](../../product/task-board.md). Roadmap entry: [Phase 8](../../roadmap.md#phase-8--task-board). Builds on [Phase 4](2026-10-15-phase-4-shared-foundation-design.md) (files, notification events, group rooms, group tabs).

Built on branch `phase-8`, cut from `phase-4`, **in parallel with Phase 5** (`phase-5`, group chat). This branch touches only `modules/tasks`, `features/tasks`, its migration, its i18n keys, its docs and the shared types it adds. Whichever of 5 and 8 merges second regenerates its drizzle migration.

## Goal

Every group has a Kanban board: four fixed buckets, custom buckets between them, task cards with title, description, creator, assignees, deadline, urgent flag and files, drag and drop, live updates for everyone looking at the board. The task form is one reusable component, so Phase 9 uses it to review the cards the AI proposes.

## Owner decisions (brainstorming, 2026-10-15)

| question | decision |
|---|---|
| Fixed buckets | **To do**, **eGrant review**, **<client> review** (follows the group name), **Completed**. Created for every group; cannot be renamed, deleted or moved. To do is always first, Completed always last. |
| Custom buckets | Allowed between To do and Completed; only admins create, rename, reorder and delete them. |
| Clients | Create, edit and move tasks, and write in task chats. |
| Card fields | Title, description, creator, **one or more assignees**, deadline, files, **urgent** flag. No priority or labels. |
| Message ↔ tasks | A task made from a chat message links back to it ("Created from a message", opens the chat at that message); the message lists its tasks (Phase 9). |
| Notifications | Moving a task to another bucket notifies its creator and every assignee; every assignee gets deadline reminders (3, 2, 1 days before) and, for urgent tasks, a reminder every 3 hours. Recorded here, delivered and scheduled in Phase 6. |
| Reuse | The task form is the same in the board and in the AI review screen (Phase 9). |

Controller rulings (technical, owner informed):

- Assignees: zero or more, each a person of the group (Phase 4 `useGroupPeople`: a client of the group or an active admin), max 10. If an assignee is removed from the group later, the task keeps them and shows the name as "(removed)".
- Deleting a task: admins, and the client who created it. Deleting a custom bucket moves its tasks to the end of To do.
- Deadline is a date (no time). Overdue = the date is before today in Europe/Bratislava and the task is not in Completed.
- Editing in the task panel saves with an explicit "Save changes" (no autosave): one behaviour for the board and the AI review.
- Concurrent edits: last write wins; the other user's panel shows "Changed by Jana just now. Reload" if the task changes under an unsaved form (the form never overwrites silently).
- Order inside a bucket is a fractional-index string (`fractional-indexing`, ~1 kB), computed **by the server** from "place after task X": two people dragging at once never corrupt the order.
- Drag and drop with `@dnd-kit/core` + `@dnd-kit/sortable` (keyboard and touch support, accessible) inside the lazy Tasks chunk. Rejected: native HTML5 drag and drop (no touch, poor keyboard).
- The board of a group is created lazily the first time it is read (`ensureBoard`), so the groups module is not touched and old groups need no backfill.

## User experience

All copy is the English source; Slovak goes in `sk.json`. Designed with `frontend-design` on the egrant.sk tokens (`docs/design/tokens.md`).

Bucket names: "To do", "eGrant review", "<group name> review", "Completed" (Slovak: "Na spracovanie", "Kontrola eGrant", "Kontrola <group name>", "Hotové").

### Board (Tasks tab)

```
[Tasks]  ─ [+ Add bucket] (admins)
┌ ■ To do  4 ─┐ ┌ My bucket 2 ┐ ┌ ■ eGrant review 1 ┐ ┌ ■ ABC review 0 ┐ ┌ ■ Completed 7 ┐
│┌───────────┐│ │             │ │┌─────────────────┐│ │ Nothing here   │ │               │
││Urgent     ││ │             │ ││Budget table     ││ │ yet.           │ │               │
││Fix budget ││ │             │ ││(JN) 📎2  20 Oct ││ │                │ │               │
││(VH) 18 Oct││ │             │ │└─────────────────┘│ │                │ │               │
│└───────────┘│ │             │ │                   │ │                │ │               │
│ + Add task  │ │ + Add task  │ │ + Add task        │ │ + Add task     │ │ + Add task    │
└─────────────┘ └─────────────┘ └───────────────────┘ └────────────────┘ └───────────────┘
```

Order: To do, custom buckets, eGrant review, <client> review, Completed. The flow is work → eGrant checks → client checks → done, so a new custom bucket goes after the last custom bucket (or right after To do when there is none); an admin may reorder custom buckets anywhere between To do and Completed.

- Columns 288 px wide on the `muted` (#F0EDEA) tile color with the card radius, side by side; the board scrolls horizontally, each column scrolls vertically. Under 641 px each column takes the full width minus a peek of the next one (scroll-snap).
- Column header: name, task count. The four fixed buckets carry a small 8 px square of color that says what kind of step they are: To do `ink` outline, eGrant review `brand-purple`, <client> review `brand-blue`, Completed `success`. Custom buckets have none. Admins see a "More" menu on custom buckets (Rename, Delete).
- **Card**: white `card`, title (max 3 lines), then one meta row: assignee avatars (overlapping, up to 3, then "+2"), deadline ("18 Oct"; `error-ink` text when overdue), paperclip with the file count, and in Phase 9 the chat count. Cards in Completed show the title in `muted-foreground`.
- **Urgent** is the board's one loud signal: a filled `destructive` pill "Urgent" above the title. Nothing else on the card uses color.
- "+ Add task" at the bottom of each column: an inline title field (Enter creates the task in that bucket, Esc cancels). Details are added in the task panel.
- Drag: the card lifts (shadow token), a placeholder shows where it lands; drop saves at once. Keyboard: focus a card, Space to pick up, arrows to move, Space to drop (dnd-kit announcements, translated). Touch: press and hold 250 ms to drag.
- Empty bucket: "Nothing here yet." Empty board with no tasks: the To do column says "Add the first task for this group."

### Task panel

Route `/groups/:id/tasks/:taskId` (links from chat in Phase 9 open it). Desktop: a 560 px panel sliding over the right of the board; under 1024 px a full-screen page with a back button.

- Top: bucket select (moves the task), "More" menu with Delete (creator or admin; inline confirm "Delete this task? Its files are deleted too.").
- `<TaskForm>`: title (required, max 200), description (multi-line, max 10 000), assignees (searchable multi-select of `useGroupPeople`, chosen people shown as removable chips with avatar and the "eGrant" pill on admins), deadline (native date input), urgent (switch with the label "Urgent"), files (upload with `features/files`, list with chips and image previews, remove a file before saving).
- Footer: "Created by Jana Nováková on 15 Oct 2026". Phase 9 puts the task chat below the form (slot `children`).
- "Save changes" / "Cancel" appear when the form is dirty; leaving with unsaved changes asks inline first.
- When the task was made from a chat message, the panel shows "Created from a message" above the form: the author, the first 140 characters and a link that opens the chat at that message (Phase 5 `?message=` link). The field exists in this phase (`source_message_id`); Phase 9 fills it.

### Bucket management (admins)

"+ Add bucket" after the last custom bucket: an inline name field. Rename in place from the column menu. Delete asks inline: "Delete this bucket? Its tasks move to To do." Custom buckets are dragged by their header to reorder (only between To do and Completed; fixed buckets cannot be dragged).

## Architecture

### Reuse: `<TaskForm>`

`features/tasks/task-form.tsx` exports `<TaskForm value onChange groupId errors? />`: controlled fields only, no saving, no bucket select. The task panel wraps it with save logic; Phase 9's AI review screen renders one `<TaskForm>` per proposed card with its own Approve / Reject. Its value type `TaskDraft { title, description, assigneeIds, dueDate, urgent, fileIds }` is in `packages/shared`, and the create endpoint accepts exactly this shape (plus `bucketId`), so Phase 9 creates approved cards through the same endpoint.

Shared with the chat from Phase 4: `<Avatar>` and `useGroupPeople(groupId)` (the assignee select lists exactly these people).

### Data (`modules/tasks`)

| table | columns |
|---|---|
| `buckets` | `id`, `group_id` (FK cascade), `kind` (`todo` \| `egrant_review` \| `client_review` \| `done` \| `custom`, CHECK), `name` (custom only, max 60; CHECK null for fixed kinds), `position` text, `created_at`. Partial unique index on (`group_id`, `kind`) where `kind <> 'custom'`. |
| `tasks` | `id`, `group_id` (FK cascade, indexed), `bucket_id` (FK), `position` text, `title`, `description`, `created_by` (FK user), `due_date` date nullable, `urgent` boolean default false, `completed_at` (set when moved into Completed, cleared when moved out), `source_message_id` (nullable; FK added in Phase 9), `created_at`, `updated_at`. Index (`bucket_id`, `position`); index (`due_date`) where not completed, and (`urgent`) where urgent — both for Phase 6 reminders. |
| `task_assignees` | `task_id`, `user_id` (PK both, cascade; index on `user_id` for "my tasks" and reminders) |
| `task_attachments` | `task_id`, `file_id` (PK both, cascade) |

Fixed-bucket positions are fixed keys (`a0` … and `z0` for Completed) so custom buckets always fall between; the server refuses a custom bucket position outside them.

### Policy

`modules/tasks/policy.ts`: `canUseBoard(actor, groupId, actorGroupId)` = `canReadGroup`; `canManageBuckets` = admin; `canDeleteTask(actor, task)` = admin or `task.createdBy === actor.id`. Fixed buckets: any rename/delete/move answers 400 `fixed_bucket`. Unreadable group, task or bucket: 404.

### Endpoints

| method | path | what |
|---|---|---|
| GET | `/api/groups/:id/board` | `{ buckets, tasks }` (created lazily); tasks with assignees, creator, file count |
| POST | `/api/groups/:id/buckets` | admin; `{ name }` → bucket placed after the last custom bucket |
| PATCH | `/api/buckets/:id` | admin; `{ name?, afterBucketId? }` |
| DELETE | `/api/buckets/:id` | admin; tasks move to the end of To do; 204 |
| POST | `/api/groups/:id/tasks` | `TaskDraft & { bucketId? }` (default To do) → 201 task, added at the end of the bucket |
| GET | `/api/tasks/:id` | task with files (`FileInfo`) |
| PATCH | `/api/tasks/:id` | partial `TaskDraft` plus `updatedAt` of the version being edited; a stale `updatedAt` answers 409 `task_changed` |
| POST | `/api/tasks/:id/move` | `{ bucketId, afterTaskId: string \| null }` → task with its new position |
| DELETE | `/api/tasks/:id` | creator or admin; files deleted; 204 |

Rate limit: 120 writes/min per user. Validation in `packages/shared` (`TaskDraft`, `TaskDto`, `BucketDto`). An assignee who is not one of the group's people, or more than 10, answers 400 `invalid_assignee`.

### Realtime

Into the group room (`emitToGroup`, Phase 4) after commit:

- `board:task` `{ task }` — created, edited or moved; the client upserts it in the board cache and re-sorts the bucket.
- `board:task_deleted` `{ taskId }`.
- `board:buckets` `{ buckets }` — after any bucket change, the full list (small).

After a reconnect the board refetches `GET …/board` (one request; boards are small), instead of a `seq` catch-up.

### Notification events (recorded, not delivered)

In the same transaction (`recordNotifications`, Phase 4), never for the person who acted:

- `task.moved` — when the bucket changes: to the creator and every assignee. Payload `{ taskId, groupId, title, fromBucket, toBucket, actorName }` (bucket names resolved at that moment).
- `task.assigned` — to each person newly added as an assignee.

Deadline and urgent reminders are not events: Phase 6 schedules them by reading `tasks` (`due_date`, `urgent`, `completed_at`) and `task_assignees`.

## Error handling

Moving a task that someone just deleted: 404, the card disappears with a short notice "This task was deleted." A drop that the server refuses rolls the card back to where it was. `task_changed` (409): the panel shows "Changed by someone else. Reload" and keeps the user's text until they choose. Upload errors come from `features/files`.

## Testing

- Server (test-first): lazy board creation (exactly four fixed buckets, once, also under two parallel first reads); fixed buckets cannot be renamed, moved or deleted; custom bucket order stays between To do and Completed; delete bucket moves tasks to To do; create/edit/move/delete with permissions (client creates and moves, cannot manage buckets, deletes only own tasks); `invalid_assignee`; `task_changed`; fractional positions under concurrent moves stay unique and ordered; `completed_at` set and cleared; notification events (moved → creator + assignee minus actor; assigned); another group's client gets 404 everywhere.
- Web: `<TaskForm>` controlled behaviour and validation; board renders buckets in order with counts; inline add; card meta (overdue, urgent); keyboard drag; socket upsert re-sorts; stale form notice.
- E2E (two browsers): admin and client on one board; the client creates a task, the admin sees it live, drags it to eGrant review, the client sees it move; the admin adds and deletes a custom bucket; a file attached to a task can be downloaded.

## Done when

An admin and a client work on the board at the same time and see each other's changes live: create, edit, mark urgent, attach a file, drag between and inside buckets; an admin manages custom buckets; fixed buckets cannot be changed.

## Documentation updates in this phase

`architecture/data-model.md` (Bucket, Task, task attachments built; priority and labels removed), `architecture/realtime.md` (board events), `architecture/permissions.md` (task policy), `architecture/overview.md` (tasks module), `docs/design/tokens.md` (board as built), glossary (bucket, urgent).

## Out of scope

Task chat and tasks from messages (Phase 9), delivery of notifications and reminders (Phase 6), filters and search on the board, task history log, time of day on deadlines.
