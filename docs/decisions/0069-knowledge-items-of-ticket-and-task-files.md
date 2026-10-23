# 0069: Knowledge items of ticket and task files, kept by FK cascades and one in-transaction sync

- Status: accepted
- Date: 2026-10-22

## Context

Phase 25 lists every chat file in the knowledge base (`chat_file`). The chat module calls the
knowledge base through a listener registry (`chat/file-hooks.ts`), and each entry cascades from
its `message_attachments` row. The owner asked for the files of tickets and of task cards too
(2026-10-22, [spec](../superpowers/specs/2026-10-22-knowledge-ticket-task-files-design.md)).
Ticket files are written in two places (the manual form, the intake) and move with the ticket;
task card files in three (create, cards from a source, edit).

## Decision

- **Two more types**, `ticket_file` and `task_file`, with three columns on `knowledge_items`:
  `source_ticket_id`, `source_task_id`, `source_file_id`. Composite foreign keys to
  `ticket_attachments (ticket_id, file_id)` and `task_attachments (task_id, file_id)` with
  `ON DELETE CASCADE`, as for chat files: whatever removes the attachment row (a file taken off
  the card, a deleted task, ticket, file or group) removes the entry, with no code path to forget.
- **One sync function per source, called directly** by the tickets and tasks services inside the
  transaction that writes the attachments (`syncTicketFiles`, `syncTaskFiles` in
  `knowledge/source-files.ts`). Each is one `INSERT ... SELECT ... ON CONFLICT DO NOTHING` over
  the attachment rows (and, for a ticket, one `UPDATE` of the group), so it is idempotent and the
  same SQL backfills migration 0072. No listener registry: the tasks service already calls the
  knowledge module (links), and a registry only paid off for the chat, whose module the knowledge
  schema imports.
- **The live pushes run in the routes** after the commit (`emitTicketFileItems`,
  `emitTaskFileItems`), like the chat's `sent` hook.

## Consequences

- Visibility, author and search text are SQL in one place (`source-files.ts`), mirrored by the
  backfill; a test runs the backfill against the API's result.
- `canConvertChatFile` became `canConvertFile` for the three automatic types; the `to-file` route
  and service work on the shared `coalesce(chat_file_id, source_file_id)`. Since 2026-10-23
  (owner decision) it allows admins, the author and the group's managers (active `client`
  members), so every reader of an automatic file; a manager's result stays public.
- An intake file has no uploader: its author is the ticket's initiator, else (no account) the
  ticket's creator, else the first superadmin, in the sync and in the backfill alike.
- Removals and moves away are not pushed live (next load), as for chat files of a deleted task.
