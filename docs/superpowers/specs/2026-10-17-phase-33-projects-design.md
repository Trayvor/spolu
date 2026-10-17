# Phase 33 — Projects per client and closer eGrant integration: design

Date: 2026-10-17 · Status: **spec written, waiting for the owner** (nothing is built). Plan: [2026-10-17-phase-33-projects.md](../plans/2026-10-17-phase-33-projects.md). Roadmap: [Phase 33](../../roadmap.md#phase-33--projects-per-client-and-closer-egrant-integration). The internal admin group and the three-tab attachment picker are [Phase 34](2026-10-17-phase-34-admin-group-design.md).

Builds on: groups ([product/groups.md](../../product/groups.md)), the task board ([product/task-board.md](../../product/task-board.md)), tickets and the intake ([product/tickets.md](../../product/tickets.md), [integrations/egrant-ticket-intake.md](../../integrations/egrant-ticket-intake.md)), the knowledge base and its chat attachments ([Phase 28 attachments](2026-10-17-phase-28-reactions-and-attachments-design.md)), the Phase 28 editor ([spec](2026-10-17-phase-28-chat-editor-design.md), [ADR 0025](../../decisions/0025-prosemirror-chat-editor.md)) and AI text tools and voice ([spec](2026-10-17-phase-28-ai-text-tools-and-voice-design.md)), and Finance ([Phase 32 spec](2026-10-17-finance-module-design.md), parts A2, B, C and D being built now). Rules: [permissions](../../architecture/permissions.md), [performance](../../architecture/performance.md), [realtime](../../architecture/realtime.md).

## Owner's request (2026-10-17, translated from Ukrainian, intent kept)

1. Every client gets its own **dashboard** (a new tab, a home inside the group) where **projects** can be added. Projects contain **events**. An event has a name, a description, optional file(s) and a date. A project has the same except the date.
2. **Tickets** can be assigned to a project. In practice a ticket's project is the `project name` the eGrant API sends: integrate it (match or create the project from the API value; decide the matching rules). The project can be chosen or changed on the ticket, and a ticket can also be assigned to an **event** of that project. **Tasks** on the task board get exactly the same (project + event).
3. The client dashboard has a card imagined as a **wide straight timeline line where dots mark events**, showing which project they belong to. Under each event, rows list the **tasks and tickets** (separately, vertically) that belong to it, and at the very bottom the done tasks and tickets in a pile. On phones this shows when tapping an event. One must be able to browse the **whole life of a project chronologically**, see past and future events, and see a marker of **where we are now**.
4. Also cards with the client's **active tickets and tasks**, those where I am the assignee first.
5. Tickets and the task board get **filters by project and event**.
6. For this phase, for the knowledge base and for **every place where descriptions can be written**: the **AI input features** (Phase 28: AI text tools Fix / Formal / Translate, voice input) and **adding knowledge items** must be available there.
7. **Finance (Phase 32):** the client finance dashboard must be able to filter costs by **project and event**; the system-wide finance dashboard needs no event filter (project filter: decide).

Small feature noted with this phase: a knowledge item's type "From chat" can be changed to a plain file. It is being built now on branch `feat/knowledge-chat-file-to-file` by another agent and is not part of this spec (see §15).

## Owner decisions

Each row is a recommendation we build unless the owner says otherwise. **B** marks a business choice the owner must confirm; the others are technical defaults we take.

| # | Question | Recommendation | Why |
|---|---|---|---|
| 1 | **B** Which intake field carries the project? Today the intake has **no project field**: it has `programme` (grant programme name), `area`, `subject`. | **Add two optional intake fields: `project` (the project's name, ≤ 200) and `project_id` (eGrant's own stable id of the project, ≤ 100).** `programme` stays what it is and is **not** used as the project. If eGrant cannot send a project and the owner says "the project is the programme", the one switch is `TICKETS_PROJECT_FIELD=programme` (read in one function), no other change. | A programme (a call) and a project are different things in eGrant; guessing silently would file tickets under the wrong project. A stable id survives renames on either side. The eGrant developers must add the fields: the owner confirms with them. |
| 2 | **B** No project matches the name eGrant sent. | **Create the project automatically** in the ticket's client (marked "From eGrant", with the received name and id), so every ticket with a project lands in one. Admins rename, archive or **merge** duplicates later (decision 4). | Owner's words ("match/create"). A manual queue of unmatched names would be one more inbox nobody empties. |
| 3 | Matching rules. | Per client only, in this order: (1) `project_id` equals a project's stored eGrant id; (2) the **name key** (trimmed, inner spaces collapsed, lower-case, without diacritics: the existing `normalizeSearch`) equals a project's name key or one of its **aliases**; (3) otherwise create (decision 2). Archived projects match too (the ticket goes to the archived project, which shows a "New ticket in an archived project" hint to admins; it is not unarchived). A rename keeps the old name key as an alias; a merge moves the merged project's keys and ids to the survivor. A per-client lock and a primary key on the keys make concurrent intakes create one project, not two. | Exact keys are predictable; fuzzy matching (edit distance) would merge "Projekt A" and "Projekt B". Aliases make renames and merges safe for future tickets. |
| 4 | **B** Merging projects. | **Admins merge project A into B** (A's events, tasks, tickets, files, aliases and eGrant ids move to B; A is deleted), from A's menu, with a confirmation that names the counts. | Automatic creation (decision 2) will create a few duplicates from typos in eGrant; merge is the cleanup. |
| 5 | A ticket without a client arrives with a project. | **Keep the raw values on the ticket** (`egrant_project_name`, `egrant_project_id`) and match when an admin assigns the client; moving a ticket to another client matches again there (its old project and event are cleared, since projects belong to one client). | Projects are per client; there is nothing to match against before the client is known. |
| 6 | **B** Does a manual project choice on a ticket win over eGrant? | **Yes.** The intake sets the project once, at creation (or at the first client assignment). After that only people change it. | eGrant sends a ticket once; there is no later update to fight with. |
| 7 | **B** Who sees projects and events? | **Admins and the client's people** (everyone who reads the group, `canReadGroup`). A **žiadateľ** sees on their own ticket only the **project's name** (read-only), never the event, the dashboard or other projects. | The client's tasks and tickets are already visible to its clients; the timeline is their story too. A requester came from eGrant with that project, so its name is not new to them; event names can be internal. |
| 8 | **B** Who creates and edits projects and events? | **Admins only** (create, edit, archive, merge, delete). Clients read them and may set a project and event on **tasks** (they edit tasks today). Ticket project and event follow the ticket's field rule: **admins only** (`canEditTicket`). | Projects structure the eGrant team's work; clients adding events would need moderation. Option: let clients add events later with one policy change (`canEditEvents`). |
| 9 | **B** Admins-only events or projects? | **No visibility switch in this phase**: everything in a client's projects is visible to the client's people. | Every visibility rule doubles the queries and tests (see Knowledge). Internal planning belongs in the admin group (Phase 34). Can be added later as a column on events. |
| 10 | Event date. | **One date, required** (`occurs_on date`), no time and no end date. Events of the same day are ordered by creation. | Owner's words; a time or a range can be added later without changing the timeline API. |
| 11 | **B** Deleting a project or event that has tasks or tickets. | Allowed for admins with a confirmation naming the counts; their tasks and tickets **keep existing** and lose the project (or only the event). **Archive** is the normal way to end a project: archived projects leave the pickers and the timeline's default view, stay filterable, and still match eGrant (decision 3). | Deleting work items because their label went would be destructive; archive keeps the history browsable. |
| 12 | Tasks made from a ticket (Turn into tasks). | **They inherit the ticket's project and event** (editable in the review cards). Tasks made from a chat message or a meeting get none by default. | The ticket's project is the obvious context; a group chat has none. |
| 13 | **B** The new tab's name, place and whether it opens first. | Tab **Prehľad** (EN "Overview"), the **first pill**; the group still **opens on Chat** as today. | The team lives in the chat; the overview is one tap away. Option: open on Prehľad (one line in the router). |
| 14 | Timeline spacing. | **Equal spacing by order** (each event a column of the same width, the date written under the dot), not a proportional time scale; long gaps get a small "4 months" mark on the line. Opens scrolled so **Today** is visible, with Today as a vertical marker between the last past and the first future event. | A proportional scale piles a week's events into one dot and leaves months empty; equal columns keep every event readable and leave room for its rows of tasks and tickets. |
| 15 | Which events the timeline shows. | Default **all active projects** of the client (each dot carries its project's colour and name); a **project select** narrows it to one project, which shows that project's **whole life** (archived ones selectable). Paged: 15 events before Today and 15 after, more with "Earlier" and "Later" at the ends. | "All projects" answers "what is next for this client"; one project answers "the life of this project". Paging keeps a ten-year client fast. |
| 16 | Rows under an event. | Open **tasks** (up to 5) and open **tickets** (up to 5) as two separate lists, then the **done pile** (completed tasks and resolved tickets) collapsed to one line "7 done" that expands. "Show all (12)" opens the board or the Tickets tab filtered by that event. | Owner's layout; caps keep a busy event from stretching the card. |
| 17 | Phones. | The same horizontal line, scrollable, with larger dots; **tapping an event opens a sheet** with its description, files, task list, ticket list and done pile. | Owner's words. |
| 18 | Active tickets and tasks cards. | Two cards: **Tickets** (New and In progress of this client) and **Tasks** (not in Completed). Order: **assigned to me first** (I am a riešiteľ / an assignee), then the rest (tickets newest first; tasks urgent, then by deadline). 8 rows each, "Open all" to the tab with the matching filter. Clients see the same cards. | Owner's words; the same ordering as the admin home's cards. |
| 19 | Project and event filters. | Group **Tasks** tab and group **Tickets** tab: **Project** (Any, No project, a project) and, once a project is chosen, **Event** (Any, No event, an event). In the URL, remembered like every filter. Global board and global tickets list: the Project filter appears **only when exactly one client is chosen** (projects are per client). | Owner's words; a project list across 3 000 clients would be meaningless. |
| 20 | **B** "Every place where descriptions can be written". | A shared **description editor** (the Phase 28 editor in document mode: Enter makes a new line) with the **AI button, the microphone and "Attach knowledge"**, in every long text field listed in §10.1: task description, ticket text, project and event description, knowledge note body and the description of a file, link and reminder item, meeting notes. **Finance** fields get AI and voice but **no knowledge attachments** (finance stays sealed, ADR 0027). Short one-line fields (titles, names) do not. The chat's edit box keeps no AI tools (Phase 28 decision 6). | One component everywhere; finance cannot point at knowledge without opening its sealed boundary. |
| 21 | How knowledge is attached to a description. | As in chat: **a list of attached items under the text** ("Attached knowledge", the chat's cards), not tokens inside the text; at most **10** per description. Only items the description's readers may all see: a client group's public, shareable items (`isShareable`), checked on save and again on display ("Item unavailable"). A žiadateľ opens the items attached to their own ticket's text read-only, like a ticket chat's. | Reuses the chat's rules, cards and read-through route; inline tokens would need a new Markdown token in the parser, the renderer, search and digests. |
| 22 | AI tools outside a chat. | New group-scoped routes `GET /api/groups/:id/ai-tools`, `POST /api/groups/:id/ai-text` and `POST /api/groups/:id/transcribe`, with the chat routes' rules (`canReadGroup`, the same rate limits **shared** with the chat per user, the same prompts and providers). Finance fields call them only for finance admins (they are admins, so `canReadGroup` passes). | The chat routes are keyed by channel; a description has a group, not a channel. Shared limits keep the cost cap one number. |
| 23 | **B** Finance: costs per project and event. | The client's Financie tab gets **Project** and **Event** filters on the **Overview** (money and hours) and the **Work log**. A **contract** may name a project (optional; no event), so the money view filters too; a manual time entry may name a project and event. | Owner's words; contracts are signed per project often enough to be worth one optional field. |
| 24 | **B** Finance: the system-wide page. | **No event filter**; a **Project filter only when exactly one client is chosen** (the same rule as the boards, decision 19). Rankings are unchanged. | Owner left the project filter open; across clients a project list is meaningless, with one client it is free. |
| 25 | Finance data stays sealed. | Time entries store their own **`project_id` and `event_id`** (copied from the task or ticket by the finance hooks and kept in step by a new hook when a task's or ticket's project changes), so finance never reads `tasks` or `tickets`. The projects module never reads finance tables. | Same rule as `linked_ticket_id` in Phase 32 (decision 25 there). |
| 26 | Notifications. | **None new** in this phase. Changing a task's project or event is an edit like any other (no move notification). | Not asked for; event reminders can come later as a reminder subject kind `event`. |
| 27 | Project colour. | Picked automatically from the brand accents (purple, pink, blue, coral, green) by a hash of the project id, like avatars; shown only as the event dot's ring and a small chip. No colour picker. | Tells projects apart on the line without a settings field; accents stay small, as `design/tokens.md` asks. |

## 1. Goal and scope

A client's work gets a structure the team and the client can both follow: **projects** with dated **events**, every task and ticket optionally placed on one, a **timeline** of a project's whole life, and cards of what is open now. Tickets from eGrant find their project by themselves. Every description field gets the Phase 28 writing help.

Out of scope (later): event reminders and notifications, event times and ranges, admins-only events, clients creating events, Gantt-style dependencies, a cross-client project view, linking client tasks to admin-group projects (Phase 34 §11).

## 2. Concepts

- **Project** (sk "Projekt"): belongs to one client group. Name (required, ≤ 200), description (Markdown ≤ 10 000), files (0..n), attached knowledge, status **active** or **archived**, source **manual** or **egrant**, eGrant id (optional), aliases (name keys that also match).
- **Event** (sk "Udalosť"): belongs to one project. Name (required, ≤ 200), description, files, attached knowledge, **date** (required).
- A **task** or a **ticket** has at most one project and, inside it, at most one event. An event implies its project.
- **Today** is the Bratislava date. An event is **past** when its date is before today, **today**, or **coming**.

## 3. Data model

New module `modules/projects` (`schema.ts`), one migration in part P1 (number: the next free one at merge time; `0034_finance_foundation` is the latest on `main` today and Phase 32 parts may add more). Ids are text like elsewhere.

```
projects (
  id, group_id → groups on delete cascade,
  name text 1..200, name_key text,                  -- normalizeSearch(name)
  description text default '' (Markdown ≤ 10 000),
  status text in ('active','archived') default 'active',
  source text in ('manual','egrant'),
  egrant_project_id text null (≤ 100),
  created_by → user on delete set null, created_at, updated_at (precision 3), archived_at null
)
  unique (id, group_id)                                   -- target of the composite FKs below
  idx (group_id, status, name_key)                        -- pickers and the projects card
  idx (created_by)

project_name_keys (                                       -- what an intake matches: names, aliases, eGrant ids
  project_id → projects on delete cascade, group_id,
  kind text in ('name', 'egrant_id'), key text,           -- normalizeSearch(name), or the eGrant id as sent
  pk (group_id, kind, key)                                -- one project per key and client
)
  idx (project_id)

project_events (
  id, project_id, group_id,
  foreign key (project_id, group_id) → projects (id, group_id) on delete cascade,
  name text 1..200, description text default '', occurs_on date not null,
  created_by → user on delete set null, created_at, updated_at (precision 3)
)
  unique (id, project_id)                                 -- target of the task/ticket FK
  idx (group_id, occurs_on, id)                           -- the all-projects timeline, keyset both ways
  idx (project_id, occurs_on, id)                         -- one project's timeline
  idx (created_by)

project_attachments (                                     -- files of a project or of an event
  file_id → files on delete cascade,
  project_id → projects on delete cascade null,
  event_id → project_events on delete cascade null,
  CHECK num_nonnulls(project_id, event_id) = 1,
  pk (file_id)
)
  idx (project_id) where project_id is not null, idx (event_id) where event_id is not null
```

On the other modules' tables (each module owns its columns; the migration adds them):

```
tasks:   project_id text null, event_id text null,
         foreign key (project_id, group_id) → projects (id, group_id) on delete set null (project_id, event_id),
         foreign key (event_id, project_id) → project_events (id, project_id) on delete set null (event_id),
         CHECK event_id is null or project_id is not null
         idx (group_id, project_id, event_id)   -- board filters
         idx (event_id) where event_id is not null      -- the timeline rows, the FK

tickets: project_id, event_id as for tasks (same FKs and CHECK; group_id is nullable: CHECK project_id is null or group_id is not null),
         egrant_project_name text null (≤ 200), egrant_project_id text null (≤ 100)   -- raw intake values (decision 5)
         idx (group_id, project_id, event_id), idx (event_id) where event_id is not null
```

- The **composite foreign keys** make the database guarantee what the services check: a task's project is of the task's own client, and its event is of its project. A ticket moved to another client must clear (or re-match) its project in the same statement, or the FK refuses the move.
- `on delete set null (project_id, event_id)` is PostgreSQL 15+ column-list syntax (we run 17). Drizzle cannot express it, so the migration's SQL is written by hand after `db:generate` (as for other partial or composite constraints) and the schema files carry the plain columns with a comment.
- Files: project and event files are ordinary group files (the client's storage, `canReadFile` by the group rule), attached through the files module's `attachFiles` like knowledge does; a finance-only file is refused there already.
- Attached knowledge in descriptions: `knowledge_links` in the knowledge module, §10.3 (same migration, so later parts need none).
- Finance columns: part P6, its own migration after Phase 32 is merged (§11).

### 3.1 Module boundaries

- `modules/projects` owns `projects`, `project_name_keys`, `project_events`, `project_attachments`. It exports: `getProjectRef(db, groupId, projectId, eventId)` (validates a pair for a write, or throws `InvalidProjectError` → `400 invalid_project`), `projectRefs(db, ids)` (names and colours for DTOs, one query), `matchOrCreateEgrantProject(tx, groupId, { name, id })`, `listPickerProjects(db, groupId)`, and the timeline service.
- The tasks and tickets modules own their new columns and call `getProjectRef` inside their write transactions. Their DTOs gain `project: { id, name, color } | null` and `event: { id, name, occursOn } | null` from one batched `projectRefs` call per page (never one per row).
- The timeline needs tasks and tickets per event: the tasks module exports `tasksByEvents(db, groupId, eventIds, { openLimit })` and the tickets module `ticketsByEvents(…)` (each one query with `row_number() over (partition by event_id …)` and one grouped count). The projects module never reads `tasks` or `tickets`.
- Merge and delete move or clear links through the tasks and tickets modules' exported `reassignProject(tx, groupId, fromProjectId, toProjectId)` / `clearEvent(tx, eventId)` (the FKs do the clearing on delete; merge needs the explicit move).

## 4. Permissions (`modules/projects/policy.ts`, test-first)

| function | rule |
|---|---|
| `canReadProjects(actor, groupId, actorGroupIds)` | `canReadGroup`: admins and the group's clients. A žiadateľ never (404). |
| `canEditProjects(actor)` | `isAdmin` (decision 8): create, edit, archive, merge, delete projects and events, upload their files. |
| `canSetTaskProject(actor, task)` | `canUseBoard` (admins and the group's clients: they edit tasks). |
| `canSetTicketProject(actor)` | `canEditTicket` (admins only). |

- A project, event or file of a group the caller cannot read answers `404 not_found`, as everywhere; a client's write on a project answers `403 forbidden`.
- A žiadateľ: `TicketDto.project` is `{ id, name }` only (no colour, no link), `event` is always `null` for them (decision 7); built in the ticket routes' `forReader` like the task links.
- The intake (no session) creates projects through `matchOrCreateEgrantProject`, never through the routes.

## 5. eGrant intake (part P3)

### 5.1 The API change (integration guide)

Two new optional fields in `POST /api/tickets/intake`:

| field | meaning | rules |
|---|---|---|
| `project` | the name of the eGrant project the request is about | up to 200 characters, trimmed; empty = not given |
| `project_id` | eGrant's own id of that project | up to 100 characters; stable across renames |

Nothing else changes; unknown fields are still ignored, so older eGrant versions keep working. `docs/integrations/egrant-ticket-intake.md` gets the rows, an example and a "Projects" paragraph under "What happens in Help".

### 5.2 Matching (inside the intake transaction)

1. No client matched (no `instance_url` match): store `egrant_project_name` / `egrant_project_id` on the ticket; nothing else (decision 5).
2. With a client: `matchOrCreateEgrantProject(tx, groupId, { name, id })`:
   - `id` given and a key row `(group, 'egrant_id', id)` exists → its project (the name may differ: eGrant renamed it; the received name is added as an alias so later name-only tickets match too);
   - else the key row `(group, 'name', normalizeSearch(name))` → its project (and when `id` was given, an `egrant_id` key row is added, and `egrant_project_id` set if the project has none);
   - else insert a project (`source = 'egrant'`, name as received, `egrant_project_id`) and its key rows. The whole lookup runs under `lockGroupProjects` (a transaction advisory lock on the group, taken first), so two concurrent intakes for one client create one project; the key's primary key is the backstop.
3. The ticket gets `project_id` (no event; events are chosen by people). Raw values are stored in every case, for the record and for a later move.
4. Admin assigns or moves the client (`assignClient` / `PUT /api/tickets/:id/group`): in the same transaction the project and event are cleared and, if raw values exist, matched again in the new client (step 2). A manual project chosen in the old client is lost on a move (projects are per client); the edit form says so before saving.

Only `id` given, no name: match by id, else create with the name "eGrant project <id>" (admins rename). Neither given: no project.

### 5.3 Name keys and aliases

- `name_key = normalizeSearch(name)` (the existing helper of `knowledge/search.ts`, moved to `infra/text/search.ts` by Phase 32 part B; if B has not merged, P3 imports it from knowledge).
- Creating a project inserts its key; a rename inserts the new key and keeps the old one (alias); an admin can remove an alias in the project's edit dialog ("Also matches: …" chips). Two projects can never share a key in one client (`409 project_name_taken` on create or rename, with the other project's name).
- Merge: in one transaction under `lockGroupProjects` (an advisory lock per group): move events (`project_events.project_id`), tasks and tickets (through their modules), files, linked knowledge and **every key row** (`kind = 'name'` and `kind = 'egrant_id'`) to the survivor, then delete A. The survivor's own `egrant_project_id` stays what it shows; A's id keeps matching through its moved key row.

## 6. Tasks and tickets (part P2)

- **Task form** (create and edit, the panel's Details tab): under the deadline a **Project** select (the client's active projects by name, "No project") and, when a project is chosen, an **Event** select (its events by date, coming ones first, then past, "No event"). Changing the project clears the event. Saved with the form (`project_id`, `event_id` in the create and PATCH bodies; `400 invalid_project` for a pair that does not fit).
- **AI review cards** (Turn into tasks from a ticket): inherit the ticket's project and event (decision 12), shown as the same two selects on each card.
- **Task card** on the boards: a small chip with the project's colour dot and name (and "· event" when set), after the deadline, truncated; hidden on cards of the global board when space is short (the panel shows it).
- **Ticket page**: Project and Event in the details list; admins change them in "Edit" (the content form) with the same selects. A ticket without a client shows the raw eGrant project name as text ("eGrant project: Culture 2026 – Jana") until a client is assigned.
- **Ticket list rows**: the project chip next to the area.
- **Filters** (decision 19): the group Tasks tab gets a "Project" menu pill and, with a project chosen, an "Event" menu pill (`?project=<id>|none&event=<id>|none`); the group Tickets tab the same; both remembered (`useRememberedFilters`, per group). The global board and the global tickets list show the Project pill only while exactly one client is chosen; choosing a second client drops it. Server: the group board has **no filters today** (`GET /api/groups/:id/board` and `/board/done`, `BoardQuerySchema`), so P2 adds its first two: `project` and `event` on both board routes (the Completed column's paging keeps them). `GET /api/groups/:id/tickets` (`TicketListQuerySchema`) gains `project` and `event`; `GET /api/tasks/global` (`GlobalBoardFilterSchema`, `home/global-board.ts`) and `GET /api/tickets/global` accept `project` only with exactly one client in `clients` (`400 invalid_filter` otherwise). Each query uses the `(group_id, project_id, event_id)` index. On the web: `features/tasks/board.tsx` gets a filter row (it has none), `features/tickets/ticket-filters.tsx` and `search.ts` the two pills, `features/global-board/board-filters.tsx` the Project pill.
- **Socket**: `task:upserted` and `ticket:updated` already carry the DTO, which now has `project` and `event`; the board's filter drops a task that left the filtered project.

## 7. The Prehľad tab (parts P1 and P4)

Route `/groups/$groupId/overview`, the first tab pill (decision 13), a lazy chunk `projects-tab` with the locale namespace `projects`. Visible to admins and the group's clients.

### 7.1 Layout

From 1024 px, two rows inside the page width:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Timeline                         [All projects ▾]  [Earlier]      [Later]   │
│ ──●────────●──────────●───────┃Today┃──────○──────────○────────────○───────  │
│   12. 3.   2. 5.      30. 6.   ┃      ┃     4. 11.      20. 12.     15. 2.     │
│   Kickoff  Call open  Review   ┃      ┃     Evaluation  Contracts  Report     │
│   ◦ Kultúra ◦ Šport   ◦ Kultúra┃      ┃     ◦ Kultúra   ◦ Šport    ◦ Kultúra  │
│   Tasks    Tasks      Tasks    ┃      ┃     Tasks       Tasks      Tasks       │
│   · Budget · …        · …      ┃      ┃     · Scoring   · …        —           │
│   Tickets  Tickets             ┃      ┃     Tickets                            │
│   · #812 … · #840 …            ┃      ┃     · #901 …                           │
│   ▤ 7 done ▤ 3 done   ▤ 12 done┃      ┃                                        │
└──────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────┐ ┌──────────────────────────────────────┐
│ Tickets  9 active · 3 mine           │ │ Tasks  14 open · 5 mine · 2 urgent   │
│ rows …                    Open all   │ │ rows …                    Open all   │
└──────────────────────────────────────┘ └──────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│ Projects   [+ New project]   Active · Archived                              │
│ Kultúra 2026  · 6 events · next: Evaluation 4. 11. · 12 open tasks · 4 tickets│
│ Šport 2026    · …                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

641–1023 px: the same, the two active cards side by side. Phones (≤ 640 px): the timeline (line only), then Tickets, Tasks and Projects stacked; the cards keep 5 rows.

### 7.2 The timeline card

Design (egrant.sk tokens only; `design/tokens.md`):

- **The line** is one 2 px `line`-coloured rule across the card's scrolling strip. Every event is a column of fixed width (200 px on a computer, 160 px on phones) with its dot on the line. **Past** events: a filled `ink` dot. **Today's**: a filled dot with a ring. **Coming**: a hollow dot (2 px `ink` border, `surface` fill). Each dot has a 3 px ring in the **project's colour** (decision 27), and under it the date (13 px, `muted`), the event's name (weight 600, two lines max) and, in the all-projects view, the project's name with its colour dot.
- **Today** is a vertical 2 px `ink` rule with a small "Today" label (sk "Dnes"), placed between the last past and the first coming event (on an event of today, just before it). The strip opens scrolled so Today sits at about a third from the left. A "Today" button in the header scrolls back to it after browsing.
- **Gaps:** when two neighbouring events are more than 60 days apart, the line between them shows a small break with the gap ("4 months", `Intl.RelativeTimeFormat`-free: our own short formatter in `projects` texts).
- **Under each event** (computer and tablet): "Tasks" with up to 5 open tasks (done circle state, title, assignee avatars, deadline in red when overdue), then "Tickets" with up to 5 active tickets (`#number`, subject, status pill), each list hidden when empty; "Show all (n)" when there are more, opening the Tasks or Tickets tab filtered by the event. At the bottom the **done pile**: one muted line "▤ 7 done" (a stack icon); a click expands it in place to the done tasks (struck through) and resolved tickets, 10 at a time. The column heights differ; the strip aligns them to the top.
- **Clicking** the event's name opens the **event sheet** (side sheet on a computer, full-screen on phones): name, date, project, description (rendered Markdown), files, attached knowledge, and the same three lists without caps (paged). Admins get "Edit" and "Delete" there. A task row opens the task panel (`?task=<id>` on the overview route, like the admin home); a ticket row opens the ticket page.
- **Phones:** the strip shows only the line, the dots, the dates and the names (no rows). Tapping an event opens the event sheet (decision 17). The strip scrolls sideways with momentum; the dots have a 44 px tap area.
- **Header:** the project select (All projects [default]; each active project; "Archived" group below), "Earlier" and "Later" at the strip's ends (they load the next 15 events in that direction and keep the scroll position), "Today", and for admins "+ Event" (asks the project when "All projects" is shown).
- **Empty states:** no projects: "No projects yet. Projects group this client's tasks and tickets along a timeline." with "+ New project" for admins (clients see the sentence only). A project without events: "No events yet." with "+ Event" for admins.
- **Accessibility:** the strip is a list (`<ol>`) of events in date order, each an `<li>` with a heading (name), the date as `<time>`, and its lists; Today is an `<li role="presentation">` with a visually hidden "Today, <date>"; arrow keys move focus between events; the strip's scroll follows focus. Rows are links. No hover-only information.
- **Implementation:** HTML and CSS only (flex columns with a border line); no SVG chart and no library. The only motion is the sheet's opening (existing `SheetDialog`).

### 7.3 Timeline API

`GET /api/groups/:id/timeline?project=<id>&around=today|<date>&before=<cursor>&after=<cursor>&limit=15` → `{ events: TimelineEventDto[], before: cursor | null, after: cursor | null, today: 'YYYY-MM-DD' }`, where each event carries `{ id, name, occursOn, project: { id, name, color }, files: n, openTasks: TaskRow[≤5], openTaskCount, openTickets: TicketRow[≤5], openTicketCount, doneCount }`.

- First call (`around=today`): the 15 events before today and the 15 from today on, by `(occurs_on, id)` keyset on the `(group_id, occurs_on, id)` index (one project: the `(project_id, occurs_on, id)` index). Archived projects are left out unless `project` names one.
- Per page: one events query, one `tasksByEvents` (rows and counts), one `ticketsByEvents`, one `projectRefs`, one names batch for avatars: **six queries for any page**.
- `GET /api/project-events/:id/items?kind=tasks|tickets|done&after=` pages the sheet's and the done pile's lists (20 a page).
- A žiadateľ gets `404` (no group read).

### 7.4 The active cards

`GET /api/groups/:id/overview/active` → `{ tickets: { rows ≤ 8, total, mine }, tasks: { rows ≤ 8, total, mine, urgent } }`, one request for both cards, built from the tickets and tasks modules' exported functions (`activeTicketsOf(groupId, userId, limit)`, `openTasksOf(groupId, userId, limit)`): "mine" first (`exists` on `ticket_assignees` / `task_assignees` for the caller), then the module's usual order. Each row shows its project chip. "Open all" goes to the Tickets tab (status Open, assignee Anyone) or the Tasks tab. The cards refetch on the group's `ticket:*` and `task:*` events (2 s debounce).

### 7.5 The projects card and dialogs

- Rows: colour dot, name, "From eGrant" badge for `source = 'egrant'`, the number of events, the next coming event, open tasks and tickets counts (one grouped query each through the tasks and tickets modules). Active by default; an "Archived" pill shows the archived ones. A row opens the **project sheet** (description, files, knowledge, its events in date order with "+ Event", "Show on the timeline" which selects it in the timeline). Admins: "Edit", "Archive"/"Restore", "Merge into…", "Delete".
- **Project dialog:** name, description (§10), files, and for an existing project "Also matches" (aliases, removable) and the eGrant id (read-only).
- **Event dialog:** project (fixed when opened from a project), name, date (date picker, past dates allowed), description (§10), files.
- **Merge dialog:** "Merge Kultúra 2026 (dup) into …" with a project picker and the counts that move; confirm button "Merge".
- 30 projects a page, "Show more".

### 7.6 Projects API

| route | purpose |
|---|---|
| `GET /api/groups/:id/projects?status=active\|archived&after=` | the card's page (30, by `name_key, id`) with counts |
| `GET /api/groups/:id/projects/picker` | id, name, colour, status of every project of the client (for selects; small) |
| `GET /api/projects/:id/events/picker` | id, name, date of a project's events (for selects) |
| `POST /api/groups/:id/projects` · `GET`/`PATCH`/`DELETE /api/projects/:id` | projects (`updatedAt` check: `409 project_changed`) |
| `POST /api/projects/:id/archive` · `…/restore` · `POST /api/projects/:id/merge { into }` | lifecycle |
| `DELETE /api/projects/:id/aliases/:key` | remove an alias |
| `POST /api/projects/:id/events` · `GET`/`PATCH`/`DELETE /api/project-events/:id` | events |
| `GET /api/groups/:id/timeline` · `GET /api/project-events/:id/items` · `GET /api/groups/:id/overview/active` | §7.3, §7.4 |

Files upload through the existing `POST /api/groups/:id/files` and are attached by id in the bodies (`fileIds`), as knowledge does.

## 8. Realtime

| event | payload | room | when |
|---|---|---|---|
| `project:changed` | `{ groupId, projectId, kind: 'project' \| 'event' }` | `group:<id>` | after any project or event write, archive, merge or delete commits |

The open overview refetches the affected queries (2 s debounce); the pickers' cached lists are invalidated. Task and ticket events are unchanged (their DTOs carry the new fields). Catch-up on reconnect: the overview refetches with `firstJoinCheck`, like the other tabs.

## 9. i18n

A new lazy namespace `projects` (`apps/web/src/locales/projects/<code>.json`) in all nine languages (sk, en, cs, sl, bg, et, it, hr, uk) for the tab, the cards, the timeline, the dialogs and the filters' texts; `group.tabs.overview` in the eager files (sk "Prehľad", en "Overview"); the task form's and ticket page's field labels in `tasks` and `tickets`; the description editor's buttons in the `chat` texts it already uses (§10). Dates through `Intl.DateTimeFormat` with the UI language. Slovak is the source; the other translations follow the Phase 26 rule (machine-drafted, waiting for a native speaker).

## 10. AI and knowledge in description fields (part P5)

### 10.1 Every description field (as of `main` 2026-10-17)

| field | where (web) | today | gets |
|---|---|---|---|
| Task description | task form and panel (`features/tasks/task-form.tsx`, `description`) | `FormattedTextField` (`components/formatted-text-field.tsx`: textarea, chat toolbar, rendered preview) | editor, AI, voice, knowledge |
| Task card description in the AI review | `features/task-split/` review cards | textarea | editor, AI, voice (no knowledge: added after creating) |
| Ticket text | new-ticket dialog and ticket "Edit" (`features/tickets/content-fields.tsx`, `body`) | plain textarea, shown as `whitespace-pre-wrap` (`ticket-fields.tsx`) | editor, AI, voice, knowledge; the text is then shown with the chat renderer (§10.2) |
| Project and event description | Phase 33 dialogs | — | editor, AI, voice, knowledge |
| Knowledge note and reminder body; file and link description; meeting notes | `features/knowledge/knowledge-form.tsx` (`body`) | `FormattedTextField` | editor, AI, voice, knowledge (an item linking other items) |
| Meeting AI summary, decisions, open questions | `features/knowledge/meeting-view.tsx` | plain textareas | editor, AI, voice (no knowledge: the summary is one structured block) |
| Meeting transcript | `features/knowledge/meeting-fields.tsx` | plain textarea | **nothing** (pasted or generated text, often an hour long; AI tools are capped at a message's length) |
| Finance document, note and contract description | `features/finance/documents/` (Phase 32 B, not built yet; the schema has `finance_items.body`) | — | editor, AI, voice (**no knowledge**, decision 20) |
| Finance manual entry note | Phase 32 C | one line (≤ 500) | nothing (short field) |
| "Solve with Claude" notes | `features/open-in-claude/solve-with-claude.tsx` | plain textarea | nothing (a note for a prompt, not a description; can be added on request) |
| Bulk email text blocks | `features/bulk-email/rich-text-editor.tsx` | its own rich text (document tree, ADR 0024) | **nothing** (emails take their own format; Phase 28 left the builder out) |
| Group fields, titles, names, subjects | — | one line | nothing (groups have no description field) |

The plan's part P5 re-checks this list against `main` when it starts (a field added meanwhile joins it).

### 10.2 The description editor

- `features/editor/description-field.tsx`, replacing `FormattedTextField` and the plain textareas of §10.1: the Phase 28 ProseMirror editor (`features/chat/editor/chat-editor`, its lazy chunk) in **document mode**: Enter always makes a new line (smart lists as in chat), no Send, no mention picker unless the field supports mentions (task descriptions do today: kept), up to 10 000 characters, grows to 16 lines then scrolls, the same eight-button toolbar. Value in and out is Markdown, so storage, rendering, search text and digests do not change.
- The bottom row holds the Phase 28 **AI button** and **microphone** (`features/chat/ai-tools/ai-text-button.tsx`, `voice-input/voice-button.tsx`; today the composer renders them inline when it has a `channelId`, with `draftTools { getText, setText }`, and its `extraActions` slot is unused). P5 replaces their `channelId` prop with a `target`: `{ kind: 'channel', id }` or `{ kind: 'group', id }`, which picks the routes of decision 22; the composer passes the channel target, unchanged in behaviour and **"Attach knowledge"** (the Phase 28 knowledge picker, unchanged, opened with the field's group). Undo of an AI change is one editor undo step, as in chat.
- **Lazy:** the field first renders the saved Markdown with the chat renderer (no editor code) plus an "Edit" affordance; the editor chunk loads on focus or click (it is usually cached already from the chat). Forms that open in edit mode (new task, new ticket) request the chunk as they open and show a same-height placeholder until it arrives, like the composer. The task board, the ticket page and the knowledge tab therefore gain no eager code beyond the small field shell (< 1 kB each, measured in P5).
- **Ticket text rendering:** ticket bodies are plain text today (intake and the form). Once the field is an editor they are shown with the chat renderer (`format/render.tsx`), which keeps line breaks; an intake body with stray Markdown characters (`*`, `#` at a line start) may now render as formatting, the same accepted trade-off as Phase 28's headings (editor decision 1).
- `GET /api/groups/:id/ai-tools` decides which buttons show (cached per group per session), so with the AI off nothing appears.

### 10.3 Attached knowledge in descriptions

```
knowledge_links (                       -- knowledge module (migration of part P1)
  item_id text not null,                -- no FK: a deleted item shows as unavailable, as in chat
  task_id → tasks on delete cascade null,
  ticket_id → tickets on delete cascade null,
  project_id → projects on delete cascade null,
  event_id → project_events on delete cascade null,
  knowledge_item_id → knowledge_items on delete cascade null,   -- an item that links other items
  position int,
  CHECK num_nonnulls(task_id, ticket_id, project_id, event_id, knowledge_item_id) = 1
)
  unique (item_id, coalesce(task_id, ticket_id, project_id, event_id, knowledge_item_id))
  idx (task_id) / (ticket_id) / (project_id) / (event_id) / (knowledge_item_id), each partial where not null
  idx (item_id)                          -- the file read rule
```

- The knowledge module owns the table and exports `setLinkedItems(tx, subject, groupId, itemIds)` (validates with `isShareable` in that group: `400 invalid_knowledge_item`; at most 10) and `linkedItemCards(db, subject kind, ids)` (one query for the rows, the cards re-checked with `shareableItemCards`, unavailable ones as ids only). The owners (tasks, tickets, projects, knowledge itself) call them inside their writes and DTO builds, with `knowledgeIds` in their bodies; they never read the table.
- Display reuses `features/chat/knowledge-cards.tsx` under the rendered description.
- A žiadateľ opens items linked to **their own ticket's text** through `GET /api/tickets/:id/knowledge/:itemId` (the ticket readable to them, the item linked to it and still shareable; read-only detail without reminders), and its files through a new file read rule `fileOfTicketLinkedKnowledge` registered by the tickets module, never an admins-only or finance-only file.
- A ticket moved to another client: its links stay rows but show as unavailable (the items belong to the old client), exactly like a moved ticket chat's attachments.

## 11. Finance: costs by project and event (part P6, after Phase 32 C and D)

- Migration (finance module): `finance_time_entries.project_id text null`, `event_id text null` (no FK to projects: finance keeps its own copy, decision 25; a deleted project leaves the ids, which the filters simply no longer offer), `finance_items.project_id text null` (contracts only, decision 23). Indexes `(group_id, project_id, worked_on) where minutes is not null and worked_on is not null` and `(group_id, event_id, worked_on)` with the same condition; `(group_id, project_id, starts_on) where type = 'contract'`.
- Hooks (finance, importing nothing from tasks or tickets): `onTaskCompleted` and `onTicketResolved` events gain `projectId` and `eventId` and store them; a new `onSubjectProjectChanged(tx, { kind: 'task' | 'ticket', id, projectId, eventId })` updates the subject's entries (all of them, filled or requested), called by the tasks and tickets modules when a project or event changes (also by merge, which moves them, and by the FK clearing on delete, which the projects service turns into a call before deleting). Manual entries get optional project and event selects (the client's projects through `listPickerProjects`).
- Filters: the client's **Overview** (money and hours) and **Work log** take `project` and `event` (`event` only with `project`): `GET /api/groups/:id/finance/overview?project=&event=` and `…/work-log?project=&event=`. Money totals filter contracts by `project_id` (an event filter leaves the money view showing "Contracts are not tied to events" and only the cost line); hours and cost filter entries. A ticket unit (ticket and its linked tasks) is filtered by each entry's own project, so a linked task in another project drops out of the unit for that filter.
- `/finance`: the Project filter appears only while exactly one client is chosen (decision 24); no event filter; rankings unchanged.
- The Phase 32 seal holds: the projects module and the timeline never read finance; finance gets project names through `projectRefs` (exported, read-only).

## 12. Performance

- Lazy chunks: `projects-tab` (the overview with the timeline, cards and dialogs) and `projects` locale namespace. The task form and ticket page gain two small selects that load their options on open (`picker` endpoints). The eager shell gains only the tab pill text and route (< 0.3 kB). The description editor is lazy (§10.2).
- Every list is paged: projects 30, timeline 15 + 15 events, rows capped at 5 + 5 + done count, sheet lists 20.
- Indexes as in §3; an EXPLAIN test (`modules/projects/explain.test.ts`) on a seeded volume (3 100 groups, 40 000 projects, 400 000 events, the tasks and tickets volumes of `home/test-volume.ts` with 30 % on an event): the timeline page < 50 ms, the active cards < 30 ms, the filtered board and ticket list as fast as unfiltered (no sequential scan).
- No N+1: the six-query timeline page; DTO project refs batched per page.

## 13. Docs to update (by the part that changes them)

New `product/projects.md` (requirements as built, sections per part); `product/README.md`; `product/groups.md` (the tab); `product/task-board.md`, `product/tickets.md` (fields, filters); `integrations/egrant-ticket-intake.md` and `product/integrations.md` (the fields); `product/knowledge-base.md` and `product/chat.md` (the description editor, linked knowledge); `product/finance.md` (filters); `architecture/data-model.md`, `permissions.md`, `realtime.md`, `overview.md` (module, API), `performance.md` (chunks, EXPLAIN); `glossary.md` (project, event, timeline, alias); `roadmap.md`. ADR: one, `00NN-projects-composite-keys-and-egrant-matching.md` (composite FKs with column-list `set null`, exact-key matching with aliases, auto-create), in part P1. No new dependency.

## 14. End-to-end scenarios (`e2e/projects.spec.ts`, `e2e/projects-intake.spec.ts`, `e2e/description-editor.spec.ts`)

1. **Projects and events.** An admin opens a client's Prehľad, creates the project "Kultúra 2026" with a description and a PDF, adds three events (one past, one today, two coming); the timeline shows them in order with Today between; the client sees the same and cannot edit.
2. **Tasks and tickets on events.** The admin sets a task's project and event in the panel; the event's column lists it under Tasks; completing it moves it into the done pile ("1 done"); the Tasks tab filtered by the event shows only it.
3. **Intake.** The intake sends a ticket with `project: "Kultúra 2026"` → it lands in that project; another with `project: "Nový projekt"` creates "Nový projekt" (From eGrant); a third with `project: " kultura  2026 "` matches the first; a ticket without a client keeps the raw name and matches once the admin assigns the client.
4. **Merge.** The admin merges "Nový projekt" into "Kultúra 2026"; its ticket moves; a new intake with "Nový projekt" lands in "Kultúra 2026".
5. **Active cards.** The admin assigned to one ticket and one task sees them first on the cards; a client sees their own first.
6. **Phone.** At 390 px the timeline shows dots only; tapping an event opens the sheet with its tasks, tickets and done pile.
7. **Description editor.** In a task description the admin dictates with the fake transcription, runs "Make it formal" (fake provider), attaches a public note, saves; a client sees the note card; making the note admins-only shows "Item unavailable".
8. **Finance filter** (P6). A finance admin filters the client's work log by the project: only that project's entries and totals remain.

## 15. The small feature: "From chat" → plain file

Owner request of 2026-10-17: a knowledge item of type "From chat" can be turned into an ordinary **File** item (kept when the message is deleted, editable, movable into folders). Built now on `feat/knowledge-chat-file-to-file` by another agent with its own short design; this spec only records the dependency: none. Phase 33 does not touch `chat_file` items (they cannot carry linked knowledge or the description editor while they stay chat files; once converted they are File items and get §10 like any other).

## 16. Testing (test-first)

Server: the policy table of §4 for admin, client, žiadateľ and outsider; the composite FKs (a task cannot point at another client's project; an event of another project is refused; moving a ticket clears or re-matches); matching (id, key, alias, archived, create, concurrency of two intakes, id-only, none); merge (events, tasks, tickets, keys, ids move; future matches); the filters and their `400`s; the timeline page (order around today, paging both ways, caps and counts, archived projects, six queries); the active cards' order; the description routes (AI tools per role, shared rate limits) and `knowledge_links` (shareable only, re-check on display, žiadateľ read-through, files rule, moved ticket); the finance hooks and filters (P6); EXPLAIN. Web: the selects (clearing the event), the filters (remembered, the one-client rule), the timeline (Today placement, gaps, done pile, keyboard, phones' sheet), the cards, the dialogs, the description field (lazy load, AI, voice, attach, undo).

## 17. Risks

- **eGrant must send the project.** Until it does, only manual assignment works; decision 1 names the fallback switch.
- **Automatic creation makes duplicates** from typos; merge (decision 4) and aliases fix them, and the "From eGrant" badge shows where they came from.
- **The timeline on a client with hundreds of events** stays fast through paging; the all-projects view of a very active client may feel crowded, which the project select answers.
- **The description editor everywhere** touches many forms; P5 keeps each form's own save logic and swaps only the field.
