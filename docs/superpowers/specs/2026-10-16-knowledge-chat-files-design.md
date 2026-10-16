# Chat files in the knowledge base (design)

Owner request of 2026-10-16: files uploaded into chats appear in the knowledge base. Builds on Phase 17 ([spec](2026-10-16-phase-17-knowledge-base-design.md)) and Phase 24 ([folders](2026-10-16-phase-24-knowledge-folders-design.md)); product doc [knowledge-base.md](../../product/knowledge-base.md).

## Owner request

1. A separate knowledge type, "From chat" (sk "Z chatu"), created only automatically when a file is attached to a chat message. Nobody creates or edits it by hand.
2. Each entry links to the message it came from: the group chat, the task chat in the task panel, or the ticket chat on `/tickets/<id>`, at that message.
3. A filter whether to also show the files of the tasks' and tickets' chats, shown only while the "From chat" type is ticked (in the group's Knowledge tab and in the admins' global view).

## Defaults (decided by us, for the owner to confirm)

- **Decision (default): stored rows, not a query over the chat.** Each file of a chat message is one `knowledge_items` row of type `chat_file`, written in the same transaction as the message. The tab, the global list, search, the cursor pages and their indexes stay one query, with no union over two sources. Migration `0024_knowledge_chat_files` backfills a row for every file of every live message already in a chat.
- **Decision (default): the entry lives exactly as long as the file in the chat.** The row points at the message attachment (`message_attachments (message_id, file_id)`) with a foreign key `on delete cascade`. Deleting the message (its attachment rows go), the file, the task (its chat), the ticket or the group removes the entry in the same statement; nothing can be left behind.
- **Decision (default): visibility follows the chat, which today means "public".** Every chat of a group (the group chat, its task chats, its ticket chats) is read by the same people who read the group's public knowledge: all admins and the group's clients (a client reads every task and every ticket of their group). A ziadatel never sees knowledge (404 on every knowledge route and no group room), and a requester who is not a member sees nothing. So a chat file is a `public` item of the chat's group. A ticket's chat that moves to another client takes its entries along in the same transaction (`group_id` follows the channel). If an admins-only chat ever appears, its entries must become `admins` items; the service has one place for this (`chatFileVisibility`).
- **Decision (default): read-only.** `POST` refuses the type (it is not in the draft schema), `PATCH` and `DELETE` answer 403 (`canEditItem` is false for `chat_file`), and the item has no "…" menu. To remove one, delete the message in the chat.
- **Decision (default): not in folders.** A chat file has no folder and cannot be moved into one.
  - The folder view (no search, "From chat" not ticked, also "All") lists only hand-made items, so a busy chat never buries them.
  - Ticking "From chat" turns the list flat, like a search: breadcrumbs and folder rows hide and the list runs newest first across the whole group (in the global view: across the clients of the client filter). Other ticked types join the same flat list.
  - Search is flat as before and finds chat files by file name (with "All" or with "From chat" ticked).
- **Decision (default): by default only the group chat's files.** The checkbox "Also from tasks and tickets" (sk "Aj z úloh a tiketov") appears next to the type filter only while "From chat" is ticked; it writes `?chats=all`. Unticked (the default), only files of the group chat are listed. The same rule applies to a search in "All": it finds the group chat's files; to find a file of a task or ticket chat, tick "From chat" and the checkbox.
- **Decision (default): the row.** A chat icon, the file name as the title (a link that downloads it, or opens an image), its size, the source ("Group chat", "Task: <title>", "Ticket #12"), then the author and the time of the message. Clicking the row elsewhere opens the chat at the message (a reply opens its thread), through the existing message-link helper. The `?k=<id>` link of a chat file (from a live event or a shared link) opens a read-only detail with the file and "Show in chat".
- **Decision (default): title, author and time.** The title is the file name (first 200 characters), the author is the message's author, `created_at` is the message's time, `search_text` is the normalized file name.
- **Decision (default): realtime.** A new chat file is pushed as `knowledge:item` to the chat group's room after the message commits, so it appears live like other items. Deleting the message pushes `knowledge:item_deleted`. A ticket moved to another client and a deleted task push nothing to the knowledge lists (rare; the entries are already gone or moved, lists show the change on their next load, and an open detail says "This item is no longer available.").

## Data

`knowledge_items` gains:

| column | type | notes |
|---|---|---|
| chat_message_id | text null | with `chat_file_id`: → `message_attachments (message_id, file_id)` on delete cascade |
| chat_file_id | text null | |
| chat_channel_id | text null | the message's chat; the ticket move updates `group_id` by it |
| chat_kind | text null | `group`, `task` or `ticket` |

Checks: `type` adds `chat_file`; `(type = 'chat_file') = (chat_message_id is not null)`, and the four columns are set together; `chat_kind in ('group','task','ticket')`.

Indexes:
- unique `(chat_message_id, chat_file_id)` where set: the cascade lookup and one entry per file;
- `(chat_channel_id)` where set: the ticket move;
- `(group_id, created_at desc, id desc)` where `type = 'chat_file'`: a group's chat files page (the kind filtered on top);
- `(group_id, created_at desc, id desc)` where `folder_id is null and type <> 'chat_file'`: the top level of the folder view, which would otherwise skip over every chat file.

## API

- `KnowledgeTypes` adds `chat_file`; `KnowledgeCreatableTypes` is the four hand-made types (the "+ New" menu).
- `GET /api/groups/:id/knowledge` and `GET /api/knowledge` take `chats=all` (any other value or none: the group chat only). With `folder` set (the folder view) chat files are never listed.
- `KnowledgeSummary.chat`: `{ channelId, messageId, parentId, kind, taskId, taskTitle, ticketId, ticketNumber } | null`, set for chat files (one join per page, no extra query). The detail's `files` holds the chat file.
- The chat module exposes hooks (`chat/file-hooks.ts`): `attached` inside the send transaction, `moved` inside the ticket chat's move, `sent` after the send commits (pushes), `removing` before a message delete (the ids to push as deleted). The knowledge module registers them at start-up; the chat module never imports knowledge.

## Web

- Type pills and the global type menu add "From chat" ("Z chatu"); "+ New" does not offer it.
- `?chats=all` and the "Also from tasks and tickets" checkbox, rendered only while "From chat" is ticked.
- The list is flat while `q` is set or "From chat" is ticked.
- Live updates: a chat file event is kept only in a flat list whose filter admits it (type ticked, or none ticked with a search; group chat unless `chats=all`), never in a folder view.

## Tests

Server, test-first: a send with files creates one entry per file (author, time, title, search text, chat source); a client of another group never reaches it (tab list, global list is admin-only, detail, search, socket event to the other group's room); a ziadatel gets 404; the default lists only the group chat's files, `chats=all` adds task and ticket chats; the folder view never lists them; delete of the message removes them and pushes `item_deleted`; a ticket moved to another client moves them (the old client no longer reads them); PATCH/DELETE 403, POST 400; the backfill SQL.

Web: the row (source label, link to the chat, file link), the pill and the checkbox appear only with the type, the flat list, events.
