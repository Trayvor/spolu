# Knowledge base

Each group has a Knowledge tab where clients and admins keep what the group needs to know: notes, files, links and reminders. Admins can keep items to themselves. Admins also get one global list of knowledge across all clients.

## Requirements

- **Knowledge tab** in every group (sk: "Znalosti"), between Tasks and Members.
- **Four item types:**
  1. **Note**: a title and a body with the same formatting as the chat composer, plus files.
     - In the list: the title, the number of attached files, and the start of the body on one line, ending with "…".
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

## Status

Built on the server (Phase 17): the HTTP API (`modules/knowledge/routes.ts`: the tab list, the global list and its scope, create, read, edit, delete; 120 writes per minute per user), the reminder endpoints (`modules/reminders/routes.ts`: the set, subscribe and unsubscribe, the `.ics` file) and realtime (public items to the group room, admins-only items to the group's admins room). Built on the web: the Knowledge tab with live updates, the detail dialog (view, create, edit, delete), the reminder block, and the admins' global list with the client filter. End-to-end tests: `e2e/knowledge.spec.ts`. Waiting for the owner's walkthrough on the server.

## Phase

Phase 17 (the tab, the four types, visibility, the global list; reminders from `reminders.md`). The global list's default client filter is the clients the admin manages (Phase 18, client managers).

## Global list (built)

- `/knowledge`, for admins only (a client gets the not-found page; the API answers 403). The header shows "Knowledge" before "Groups"; on phones the user menu lists it first.
- The rows are the tab's rows, each with the group's logo and name in its last line, newest first, 30 per page with "Load more". Clicking a row opens the detail over the list (`?k=<id>`).
- Filters, all in the URL so Back and shared links keep them: `?clients=<id>,<id>` (none means the default scope), `?type=` (any combination of Notes, Files, Links, Reminders as one comma list, e.g. `?type=note,link`; none means all types; an old single value still works, unknown or repeated types are dropped) and `?q=` (applied after 300 ms of typing, from 2 characters; Back or a link that changes `q` updates the field).
- Type menu: a secondary pill reading "All types", the one ticked type ("Notes"), or "n types" ("2 typy", "4 typov" in Slovak). It opens a menu with "All types" (ticked while no type is; picking it clears the others), a rule, then the four types as checkbox items. The menu stays open while ticking; Escape or a click outside closes it.
- Client filter: "Clients: All", "Clients: My clients (n)" or "Clients: n selected". The list splits into "Managed by you" and "Other clients" as soon as `GET /api/knowledge/scope` names managed clients (the admin's `group_managers` rows); a `null` answer, which the server no longer sends, would show every client in one list headed "Clients". An admin who manages none sees all clients with the hint "You don't manage any clients yet. Showing all clients." "Only my clients" and "Reset" go back to the default; "All clients" (or choosing every client by hand) writes `?clients=all`, which stays "every client" as clients are added. The request then sends `scope=all` instead of any ids. A choice equal to the managed clients reads "My clients (n)"; ids of clients that no longer exist are ignored. The pill is disabled until the clients and the managed ids have loaded. The chosen clients show as removable chips on their own row under the filters, managed ones with an ink dot; "Reset" ("Predvolené") sits in the filter row, after the other controls.
- The last explicit client choice is kept in the browser (`localStorage['spolu.knowledge.clients']`) and restored when the admin opens `/knowledge` without parameters; Reset clears it. Blocked storage is ignored.
- No live updates: the list refetches when the window regains focus and when the page opens.
