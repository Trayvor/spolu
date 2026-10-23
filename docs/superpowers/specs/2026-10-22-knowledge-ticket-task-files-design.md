# Knowledge: files from tickets and tasks, and "Save as a file" from the list

Status: built on `feat/knowledge-ticket-task-files` (2026-10-22). Requirements: [product/knowledge-base.md](../../product/knowledge-base.md), "Files from tickets and tasks". Approach: [ADR 0069](../../decisions/0069-knowledge-items-of-ticket-and-task-files.md).

## Owner request (2026-10-22)

1. Besides "Z chatu" (`chat_file`, Phase 25), the knowledge base lists files from **tickets** and from **tasks** automatically, as their own read-only types.
2. For all three automatic types, people can **convert** an item into a normal file item that then shows among all knowledge (its folder, "All"). The owner thought this was missing: it existed only in the detail (`?k=<id>`), which a chat file's row never opens (the row opens the chat).

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Types and names | `ticket_file` "Z tiketu" (en "From ticket") and `task_file` "Z úlohy" ("From task"), after `chat_file`; all nine languages in the lazy `knowledge` namespace, using the existing per-language words for ticket and task. `KnowledgeAutoFileTypes` / `isAutoFileType` in `@spolu/shared` name the three automatic types. |
| 2 | Which ticket files | `ticket_attachments`: the files uploaded with a ticket in the manual form or sent to the eGrant intake. Files sent in the ticket's chat stay `chat_file` (no duplicates). A ticket without a client produces nothing; its entries appear when it gets one. |
| 3 | Which task files | `task_attachments`: the files on the task card itself (created with it, added in an edit, or copied from a ticket or message when the card was made). Files of the task's chat stay `chat_file`. A file copied from a ticket to a task is a separate file row, so it is listed once under each. |
| 4 | Lifecycle | Created in the same transaction as the attachment rows (`syncTicketFiles`, `syncTaskFiles` in `knowledge/source-files.ts`, called by the tickets and tasks services). Removed by a composite FK `ON DELETE CASCADE` from the attachment row: a file removed from the card, a deleted task or ticket, a deleted file or group. A ticket moved to another client moves its entries (and adds them on its first client). |
| 5 | Visibility | Who reads the source: admins and every client of the group read all its tickets and tasks; a ziadatel reads no knowledge. So the entry is `public`; `admins` in the admin group (its tasks; it holds no tickets) or for a file flagged `admins_only`. A finance file never becomes one. No ticket or task is admins-only today; should one appear, the `VISIBILITY` expression in `source-files.ts` is the one place to change. |
| 6 | Author and time | The uploader. An intake file (sent to the ticket's mailbox) has none, so its author is the ticket's initiator (`requester_user_id`, owner decision 2026-10-23); only when the initiator has no account (no email, a removed membership, a disabled account) the ticket's creator, else the first superadmin (rows without any are skipped; the backfill uses the same order). Time: the ticket's creation; for a task file when it was attached (`files.attached_at`), else the task's creation. Title = file name; search text = the folded file name. |
| 7 | Lists | Not in folders and not in the default folder view ("All"), like chat files. The type filter offers "Z tiketu" and "Z úlohy"; ticking any automatic type makes the list flat. A search (flat list) finds them by file name. `chats=all` still only concerns chat files. The global search (`/api/search`) leaves all three out, as before for chat files. |
| 8 | The row | Icon of its own, the file name downloads the file, the source "Tiket #12" / "Úloha: <title>" and the size; clicking the row opens the ticket page or the task panel. |
| 9 | Converting | `POST /api/knowledge/:id/to-file` and `canConvertFile` (was `canConvertChatFile`) take all three types: admins, the item's author and (owner decision 2026-10-23) the group's managers (its active `client` members in a live group), while they read it; never a ziadatel, a removed member or another client's managers. A manager is a client, so their result stays public, as for a client author (`canSetVisibility`); the item keeps its author. Same implementation: same id, own copy of the file, the source columns cleared, so it leaves the automatic list and appears in its folder (top level by default). |
| 10 | Reachable from the list | Every automatic row and card has a "…" menu: "Uložiť ako súbor" (for its author, admins and the group's managers, decision 9), "Zobraziť v chate" / "Zobraziť tiket" / "Zobraziť úlohu", and "Podrobnosti". "Uložiť ako súbor" opens the detail straight in the file form. The detail of a ticket or task file has "Zobraziť tiket" / "Zobraziť úlohu". |
| 11 | Realtime | After the commit, the task routes (create, from message, from ticket, edit with files) and the ticket routes (create, client assigned or changed) push `knowledge:item` for the source's entries to the group room (admins room for admins-only). Removals and a move away show on the next load, as for a deleted task's chat files. |
| 12 | Performance | Inserts are one `INSERT ... SELECT` per source in the write's transaction (no N+1). Unique partial indexes `(source_ticket_id, source_file_id)` and `(source_task_id, source_file_id)` serve the cascades, the move and the pushes; `knowledge_items_source_file_idx` the file lookups. The automatic-files index and the folder view's root index now cover all three types; `knowledge/explain.test.ts` checks the tab's queries on the search volume. |
| 13 | MCP | `list_knowledge` accepts the new types (the description says so); MCP calls the HTTP API as the user, so the same rules apply (MCP is admins-only anyway). |
| 14 | Migration | 0072 (other open PRs also use 0072 and 0073: renumber at merge): three columns, the FKs, CHECKs, indexes, and a backfill of every existing ticket file (tickets with a client) and task card file. |

## Owner decisions (2026-10-23)

- Who converts: admins, the item's author **and the group's managers** (decision 9, 10). Since every client who reads a group's knowledge is its manager, every reader of an automatic file may save it as a file.
- Author of an intake ticket file: the ticket's initiator; the creator and then the first superadmin only when the initiator has no account (decision 6, unchanged in code, now confirmed).

## Out of scope

- Live removal of entries when a task file is removed or a ticket moves away (next load).
- A "Save as a file" for many items at once.
