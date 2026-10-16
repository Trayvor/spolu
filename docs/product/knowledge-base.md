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
- **In the tab:** filter by type and search (title, body or description, file names, URL). Newest first, more on demand.
  - Built: the header with "+ New", the type pills (All, Notes, Files, Links, Reminders) and the search field. The search runs 300 ms after typing stops, from 2 characters. Type and search live in the URL (`?type=link&q=portal`), so Back restores them.
  - "+ New" opens a menu of the four types, each with one line of help: a dropdown from 641 px, a bottom sheet on phones. Picking one opens the create dialog (`?k=new&kind=reminder`); after Create the new item opens.
  - Empty tab: "Nothing here yet. Add notes, files, links and reminders the whole group can find." with "+ New". With a filter or search: "No knowledge matches "{q}"." (or "No knowledge of this type yet." for a type alone) and "Clear filters".
  - An item that is gone (deleted, or no longer visible) closes its dialog with "This item is no longer available."
- **Global knowledge list** (admins only), in the main menu above Groups:
  - every client's knowledge in one list;
  - client filter: by default the clients this admin manages (see client managers); the admin removes some or adds others, with managed and other clients visually separated;
  - type filter;
  - search by title, description, file name or URL, also without diacritics.
- **Realtime:** items created or changed by others appear at once in the group's tab. Built: a new item goes first and a changed one is updated in place; items of another type than the filtered one are left out; while a search is active the list reloads instead. A deleted item disappears, and its open dialog closes with the notice. After a reconnect the first page reloads.
- Example of done: an admin and a client of one group keep notes, files, links and reminders in the tab. The client never sees the admin's admins-only items. The admin finds any item across clients in the global list.

## Status

Built on the server (Phase 17): the HTTP API (`modules/knowledge/routes.ts`: the tab list, the global list and its scope, create, read, edit, delete; 120 writes per minute per user), the reminder endpoints (`modules/reminders/routes.ts`: the set, subscribe and unsubscribe, the `.ics` file) and realtime (public items to the group room, admins-only items to the group's admins room). The web tab and global list come in later Phase 17 tasks.

## Phase

Phase 17 (the tab, the four types, visibility, the global list; reminders from `reminders.md`). The global list's default client filter needs Phase 18 (client managers); until then it shows all clients.
