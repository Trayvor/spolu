# Phase 33 — Projects per client and closer eGrant integration: plan

Spec: [2026-10-17-phase-33-projects-design.md](../specs/2026-10-17-phase-33-projects-design.md) (read its "Owner decisions" first). Status: **approved** by the owner on 2026-10-17. Decisions 6 and 8 were amended, and 6a and 8a answered, the same day. Changes from the eGrant project webhook become pending changes reviewed field by field. The group's clients create, edit, archive, merge and delete projects and events and set them on tasks and tickets. The eGrant API is final:

- projects by their own call `PUT /api/egrant/projects/:project_id`, which creates and updates them;
- no event ids (pairing by name and date);
- the ticket intake sends only `project_id`; it never sets an event, and eGrant never updates a ticket. Phase 34's plan: [2026-10-17-phase-34-admin-group.md](2026-10-17-phase-34-admin-group.md); the joint merge order of both phases is at the end of this file.

Six pull requests. **P1 is merged first**: it writes the one migration (projects, events, files, name keys, the task and ticket columns, `knowledge_links`), the shared types, the policy, the projects API and the empty Prehľad tab, so the other parts add code in files of their own. Then **P2, P3, P4 and P5 run in parallel** (separate worktrees, any merge order, each rebases on the previous merge). **P6** (finance filters) waits for P2 and for Phase 32 parts C and D. Each part is test-first (`superpowers:test-driven-development`), runs `bash scripts/ci.sh` before merging and updates its docs with `update-kb`; screen work starts with the `frontend-design:frontend-design` skill (CLAUDE.md).

```
Phase 32 A2 · B · C ─┬─ D ─────────────────────────────────────────┐
                     │                                              │
P1 foundation ───────┼── P2 tasks & tickets: fields, filters ───────┴── P6 finance filters by project/event
                     ├── P3 eGrant project webhook, ticket links, merge
                     ├── P4 timeline and overview cards
                     └── P5 description editor: AI, voice, knowledge everywhere
```

## Conflict rules for the parallel parts

- **Migrations:** only P1 writes one for this phase (spec §3 and §10.3). P6 writes the finance one (spec §11). A part that finds it needs another change makes its own migration on top of `main` and renumbers it when it rebases; it says so in its PR. Phase 32 parts and the `chat_file` → file change may land migrations meanwhile: P1 takes the next free number at its merge.
- **Server:** P1 creates `modules/projects/{schema,policy,service,events,routes,refs}.ts` and empty files owned by later parts: `timeline.ts`, `overview.ts` (P4), `egrant-match.ts`, `merge.ts` (P3). In `modules/tasks` and `modules/tickets`, P2 owns the field and filter changes; P3 adds `modules/projects/egrant-routes.ts`, `egrant-delivery.ts` and `modules/tickets/egrant-link.ts`, and touches only the intake route, `assignClient`, the move (one call each) and the groups service's create and URL change (one call to `processInboxFor`); P4 adds new files `tasks/by-event.ts`, `tasks/open-of-group.ts`, `tickets/by-event.ts`, `tickets/active-of-group.ts` and edits nothing else there; P5 adds `knowledge/links.ts` and the AI group routes in `modules/ai/group-text-routes.ts`, and edits the DTO builders of tasks, tickets, projects and knowledge only to add `linkedKnowledge` (one line each, after P2's `project` line when both are open: the later one rebases).
- **Shared types:** P1 writes `packages/shared/src/projects/` (`common.ts`, `timeline.ts`, `overview.ts`, `intake.ts`) with every DTO and request schema of the spec, and adds `project`, `event` (nullable, optional in requests) to the task and ticket DTOs and bodies. A part refines only its own file.
- **Locales:** P1 creates the namespace `projects` in all nine languages with the shared words and registers it on the overview route; P2 writes into `tasks`, `tickets`, `taskSplit`; P4 into `projects` (its own keys under `timeline.*` and `cards.*`); P5 into `chat` (editor buttons are there already) and `knowledge`. P1's own dialog keys live under `projects.dialogs.*`.
- **Web:** P1 owns `features/projects/{overview-tab,projects-card,project-sheet,project-dialog,event-dialog,api,use-project-events}.tsx` and the tab pill in `group-tabs.tsx`; P4 owns `features/projects/{timeline,timeline-event,event-sheet,done-pile,active-cards}.tsx`, rendered in slots P1 leaves in `overview-tab.tsx`; P2 owns `features/projects/{project-select,event-select}.tsx` and their use in the task, ticket and review forms and the filter pills; P5 owns `features/editor/` and the AI and voice buttons' `target` prop. P1's dialogs use a plain `FormattedTextField` for descriptions; P5 swaps it.
- **Docs:** P1 creates `docs/product/projects.md` with one section per part; each part fills its section. Edits of shared docs go into their own paragraph at the end of the relevant section.

## Interfaces between the parts (written by P1, stubs throw `not implemented` where a later part fills them)

```ts
// modules/projects/policy.ts (P1)
canReadProjects(actor, groupId, actorGroupIds): boolean
canEditProjects(actor, groupId, actorGroupIds): boolean     // = canReadGroup (decision 8)
canArchiveProject(actor, groupId, actorGroupIds): boolean   // = canReadGroup (decision 8a)
canMergeOrDeleteProject(actor, groupId, actorGroupIds): boolean   // = canReadGroup (decision 8a, owner 2026-10-17)
canSetTaskProject(actor, groupId, actorGroupIds): boolean   // = canUseBoard
canSetTicketProject(actor, ticket, role): boolean           // admin, or a client of the ticket's group; never a žiadateľ or a ticket without a client

// modules/projects/refs.ts (P1)
getProjectRef(db | tx, groupId, projectId: string | null, eventId: string | null): Promise<{ projectId; eventId } | null> // throws InvalidProjectError
projectRefs(db, pairs: { projectId; eventId }[]): Promise<Map<string, ProjectRefDto>>
listPickerProjects(db, groupId): Promise<ProjectPickerItem[]>
lockGroupProjects(tx, groupId): Promise<void>
colorOf(projectId): ProjectColor

// modules/projects/egrant-match.ts (P3)
findEgrantProject(tx, groupId, egrantProjectId): Promise<string | null>   // a ticket's link, by the eGrant id only
// modules/projects/egrant-delivery.ts (P3)
receiveProjectDelivery(tx, groupId, egrantProjectId, body: EgrantProjectBody): Promise<{ projectId; state: 'created' | 'unchanged' | 'pending' | 'stale'; pending: number; skipped: string[] }>   // links waiting tickets on create
processInboxFor(tx, groupId, host): Promise<void>                    // called by the groups service on client create / URL change
reviewEgrantChanges(deps, actor, projectId, { accept: string[]; dismiss: string[] }): Promise<ProjectDto>
// modules/tickets/egrant-link.ts (P3)
linkTicketProject(tx, ticket, egrantProjectId: string | null): Promise<'linked' | 'waiting' | 'none'>   // once, only on a ticket without a project
linkWaitingTickets(tx, groupId, egrantProjectId, projectId): Promise<string[] /* ticket ids, for ticket:updated */>
// modules/projects/merge.ts (P3)
mergeProjects(deps, actor, fromId, intoId): Promise<ProjectDto>

// modules/tasks (P2 for the columns; P4 for the reads)
reassignTaskProject(tx, groupId, fromProjectId, toProjectId): Promise<void>
tasksByEvents(db, groupId, eventIds, { openLimit }): Promise<Map<eventId, { open: TaskRow[]; openCount; doneCount }>>
openTasksOf(db, groupId, userId, limit): Promise<{ rows; total; mine; urgent }>
// modules/tickets (same split)
reassignTicketProject(tx, groupId, fromProjectId, toProjectId): Promise<void>
ticketsByEvents(db, groupId, eventIds, { openLimit }): Promise<Map<eventId, { open: TicketRow[]; openCount; doneCount }>>
activeTicketsOf(db, groupId, userId, limit): Promise<{ rows; total; mine }>

// modules/knowledge/links.ts (P5; the table from P1)
setLinkedItems(tx, subject: { kind: 'task' | 'ticket' | 'project' | 'event' | 'knowledge'; id }, groupId, itemIds): Promise<void>
linkedItemCards(db, kind, subjectIds): Promise<Map<subjectId, KnowledgeCardDto[]>>

// web (P1): features/projects/api.ts query keys ['projects', groupId, kind, …]; useProjectEvents(groupId) → invalidate on project:changed (2 s debounce)
// web (P5): <DescriptionField value onChange target={{ kind: 'group', id }} knowledge={…} mentions? />
```

---

## Part P1 — Foundation (branch `feat/projects-foundation`)

Status: **built** on `feat/projects-foundation` (migration 0036). Deviations: merge stays with P3 (its file, route and dialog), so P1's "Done when" checks it there; the shared intake schemas are in `packages/shared/src/projects/intake.ts` (P3 refines that file, not a new `egrant.ts`); the stubs also cover `egrant-delivery.ts`, `tickets/egrant-link.ts`, the four P4 read files, `tasks/project-links.ts` and `tickets/project-links.ts` (`reassign…Project`) and `knowledge/links.ts`, each throwing `NotImplementedError`; the projects card's counts come from new `tasks/by-project.ts` and `tickets/by-project.ts`.

**Goal:** projects and events exist and are enforced; admins and the group's clients create, edit, archive, merge and delete them with files (decisions 8 and 8a); the Prehľad tab shows the projects card; every table of the phase exists.

Server:
- Migration `projects_foundation` (spec §3, §10.3): `projects`, `project_name_keys`, `project_events`, `project_attachments`; `tasks.project_id`, `tasks.event_id`, `tickets.project_id`, `tickets.event_id`, `tickets.egrant_project_id` with its partial index for waiting tickets; `projects.egrant_delivered_at`, `egrant_sent_at`; `project_events.source`, `name_key`, `egrant_name_key`, `egrant_date`; `egrant_changes`; `egrant_project_inbox` (spec §3, §5), with the composite FKs (`on delete set null (…)` column lists written by hand in the SQL) and CHECKs; `knowledge_links`; every index (each FK leads one: `infra/db/foreign-key-indexes.test.ts`).
- `modules/projects/{schema,policy,service,refs,events,routes}.ts`: CRUD for projects and events with `updatedAt` conflicts (`409 project_changed`), archive and restore, delete (the FKs clear tasks and tickets), files through `attachFiles`, name keys on create and rename (`409 project_name_taken`), alias removal; the picker routes; `project:changed` to `group:<id>`.
- Tasks and tickets: the columns in their Drizzle schemas only (no behaviour; P2 adds it), so the build passes.
- `packages/shared/src/projects/*`, the DTO additions (`project`, `event` as `null` until P2 fills them).
- ADR `docs/decisions/00NN-projects-composite-keys-and-egrant-matching.md`.

Web:
- `group-tabs.tsx`: the `overview` pill first; `router.tsx`: `/groups/$groupId/overview` (lazy `projects-tab`, namespace `projects`).
- `features/projects/overview-tab.tsx` (the grid with slots for the timeline and the active cards, filled by P4), `projects-card.tsx`, `project-sheet.tsx`, `project-dialog.tsx`, `event-dialog.tsx` (descriptions with `FormattedTextField` for now), `api.ts`, `use-project-events.ts`.
- Locales: `projects` in nine languages; `group.tabs.overview` in the eager files.

Tests (first): policy table (admin, client, žiadateľ, outsider: a client creates, edits, archives, restores, merges and deletes and removes aliases; a žiadateľ `404` on every route); CRUD and validation; composite FK refusals (another client's project, an event of another project, an event without a project); deleting a project or event clears tasks and tickets but keeps them; name keys and `409`; archive; files readable by the group's readers only; the realtime event's rooms; web: the tab only for group readers, the card's states, the dialogs' validation.

Docs: `product/projects.md` (new), `product/README.md`, `product/groups.md` (tab), `architecture/data-model.md`, `permissions.md`, `realtime.md`, `overview.md`, `glossary.md`, the ADR, `roadmap.md` (Phase 33 in progress). Bundle: initial JS delta (< +0.3 kB) in `architecture/performance.md`.

Done when: an admin creates a project with two events and a file in a client's Prehľad; the client sees them, adds a third event, archives the project and merges a duplicate into it; a žiadateľ reaches none of it.

---

## Part P2 — Tasks and tickets on projects, and the filters (branch `feat/projects-links`; after P1)

**Goal:** spec §6 and decision 12.

Server:
- `modules/tasks`: `project_id`/`event_id` in create, PATCH and the AI review create (`getProjectRef` in the transaction, `400 invalid_project`, `canSetTaskProject`); the DTOs' `project`/`event` through one `projectRefs` per page (board, done page, global board, panel, home cards); filters `project`/`event` on `GET /api/groups/:id/board` and `/board/done`; `project` on `GET /api/tasks/global` only with one client (`invalid_filter`); `reassignTaskProject`.
- `modules/tickets`: a route of its own, `PUT /api/tickets/:id/project { projectId, eventId }` (`canSetTicketProject`: admins and the group's clients, decision 8), the same pair in the new-ticket body (a client creating a ticket may choose it), the list filters (`TicketListQuerySchema`), `GET /api/tickets/global` with one client; the žiadateľ's `forReader` strips colour and event; tasks made from a ticket inherit its project and event; `reassignTicketProject`; moving a ticket to another client clears project and event in the same statement (P3 then adds the re-match there).
- EXPLAIN cases: the filtered board and ticket list on `home/test-volume.ts`.

Web:
- `features/projects/project-select.tsx`, `event-select.tsx` (load on open from the picker routes; changing the project clears the event).
- Task form and panel, AI review cards (`features/task-split/`), ticket new and edit forms, ticket page details, the project chip on task cards and ticket rows.
- Filters: `features/tasks/board.tsx` gets its first filter row (Project, Event; `useRememberedFilters` per group; phones: one "Filters (n)" pill); `features/tickets/ticket-filters.tsx` and `search.ts`; `features/global-board/board-filters.tsx` (Project only with one client).
- Locales: `tasks`, `tickets`, `taskSplit`, `adminHome` (global board pill) in nine languages.

Tests (first): set, change, clear on tasks and tickets per role (a client yes on both; a žiadateľ `404`; a client still `403` on the ticket's other fields); invalid pairs; inheritance from a ticket; the move clearing; filters and their `400`s; DTO batching (query count); web: selects, the filter pills and URL params, the one-client rule; e2e scenario 2.

Docs: `product/task-board.md`, `product/tickets.md`, `product/admin-home.md` (global board), `product/projects.md` (Links and filters), `architecture/permissions.md`, `architecture/overview.md` (API).

Done when: a task and a ticket sit on an event, and both tabs filter by the project and the event.

---

## Part P3 — eGrant project webhook, ticket links, merge (branch `feat/projects-intake`; after P1, parallel with P2)

**Goal:** spec §5 and decisions 1–6c. This part covers:

- the project endpoint (a webhook) that creates and updates projects;
- pending changes from it, reviewed field by field;
- the ticket intake's `project_id` link, including tickets that wait for their project;
- merge.

Server:
- **Project endpoint** `PUT /api/egrant/projects/:project_id`, in `modules/projects/egrant-routes.ts`:
  - The Bearer key and its own rate limit (120 a minute per IP) are checked in `onRequest`, before the body; the body limit is 1 MiB.
  - The schema `EgrantProjectBodySchema` lives in `packages/shared/src/projects/egrant.ts`, with a strict `dd.mm.yyyy` parser `parseEgrantDate`.
  - The answers are `201`, `200` and `202`, with `skipped` listing the skipped events.
  - Skipped events are logged without their text.
- **`modules/projects/egrant-delivery.ts`:**
  - `receiveProjectDelivery(tx, groupId, projectId, body)` handles the first creation (spec §5.2) and links the client's waiting tickets through the tickets module's `linkWaitingTickets`.
  - A person's project with the same name key and no eGrant id is linked, and its differences become pending changes.
  - The event pairing: name and date, then name alone, then date alone, then additions and removals (spec §5.4).
  - Each event's eGrant identity (`egrant_name_key`, `egrant_date`) is updated on every processed delivery.
  - The rows of `egrant_changes`: an equal value deletes the row, a dismissed hash stays dismissed, anything else becomes pending.
  - The `sent_at` stale guard.
- **`egrant_project_inbox`:** an unknown instance answers `202` and the delivery is stored. Creating a client, or changing its eGrant URL, processes the stored deliveries and links the waiting tickets; this is one call from the groups service into an exported `processInboxFor(tx, groupId, host)`. The daily cleanup job drops rows older than 180 days.
- **Review API:**
  - `GET /api/projects/:id/egrant-changes`.
  - `POST /api/projects/:id/egrant-changes { accept, dismiss }`, guarded by `canEditProjects`; accepting a removal uses `canMergeOrDeleteProject`, the same rule (decision 8a). A row that changed meanwhile answers `409 change_outdated`.
  - `ProjectDto.egrantChanges` (the count).
- **Ticket link** (spec §5.5):
  - `project_id` joins `TicketIntakeBodySchema`; it is optional, and an empty value means no project.
  - `modules/tickets/egrant-link.ts` holds `linkTicketProject` and `linkWaitingTickets`:
    - a known eGrant id links the ticket;
    - an unknown one keeps the raw id in `tickets.egrant_project_id` until the project arrives;
    - a ticket without a client keeps the raw id;
    - there is never an event, and never a second link on a ticket that has a project.
  - `assignClient` and the group move match the raw id in the new client (the move first clears the old project and event).
  - DTOs: `TicketDto.waitingForProject`, `TicketDto.egrantChanges` and `TicketListItem.egrantChanges` (all stripped for a žiadateľ); the list filter `egrant=pending`.
- **Merge:** `modules/projects/merge.ts` and `POST /api/projects/:id/merge` (`canMergeOrDeleteProject`: admins and the group's clients). It moves events, tasks, tickets, files, linked knowledge, pending eGrant changes and key rows, then deletes the merged project.
  - It uses P2's `reassign…` functions when P2 has merged.
  - Otherwise P3 adds them as stubs with the same signatures in the tasks and tickets modules; the part that rebases later keeps one copy.
- **Fallback switch:** `TICKETS_PROJECT_FIELD=programme`, read in one function and documented in `.env.example`. It is used only if eGrant never sends projects.
- **Archived projects:** the ticket page shows a hint when a ticket lands in an archived project (a flag in the ticket DTO).

Web:
- **Project sheet:**
  - the "From eGrant" badge on the project and its events, and the "Also matches" chips;
  - the **"Changes from eGrant (n)"** section: one row per field with current → incoming, Accept or Dismiss on each row, and "Save choices";
  - the "Maybe the same event" pairs shown side by side;
  - the merge dialog.
- **Projects card and timeline:** the "eGrant changes (n)" badge on the project's row, and a mark on affected events and in the project select.
- **Tickets:**
  - The ticket page, for admins and the group's clients, shows:
    - "eGrant project prj-208 has not arrived yet" for a waiting ticket;
    - the raw id for a ticket without a client;
    - the line "This ticket's project has changes from eGrant · Review";
    - the move warning.
  - The "eGrant change" badge appears on rows of the group and global lists and on the admin home's Tickets card, and the lists get an "eGrant changes" filter pill.
- Locales: `projects`, `tickets`.

Tests (first): the lists of spec §16. They cover:
- project deliveries, with waiting tickets linked;
- the pairing and its limits;
- the inbox;
- the review, by a client and by an admin;
- the ticket link: known, waiting, no client, empty, never an event, never relinked;
- matching a person's project by name;
- concurrency: two deliveries at once create one project;
- merge.

E2e: scenarios 3, 4 and 5 (`e2e/projects-intake.spec.ts`).

Docs:
- `integrations/egrant-ticket-intake.md`. The "What eGrant must send" checklist with both examples, and the section "Projects (planned)", are drafted already in the spec PRs. P3 removes the "planned" marks and adds "Projects" under "What happens in Help".
- `product/integrations.md`, `product/tickets.md`, `product/projects.md` (eGrant projects), `.env.example`, `architecture/overview.md` (API, config), `architecture/permissions.md` (the keyed endpoint, the review rights).

Done when:
- an eGrant project call creates the project with its events;
- a later call becomes changes that a client or an admin accepts or dismisses field by field;
- tickets with its `project_id` land in it, also those that arrived before the project.

**Before merging, the eGrant developers confirm** they can send the project call and `project_id` on tickets.

---

## Part P4 — Timeline and the overview cards (branch `feat/projects-timeline`; after P1, parallel with P2, P3, P5)

**Goal:** spec §7.2–§7.4, decisions 14–18.

Server:
- `modules/projects/timeline.ts` (`GET /api/groups/:id/timeline`, keyset around today both ways, six queries a page) and `GET /api/project-events/:id/items`; `modules/projects/overview.ts` (`GET /api/groups/:id/overview/active`).
- `tasks/by-event.ts`, `tasks/open-of-group.ts`, `tickets/by-event.ts`, `tickets/active-of-group.ts` (exported reads; window-function caps; grouped counts).
- `modules/projects/test-volume.ts`, `explain.test.ts` (spec §12 limits).

Web:
- `features/projects/timeline.tsx` (the strip, Today marker, gaps, Earlier/Later keeping the scroll position, keyboard), `timeline-event.tsx`, `done-pile.tsx`, `event-sheet.tsx`, `active-cards.tsx`; the phone variant (dots only, sheet on tap).
- The task panel over the overview route (`?task=<id>`), as on the admin home.
- Locales: `projects` (`timeline.*`, `cards.*`).

Tests (first): timeline order around today (past, today, coming; same day by creation), paging, caps and counts, archived projects, the all-projects colours, the query count; active cards' "mine first"; web: Today placement with no past or no coming events, gaps over 60 days, the done pile, Earlier/Later scroll keeping, arrow keys, the phone sheet; e2e scenarios 1, 6, 7 (`e2e/projects.spec.ts`). Data for the tests is set through SQL fixtures until P2 merges (the columns exist since P1).

Docs: `product/projects.md` (Timeline and cards), `architecture/performance.md` (chunk and EXPLAIN numbers), `architecture/overview.md` (API).

Done when: a client's whole project life is browsable on the timeline with Today visible, each event listing its tasks, tickets and done pile, on a computer and a phone.

---

## Part P5 — Description editor with AI, voice and knowledge (branch `feat/description-editor`; after P1, parallel)

**Goal:** spec §10, decisions 20–22.

Server:
- `modules/ai/group-text-routes.ts`: `GET /api/groups/:id/ai-tools`, `POST /api/groups/:id/ai-text`, `POST /api/groups/:id/transcribe` (`canReadGroup`; the chat routes' providers, prompts and **the same per-user limiters**; Translate by the group's eGrant link as in chat).
- `modules/knowledge/links.ts` (`setLinkedItems`, `linkedItemCards`, the žiadateľ read-through `GET /api/tickets/:id/knowledge/:itemId`, file rule `fileOfTicketLinkedKnowledge` registered by tickets); `knowledgeIds` in the bodies and `linkedKnowledge` in the DTOs of tasks, tickets, projects, events and knowledge items.
- Re-check the field list of spec §10.1 against `main` first (a field added meanwhile joins it).

Web:
- `features/editor/description-field.tsx` (document mode of the chat editor, lazy on focus, rendered Markdown first), the `target` prop on `AiTextButton` and `VoiceButton` (the composer passes the channel), "Attach knowledge" opening the existing `knowledge-picker.tsx` **without changing it** (Phase 34 P34-A turns it into a tab), the linked cards under rendered descriptions.
- Swap the fields of spec §10.1: task form, AI review cards, ticket new/edit (and the ticket text rendered with the chat renderer), project and event dialogs, the knowledge form, the meeting summary fields; the finance item form when Phase 32 B has merged (else a follow-up line in its PR).
- Locales: `chat`, `knowledge`, `tickets` in nine languages.

Tests (first): the group AI routes' access matrix (admin, client, žiadateľ `404`, outsider) and shared limits; `knowledge_links` (shareable only, at most 10, re-check, moved ticket unavailable, žiadateľ read-through and files, never admins-only or finance-only); web: lazy load on focus, Enter makes a line, AI replace and undo, voice append, attach and remove, each swapped form still saves; e2e scenario 8 (`e2e/description-editor.spec.ts`, fake providers). Bundle: each form's delta (< 1 kB eager) in `architecture/performance.md`.

Docs: `product/chat.md` (the editor outside chat), `product/task-board.md`, `product/tickets.md`, `product/knowledge-base.md`, `product/projects.md`, `architecture/permissions.md` (the group AI routes, the read-through), `architecture/overview.md` (API).

Done when: every field of spec §10.1 marked "editor" has the AI button, the microphone and (where marked) "Attach knowledge", and nothing was added to the initial JS.

---

## Part P6 — Finance by project and event (branch `feat/finance-projects`; after P2 and Phase 32 C and D)

**Goal:** spec §11, decisions 23–25.

Server:
- Migration (finance): `finance_time_entries.project_id`, `event_id`; `finance_items.project_id`; the partial indexes of spec §11. A one-off backfill in the migration is not possible without reading `tasks` (forbidden to finance): instead a startup job `finance.backfill-projects` asks the tasks and tickets modules for `projectOfTasks(ids)` / `projectOfTickets(ids)` in batches and writes the copies (idempotent, logs counts).
- Hooks: `onTaskCompleted` / `onTicketResolved` events gain `projectId`, `eventId`; new `onSubjectProjectChanged(tx, …)` called by P2's write paths and by P3's merge (each one line in the tasks and tickets services, inside their transactions).
- Filters on the client overview and work log (`project`, `event`); `/finance` routes take `project` only with one client; contract form's optional project; manual entries' project and event.
- EXPLAIN cases with the filters on the Phase 32 volume.

Web:
- The Project and Event pills on the Financie tab's Overview and Work log (remembered), the contract form's project select, the manual entry's selects; `/finance`'s Project pill with one client.
- Locales: `financeLog`, `financeDocuments`, `financeSystem`.

Tests (first): copies on completion, on change, on merge, on delete (ids stay, filter no longer offers them); filtered totals per currency and cost; a ticket unit split by project; the one-client rule; the seal (projects never reads finance; finance never reads tasks or tickets: an import test); e2e scenario 9.

Docs: `product/finance.md`, `architecture/data-model.md`, `architecture/permissions.md` (unchanged rules, new params), `architecture/performance.md`.

Done when: a finance admin sees a client's hours, cost and contract money for one project, and for one event.

---

## Joint merge order of Phases 32 (rest), 33 and 34

Both phases are planned to run with parallel agents in worktrees; the orchestrator runs `scripts/ci.sh` serially and merges.

| wave | runs in parallel | waits for |
|---|---|---|
| 0 (in flight) | Phase 32 A2, B, C; `feat/knowledge-chat-file-to-file` | — |
| 1 | **P33-P1** foundation; **P34-A** three-tab picker in client groups; **P34-B** admin group foundation | owner's answers; P34-A needs Phase 28 attachments merged (it is) |
| 2 | P33-P2, P33-P3, P33-P4, P33-P5; Phase 32 D (when B and C are in) | P33-P1 |
| 3 | **P34-C** admin-group knowledge sharing (after P34-B and P33-P5, which owns the description links it extends); **P34-D** admin-group picker with the client filter (after P34-A, P34-B) | as listed |
| 4 | **P33-P6** finance filters (after P33-P2, Phase 32 C and D); **P34-E** finance in the admin group (after P34-B, Phase 32 D) | as listed |
| 5 | final testing: every e2e of both phases on the test server, the owner's walk | all |

Hot files touched by more than one part, and who goes first: `features/groups/group-tabs.tsx` (P33-P1 adds Overview, P34-B adds the kind switch: whichever merges second rebases two lines); `features/chat/composer.tsx` (P33-P5 changes the AI and voice props, P34-A the attach menu: different lines, P34-A first if both are open); `modules/tickets/service.ts` (P33-P2, P33-P3, P34-B: one call each in different functions); `modules/knowledge/policy.ts` (P34-C replaces `isShareable` by `isShareableInto`: after P33-P5); `components/client-filter.tsx` (P34-B adds the admin group option, P34-D the "my clients" marks: P34-B first).
