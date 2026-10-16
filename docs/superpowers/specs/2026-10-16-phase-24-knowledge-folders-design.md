# Phase 24 — Folders in the knowledge base (design)

Owner decisions of 2026-10-16 (final), the defaults taken where the owner did not decide, and the design. Builds on Phase 17 ([spec](2026-10-16-phase-17-knowledge-base-design.md), [product/knowledge-base.md](../../product/knowledge-base.md)).

## Owner decisions

1. Folders live in a group's knowledge base (the Knowledge tab of each client group). No folders shared across clients.
2. Subfolders are allowed (a tree), with breadcrumbs.
3. Admins and the group's clients create, rename and move folders (the same people who keep knowledge items; a ziadatel never sees knowledge).
4. A folder can be admins-only, like an item: clients never see such a folder or anything inside it, and cannot put items into it.
5. The admins' global view shows the folder structure (client → folders → items) by default and while the client or type filter is used. As soon as something is typed in search, items are searched everywhere regardless of folders: a flat list, each result with its client and folder path. The group's Knowledge tab works the same way: the tree normally, a flat list across all folders while searching.

## Defaults (decided by us, for the owner to confirm)

- **Decision (default): deleting a folder never deletes items.** Its items and subfolders move one level up, into the folder's parent (or the top level). Nothing is lost, and a client deleting a folder that looks empty to them cannot learn that it held admins-only things, because those simply move up for the admins.
- **Decision (default): moving is a "Move to…" picker** (a list of the group's folders as a tree, plus "Top level"), for items (in the item's menu) and folders (in the folder's menu). No drag and drop.
- **Decision (default): who moves what.** A folder: anyone who sees it (admins, the group's clients for public folders). An item: whoever may edit it (its author and admins), since moving changes where others find it.
- **Decision (default): order.** Folders first, by name (Slovak alphabetical order, case-insensitive), then the items of the folder, newest first, 30 at a time with "Load more", as before.
- **Decision (default): an item created inside an open folder lands in that folder.** The same for a new folder (it becomes a subfolder).
- **Decision (default): no depth limit.** A group's folders are loaded in one query and the tree is built in memory, so depth costs nothing. A group may have at most 1000 folders; a folder name has 1–100 characters. Names may repeat (no uniqueness rule).
- **Decision (default): admins-only is inherited downwards.** Everything inside an admins-only folder is admins-only:
  - a folder or item created in it is admins-only;
  - an item or folder moved into it becomes admins-only (an item's files and reminder follow, as when an admin switches an item to admins-only: non-admin recipients are dropped);
  - making a folder admins-only makes everything inside it admins-only;
  - a client's item can never become admins-only (Phase 17 rule), so a client's item cannot be moved into an admins-only folder, and a folder holding a client's item (anywhere inside) cannot be made admins-only or moved into an admins-only folder. The server answers 400 `invalid_visibility`; the web explains it.
  - inside an admins-only folder nothing can be switched back to public; move it out first.
- **Decision (default): making a folder public again (or moving it out of an admins-only folder) changes only the folder itself.** Its contents stay admins-only until an admin makes them public one by one. Nothing becomes visible to clients by accident.
- **Decision (default): realtime.** Folder changes (create, rename, move, visibility, delete) push events like items: a public folder to the group room, an admins-only one to the group's admins room. When a folder becomes admins-only the clients get "folder deleted" and "item deleted" for each item that was hidden. A viewer whose open folder disappears is taken back to the top level with "This folder is no longer available."
- **Decision (default): reminders keep working unchanged.** A reminder's link opens the item over the top level of the tab (`?k=<id>`); the item's detail shows its folder path.
- **Decision (default): the global view's folder tree is for browsing.** Admins create items and folders in the group's tab; in the global view they open items, and rename, move or delete folders.

## Data

New table `knowledge_folders`:

| column | type | notes |
|---|---|---|
| id | text pk | uuid |
| group_id | text not null | → groups, on delete cascade |
| parent_id | text null | → knowledge_folders; null is the top level |
| name | text not null | 1–100 characters (check) |
| visibility | text not null default 'public' | `public` or `admins` (check) |
| created_by | text not null | → user |
| created_at, updated_at | timestamptz(3) | |

Indexes: `(group_id)`, `(parent_id)`.

`knowledge_items.folder_id` (text null → knowledge_folders; null is the top level). The index `(group_id, folder_id, created_at desc, id desc)` serves a folder's page (`folder_id = $1` or `folder_id is null`).

Migration `0022_knowledge_folders` (drizzle-kit generate).

Invariant, kept by the service: a folder or item inside an admins-only folder is admins-only. So every ancestor of a public folder or public item is public, and a client's path to anything they see never crosses an admins-only folder.

All folder and item writes of one group take a transaction-level advisory lock on the group (`pg_advisory_xact_lock`) before reading the folder tree, so two moves cannot make a cycle and a cascade to admins-only cannot miss an item moved in at the same moment.

## API

Folders (all need a session; a ziadatel or a client of another group gets 404; writes share the knowledge rate limit):

- `GET /api/groups/:id/knowledge/folders` → `{ folders: KnowledgeFolderDto[] }`: every folder of the group the actor sees (clients: public ones), sorted by name. One query.
- `POST /api/groups/:id/knowledge/folders` `{ name, parentId?: string | null, visibility?: 'public' | 'admins' }` → 201 `KnowledgeFolderDto`. A client asking for `admins` gets 400 `invalid_visibility`; a parent the actor does not see is 404; in an admins-only parent the folder is admins-only. 400 `folder_limit` at 1000 folders.
- `PATCH /api/knowledge/folders/:id` `{ name?, parentId?, visibility? }` (at least one) → `KnowledgeFolderDto`. Moving into itself or below itself: 400 `invalid_folder`. Visibility rules above.
- `DELETE /api/knowledge/folders/:id` → 204; contents move to the parent.

`KnowledgeFolderDto`: `{ id, groupId, parentId, name, visibility, updatedAt }`.

Items:

- `KnowledgeDraft.folderId` (optional, null = top level) and `KnowledgePatch.folderId` (optional, nullable). An unknown folder, one of another group, or one the actor does not see: 404. A client's item into an admins-only folder: 400 `invalid_visibility`. An explicit `visibility: 'public'` inside an admins-only folder: 400 `invalid_visibility`.
- `KnowledgeSummary` gains `folderId` and `folderPath` (`{ id, name }[]`, top level first). The path is resolved for a whole page in one recursive query; for a public item only public folders can be on it (the invariant), and the service drops any other as defence in depth.
- `GET /api/groups/:id/knowledge?folder=<id>|root`: the items directly in that folder (or at the top level). Without `folder` the list is every item of the group (the flat list used while searching). A folder the actor does not see is 404, so its id cannot be probed.
- `GET /api/knowledge` (the global list) is unchanged: flat; the web uses it only while searching.

Realtime (shared `KnowledgeEvents`):

- `knowledge:folder` `{ folder: KnowledgeFolderDto }` after create and update; `knowledge:folder_deleted` `{ groupId, id }` after delete.
- Routing like items: public → group room; admins-only → group admins room; public → admins-only sends `folder_deleted` to the group's clients, plus `item_deleted` for every item that became admins-only.
- A moved item sends the usual `knowledge:item` (with its new `folderId`).

## Web

- **Tab** (`/groups/:id/knowledge?folder=<id>`): breadcrumbs "Knowledge › Folder › Subfolder" (each a link; long paths collapse the middle to "…" on phones), then the folders of the open folder as rows (folder icon, name, the "Only eGrant" badge, a "…" menu: Rename, Move to…, Delete), then the items of that folder. "+ New" gets a fifth entry, "Folder". The type pills filter the items of the open folder. While a search is active the breadcrumbs and folder rows hide and the list is flat across all folders; each row shows its folder path.
- **Folder dialog** (create and rename): the name, and for admins "Visible to" (Everyone in the group / Only eGrant; locked to Only eGrant inside an admins-only folder, with a line saying why).
- **Move dialog**: the group's folders as an indented tree with "Top level" first; the current place and (for a folder) the folder itself and everything below it are disabled; admins-only folders show the lock. Clients only see public folders.
- **Item detail**: the folder path above the title; "Move to…" in the "…" menu. A new item's form is locked to admins-only inside an admins-only folder.
- **Global view** (`/knowledge`): without search, the first level is the clients in the chosen scope (logo and name, by name); choosing one (`?at=<groupId>`) shows breadcrumbs "All clients › Client › Folder" and that group's folders and items (the type filter applies to the items). With search: the existing flat list across clients, each row with its client and folder path.
- Live updates in the tab: folder events refetch the group's folder list and its item lists; an item event upserts the row only when its `folderId` is the open folder (otherwise removes it).

Performance: one folder query per group view; one recursive query per page for the paths; items paginated through the new index; everything new lives in the lazy knowledge chunks (nothing in the entry chunk).

## Tests

Server, test-first: admins-only folders and their contents never reach a client through `GET folders`, the folder list filter (`?folder=`), the flat list, search, the global list, the detail (`folderPath`), any write (404 for a hidden folder as parent, target or list), or any socket event; cascade to admins-only (folders, items, files, reminder recipients); refusals for client items; delete moves contents up; cycles refused; 1000 limit.

Web: tree helpers, breadcrumbs, folder rows and menu, move dialog disabled targets, search turning the tree into a flat list with paths, the global view's client level and drill-down, events.
