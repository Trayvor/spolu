# Knowledge base

Each group has a Knowledge tab where clients and admins keep what the group needs to know: notes, files, links and reminders. Admins can keep items to themselves. Admins also get one global list of knowledge across all clients.

## Requirements

- **Knowledge tab** in every group (sk: "Znalosti"), between Tasks and Members.
- **Four item types** people create (and a fifth, "From chat", added by the chat: see below):
  1. **Note**: a title and a body with the same formatting as the chat composer, plus files.
     - In the list: the title, the number of attached files, and the start of the body on one line, ending with "…" (the card view shows several lines, see "Card view").
  2. **File**: one file, with a title and a description.
     - In the list: a file icon and the file name.
     - Clicking the file name downloads the file, or opens it in the browser for images.
  3. **Link**: a URL, with a title and a description.
     - In the list: the address.
     - Clicking it opens the URL in a new tab.
  4. **Reminder**: a title and a formatted body (no files), plus one or more date-times.
     - At each time its recipients are notified (see `reminders.md`).
     - A button exports the upcoming times to a calendar (`.ics`).
     - In the list: the next date and time.
- Clicking a card anywhere else opens its **detail**: a centred dialog on desktop, a full-screen sheet on phones. Every item has its own link (`?k=<id>`), so links and notifications open it.
- **Visibility:**
  - A client always creates public items: the group's clients and all admins see them.
  - An admin chooses, when creating or editing an item, between public ("Everyone in the group") and admins-only ("Only eGrant"). Admins-only items and their files are visible to all admins, never to clients.
  - A client's item stays public.
- **Edit and delete:** the author and admins. Deleting an item deletes its files and reminders.
- **In the tab:** filter by any combination of types and search (title, body or description, file names, URL). Newest first, more on demand.
  - Built: the header with "+ New", the type pills (All, Notes, Files, Links, Reminders) and the search field. The four type pills are checkboxes: any combination can be ticked, and the list shows items of any ticked type; a ticked pill is filled ink with a check mark. "All" is ticked while no type is, and clears the ticked types. The search runs 300 ms after typing stops, from 2 characters. Types and search live in the URL (`?type=note,link&q=portal`, the types as one comma list), so Back restores them; an old single-type link (`?type=link`) still works, and unknown or repeated types are dropped.
  - "+ New" opens a menu of the four types, each with one line of help: a dropdown from 641 px, a bottom sheet on phones. Picking one opens the create dialog (`?k=new&kind=reminder`); after Create the new item opens.
  - Empty tab: "Nothing here yet. Add notes, files, links and reminders the whole group can find." with "+ New". With a filter or search: "No knowledge matches "{q}"." (or "No knowledge of this type yet." / "No knowledge of these types yet." for types alone) and "Clear filters".
  - An item that is gone (deleted, or no longer visible) closes its dialog with "This item is no longer available."
- **Global knowledge list** (admins only), in the main menu above Groups:
  - every client's knowledge in one list;
  - client filter: by default the clients this admin manages (see client managers); the admin removes some or adds others, with managed and other clients visually separated;
  - type filter: any combination of types (none means all);
  - search by title, description, file name or URL, also without diacritics.
- **Realtime:** items created or changed by others appear at once in the group's tab. Built: a new item goes first and a changed one is updated in place; items of a type that is not ticked are left out (none ticked: every type is kept); while a search is active the list reloads instead. A deleted item disappears, and its open dialog closes with the notice. After a reconnect the first page reloads.
- Example of done: an admin and a client of one group keep notes, files, links and reminders in the tab. The client never sees the admin's admins-only items. The admin finds any item across clients in the global list.

## Folders (Phase 24, built)

Design and the defaults we chose: [Phase 24 spec](../superpowers/specs/2026-10-16-phase-24-knowledge-folders-design.md).

- Each group's knowledge base has folders and subfolders (no depth limit; at most 1000 per group; names 1–100 characters, may repeat). No folders shared across clients.
- Admins and the group's clients create, rename, move and delete the folders they see. Moving an item is part of editing it (its author and admins).
- **Admins-only folders:** only admins create them or switch a folder to admins-only. Clients never see such a folder or anything inside it. Everything inside is admins-only: a folder or item created or moved into it becomes admins-only (files and reminder recipients follow), and nothing inside can be made public. A client's item stays public, so it cannot go into an admins-only folder and a folder holding one cannot become admins-only ("A client's item can't go into a folder that only eGrant sees."). Making a folder public again changes only that folder.
- **Deleting a folder never deletes items:** its subfolders and items move one level up. The confirmation says so.
- **Tab:** breadcrumbs ("Knowledge › Folder › Subfolder"; on phones a long path keeps the first and last two), then the open folder's subfolders by name (folder icon, "Only eGrant" badge, "…" menu: Rename, Move to…, Delete), then its items newest first. The open folder is `?folder=<id>`. "+ New" has a fifth entry, "Folder", which creates a subfolder of the open folder; a new item is created in the open folder. The type pills filter the open folder's items. A folder that disappears (deleted, or hidden) takes the viewer back to the top level with "This folder is no longer available."
- **Search** ignores folders: while `q` is set the breadcrumbs and folder rows hide and the list is flat across all folders; each row shows its folder path ("Grants / 2026").
- **Item detail:** the folder path next to the type; "Move to…" in the "…" menu opens a picker of the group's folders as an indented tree under "Top level" (the current place cannot be chosen; for a folder, neither can the folder itself or anything below it).
- **Global list:** without a search it is a folder view: the clients of the client filter by name (logo and name), then a client's folders and items (`?at=<group>&folder=<id>`, breadcrumbs "All clients › Client › Folder"). The type filter applies to the items there. Typing a search switches to the flat list across clients, each row with its client and folder path.
- **Realtime:** folder changes reach the tab live (`knowledge:folder`, `knowledge:folder_deleted`); the folder list and the item lists refetch.

## Card view (built)

Owner request of 2026-10-17. Design and the defaults we chose: [spec](../superpowers/specs/2026-10-17-knowledge-card-view-design.md).

- **Toggle** "List / Cards" (sk "Zoznam / Karty") next to the search field, in each group's Knowledge tab and in the global list. List is the default. The choice is one per person for all knowledge lists, kept in the browser (like the remembered filters, not in the URL).
- **Cards:** one column on phones, two or three as the width allows (the global list widens to fit three). Each card has the row's icon or date leaf, the title (two lines), "Only eGrant", the type's line (file, address, next reminder time, meeting date and state, chat source), up to five lines of the text, and at the bottom the author and date, a note's file count, and where the row shows them the client and folder path. The whole card opens the detail (`?k=<id>`), a chat file the chat; the file name and address keep working as links.
- **Folders** stay rows above the cards; breadcrumbs, search, filters and "Load more" work as in the list.
- **The text shown** is the list's excerpt: the first 360 characters of the body (a note's text, a file's or link's description, a reminder's or meeting's notes) as plain text with its lines, formatting marks dropped, "…" when cut. Rows show one line of it. Never the meeting transcript or summary.

## Files from chats (Phase 25, built)


Owner request of 2026-10-16. Design and the defaults we chose: [spec](../superpowers/specs/2026-10-16-knowledge-chat-files-design.md).

- **Type "From chat"** (sk "Z chatu"): every file attached to a chat message (the group chat, a task chat, a ticket chat) becomes one knowledge item of its group, automatically, in the same write as the message. Nobody creates, edits, moves or deletes one by hand ("+ New" does not offer it; the detail has no "…" menu). Its author or an admin may turn it into a normal file item ("Save as a file", below). Deleting the message (or the file, task, ticket or group) removes it. Files already in chats were added by migration 0024.
- **Who sees them:** exactly who reads the chat. Every chat of a group is read by the admins and the group's clients, so a chat file is a public item of that group; a ziadatel never sees knowledge. A ticket moved to another client takes its chat files along.
- **The row:** a chat icon, the file name (it downloads the file, or opens an image), the source ("Group chat", "Task: <title>", "Ticket #12") and the size, then the author and time of the message. Clicking the row elsewhere opens the chat at the message: the group's Chat tab, the task panel's Chat tab, or the ticket page; a reply opens its thread. `?k=<id>` of a chat file shows a read-only detail with the file and "Show in chat".
- **Not in folders:** the folder view (also "All") lists only hand-made items. Ticking "From chat" makes the list flat like a search: breadcrumbs and folders hide and it runs newest first across the whole group (in the global view: across the chosen clients). Search finds chat files by file name.
- **Tasks and tickets too:** while "From chat" is ticked, a checkbox "Also from tasks and tickets" (sk "Aj z úloh a tiketov", `?chats=all`) appears next to the type filter, in the tab and in the global view. Unticked (the default) only the group chat's files are listed, also in a search with "All".
- **Live:** a new chat file appears at once in an open list that shows chat files; a deleted message removes it. A ticket moved to another client or a deleted task changes the lists on their next load.
- **Save as a file** (owner request of 2026-10-17, sk "Uložiť ako súbor"): in a chat file's detail, its author (the message's author) and admins see the button "Save as a file". It opens the file form: the file fixed (shown, not replaceable), the title (the file name to start with), the description, the folder (a select of the group's folders, "Top level" first; an admins-only folder makes it "Only eGrant") and, for admins, "Visible to" (a client's file stays public). Saving turns the item into a normal file item, one way: same id, author and date, it leaves "From chat" and appears in its folder, and from then on it is edited, moved and deleted like any file item (a file item has no reminders). The item gets its **own copy of the file**: the chat message keeps its attachment unchanged, and deleting the message (or the task, the ticket chat's move to another client) no longer touches the item or its file. Search finds it by its new title, description and file name. Open lists update live (`knowledge:item`: it leaves a "From chat" list and joins the folder's); an admins-only result disappears for clients at once.

## Meetings (Phase 30, built)

Owner request of 2026-10-17. Design and the defaults we chose: [spec](../superpowers/specs/2026-10-17-knowledge-meetings-design.md).

- **Type "Meeting"** (sk "Stretnutie"), in "+ New" with its help line and in the type pills ("Meetings"). Fields: title, date and time (required), meeting link, recording link, transcript link (optional http(s) URLs), notes (the formatted body), the transcript (typed, pasted, or "Load from file": `.txt`, `.vtt`, `.srt`, `.docx`, read by `POST /api/knowledge/transcript-text` and nothing stored), and an optional reminder ("Remind 15 minutes before" adds a time; then the usual times and recipients). Folders, search, visibility, edit and delete as for the other types; the transcript is not searched, the links and the summary are.
- **List row:** a date leaf of the meeting's day, the title, the date and time and a badge "Processing" (recording being converted, AI running) or "Summary".
- **Detail:** the date and time with "Join the meeting" and the recording and transcript links as pills; the notes; **Recording** (editors upload audio or video up to 2 GB with a progress bar; "Converting to audio…" until the job is done; then an audio player and the file; Replace and Delete; a failed conversion says so); **Summary**; the transcript folded ("transcribed by AI" when the AI made it); the reminder panel.
- **Recording storage:** only a compact audio copy (AAC mono, 32 kbps, `.m4a`) is kept on our server, as a file of the item (it follows the item's visibility); the uploaded original is deleted after the conversion or its last failed attempt. Video stays only behind the recording link.
- **AI ("Spracovať s AI", admins only):** a run transcribes the stored audio when there is no transcript, then writes the summary: a short paragraph, decisions, action items (with the person and the date when the meeting names them) and open questions, in the language the meeting was spoken in. The state shows while it runs (waiting, transcribing, writing); a failure says which step failed, and the button starts a new run. "Process again" asks first, since it replaces the summary. The item's editors can edit the summary. One run per meeting at a time, 20 an hour per admin.
- **Create tasks** (admins, from the action items): the task review dialog with one card per action item (a named person of the group is preselected, a said date is the deadline), and a bucket choice ("Add to", To do by default, never Completed).
- **Tasks from the meeting** (owner bug report of 2026-10-17): every task created from a meeting is linked to it. Once there is at least one, the summary shows "Tasks from this meeting (N)" (sk "Úlohy zo stretnutia") instead of the action items and "Create tasks": one row per task, oldest first, with its title (a link opening the task panel on the board, struck through when completed), its bucket and its assignees. Everyone who reads the meeting sees them (admins and the group's clients; a žiadateľ reading it through a chat message does not). A deleted task leaves the list; the list follows edits, moves and deletes live. **Owner decision (ours, 2026-10-17):** admins can still turn the rest into tasks with a small "Create more tasks" (sk "Vytvoriť ďalšie úlohy"), shown only while some action item has no task with its title (case and surrounding spaces ignored; a card renamed in the review counts as not done); its review proposes only those items. The task panel shows "Meeting: <title>" (sk "Stretnutie:") linking back to the meeting in the Knowledge tab, only to people who can read it (an admins-only meeting never to clients); deleting the meeting removes that line.
- **Who sees it:** like every item: the group's clients see a public meeting with its recording, transcript and summary; admins-only keeps all of it to admins.
- **Notifications** (2026-10-17, the Meetings notification group, see `notifications.md`): a new meeting and a moved start notify the people who can see it (under All messages); the AI result notifies the admin who pressed "Spracovať s AI"; the meeting's optional reminder is its only reminder.

## Status

Built on the server (Phase 17): the HTTP API (`modules/knowledge/routes.ts`: the tab list, the global list and its scope, create, read, edit, delete; 120 writes per minute per user), the reminder endpoints (`modules/reminders/routes.ts`: the set, subscribe and unsubscribe, the `.ics` file) and realtime (public items to the group room, admins-only items to the group's admins room). Built on the web: the Knowledge tab with live updates, the detail dialog (view, create, edit, delete), the reminder block, and the admins' global list with the client filter. Phase 24 adds folders (above), on the server (`modules/knowledge/folders.ts`, routes in `routes.ts`) and on the web (`folder-browser.tsx`, `folder-dialog.tsx`, `move-dialog.tsx`, `breadcrumbs.tsx`). End-to-end tests: `e2e/knowledge.spec.ts`. Waiting for the owner's walkthrough on the server.

## Phase

Phase 17 (the tab, the four types, visibility, the global list; reminders from `reminders.md`). Phase 24: folders. Phase 25: files from chats. The global list's default client filter is the clients the admin manages (Phase 18, client managers).

## Global list (built)

- Without a search the list is the folder view (see Folders above); the rows below are what a search shows.
- `/knowledge`, for admins only (a client gets the not-found page; the API answers 403). The header shows "Knowledge" before "Groups"; where the links do not fit, the section menu lists it in the same order.
- The rows are the tab's rows, each with the group's logo and name in its last line, newest first, 30 per page with "Load more". Clicking a row opens the detail over the list (`?k=<id>`).
- Filters, all in the URL so Back and shared links keep them: `?clients=<id>,<id>` (none means the default scope), `?type=` (any combination of Notes, Files, Links, Reminders as one comma list, e.g. `?type=note,link`; none means all types; an old single value still works, unknown or repeated types are dropped) and `?q=` (applied after 300 ms of typing, from 2 characters; Back or a link that changes `q` updates the field).
- Type menu: a secondary pill reading "All types", the one ticked type ("Notes"), or "n types" ("2 typy", "4 typov" in Slovak). It opens a menu with "All types" (ticked while no type is; picking it clears the others), a rule, then the four types as checkbox items. The menu stays open while ticking; Escape or a click outside closes it.
- Client filter: "Clients: All", "Clients: My clients (n)" or "Clients: n selected". The list splits into "Managed by you" and "Other clients" as soon as `GET /api/knowledge/scope` names managed clients (the admin's `group_managers` rows); a `null` answer, which the server no longer sends, would show every client in one list headed "Clients". An admin who manages none sees all clients with the hint "You don't manage any clients yet. Showing all clients." "Only my clients" and "Reset" go back to the default; "All clients" (or choosing every client by hand) writes `?clients=all`, which stays "every client" as clients are added. The request then sends `scope=all` instead of any ids. A choice equal to the managed clients reads "My clients (n)"; ids of clients that no longer exist are ignored. The pill is disabled until the clients and the managed ids have loaded. The chosen clients show as removable chips on their own row under the filters, managed ones with an ink dot; "Reset" ("Predvolené") sits in the filter row, after the other controls.
- The last filters (clients, types, chat files; not the search) are kept in the browser per admin and restored when the admin opens `/knowledge` without filters; each group's Knowledge tab remembers its types and chat files the same way. Reset clears them. Blocked storage is ignored. See non-functional.md, "Lists remember their filters".
- No live updates: the list refetches when the window regains focus and when the page opens.

## Items attached to chat messages (Phase 28)

A group's items can travel in its chats (group chat, task and ticket chats): the chat's book button opens a search over the items everyone in the group can see (`GET /api/groups/:id/knowledge?shareable=1`: public items; an item inside an admins-only folder is admins-only itself) and attaches up to 5 to a message. The card in the chat opens the item with the reader's own rights. Only items visible to everyone in the group can be attached, and the check runs again on every display: an item made admins-only, moved into an admins-only folder or to another client, or deleted is shown as unavailable. A žiadateľ, who never sees the knowledge base, opens an item attached in their ticket chat read-only through that message (no reminders, no folder browsing, no edits) and can download its files. See [chat.md](chat.md) and the [design](../superpowers/specs/2026-10-17-phase-28-reactions-and-attachments-design.md).
