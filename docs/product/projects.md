# Projects (Phase 33)

Requirements as built. Design: [Phase 33 spec](../superpowers/specs/2026-10-17-phase-33-projects-design.md) (its "Owner decisions" first), [plan](../superpowers/plans/2026-10-17-phase-33-projects.md). Built in six parts; each part fills its own section below.

## Concepts

- **Project** (sk "Projekt"): belongs to one client group. Name (1–200, required), description (Markdown, ≤ 10 000), files (0–20 ordinary group files), status **active** or **archived**, source **manual** or **egrant** ("From eGrant"), eGrant's project id (read-only), **aliases** (the name keys of its earlier names).
- **Event** (sk "Udalosť"): belongs to one project. Name (1–200), description, files, **date** (one day, required, past dates allowed). Events of one day are ordered by creation.
- A task or a ticket has at most one project and, inside it, at most one event (part P2 sets them). The database refuses another client's project and an event of another project ([ADR 0030](../decisions/0030-projects-composite-keys-and-egrant-matching.md)).
- Each project has a **colour** from the brand accents (purple, pink, blue, coral, green), picked by a hash of its id like avatars; shown only as a small dot.
- **Name key**: the name trimmed, inner spaces collapsed, lower-cased, without diacritics. Two projects of one client never share a name key; a rename keeps the old key as an alias ("Also matches"), which anyone who edits the project can remove.

## Who sees and does what

Admins and the group's clients (everyone who reads the group) see projects and events and **create, edit, archive, restore and delete** them, add files, and remove aliases (decisions 8 and 8a). A žiadateľ never reaches the group, so every project route answers them `404`; on their own ticket they will see only the project's name (part P2). Details: [permissions](../architecture/permissions.md#projects-phase-33).

## Foundation (part P1)

- **Prehľad tab** (EN "Overview"), `/groups/<id>/overview`: the **first** tab pill of a group; the group still opens on Chat. It is one lazy chunk (`overview-tab`) with the `projects` locale namespace. Part P4 adds the timeline above and the two active cards in the middle; P1 shows the projects card.
- **Projects card**: the client's projects by name, 30 a page with "Show more", **Active** or **Archived** (pills). Each row: the colour dot, the name, "From eGrant" for eGrant's projects, "eGrant changes (n)" (from part P3), then the number of events, the next coming event (from today, Bratislava) with its date, and the open tasks and open tickets (shown only when there are any). Empty: "No projects yet. Projects group this client's tasks and tickets along a timeline." "New project" opens the project dialog; a row opens the project sheet.
- **Project sheet**: name with its dot, "Archived" and "From eGrant" badges, the description (rendered Markdown), files, and the **events** by date with "Add event". The menu has Edit, Archive or Restore, and Delete. Delete asks first and names what happens: its events go too; its open tasks and tickets stay, without the project. Clicking an event opens it in the event dialog.
- **Project dialog**: name, description (the description editor with AI, voice and attached knowledge, part P5), files; for an existing project the **Also matches** chips (aliases, each removable) and the eGrant project id (read-only). A taken name says which project has it; an edit made by someone else meanwhile asks to reopen (`409 project_changed`).
- **Event dialog**: the project (fixed), name, date, description, files; an existing event can be deleted there after a confirmation (its tasks and tickets keep the project).
- **Archive** is the normal way to end a project: it leaves the active list and the pickers' active section, stays in the Archived list and stays selectable for tasks and tickets. **Delete** removes the project, its events, files, aliases and links; its tasks and tickets keep existing without it. Deleting an event clears only the event on its tasks and tickets.
- **Live**: every write tells the group's room `project:changed`; an open Prehľad refetches 2 s after the last change.
- Merge ("Merge into…") is part P3's. "Show on the timeline" (part P4, in the sheet's menu) selects the project in the timeline.
- **The admin group** "eGrant tím" (Phase 34, `kind = 'admin'`) has the Prehľad tab and its own projects too: the project routes check `canReadGroup`, which only admins pass there. Its card counts no tickets (the admin group has none); the eGrant webhook and ticket links (part P3) concern client groups only.

## Links and filters (part P2)

Planned: the project and event selects on tasks and tickets, the chips, the filters on the Tasks and Tickets tabs.

## eGrant projects (part P3)

Planned: the project webhook, pending changes from eGrant, the intake's `project_id`, merge.

## Timeline and cards (part P4)

Built (part P4, `feat/projects-timeline`). The Prehľad tab shows, from the top: the **timeline**, the **Tickets** and **Tasks** cards (side by side from 641 px, stacked on phones), then the projects card.

- **Timeline card** (decisions 14–17): the client's events on one straight line, each event a column of the same width (200 px, 160 px on phones), in date order and events of one day by creation. Past events have a filled dot, today's a filled dot with a ring, coming ones a hollow dot; every dot has a ring in its project's colour. Under the dot: the date, the event's name (two lines at most) and, while all projects are shown, the project's name with its dot.
- **Today** is a vertical black rule labelled "Dnes" between the last past and the first coming event (an event of today comes right after it; with no past events it comes first, with no coming ones last). The strip opens scrolled so Today sits about a third from the left; the **Dnes** button scrolls back to it.
- **Gaps:** neighbours more than 60 days apart get a small mark on the line halfway between them ("4 mesiace"; two years and more in years).
- **Which events:** all active projects by default; the **project select** (all projects, each active project, then the archived ones) shows one project's whole life, archived projects too. The choice is in the URL (`?project=<id>`), so "Show on the timeline" in the project sheet and Back work. 15 events before today and 15 from today load first; **Skoršie** and **Neskoršie** at the strip's ends load 15 more that way and keep what is on screen in place.
- **Under each event** (from 641 px): "Úlohy (n)" with up to 5 open tasks (urgent first, then by deadline; the deadline in red when overdue; assignees' avatars), "Tikety (n)" with up to 5 open tickets (newest first, `#number`, subject, status), each list only when it has rows; "Zobraziť všetko (n)" when there are more, which opens the event sheet (the filtered Tasks and Tickets tabs come with part P2's filters); then the **done pile**, one muted line "Hotové (7)" that expands in place to the completed tasks (struck through) and resolved tickets, newest first, 20 at a time. A task row opens the task panel over the overview (`?task=<id>`, as on the admin home's board); a ticket row opens the ticket page.
- **Event sheet:** the event's name opens it (on phones the whole top of the column is its tap area): name, date, project, "From eGrant", description, files, attached knowledge, every open task and open ticket (20 a page) and the done pile expanded. Its menu has Edit (the event dialog) and Delete (asks first; tasks and tickets keep the project). Everyone who reads the group may use them (decision 8a).
- **Header:** the project select, **Dnes**, and **Pridať udalosť**: with one project chosen it opens the event dialog for it, with all projects a menu asks which project first.
- **Empty states:** a client without projects: "Zatiaľ žiadne projekty. Projekty zoraďujú úlohy a tikety tohto klienta na časovej osi." with **Nový projekt**; no events: "Zatiaľ žiadne udalosti." (with **Pridať udalosť** when one project is chosen).
- **Phones** (≤ 640 px): the line, dots, dates, names and projects only; a tap opens the event sheet with the lists.
- **Keyboard:** the strip is a list of events in date order (each a heading with the name as a button, the date as `<time>`); the arrow keys, Home and End move between events and the strip follows the focus. Today is announced as "Dnes, <date>".
- **Tickets card** (decision 18): the client's New and In progress tickets, those I am a riešiteľ of first, then newest first, 8 rows (5 on phones): `#number`, subject, the project (and event) chip, status. The header counts them ("aktívne: 9, moje: 3"); **Otvoriť všetko** opens the Tickets tab (its default: open, anyone).
- **Tasks card:** the client's tasks not in Completed, mine (I am an assignee) first, then urgent, then by deadline (none last), then oldest; 8 rows (5 on phones): title, the project chip, deadline (red when overdue), avatars; the header counts open, mine and urgent ones; **Otvoriť všetko** opens the Tasks tab. Clients see the same cards with their own rows first.
- **Live:** task and ticket events of the group refetch the timeline, the open lists and the cards 2 s after the last one; `project:changed` refetches everything of the tab as before.

## Description editor (part P5)

Built (part P5, `feat/description-editor`). Every long description field is one component, `features/editor/description-field.tsx`:

- **Where:** the task description (task panel and new task; the AI review cards get AI and voice without knowledge, attached after creating), the ticket text (new-ticket dialog and an admin's edit; with a client only, a ticket without a client keeps a plain textarea), the project and event descriptions, the knowledge item body (note and reminder text, file and link description, meeting notes), the meeting AI summary paragraph, and the finance item description (AI and voice, **no knowledge**: finance stays sealed). Not: titles and names, the meeting transcript, the meeting's decisions and open questions (one item per line lists, kept as plain lists), "Solve with Claude" notes, bulk email blocks, the chat's own edit box.
- **How it looks:** a filled text shows rendered like a chat message with "Edit …"; an empty one opens the editor at once. The editor is the chat's ProseMirror editor in **document mode**: Enter always makes a new line (smart lists as in chat), at least six lines, grows to 16, then scrolls; the chat's eight-button toolbar; at its end the **microphone**, the **AI button** (Fix mistakes, Make it formal, Translate off `.sk`) and **"Attach from the knowledge base"**. Undo of an AI change is one editor undo step (and the AI button's Undo). Value in and out is Markdown, so storage, search and digests did not change.
- **Attached knowledge:** the chat's knowledge picker (unchanged, so it caps one pick at 5; the server takes up to 10) adds items; they show as chips with Remove under the editor and as the chat's cards under the rendered text. Only a client group's public, shareable items can be attached, checked on save (`400 invalid_knowledge_item`: "An attached knowledge item can no longer be shared here. Remove it and save again.") and on every display: an item made admins-only, deleted, or of another client (a ticket moved to another client) shows "Item unavailable" and stays until removed.
- **Ticket text** is now shown with the chat renderer (line breaks kept; a body with Markdown characters may render as formatting). A žiadateľ opens the items attached to their own ticket's text read-only, with their files.
- **Lazy:** the editor (`description-editor`, 2.5 kB gzip) and the cards (`linked-cards`) are lazy chunks with the `chat` texts; the forms carry only the field shell (`description-field`, 1.6 kB gzip shared, mostly the Markdown renderer the old field had too). The initial JS grew 0.04 kB (the shared schemas).

### AI and voice in the other long-text places (`feat/editor-everywhere`)

Plain-stored text keeps its format and gets the same tools through `features/editor/plain-text-field.tsx` (a textarea with the microphone and the AI button in a lazy chunk with the `chat` texts; no Markdown, no knowledge links):

- **Meeting decisions and open questions** (the summary editor): still one entry per line (`lines` mode: a dictation starts a new line, the AI's list markers and blank lines are cut so the stored `string[]` is unchanged). Group routes.
- **Notes for Claude** ("Solve with Claude", admins) and the **ticket text of a ticket without a client** (admins): admin routes.
- **Bulk email text block** (`bulk-email/rich-text-editor.tsx`): the toolbar gets the same two buttons (lazy `rich-text-ai-tools`). The block is read as Markdown-like text (`rich-text-ai.ts`: `##`/`###`, `- `, `1. `, `**bold**`, `[link](https://…)`) and written back as the builder's own node tree, so the stored format is unchanged. Underline, strike, italic and colours are not sent to the AI; Undo and an appended dictation keep the original tree. Admin routes.

Fields left as they are: one-line names, titles, subjects, codes, emails, URLs and search boxes; the finance work-log note (one line, 500 characters); the meeting transcript (a verbatim record up to 400 000 characters, which the AI limit would cut and a rewrite would falsify); chat composers (already have the tools).

## Finance (part P6)

Planned: Finance costs by project and event.
