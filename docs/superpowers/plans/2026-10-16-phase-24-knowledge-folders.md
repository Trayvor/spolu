# Knowledge Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Folders (a tree, optionally admins-only) in each group's knowledge base, browsable in the group's tab and in the admins' global view, with search staying a flat list across folders.

**Architecture:** A `knowledge_folders` table and `knowledge_items.folder_id` in the knowledge module. A new `folders.ts` service loads a group's folders in one query and does every tree check in memory under a per-group advisory lock; item paths come from one recursive query per page. The web adds a folder browser (breadcrumbs, folder rows, move and folder dialogs) to the lazy knowledge chunks.

**Tech Stack:** Fastify, Drizzle (PostgreSQL 17), Socket.IO, zod (`@spolu/shared`), React, TanStack Router/Query, Tailwind, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-16-phase-24-knowledge-folders-design.md](../specs/2026-10-16-phase-24-knowledge-folders-design.md)

## Global Constraints

- Folder name 1–100 characters (trimmed); at most 1000 folders per group; no depth limit.
- Visibility values `public` | `admins`; anything inside an admins-only folder is admins-only.
- Error codes: `invalid_visibility` (400), `invalid_folder` (400, cycle or folder of another group), `folder_limit` (400), `not_found` (404 for any folder the actor cannot see).
- Events `knowledge:folder` and `knowledge:folder_deleted`, routed like items.
- Server tests run with `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_t24`.
- Initial JS ≤ 200 kB gzip: nothing new in the entry chunk (`features/knowledge/search.ts` is eager: keep it import-free).
- English code and docs; UI strings in `locales/knowledge/{en,sk}.json`.

## Review Focus

- A client asking for a hidden folder by id (list `?folder=`, create `parentId`, item `folderId`, PATCH, DELETE) must get the same 404 as for an unknown id — test each route.
- A client deleting a folder that holds admins-only things: they move up, the client sees nothing new — test that the client's lists stay the same and the admin sees the contents in the parent.
- Making a folder admins-only with a client's item deep inside: 400 and nothing changes — test with the item two levels down.
- An item moved by an admin into an admins-only folder: its files become admins-only and non-admin reminder recipients are dropped — test both.
- A viewer inside a folder that is deleted or hidden: the web goes back to the top level with a notice — test in the tab test.

---

### Task 1: Shared schemas

**Files:**
- Modify: `packages/shared/src/knowledge.ts`, `packages/shared/src/errors.ts` (or wherever `ErrorCodes` lives)
- Test: `packages/shared/src/knowledge.test.ts`

**Interfaces:**
- Produces: `KNOWLEDGE_FOLDER_LIMITS = { name: 100, perGroup: 1000 }`, `KnowledgeFolderDtoSchema`/`KnowledgeFolderDto`, `KnowledgeFolderListSchema` (`{ folders }`), `KnowledgeFolderDraftSchema` (`{ name, parentId: string | null = null, visibility = 'public' }`), `KnowledgeFolderPatchSchema` (strict, at least one of `name`, `parentId`, `visibility`), `KnowledgeDraft.folderId: string | null` (default null), `KnowledgePatch.folderId?: string | null`, `KnowledgeSummary.folderId: string | null`, `KnowledgeSummary.folderPath: { id: string; name: string }[]`, `KnowledgeEvents.folder = 'knowledge:folder'`, `KnowledgeEvents.folderDeleted = 'knowledge:folder_deleted'`, `KnowledgeFolderEvent = { folder }`, `KnowledgeFolderDeletedEvent = { groupId, id }`, `ErrorCodes.invalidFolder = 'invalid_folder'`, `ErrorCodes.folderLimit = 'folder_limit'`.

- [ ] Write failing tests: the draft trims the name and refuses empty / 101 characters; the patch refuses `{}` and unknown keys; the item draft defaults `folderId` to null.
- [ ] Run `pnpm --filter @spolu/shared test` — FAIL.
- [ ] Implement the schemas.
- [ ] Run — PASS. Commit `feat(shared): knowledge folder schemas`.

### Task 2: Schema and migration

**Files:**
- Modify: `apps/server/src/modules/knowledge/schema.ts`
- Create: `apps/server/src/infra/db/migrations/0022_knowledge_folders.sql` (generated)

**Interfaces:**
- Produces: `knowledgeFolders` table; `knowledgeItems.folderId`.

- [ ] Add the table, the column, the checks and indexes from the spec.
- [ ] `pnpm --filter @spolu/server db:generate --name knowledge_folders`; read the SQL.
- [ ] Commit `feat(knowledge): folders table and item folder column`.

### Task 3: Folder policy and service

**Files:**
- Modify: `apps/server/src/modules/knowledge/policy.ts` (+ test)
- Create: `apps/server/src/modules/knowledge/folders.ts`, `apps/server/src/modules/knowledge/folders.test.ts`

**Interfaces:**
- Produces: `canReadFolder(actor, folder, actorGroupIds)`, `lockGroupKnowledge(tx, groupId)`, `listFolders(db, actor, groupId): Promise<KnowledgeFolderDto[]>`, `createFolder(db, actor, groupId, draft)`, `updateFolder(db, actor, id, patch): Promise<{ folder; previousVisibility; hiddenItemIds: string[] }>`, `deleteFolder(db, actor, id): Promise<{ groupId; id; visibility }>`, `resolveFolderForItem(tx, actor, groupId, folderId)`, `folderPaths(db, folderIds, publicOnly)`, errors `KnowledgeFolderNotFoundError`, `InvalidFolderError`, `FolderLimitError`.

- [ ] Write failing tests (service level, real DB): client never lists admins-only folders; client cannot create in / rename / move / delete a hidden folder (not found); admins-only parent forces admins-only; client `admins` refused; cycle refused; cascade to admins-only hides items (visibility, files, recipients) and returns their ids; client item inside blocks the cascade (two levels down); admins → public touches only the folder; delete moves folders and items up; 1000 limit; sort by name.
- [ ] Run — FAIL. Implement. Run — PASS. Commit.

### Task 4: Items in folders

**Files:**
- Modify: `apps/server/src/modules/knowledge/service.ts`, `service.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: `ListFilters.folder?: string | null` (undefined = every folder); summaries with `folderId` and `folderPath`; `createItem`/`updateItem` honour `folderId`.

- [ ] Failing tests: create in a folder; admins-only folder forces admins-only; client into hidden folder → not found; admin moving a client's item into an admins-only folder → invalid visibility; explicit public inside an admins-only folder → invalid visibility; moving into an admins-only folder hides files and prunes recipients; list `folder` filters, flat list without it, search across folders; `folderPath` on list rows and detail.
- [ ] Run — FAIL. Implement. Run — PASS. Commit.

### Task 5: Routes and events

**Files:**
- Modify: `apps/server/src/modules/knowledge/routes.ts`, `events.ts`, `routes.test.ts`

- [ ] Failing route tests: the four folder routes (status codes above, 404 for hidden folders by a client and for a ziadatel), `?folder=` on the tab list (404 for a hidden folder), and sockets: a client socket never gets an admins-only folder event; public → admins-only sends `folder_deleted` and `item_deleted` to clients only.
- [ ] Run — FAIL. Implement. Run — PASS. Commit.

### Task 6: Web data layer

**Files:**
- Modify: `apps/web/src/features/knowledge/api.ts`, `use-knowledge-events.ts`, `search.ts` (+ tests)
- Create: `apps/web/src/features/knowledge/folder-tree.ts` (+ test)

**Interfaces:**
- Produces: `groupFoldersQuery(groupId)`, `createFolder`, `updateFolder`, `deleteFolder`; `KnowledgeFilter.folder?: string | null`; `childFolders(folders, parentId, lang)`, `folderPath(folders, id)`, `descendantIds(folders, id)`, `treeRows(folders, lang)` (depth-first rows with `depth`); `useKnowledgeEvents` upserts only rows of the open folder and invalidates on folder events.

- [ ] Failing tests for the tree helpers, the URL params (`folder`, `at`) and the event rules; implement; commit.

### Task 7: Tab UI

Invoke `frontend-design` first.

**Files:**
- Create: `folder-browser.tsx`, `folder-dialog.tsx`, `move-dialog.tsx`, `breadcrumbs.tsx` (+ tests)
- Modify: `knowledge-tab.tsx`, `knowledge-row.tsx`, `knowledge-dialog.tsx`, `knowledge-view.tsx`, `new-item-menu.tsx`, `knowledge-form.tsx`, locales.

- [ ] Failing tests: breadcrumbs and folder rows; opening a folder writes `?folder=`; search hides the tree and shows paths; "Folder" in "+ New" opens the folder dialog; move dialog disables self and descendants; a create in a folder sends `folderId`; a gone folder returns to the top level with the notice.
- [ ] Implement; PASS; commit.

### Task 8: Global view

**Files:**
- Modify: `knowledge-page.tsx` (+ test), `search.ts` (`at`)

- [ ] Failing tests: without search the client level lists the scope's clients; `?at=` shows the group's folders and items with breadcrumbs; typing a search shows the flat list with client and folder path.
- [ ] Implement; PASS; commit.

### Task 9: Docs, e2e, checks

- [ ] `docs/product/knowledge-base.md`, `docs/architecture/data-model.md`, `permissions.md`, `realtime.md`, roadmap status; `e2e/knowledge.spec.ts` folder scenario (not run here).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (bundle size), `bash scripts/check-docs.sh origin/main`.
- [ ] Commit, push, open the PR.
