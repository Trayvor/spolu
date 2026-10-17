# Spolu — Phase 17: Knowledge base (design)

Date: 2026-10-16 · Status: approved by the controller under the owner's overnight authorization (2026-10-16); rulings in 2026-10-16-phases-17-20-brief.md

Requirements: [knowledge-base](../../product/knowledge-base.md), [reminders](../../product/reminders.md). Roadmap entry: Phase 17 (added to `docs/roadmap.md` when the phase starts). Builds on [Phase 6](2026-10-16-phase-6-notifications-design.md) (the notification pipeline), [Phase 8](2026-10-15-phase-8-task-board-design.md) and [Phase 9](2026-10-15-phase-9-task-chat-and-ai-design.md) (the task panel, `TaskForm`, the review dialog, `copyFile`). Depends on Phase 18 (Client managers, specified separately) only for the default client filter of the global list; see "Dependency on Phase 18".

Built on branch `phase-17`, cut from `main` after Phases 9 and 6 have merged. It can run **in parallel with Phase 18**. This branch touches `modules/knowledge`, `modules/reminders` (new), `features/knowledge`, `features/reminders` (new), a small change in `modules/files` (the admins-only flag), `modules/notifications` (one new kind), the group room join (an admins sub-room), the group tabs, the header, their migrations, i18n keys and docs. Phase 19 (task reminders) reuses the reminders module built here.

## Goal

Every group gets a **Knowledge** tab (sk: "Znalosti") where clients and admins keep what the group needs to know, as cards of four types: **note**, **file**, **link** and **reminder**. Admins can keep items to themselves. Admins also get one global list of knowledge across all clients, filtered by client and type and searchable. Reminder items notify their recipients at the chosen times through the Phase 6 pipeline and export to a calendar as an `.ics` file. The reminders part is a module of its own, so Phase 19 adds reminders to tasks without new machinery.

## Owner decisions (brief of 2026-10-16, part A and the owner answers)

| question | decision |
|---|---|
| What it is | A module where people create "knowledge" items: cards of different types. |
| Where it lives | Each group has a Knowledge tab. Admins also get a global list of all knowledge from all clients in the main menu, above the groups. |
| Visibility | A client always creates public items. An admin chooses public (admins and the client see it) or non-public (admins only) when creating an item. |
| Note | A text field like the chat composer (same formatting), plus files. In the list: title, number of attached files, and the start of the body on one line ending with "…". Clicking the card opens the full detail. Separate window or popup: our choice, as long as it fits on phones. |
| File | One file, with a title and a description. In the list: a file icon. Clicking the file name downloads or opens the file. Clicking elsewhere on the card, or the description (shown like the note body), opens the detail. |
| Link | Like the file, with a URL instead of a file. The URL opens when the card's text is clicked. |
| Reminder | Like the note without files, plus one or more date+time values and a button to export to a calendar. |
| Reminder recipients | The author, plus people the author adds. People can also subscribe to a reminder themselves. |
| Edit and delete | The author and admins. |
| Global list filters | By client: by default only the clients this admin manages; the admin can remove some or add others, from managed clients and from other clients, which are visually separated. By type. Search by title, description, file name or URL. |
| Task board | The same reminder module goes on the task board (Phase 19). |

## Controller rulings

From the brief (the owner may override):

- **Phase numbers:** new phases are numbered from 17. Knowledge base is 17, Client managers 18, Task reminders 19.
- **Knowledge detail:** a centred 720 px dialog on desktop, a full-screen sheet on phones, reusing the sheet primitives built for the task panel and the review dialog. Each item is addressable by URL (`?k=<id>`), so links and notifications open it.
- **Calendar export:** a standard `.ics` file with one VEVENT per reminder time. It works with Apple, Google and Outlook calendars.
- **Reminder delivery:** a new event kind in the Phase 6 pipeline, delivered in modes All and "Mentions and replies", like task events, and not in Off.
- **Non-public items** are visible to all admins, not only managers.

Made in this spec:

- **Detail frame.** Phase 9's review dialog already is "a centred 720 px dialog from 641 px, a full-screen sheet below" on Radix `Dialog` (the `radix-ui` package is already a dependency). Its frame moves into `components/ui/sheet-dialog.tsx` as `<SheetDialog>`, and both the review dialog and the knowledge detail use it. The header row reuses `PanelHeader` from `features/tasks/panel-parts.tsx`, which moves to `components/ui/panel-header.tsx` unchanged. Phones get the panel's "every control ≥ 44 px" rule, which also moves into `SheetDialog`. No new dependency, one sheet.
- **One form.** `<KnowledgeForm value onChange groupId type errors files onFilesChange />` follows the `TaskForm` pattern exactly: controlled fields, no saving. The dialog's create and edit modes wrap it. The body field is the task description's `DescriptionField` (the chat composer's `FormatToolbar`, shortcuts and Markdown, rendered by the chat's `MessageBody`), and the files field is `TaskFilesField`. Both move from `features/tasks/` to `components/` as `FormattedTextField` and `FilesField`, renamed only, with the task form importing them from the new place.
- **Title is required** on every type (max 200). For a file item, picking the file fills an empty title with the file name without its extension.
- **Body / description** max 10 000 characters, as tasks and messages. Notes and file items have up to 10 files total (a file item exactly one).
- **Visibility of a client's item is locked to public.** An admin editing a client's item cannot make it admins-only, because that would hide the item from its own author. An admin's item can switch either way, by any admin.
- **Admins-only files stay admins-only.** Files are read by anyone who reads the group today (`canReadFile`). A file attached to an admins-only item is marked `files.admins_only = true` and `canReadFile` refuses it to clients with 404. The flag follows the item when its visibility changes.
- **Sorting:** newest first by `created_at`, cursor-paginated, 30 per page, "Load more" at the end. No pinning in this phase.
- **Search** uses PostgreSQL trigram matching (`pg_trgm`) on one precomputed, accent-free text column; the reasoning is under "Search".
- **Reminder times** are absolute date-times, chosen in the browser's time zone and stored as `timestamptz`. At most 20 times per item. A new time must be at least one minute in the future. Fired times stay listed and cannot be edited.
- **Firing** is a pg-boss cron every minute, not one delayed job per time. Edits and deletes then need no job cancellation, and a reminder is at most a minute late. A time missed by more than 24 hours, after an outage, is marked fired without a notification.
- **Recipients** are people of the group (`isGroupPerson`, the same list as assignees and mentions; after Phase 18 the pickers list only the client's managers among admins, as for assignees). For an admins-only item, only admins. Anyone who can read the item may subscribe or unsubscribe themselves; subscribing is not limited by the picker list.
- **Live updates** go to the group room for public items and to a new admins-only sub-room of the group for admins-only items. The global list has no live updates. It refetches on focus and on opening, because an admin is not in every group's room.
- **Mentions** in a note body render like in the chat but notify nobody. Knowledge is reference material, not conversation.

## User experience

All copy is the English source; Slovak goes in the knowledge locale files (see Performance). Designed with `frontend-design` on the egrant.sk tokens (`docs/design/tokens.md`). Type names: Note, File, Link, Reminder (sk: Poznámka, Súbor, Odkaz, Pripomienka). Visibility: "Everyone in the group" and "Only eGrant" (sk: "Všetci v skupine", "Len eGrant"), because clients already know the admins as "eGrant" from the chat pill.

The design keeps to the groups-list pattern: rows in one white `Card` in a 720 px column, separated by `border` lines, not a grid of cards. Each row starts with a 40 px leading tile that says what the item is. The one distinctive element is the reminder row: instead of an icon, its tile is a small calendar leaf showing the next date. You can see what is coming up in the list without opening anything.

### Knowledge tab

The tab sits between Tasks and Members: `[Chat] [Tasks] [Knowledge] [Members]`. Route `/groups/$groupId/knowledge`, a lazy chunk.

```
Knowledge                                                      [+ New]
[All] [Notes] [Files] [Links] [Reminders]      [⌕ Search knowledge      ]
┌───────────────────────────────────────────────────────────────────────┐
│ ┌──┐ Grant application checklist                               📎 3   │
│ │≡ │ Before submitting, check the budget table and the signed de…     │
│ └──┘ (JN) Jana Nováková   14 Oct                                      │
├───────────────────────────────────────────────────────────────────────┤
│ ┌──┐ Budget 2026                                        [🔒 Only eGrant]│
│ │▤ │ budget-2026-final.xlsx  48 kB      ← link: downloads / opens       │
│ └──┘ Final version approved by the ministry. Use this one for the r…  │
├───────────────────────────────────────────────────────────────────────┤
│ ┌──┐ Ministry call portal                                             │
│ │↗ │ opvai.sk/vyzvy/2026-03                ← link: opens in a new tab  │
│ └──┘ Where the interim report is submitted. Log in with the projec…   │
├───────────────────────────────────────────────────────────────────────┤
│ ┌──┐ Submit interim report                                            │
│ │23│ Thu 23 Oct, 14:00 and 2 more                                     │
│ │Oct Upload the signed PDF to the portal before noon. Peter has th…   │
│ └──┘                                                                  │
└───────────────────────────────────────────────────────────────────────┘
                              [Load more]
```

- Header: `text-medium` weight 600 "Knowledge" and the primary "+ New" pill (full width under the title below 641 px).
- Filters: the type pills are the group tabs' filter-pill style (`h-8`, current one filled ink), "All" first. Changed after Phase 17 at the owner's request: the type pills are multi-choice checkboxes (`role="checkbox"`, a ticked one filled ink with a check), "All" resets, and `?type` is a comma list (`?type=note,link`); see `docs/product/knowledge-base.md`. The search field (the shared `Input`, 300 ms debounce, minimum 2 characters) sits right of them from 641 px and on its own line below. Type and query live in the URL (`?type=link&q=portal`), so Back restores them.
- **Row** (`px-5 py-4`, 16 px gap, the whole row opens the detail except the inner links):
  - Leading tile, 40 px, `rounded-lg bg-muted`, a 18 px outline icon in `text-foreground`: note (lines), file (document), link (arrow out). **Reminder:** the tile is a calendar leaf: the day number (`text-button` weight 600) over the short month (`text-nano` muted), with a 2 px `border-foreground` top edge. If no time is still ahead, the leaf shows the last date in `text-muted-foreground` and the second line reads "Done".
  - Line 1: the title (`text-button` weight 600, one line, truncated); on the right, the "Only eGrant" outline `Badge` with a 12 px lock for admins-only items (admins only ever see it), and for notes a paperclip with the file count (nothing at 0).
  - Line 2 depends on the type:
    - **Note:** the start of the body as plain text (the chat's `plainExcerpt`), one line, `text-button text-muted-foreground`, truncated with "…".
    - **File:** the file name as a real link (`text-button` weight 600, underlined, hover `neutral`) and the size. It is the file route: images open in a new tab, other files download, as everywhere in Spolu. The description excerpt follows on line 3.
    - **Link:** the URL without `https://` and `www.`, as a link that opens it in a new tab (`rel="noopener noreferrer"`), with a 12 px arrow-out icon. The description excerpt follows on line 3.
    - **Reminder:** the next time ("Thu 23 Oct, 14:00", in the UI language, today and tomorrow named), then "and 2 more" when there are more upcoming times. The body excerpt follows on line 3.
  - Last line (`text-micro text-muted-foreground`): the author's 24 px `Avatar`, name and the date created. In the global list, the group's 24 px logo and name come first.
- The row is a `<div>` with a full-row button underneath the inner links (the done-circle pattern: inner links are siblings, never nested in a button). Keyboard: Tab reaches the row ("Open {title}") and then its inner link.
- **Empty states:** "Nothing here yet. Add notes, files, links and reminders the whole group can find." with "+ New". With a filter or search: "No knowledge matches "{q}"." and a ghost "Clear filters".
- Under 641 px: rows keep the same structure at 16 px padding, and the tile shrinks to 32 px.

### New item

"+ New" opens a menu (the shared dropdown menu from 641 px, the `ActionSheet` on phones) with four rows: an icon, the name and one line of help:

```
┌──────────────────────────────────────────────┐
│ ≡  Note       Text with formatting and files │
│ ▤  File       One file with a description    │
│ ↗  Link       A web address with a note      │
│ 23 Reminder   Text with dates to be reminded │
└──────────────────────────────────────────────┘
```

Picking one opens the detail dialog in create mode (`?k=new&type=note`), with the title focused. Fields by type, top to bottom:

| field | note | file | link | reminder |
|---|---|---|---|---|
| Title (required) | ✓ | ✓ (filled from the file name) | ✓ | ✓ |
| File (one, required) | | ✓ first, above the title | | |
| URL (required, `https://…`) | | | ✓ first, above the title | |
| Body / Description (`FormattedTextField`) | Body | Description | Description | Body |
| Files (`FilesField`, up to 10) | ✓ | | | |
| Times (`ReminderTimesField`) | | | | ✓ (at least one) |
| Recipients (`RecipientsField`) | | | | ✓ (the author is always in it) |
| Visible to (admins only) | ✓ | ✓ | ✓ | ✓ |

"Visible to" is a two-option segmented control (two pills, the current one ink): "Everyone in the group" (default) and "Only eGrant". Clients never see it. Their items are public. Footer: primary "Create" and outline "Cancel". Nothing is saved before Create. Closing discards the draft and asks first only when something was typed ("Discard this draft?").

### Detail (dialog on desktop, sheet on phones)

URL `?k=<id>` on the Knowledge tab, and on the global list. Opening a link from a notification or a chat message with `?k=` shows the list with the dialog open over it.

```
┌──────────────────────────────── 720 px ───────────────────────────────┐
│ [Close]                                          [Edit]  [⋯ More]     │
│                                                                       │
│ Note                                                                  │
│ Grant application checklist                                           │
│ (JN) Jana Nováková, 14 Oct 2026   Everyone in the group               │
│ ───────────────────────────────────────────────────────────────────── │
│ Before submitting, check:                                             │
│ • the **budget table** matches the application                        │
│ • the declaration is signed by the mayor                              │
│                                                                       │
│ [▤ checklist.pdf 120 kB] [▤ declaration.docx 40 kB] [image preview]   │
└───────────────────────────────────────────────────────────────────────┘
```

- Header row (`PanelHeader`): "Close" from 641 px, a back arrow on phones; on the right "Edit" (secondary small pill) and "More" with Delete, both only for the author and admins.
- Body: the type name (`text-micro` muted), the title (`h2`, `text-medium` weight 600), the author line with "Everyone in the group" or the lock and "Only eGrant", a 2 px `border` rule, then the content rendered read-only:
  - **Note:** the body through `MessageBody`, then the files (file chips, image previews).
  - **File:** a large file row (the `FileChip` at full width, "Download {name}") above the description.
  - **Link:** the full URL as a link with the arrow-out icon, "Open link" for screen readers, above the description.
  - **Reminder:** the body, then the reminder block below.
- **Reminder block** (shared component `<ReminderPanel>`, reused by Phase 19):

```
 Reminders
 ┌──┐ Thu 23 Oct 2026, 14:00
 │23│
 └──┘
 ┌──┐ Mon 27 Oct 2026, 09:00
 │27│
 └──┘
  12 Oct 2026, 10:00   sent            ← fired times, muted, at the end
 Reminded: (JN)(VH)(PK)  Jana Nováková, Vladyslav H. and 1 more
 [✓ Remind me]                                [Add to calendar]
```

  - Upcoming times are listed in order with the small calendar leaf. Fired times follow, muted, marked "sent".
  - The recipients are listed as avatars plus names (author first). "Remind me" is a toggle pill (secondary when off, ink with a check when on) that subscribes or unsubscribes the viewer at once. The author cannot leave their own reminder (the toggle is on and disabled, with the hint "You created this reminder").
  - "Add to calendar" (outline pill with a calendar icon) downloads the `.ics` file of the upcoming times. It is disabled, with "No upcoming reminders", when none are left.
- **Edit** swaps the content for `<KnowledgeForm>` in place, inside the same dialog, with "Save changes" and "Cancel" in a footer that stays visible on phones. Leaving with unsaved changes asks inline ("Discard your changes?"). If the item changed meanwhile, the 409 shows "Changed by someone else. Reload", like the task panel.
- **Delete** asks inline in a `bg-secondary` bar: "Delete this item? Its files and reminders are deleted too." with a destructive "Delete" and a ghost "Cancel".
- An item that was deleted or became admins-only while a client had it open closes with the notice "This item is no longer available."

### Global knowledge list (admins)

Route `/knowledge`, a lazy chunk. The header gets "Knowledge" before "Groups" (and the user menu on phones lists it first). Same 720 px column, same rows, each with the group's logo and name in its last line.

```
Knowledge
[Clients: My clients (4) ⌄]  [All types ⌄]  [⌕ Search title, description, file or link ]
(ABC s.r.o. ×) (Obec Lúčky ×) (Mesto Nitra ×) (Spolok Tatry ×)          [Reset]
┌───────────────────────────────────────────────────────────────────────┐
│ ┌──┐ Budget 2026                                        [🔒 Only eGrant]│
│ │▤ │ budget-2026-final.xlsx  48 kB                                    │
│ └──┘ [logo] ABC s.r.o.   (VH) Vladyslav H.   13 Oct                    │
├───────────────────────────────────────────────────────────────────────┤
│ …                                                                     │
```

- **Client filter** (`<ClientFilter>`, built so that the global task board can reuse it later): a secondary pill "Clients: My clients (4)" (or "Clients: 6 selected", "Clients: All") that opens a popover from 641 px and a `SheetDialog` sheet on phones:

```
┌ Clients ─────────────────────────────┐
│ [⌕ Find a client                   ] │
│ Managed by you                       │
│ [x] (logo) ABC s.r.o.                │
│ [x] (logo) Obec Lúčky                │
│ Other clients                        │
│ [x] (logo) Mesto Nitra               │
│ [ ] (logo) Spolok Tatry              │
│ [ ] …                                │
│ [Only my clients] [All clients] [Done]│
└──────────────────────────────────────┘
```

  - Two sections with `text-micro` weight 600 muted headings: "Managed by you" first, then "Other clients", each sorted by name. Checkboxes are 20 px with 44 px rows on phones. The find field filters both sections.
  - The chosen clients show under the bar as removable chips (`bg-secondary rounded-full`). Chips of managed clients carry a 6 px ink dot before the name, so the two kinds stay apart outside the popover too. "Reset" returns to the default.
  - The selection lives in the URL (`?clients=<id>,<id>`); no `clients` parameter means the default. The last explicit choice is also remembered in `localStorage` per browser, and restored when the admin opens `/knowledge` without parameters. Storage errors are ignored.
- **Type filter**: a secondary pill with a menu: All types, Notes, Files, Links, Reminders. Changed after Phase 17: the types are checkbox items, any combination can be ticked and the menu stays open; the pill reads "All types", the one type, or "n types". It is the same filter as the tab's pills, condensed to fit the row with the client filter.
- **Search**: the same field and rules as in the tab, over title, description or body, file names and URL.
- Empty: "No knowledge for these clients yet." / "No knowledge matches "{q}"."

### Phones

The tab and the list keep their single column. The detail and the create dialog are full-screen sheets (`SheetDialog`), with the header's back arrow, a 16 px body padding, and the footer buttons pinned to the bottom above the safe area. The "+ New" menu and the client filter are bottom sheets.

## Architecture

### Reuse summary

| piece | from | used by |
|---|---|---|
| `<SheetDialog>` (720 px dialog / full-screen sheet) | Phase 9 review dialog frame, moved to `components/ui/` | review dialog, knowledge detail and create, client filter on phones |
| `PanelHeader` | `features/tasks/panel-parts.tsx`, moved to `components/ui/` | task panel, knowledge detail |
| `ActionSheet` | `components/ui/action-sheet.tsx` | "+ New" on phones |
| `useScrollLock` | `lib/use-scroll-lock.ts` | via `SheetDialog` |
| `FormattedTextField` (was `DescriptionField`) and `MessageBody` | tasks, chat | knowledge body and description |
| `FilesField` (was `TaskFilesField`), `FileChip`, `ImagePreview` | tasks, files | note files, file item |
| `PeopleSelect` (was `AssigneeSelect`, generalized with a `people` list prop) | tasks | reminder recipients |
| `createFile`, `attachFiles`, `detachFiles`, `deleteDetachedFiles` | files module | knowledge service |
| `recordNotifications` with `dedupeKey`, `requestDelivery` | notifications module | reminders fire job |

### Module `knowledge` (server `modules/knowledge`, web `features/knowledge`)

**Tables**

| table | columns |
|---|---|
| `knowledge_items` | `id`, `group_id` (FK groups, cascade), `type` text CHECK in (`note`, `file`, `link`, `reminder`), `visibility` text CHECK in (`public`, `admins`), `title` (≤ 200), `body` text default '' (≤ 10 000; the note or reminder body, the file or link description), `url` text nullable (CHECK: not null exactly when `type = 'link'`), `created_by` (FK user), `created_at`, `updated_at`, `search_text` text not null |
| `knowledge_attachments` | `item_id` (FK, cascade), `file_id` (FK files), PK both; index on `file_id` |

Indexes:

- (`group_id`, `created_at` desc, `id` desc): the tab's list and cursor;
- (`created_at` desc, `id` desc): the global list;
- GIN (`search_text gin_trgm_ops`): search;
- (`created_by`): "my items" in later phases and the author check.

`search_text` is computed by the service on every write: the title, the body as plain text (`plainExcerpt` without a length cap, mention tokens replaced by names), the URL and the attached files' names, joined, lower-cased, with diacritics stripped (NFD, then the combining marks removed), so "rozpočet" matches "rozpocet". It is recomputed when an attachment is added or removed.

The item's reminder times and recipients live in the reminders module (below), keyed by `knowledge_item_id`.

**Policy** (`modules/knowledge/policy.ts`, written test-first):

- `canReadItem(actor, item, actorGroupId)`: `canReadGroup` and (`visibility = 'public'` or `isAdmin(actor)`). Unreadable items answer 404.
- `canEditItem(actor, item)`: `isAdmin(actor)` or `item.createdBy === actor.id`, and readable. Otherwise 403.
- `canDeleteItem` = `canEditItem`.
- `canSetVisibility(actor, item, visibility)`: `admins` only by an admin, and never on an item created by a client. Otherwise 400 `invalid_visibility`.
- The global list: `requireAdmin`.

**Endpoints**

| method | path | what |
|---|---|---|
| GET | `/api/groups/:id/knowledge?type&q&cursor` | the tab's page of 30 `KnowledgeSummary`, newest first; clients get public items only |
| GET | `/api/knowledge?clients&type&q&cursor` | admins; the global list across groups (`clients` = comma-separated group ids, max 200; absent = the default scope) |
| GET | `/api/knowledge/scope` | admins; `{ managedGroupIds: string[] \| null }` for the client filter (see Phase 18) |
| POST | `/api/groups/:id/knowledge` | `KnowledgeDraft` → 201 `KnowledgeItemDto` |
| GET | `/api/knowledge/:id` | `KnowledgeItemDto`: the item with files (`FileInfo`) and, for reminders, the `ReminderSetDto` |
| PATCH | `/api/knowledge/:id` | partial `KnowledgeDraft` plus the `updatedAt` being edited; stale → 409 `knowledge_changed`; the type cannot change |
| DELETE | `/api/knowledge/:id` | author or admin; files and reminders deleted; 204 |

Shared types in `packages/shared/src/knowledge.ts`:

- `KnowledgeDraft`: `{ type, title, body, url?, fileIds, visibility, reminder?: { times: { id?, at }[], recipientIds } }`, validated per type with a discriminated union.
- `KnowledgeSummary`: `id`, `groupId`, `type`, `visibility`, `title`, `excerpt` (computed by the server; ≤ 140 characters, 360 with its line breaks since the [card view](2026-10-17-knowledge-card-view-design.md)), `url`, `file` (`FileInfo` of a file item), `fileCount`, `nextReminderAt`, `upcomingCount`, `lastReminderAt`, `createdBy` (`TaskPerson`-like `{ id, name }`), `createdAt`, and in the global list `group: { id, name, logoUrl }`.

A page is one query: the items joined with a lateral aggregate for the file count and the first file, a lateral aggregate over `reminder_times` for `nextReminderAt`, `upcomingCount` and `lastReminderAt`, and the authors' names. There are no per-row queries.

Rate limit: 120 writes/min per user, as tasks. Errors: `invalid_url` (not http or https, or over 2048 characters), `invalid_visibility`, `invalid_attachment` (existing), `knowledge_changed`, plus the reminder errors below.

**Files** (`modules/files`): a new column `files.admins_only boolean not null default false`. `canReadFile` becomes `canReadGroup(…) && (!file.adminsOnly || isAdmin(actor))`. The files service exports `setFilesAdminsOnly(tx, fileIds, value)`, which the knowledge service calls when it attaches files to an admins-only item and when an item's visibility changes. An upload is readable by the group until it is attached, but file ids are random and only the uploader knows them, so this window exposes nothing. Deleting an item detaches its files and deletes them after commit (`detachFiles` + `deleteDetachedFiles`, as tasks).

**Realtime.** `modules/knowledge/events.ts`, after commit:

- `knowledge:item` `{ item: KnowledgeSummary }`: created or edited.
- `knowledge:item_deleted` `{ id }`.

A public item goes to `groupRoom(groupId)`. An admins-only item goes to a new `groupAdminsRoom(groupId)` (`group:<id>:admins`), which an admin's socket joins together with the group room on `group:join`; it is a small change in the group room join and in `infra/realtime/rooms.ts`. A visibility change from public to admins sends `knowledge:item_deleted` to the group room, then `knowledge:item` to the admins room. Socket.IO keeps order per connection, so an admin in both rooms ends with the item. The other way round sends `knowledge:item` to the group room. The tab upserts into its query cache. Events for items outside the current type filter or search are dropped, and the cache is invalidated instead when a search is active. After a reconnect the tab refetches its first page.

### Module `reminders` (server `modules/reminders`, web `features/reminders`)

A generic module: a **reminder set** belongs to one subject (in this phase a knowledge item, in Phase 19 a task) and holds times and recipients. The module knows subjects only through a small adapter registry, so a new owner adds an adapter and a column, nothing else.

**Tables**

| table | columns |
|---|---|
| `reminder_sets` | `id`, `group_id` (FK groups, cascade), `knowledge_item_id` (FK knowledge_items, cascade, nullable, unique), `created_by` (FK user), `created_at`; CHECK `num_nonnulls(knowledge_item_id) = 1` (Phase 19 adds `task_id` and widens it to `num_nonnulls(knowledge_item_id, task_id) = 1`) |
| `reminder_times` | `id`, `set_id` (FK, cascade), `at` timestamptz, `fired_at` timestamptz nullable; index (`at`) where `fired_at is null`; index (`set_id`, `at`) |
| `reminder_recipients` | `set_id` (FK, cascade), `user_id` (FK user, cascade), `source` text CHECK in (`author`, `added`, `subscribed`), `added_by` (FK user), PK (`set_id`, `user_id`); index (`user_id`) |

One foreign key column per subject kind (not a generic `subject_id`), so deleting a knowledge item or a task removes its reminders in the database, and no owner can forget to.

**Subject adapters** (`modules/reminders/subjects.ts`):

```ts
type ReminderSubject = {
  kind: 'knowledge' | 'task';
  /** Bulk load for the fire job and the endpoints: group, title, who may read and edit. */
  loadMany(db: Db, ids: string[]): Promise<Map<string, SubjectInfo>>;
};
type SubjectInfo = {
  groupId: string;
  title: string;
  adminsOnly: boolean;
  /** False when the subject should not remind now (Phase 19: the task is in Completed). */
  active: boolean;
  canRead(actor: SessionUser, actorGroupId: string | null): boolean;
  canEdit(actor: SessionUser): boolean;
};
```

The knowledge module registers `knowledge` in this phase. `active` is always true for knowledge items.

**Service** (exported functions; other modules call only these):

- `getReminderSet(db, subject, actor)` → `ReminderSetDto { times: { id, at, firedAt }[], recipients: { user: { id, name }, source }[], subscribed: boolean, canEdit: boolean }`.
- `replaceReminderSet(tx, subject, { times, recipientIds }, actor)`. It keeps fired times, deletes the unfired times missing from `times` (knowledge items are protected from concurrent edits by their `updatedAt` 409; Phase 19 adds an optional `baseTimeIds` that limits deletion to the times the sender had loaded), inserts new ones, and replaces the `added` recipients. It keeps `author` and `subscribed` rows, and always keeps the author. Validation:
  - at most 20 times, each new one at least 1 minute ahead and at most 5 years ahead;
  - an unknown or fired time id → 400 `invalid_reminder`;
  - a time in the past → 400 `reminder_in_past`;
  - recipients must be people of the group (`isGroupPerson`) and admins for an admins-only subject → 400 `invalid_recipient`;
  - more than 50 recipients → 400 `invalid_recipient`.
- `subscribe(db, subject, actor)` / `unsubscribe(db, subject, actor)`: anyone who can read the subject. The author cannot unsubscribe (400 `author_recipient`). Unsubscribing removes the actor's row whatever its source, so someone added by the author can opt out.
- `buildIcs(db, subject, actor)` → the `.ics` text (see "Calendar export").
- `listUpcomingForUser(db, actor, { limit })`: the user's next reminders across groups, for the admin dashboard card of part B. Built here because the query belongs to this module; part B decides how the card uses it.

The knowledge service calls `replaceReminderSet` inside its create and update transaction for reminder items, so an item and its times are saved together.

**Endpoints** (registered by the reminders module, `:kind` validated against the adapter registry; in this phase only `knowledge`):

| method | path | what |
|---|---|---|
| GET | `/api/knowledge/:id/reminders` | `ReminderSetDto` (the knowledge detail also embeds it) |
| POST | `/api/knowledge/:id/reminders/subscription` | subscribe the caller; 204 |
| DELETE | `/api/knowledge/:id/reminders/subscription` | unsubscribe the caller; 204 |
| GET | `/api/knowledge/:id/reminders/calendar.ics` | the calendar file |

Phase 19 adds the same four under `/api/tasks/:id/reminders` plus a `PUT` that replaces the set, because tasks have no other save path for reminders.

**Fire job** (`modules/reminders/jobs.ts`): `reminders.fire`, cron `* * * * *`. One transaction per batch of 200:

1. Lock due times: `select … from reminder_times where fired_at is null and at <= now() order by at limit 200 for update skip locked`. Two workers never take the same row.
2. Load their sets and recipients in one query, and the subjects with `loadMany` per kind (one query each).
3. For each time: if `at < now() - 24 h` or the subject is not `active`, only set `fired_at`. Otherwise record one `reminder.due` event per recipient with `recordNotifications` (`groupId` the set's group, `dedupeKey` `reminder:<timeId>`, so a retried batch never notifies twice) and set `fired_at`.
4. After commit, `requestDelivery` for the recorded recipients.

It loops until a batch comes back short, like `deliverPending`.

**Notification kind** (Phase 6 code, small additions):

- `NotificationKinds` gets `'reminder.due'`, and `KIND_RANK` ranks it 2. `passesMode` already lets every non-`chat.message` kind through "Mentions and replies" and blocks it in Off, which is the ruling. `decideEvent` needs no change: the event has no `messageId`, so it counts as unread, and recipients are group people checked at delivery.
- Payload `ReminderDuePayload { subjectKind, subjectId, groupId, title, at, taskId? }` (`taskId` set for task subjects, so the existing task title lookup shows the current title).
- `buildPushPayload` gets a `reminder.` branch:
  - title "<title> · <group name>";
  - body "Reminder for {time}" in the user's language (time formatted in Europe/Bratislava, like the Phase 6 crons);
  - URL `/groups/<g>/knowledge?k=<id>` (Phase 19: the task panel URL);
  - tag `knowledge:<id>` (Phase 19: `task:<id>`).
- Email: reminder events join the Phase 6 email batch like task events, as one line "Reminder: <title>, <time>".

**Calendar export** (`modules/reminders/ics.ts`, about 80 lines of our own code, no dependency):

- `text/calendar; charset=utf-8`, `content-disposition: attachment; filename="<title-slug>.ics"`.
- `VCALENDAR` with `VERSION:2.0`, `PRODID:-//eGrant//Spolu//EN`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`.
- One `VEVENT` per **upcoming** time:
  - `UID:reminder-<timeId>@spolu`. The UID is stable, so importing again updates the event instead of duplicating it in Apple Calendar and Outlook, and Google skips the duplicate.
  - `DTSTAMP`, `DTSTART` in UTC (`…Z`, so no `VTIMEZONE` block is needed and every calendar shows local time), `DTEND` 15 minutes later.
  - `SUMMARY` the title, `DESCRIPTION` the body as plain text (first 1 000 characters) plus the item's link, `URL` the item's link.
  - A `VALARM` with `TRIGGER:PT0M` and `ACTION:DISPLAY`, so the calendar alerts at the time too.
- Text is escaped (`\\`, `\;`, `\,`, `\n`), lines are CRLF and folded at 75 octets, and the output is tested against RFC 5545 examples.
- It is a snapshot: later changes need a new export. A live calendar feed is out of scope.

**Web** (`features/reminders`, imported only by lazy chunks): `<ReminderTimesField>` (a list of times with native `date` and `time` inputs, "+ Add time", remove per unfired time), `<RecipientsField>` (`PeopleSelect` of the group people, filtered to admins for admins-only items, the author as a fixed chip), `<ReminderPanel>` (read view, "Remind me", "Add to calendar"). Times are converted with the browser's `Date`; the server stores UTC.

### Search

`pg_trgm` with `ILIKE` on the precomputed `search_text`, over PostgreSQL full-text search, because:

- **No Slovak text search configuration ships with PostgreSQL.** Full-text search would use the `simple` configuration: no stemming, so "rozpočtu" would still not find "rozpočet". It would add tokenizing without adding language support.
- **File names and URLs are not words.** `budget-2026-final.xlsx` and `opvai.sk/vyzvy/2026-03` are split by the full-text parser in ways users do not expect, and a fragment such as "vyzvy" or "final" inside them fails to match. Trigram `ILIKE '%term%'` finds any substring.
- **Prefixes work as people type.** "rozpo" matches with trigrams; full-text needs `:*` prefix queries per word.
- **Diacritics.** People often type without them. Stripping them once in the stored column (and in the query) handles that without the `unaccent` extension and its non-immutable function.
- **Size.** Knowledge is hundreds to a few thousand rows per installation; a GIN trigram index keeps a search well under 10 ms. The cost is a larger index and no relevance ranking. Results stay newest first, which is how the list is read anyway.

The query splits the input on spaces into up to 5 terms and ANDs one `search_text ILIKE '%' || term || '%'` per term (terms escaped for `%` and `_`). Terms of 2 characters run without the index's help but are filtered by group and type first, which is cheap at this size. `pg_trgm` is a trusted extension since PostgreSQL 13, so the migration's `create extension if not exists pg_trgm` runs as the database owner, also in the e2e database. An ADR records the choice (`docs/decisions/`).

### Dependency on Phase 18 (Client managers)

The global list's default filter is "the clients this admin manages", which Phase 18 defines (a many-to-many `group_managers` table and a groups service function listing an admin's managed group ids; this spec calls it `listManagedGroupIds(db, userId)` and uses whatever name Phase 18 gives it). The seam is one function in this module:

```ts
// modules/knowledge/scope.ts
/** The admin's managed group ids, or null while client managers do not exist. */
export async function managedGroupIdsOf(db: Db, adminId: string): Promise<string[] | null>;
```

- **Phase 17 merges first:** the function returns `null`.
  - The default scope (no `clients` parameter) is all groups.
  - `GET /api/knowledge/scope` answers `{ managedGroupIds: null }`.
  - `<ClientFilter>` shows one undivided list headed "Clients", and its pill reads "Clients: All".
  - Everything else, explicit selection included, works fully.
- **Phase 18 merges (before or after):** the function body becomes `return listManagedGroupIds(db, adminId)`, plus its test. Whichever phase merges second makes this change in its own branch.
  - The default becomes the managed clients.
  - The filter splits into "Managed by you" and "Other clients", and its pill reads "Clients: My clients (n)".
  - An admin who manages no client gets all clients as the default, with the hint "You don't manage any clients yet. Showing all clients." That is better than an empty page.
- Phase 18's narrowing of the people pickers (non-manager admins hidden from mentions and assignees) reaches `RecipientsField` automatically, because it uses the same group people list. Self-subscription stays open to every admin.

### Performance

- **Eager JS budget.** About 2.7 kB is left of 200 kB gzip, so nothing of this phase is eager:
  - The Knowledge tab (`knowledge-tab`) and the global list (`knowledge-page`) are lazy route chunks. The detail dialog, the form and the reminders components are in those chunks.
  - The header link and the tab pill add two strings and a route definition to the eager code.
  - Every other `knowledge.*` and `reminders.*` text lives in `features/knowledge/locales/{en,sk}.json` and `features/reminders/locales/{en,sk}.json`. They are loaded by those chunks with `i18next.addResourceBundle` before first render, the lever `performance.md` names for this.
  - The build check confirms the eager size does not grow by more than 0.5 kB gzip.
- The chunks reuse code the chat and task chunks already split out (formatter, renderer, file field, Radix dialog), so Vite shares those chunks instead of duplicating them.
- One query per page (see Endpoints), indexed on every filter and sort, cursor pagination, no virtualization needed at 30 rows per page. The fire job's due query uses the partial `at` index and is empty almost every minute.

### Migrations

One migration in this phase:

1. `create extension if not exists pg_trgm`.
2. `knowledge_items`, `knowledge_attachments` and their indexes, including the GIN trigram index.
3. `reminder_sets`, `reminder_times`, `reminder_recipients` and their indexes.
4. `files.admins_only boolean not null default false`.

No backfill. Whichever of 17 and 18 merges second regenerates its migration.

## Error handling

New `ErrorCodes`: `invalid_url`, `invalid_visibility`, `knowledge_changed`, `invalid_reminder`, `reminder_in_past`, `invalid_recipient`, `author_recipient`.

- Opening `?k=` for a missing or unreadable item: the list shows with the notice "This item is no longer available.", and `k` is removed from the URL.
- A reminder time that passes while the form is open: the save answers `reminder_in_past`, and the field marks the time ("This time has passed. Pick a later one.").
- Upload errors come from the files field as today.
- The `.ics` download for an item with no upcoming times answers 404, and the button is disabled anyway.
- The fire job never throws on one bad set: it logs it, marks the time fired and goes on.
- A failed delivery request is picked up by the Phase 6 sweep.

## Testing

**Server** (test-first):

- Policy:
  - Clients see public items only, and an admins-only item answers 404 to them on every endpoint, including its files and its `.ics`.
  - Edit and delete by the author and by admins; another client answers 403.
  - A client cannot create admins-only items (`invalid_visibility`).
  - An admin cannot make a client's item admins-only.
- Per-type validation: a file item has exactly one file, a link item needs an http(s) URL, a reminder needs at least one time.
- `files.admins_only` follows the item's visibility both ways.
- `search_text`: diacritics stripped; file names, URL and body included; recomputed when files change.
- Search: substring, prefix, accent-free, several terms ANDed, `%` and `_` escaped.
- The global list: explicit `clients`, the default scope with `managedGroupIdsOf` returning null (all groups) and returning ids (only those), type filter, cursor pagination.
- Delete removes files, reminder sets, times and recipients.
- Realtime: public events reach the group room, admins-only events reach only the admins room, and the visibility switch sequence is correct.
- Reminders:
  - `replaceReminderSet` keeps fired times, refuses past times and the 21st time;
  - recipients must be group people, and admins only for admins-only items;
  - the author always stays;
  - subscribe and unsubscribe, and the author cannot unsubscribe.
- Fire job:
  - due times record one event per recipient and set `fired_at`;
  - a rerun records nothing (dedupe);
  - two workers in parallel never double-fire (`SKIP LOCKED`);
  - times older than 24 h are marked fired silently;
  - a removed group member gets no push (the Phase 6 decision).
- Delivery: `reminder.due` passes All and "Mentions and replies", not Off. The push has the right title, body, URL and tag.
- `.ics`: one VEVENT per upcoming time, stable UIDs, escaping and folding, CRLF.

**Web:**

- `KnowledgeForm`: fields per type, validation, the file filling the title, the visibility control shown only to admins.
- Rows per type:
  - the excerpt is truncated;
  - the file name link and the URL link do not open the detail;
  - the reminder leaf shows the next date, or "Done".
- The detail opens from `?k=` and closes back.
- Edit, save, 409 notice, delete confirmation.
- "Remind me" toggles.
- "Add to calendar" is disabled with no upcoming times.
- `ClientFilter`:
  - two sections when managed ids exist, one list when they are null;
  - chips with the managed dot;
  - URL and `localStorage` restore.
- Socket upserts and deletes in the tab.

**E2E** (two browsers):

- An admin creates an admins-only note with a file; the client does not see it in the tab, and the file URL answers 404 to the client.
- The client creates a link item; the admin sees it live and opens the URL.
- The admin creates a reminder for one minute ahead with the client as a recipient, and the fake push sender (`PUSH_PROVIDER=fake`) records the client's push after the fire job runs (the test triggers the job directly).
- The admin downloads the `.ics` and the test parses one VEVENT.
- The global list filters by client and type and finds the file item by a fragment of its file name typed without diacritics.
- Phone viewport: the detail is a full-screen sheet and every control is at least 44 px.

## Done when

On the local production-like stack:

- An admin and a client of one group create notes, files, links and reminders in the Knowledge tab and see each other's public items live.
- The client never sees the admin's admins-only items or their files.
- Clicking a file name downloads or opens the file, and clicking a link opens the URL.
- A reminder reaches its recipients by push at the set time, and its `.ics` file adds the times to Apple, Google and Outlook calendars.
- The admin finds any item across clients in the global list by client, type and search.

## Documentation updates in this phase

- `product/knowledge-base.md` and `product/reminders.md`: status as built. Add their rows to `product/README.md`, and add the Knowledge tab to `product/groups.md`.
- `product/notifications.md`: the reminder kind.
- `architecture/data-model.md`: knowledge items, attachments, reminder sets, times, recipients, `files.admins_only`.
- `architecture/permissions.md`: the knowledge policy, the admins-only file rule, reminder recipients and subscription.
- `architecture/realtime.md`: knowledge events, the group admins room.
- `architecture/overview.md`: the knowledge and reminders modules, the fire job, the `pg_trgm` extension.
- `architecture/performance.md`: the lazy chunks, the lazy locale bundles and the measured eager size.
- `docs/decisions/`: an ADR for trigram search with `pg_trgm`.
- `docs/design/tokens.md`: the knowledge rows, the calendar leaf, `SheetDialog`, `ClientFilter`.
- `docs/roadmap.md`: the Phase 17 row and section.
- `docs/glossary.md`: knowledge item, reminder set, recipient, subscribe.

## Out of scope

- Pinning, folders, tags or manual ordering of items.
- Comments or a chat on an item.
- Version history.
- Link previews: fetching a page title or image is an SSRF risk and costs a request per link.
- Showing PDFs inline instead of downloading them.
- Mentions that notify from a note body.
- Recurring reminders.
- A live calendar feed (`webcal://`).
- Reminders relative to another date.
- Clients' own cross-group view: a client has one group.
- Live updates of the global list.
- The global task board, which reuses `<ClientFilter>` but is specified separately.
- Task reminders: [Phase 19](2026-10-16-phase-19-task-reminders-design.md).
