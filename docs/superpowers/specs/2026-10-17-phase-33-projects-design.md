# Phase 33 — Projects per client and closer eGrant integration: design

Date: 2026-10-17 · Status: **approved** by the owner on 2026-10-17: every row of the "Owner decisions" table is accepted as written, decisions 6 and 8 as amended by the owner the same day (nothing is built yet). Plan: [2026-10-17-phase-33-projects.md](../plans/2026-10-17-phase-33-projects.md). Roadmap: [Phase 33](../../roadmap.md#phase-33--projects-per-client-and-closer-egrant-integration). The internal admin group and the three-tab attachment picker are [Phase 34](2026-10-17-phase-34-admin-group-design.md).

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

Approved by the owner on 2026-10-17. Decisions 6 and 8 were amended by the owner. Decision 8a is the one sub-question the amendment left open; its recommendation is below. **B** marks a business choice; the others are technical defaults.

| # | Question | Recommendation | Why |
|---|---|---|---|
| 1 | **B** What does eGrant send about projects? (final shape set by the owner 2026-10-17) | **Projects come through their own endpoint, `PUT /api/egrant/projects/:project_id`** (decision 6c), with the instance URL, the name, the description and the full events array (each a name, a date as `dd.mm.yyyy` and a description; no event ids, decision 6b). **The ticket intake carries only `project_id` and `project` (the name)** to link the ticket, plus `external_id` and `sent_at` for updates. `programme` stays a separate field and is not the project; `TICKETS_PROJECT_FIELD=programme` remains the fallback switch only if eGrant cannot send projects. Full shape in §5. | The owner's API shape; the project id survives renames on either side. |
| 2 | **B** The first delivery of a project. | **Created automatically** in the client from the delivered data: the project with its name and description, and every valid event, all marked **"From eGrant"**. A ticket that names a project Help does not know yet creates it from its name; the project endpoint's first delivery then completes it. Admins rename, archive or **merge** duplicates later (decision 4). | Owner's words ("the project and its events are created from this data"). |
| 3 | Matching rules. | Per client only, in this order: (1) `project_id` equals a project's stored eGrant id; (2) the **name key** (trimmed, inner spaces collapsed, lower-case, without diacritics: the existing `normalizeSearch`) equals the name key or an **alias** of a project that has no eGrant id yet (one a person created): it is linked, and its differences become pending changes (§5.2); (3) otherwise create (decision 2). Archived projects match too (the ticket goes to the archived project, which shows a "New ticket in an archived project" hint to admins; it is not unarchived). A rename keeps the old name key as an alias; a merge moves the merged project's keys and ids to the survivor. A per-client lock and a primary key on the keys make concurrent intakes create one project, not two. | Exact keys are predictable; fuzzy matching (edit distance) would merge "Projekt A" and "Projekt B". Aliases make renames and merges safe for future tickets. |
| 4 | **B** Merging projects. | **Admins merge project A into B** (A's events, tasks, tickets, files, aliases and eGrant ids move to B; A is deleted), from A's menu, with a confirmation that names the counts. | Automatic creation (decision 2) will create a few duplicates from typos in eGrant; merge is the cleanup. |
| 5 | A ticket without a client arrives with a project. | **Keep the reference on the ticket** (`tickets.egrant_project_ref`) and link it when a client is assigned; moving a ticket to another client links it there (its old project and event are cleared, since projects belong to one client). | Projects are per client; there is nothing to match against before the client is known. |
| 6 | **B** eGrant later sends values that differ from what Help has (amended by the owner 2026-10-17). | **Never overwrite silently.** (a) **The project:** every differing field of a later delivery becomes a **pending change from eGrant on the project**: project name, project description, and per event its name, date and description; new events are proposed as **additions**, eGrant events missing from a delivery as **removals** (never deleted automatically). The person accepts or dismisses **each field** (and each event's fields) separately in the project sheet. (b) **The ticket's own project:** applied at once while nobody changed it by hand; after a manual change, a different incoming project becomes a pending change on the ticket with **Apply** and **Dismiss**. In both, a **dismissed value stays dismissed** until eGrant sends a different one. Shown as a badge on the project in Prehľad ("eGrant changes (3)"), on the project's tickets (page and list rows, with a filter "eGrant changes") and on the admin home's Tickets rows. Approval: admins and the group's clients (decision 8); accepting a removal deletes an event, so admins only (8a). eGrant cannot update a ticket today, so P3 adds `external_id`: a repeat `POST /api/tickets/intake` with the same `external_id` from the same instance is an **update** (`200`), a new one a **create** (`201`). Storage, rules and screens: §5.4, §5.5. No notification (decision 26 stands). | A person's choice must not vanish, and a newer eGrant fact must not be lost either; the person decides, field by field. |
| 6a | **B** Which fields may an eGrant update of a ticket change? | **Only the ticket's project (`project_id`, `project`).** Every other field in an update (subject, body, area, programme, requester, phone, due date, url, files, a status) is **ignored** and named in the answer's `ignored` list; a status from eGrant is never accepted (Help's status is the team's own workflow). *Owner to confirm*; subject and due date are the likely next candidates, each with its own pending rule. | Project data travels by the project endpoint; the conversation and status live in Help. |
| 6b | Events without ids (owner 2026-10-17: eGrant cannot send event ids). | **Match by name key + date, then pair the rest by name alone, then by date alone:** exactly one existing eGrant event fitting → proposed as a **redate** or **rename**; otherwise **addition + removal**. Each eGrant event keeps the identity eGrant last gave it (`egrant_name_key`, `egrant_date`), so a person's rename in Help does not break the pairing. Limits: a rename and a redate in one step, and two events with the same name or date, show as addition + removal; the review shows such pairs side by side ("Maybe the same event"). §5.4. | The owner's rule; ambiguity always falls back to a proposal, never to a silent change. |
| 6c | The project endpoint (owner 2026-10-17: use it). | **`PUT /api/egrant/projects/:project_id`**, a webhook eGrant calls whenever it decides; same Bearer key; 120 a minute per IP; idempotent (the body is the full state; `sent_at` orders versions); `201` created, `200` otherwise; an **unknown instance answers `202` and the delivery is stored** (latest per project, 180 days) and processed when a client with that eGrant URL is created or edited. | Stored rather than ignored: eGrant may set up projects before the team creates the client in Help, and a re-send would otherwise be needed. |
| 6d | Review of eGrant changes. | **One review section in the project sheet**, one row per field (current → incoming), each **Accept** or **Dismiss**, rows left alone stay pending, "Save choices" applies them in one transaction. | Owner's words (per field, per event; some accepted, others dismissed). |
| 7 | **B** Who sees projects and events? | **Admins and the client's people** (everyone who reads the group, `canReadGroup`). A **žiadateľ** sees on their own ticket only the **project's name** (read-only), never the event, the dashboard or other projects. | The client's tasks and tickets are already visible to its clients; the timeline is their story too. A requester came from eGrant with that project, so its name is not new to them; event names can be internal. |
| 8 | **B** Who creates and edits projects and events? (amended by the owner 2026-10-17) | **Admins and the group's clients** (everyone who reads the group) create and edit projects and events: name, description, files, date, attached knowledge. They also set the project and event on **tasks and tickets**. A ticket's project and event get their own route, so clients still do not edit the ticket's other fields. A **žiadateľ** stays read-only (decision 7). Archive, restore, merge, delete and alias removal: decision 8a. | Owner's decision: the client plans together with the eGrant team. |
| 8a | **B** May clients also archive, merge or delete? | **Recommended: clients archive and restore**, which can be undone. **Merge, delete and removing an alias stay with admins**: they change eGrant matching for the client's future tickets and cannot be undone. Each is one policy function, so the owner can move any of them with one line. *Owner to confirm.* | Actions that can be undone are safe to share; the others also steer the intake. |
| 9 | **B** Admins-only events or projects? | **No visibility switch in this phase**: everything in a client's projects is visible to the client's people. | Every visibility rule doubles the queries and tests (see Knowledge). Internal planning belongs in the admin group (Phase 34). Can be added later as a column on events. |
| 10 | Event date. | **One date, required** (`occurs_on date`), no time and no end date. Events of the same day are ordered by creation. | Owner's words; a time or a range can be added later without changing the timeline API. |
| 11 | **B** Deleting a project or event that has tasks or tickets. | Allowed for admins (decision 8a) with a confirmation naming the counts; their tasks and tickets **keep existing** and lose the project (or only the event). **Archive** is the normal way to end a project: archived projects leave the pickers and the timeline's default view, stay filterable, and still match eGrant (decision 3). | Deleting work items because their label went would be destructive; archive keeps the history browsable. |
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
  created_by → user on delete set null, created_at, updated_at (precision 3), archived_at null,
  egrant_delivered_at timestamptz null, egrant_sent_at timestamptz null,   -- the project endpoint's last processed delivery
  edited_by_person_at timestamptz null                    -- last edit by a person (§5.2's "applies directly" test)
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
  name text 1..200, name_key text, description text default '', occurs_on date not null,
  source text in ('manual','egrant') default 'manual',    -- "From eGrant"
  egrant_name_key text null, egrant_date date null,       -- the identity eGrant last gave the event (decision 6b)
  created_by → user on delete set null, created_at, updated_at (precision 3)
)
  unique (id, project_id)                                 -- target of the task/ticket FK
  idx (project_id, egrant_name_key, egrant_date) where source = 'egrant'   -- eGrant event pairing
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
         egrant_project_ref jsonb null           -- { id, name } as delivered, kept for a ticket without a client (decision 5)
         egrant_sent_at timestamptz null          -- eGrant's time of the latest value applied or held (out-of-order guard)
         external_id text null (≤ 100), external_key text null unique   -- eGrant's ticket id; host|external_id (§5.5)
         project_origin text null in ('egrant','manual')   -- who set the current project and event (decision 6)
         -- pending and dismissed eGrant changes live in egrant_changes (§5.4), not on the ticket
         idx (group_id, project_id, event_id), idx (event_id) where event_id is not null
```

- The **composite foreign keys** make the database guarantee what the services check: a task's project is of the task's own client, and its event is of its project. A ticket moved to another client must clear (or re-match) its project in the same statement, or the FK refuses the move.
- `on delete set null (project_id, event_id)` is PostgreSQL 15+ column-list syntax (we run 17). Drizzle cannot express it, so the migration's SQL is written by hand after `db:generate` (as for other partial or composite constraints) and the schema files carry the plain columns with a comment.
- Files: project and event files are ordinary group files (the client's storage, `canReadFile` by the group rule), attached through the files module's `attachFiles` like knowledge does; a finance-only file is refused there already.
- Attached knowledge in descriptions: `knowledge_links` in the knowledge module, §10.3 (same migration, so later parts need none).
- `ticket_intake_updates` (tickets module): the `request_id` of every eGrant update, for retries (§5.5).
- `egrant_changes` and `egrant_project_inbox` (projects module): pending and dismissed changes from eGrant (§5.4), deliveries for instances without a client yet (§5.1).
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
| `canEditProjects(actor, groupId, actorGroupIds)` | `canReadGroup` (decision 8): admins and the group's clients create and edit projects and events, upload their files, attach knowledge. |
| `canArchiveProject(actor, groupId, actorGroupIds)` | `canReadGroup` (decision 8a): archive and restore. |
| `canMergeOrDeleteProject(actor)` | `isAdmin` (decision 8a): merge, delete a project or an event, remove an alias. |
| `canSetTaskProject(actor, groupId, actorGroupIds)` | `canUseBoard` (admins and the group's clients). |
| `canSetTicketProject(actor, ticket, role)` | an admin, or a `client` of the ticket's group (decision 8); never a žiadateľ, never on a ticket without a client. Also guards Apply and Dismiss of a pending eGrant change. |

- A project, event or file of a group the caller cannot read answers `404 not_found`, as everywhere; a client's merge, delete or alias removal answers `403 forbidden`.
- A žiadateľ: `TicketDto.project` is `{ id, name }` only (no colour, no link), `event` is always `null` for them (decision 7); built in the ticket routes' `forReader` like the task links.
- `PUT /api/egrant/projects/:project_id` and the intake (no session, the Bearer key) create projects and record changes through `receiveProjectDelivery` and `linkTicketProject`, never through the user routes.
- Reviewing eGrant changes: `canEditProjects` (admins and the group's clients); accepting an event removal also needs `canMergeOrDeleteProject` (admins); a ticket's assignment change `canSetTicketProject`.

## 5. eGrant projects and the ticket intake (part P3)

Final API shape, set by the owner on 2026-10-17. The integration guide ([egrant-ticket-intake.md](../../integrations/egrant-ticket-intake.md)) carries it for the eGrant developers, marked "planned" until P3 is deployed. eGrant has **no event ids**: events are matched by name and date (§5.4).

### 5.1 The project endpoint (a webhook eGrant calls)

`PUT /api/egrant/projects/:project_id` — eGrant decides when to send it: when a project is created or changes, or simply the whole project again whenever convenient. Same Bearer key as the intake (`TICKETS_API_KEY`, constant-time compare, `401` / `503 intake_disabled` as there), its own rate limit of **120 requests a minute per IP** (`429 rate_limited`), body ≤ 1 MiB, no CSRF (server to server). `:project_id` is eGrant's stable project id (1–100 characters, URL-encoded).

| field | meaning | rules |
|---|---|---|
| `instance_url` | the eGrant instance (finds the client, by host, like the intake) | required, a URL ≤ 2048 |
| `sent_at` | when eGrant produced this version | required, ISO 8601 with a zone |
| `name` | project name | required, 1–200 |
| `description` | project description | plain text ≤ 10 000, stored as the description's Markdown as typed; empty = none |
| `events` | the project's events, **the full list** each time | array of up to 200; required (an empty array means "no events") |
| `events[].name` | event name | 1–200 |
| `events[].date` | event date | **`dd.mm.yyyy`**, parsed strictly (§5.3) |
| `events[].description` | event description | plain text ≤ 10 000 |

Answers:

| status | body | when |
|---|---|---|
| `201` | `{ "project_id", "state": "created", "skipped": [] }` | the client had no such project: it was created with its events |
| `200` | `{ "project_id", "state": "unchanged" \| "applied" \| "pending", "pending": <n>, "skipped": [] }` | the project existed; `applied` only for a project that had never had a delivery and nobody had edited (§5.2) |
| `202` | `{ "project_id", "state": "stored" }` | no client has this instance yet: the delivery is **stored for later** (decision 6c) |
| `200` | `{ "project_id", "state": "stale" }` | `sent_at` is older than the last delivery Help processed for this project; nothing changed |
| `400` | `{ "error": "validation_failed", "fields": [...] }` | a malformed field (an invalid event **date** is not a 400: §5.3) |
| `401`, `413`, `429`, `503` | as the intake | |

**Idempotent:** the same body again answers `200 unchanged` (or `202 stored` again) and changes nothing; there is no `request_id` here, because the body is a full state, not an event, and `sent_at` keeps an out-of-order retry from undoing a newer version.

**Unknown instance (`202`):** the delivery is kept in `egrant_project_inbox (instance_host, project_id, payload jsonb, sent_at, received_at, pk (instance_host, project_id))` (the latest per project replaces an older one). When an admin creates a client or changes its eGrant URL, the inbox rows of that host are processed as first deliveries in the same transaction and deleted. Rows older than 180 days are removed by the daily cleanup job. Stored rather than ignored, because eGrant may set up a project before the eGrant team creates the client in Help.

### 5.2 First delivery: the project is created

In one transaction under `lockGroupProjects`, for the client found by `instance_url`:

- **No project with this eGrant id** (key row `egrant_id`): create the project (`source = 'egrant'`, name, description, the `egrant_id` and name key rows) and every valid event (`source = 'egrant'`, shown as **"From eGrant"** on the timeline, in the sheet and in the pickers). `201 created`.
- **A project created by a person with the same name key and no eGrant id:** it is linked (the `egrant_id` key row is added) and every difference becomes a pending change (§5.4); nothing the person wrote is overwritten. `200 pending`.
- **A project created from a ticket** (a ticket arrived before the project endpoint, §5.5): it has `egrant_delivered_at` null. If no person has edited it since (`edited_by_person_at` null), the first delivery **applies directly** (name, description, events); otherwise the differences are pending. `200 applied` / `pending`.

Every processed delivery sets `projects.egrant_delivered_at` and `egrant_sent_at`.

### 5.3 Event dates and skipped events

- `events[].date` must match `^\d{2}\.\d{2}\.\d{4}$` and be a real calendar date (`31.02.2026` is not).
- An event with an invalid date, an empty name, or the same name key and date as an earlier event of the same delivery is **skipped**, not a failed request. The skip is logged (`egrant event skipped`: instance host, project id, index, reason; never the text) and named in the answer's `skipped` (for example `["events[2].date"]`). The rest of the delivery is processed.
- A skipped event is treated as absent from the list for that delivery, so it may be proposed for removal if it existed; the removal stays a proposal (never automatic), and the next valid delivery clears it.

### 5.4 Later deliveries: pending changes on the project

Nothing that exists is changed silently. Every difference between the delivery and the project becomes a **pending change from eGrant**:

| change | when |
|---|---|
| project name / description | differs from the project's current value |
| event name / date / description | a delivered event is paired with an existing eGrant event (rules below) and that field differs from the event's current value |
| new event | a delivered event pairs with none: proposed as an **addition** |
| event removal | an existing eGrant event (`source = 'egrant'`) pairs with no delivered event: proposed for **removal**, never deleted automatically; events people added are never proposed |

**Pairing events without ids** (decision 6b). Each eGrant event stores the identity eGrant last gave it: `egrant_name_key` and `egrant_date` (updated on every processed delivery, whatever the person accepted or dismissed, so a person's own rename in Help never breaks the pairing). For one delivery, in this order:

1. **Same name and date:** a delivered event whose name key and date equal an existing eGrant event's `egrant_name_key` and `egrant_date`. Only the description can differ.
2. **Same name, other date (a redate):** among the events still unpaired, a delivered event whose name key equals exactly one unpaired existing event's `egrant_name_key`, and that existing event is the only delivered match for it → proposed as a **date change** (and a description change if that differs too).
3. **Same date, other name (a rename):** the same with the date → proposed as a **name change** (and description).
4. **Everything left:** delivered events → additions; existing eGrant events → removals.

**Limits** (documented in the integration guide too): an event renamed **and** redated in one step shows as an addition plus a removal; two events with the same name (or, for step 3, the same date) make the pairing ambiguous, so they show as additions plus removals as well; an event's identity follows the last delivery, so a change dismissed in Help is still the new identity for pairing. Accepting a removal deletes the event and unlinks its tasks and tickets (with the usual confirmation), so the reviewer sees the pair side by side ("Maybe the same event: *Hodnotenie* 04.11. → *Hodnotenie žiadostí* 06.11.") and can accept the addition, move the links, and then accept the removal, or dismiss both.

**Storage** (projects module, migration of P1):

```
egrant_changes (
  id, group_id → groups on delete cascade,
  project_id → projects on delete cascade null,          -- project and event changes
  event_id → project_events on delete cascade null,      -- an existing event's field change or removal
  ticket_id → tickets on delete cascade null,            -- a ticket's own project (decision 6)
  kind text in ('project_name','project_description','event_name','event_date',
                'event_description','event_add','event_remove','ticket_project'),
  event_key text null,                -- event_add: '<name key>|<yyyy-mm-dd>'
  value jsonb,                        -- the incoming value: text, a date, a whole event, or { projectId, name }
  value_hash text,                    -- sha256 of the normalised value: "dismissed stays dismissed"
  state text in ('pending','dismissed'),
  sent_at timestamptz, received_at timestamptz,
  via_ticket_id → tickets on delete set null null,       -- for ticket_project: none; reserved for a later field
  CHECK (kind = 'ticket_project') = (ticket_id is not null and project_id is null)
  CHECK kind = 'ticket_project' or project_id is not null
)
  unique (coalesce(ticket_id, project_id), kind, coalesce(event_id, event_key, ''))   -- one row per field
  idx (project_id) where state = 'pending', idx (ticket_id) where state = 'pending',
  idx (group_id) where state = 'pending', idx (event_id), idx (via_ticket_id)
```

Per field and delivery: the incoming value **equals the current value** → the row is deleted; it equals a **dismissed** row's `value_hash` → the row stays dismissed (no badge); otherwise the row becomes `pending` with the new value (a newer delivery replaces an older pending value).

**Review.** Admins and the group's clients (`canEditProjects`, decision 8); accepting an **event removal** deletes an event, so admins only (decision 8a), while a client can dismiss it. The project sheet has a section **"Changes from eGrant (n)"**: one row per field with the current and the incoming value (descriptions as a before / after pair) and the time of the delivery; each row **Accept** or **Dismiss**; rows left alone stay pending; **Save choices** applies the accepted rows in one transaction (an accepted name adds an alias key; an accepted addition creates a "From eGrant" event; an accepted removal deletes the event after the confirmation) and marks the dismissed ones. `GET /api/projects/:id/egrant-changes`, `POST /api/projects/:id/egrant-changes { accept: [ids], dismiss: [ids] }` (`409 change_outdated` when a row changed meanwhile).

**Where it shows:** the project's row in the Prehľad projects card ("eGrant changes (3)", opening the sheet on the section); a small mark on the timeline's affected events and in the project select; on the project's **tickets**: the ticket page ("This ticket's project has changes from eGrant · Review") and the row badge "eGrant change" in the group and global lists, with the filter `egrant=pending`; the same mark on the admin home's Tickets rows (which tickets it lists does not change). A žiadateľ sees none of it. No notification (decision 26).

### 5.5 The ticket intake links the ticket to its project

`POST /api/tickets/intake` gains only what links the ticket:

| field | meaning | rules |
|---|---|---|
| `project_id` | eGrant's project id | 1–100 |
| `project` | the project's name, used only if Help does not know the project yet | 1–200 |
| `external_id` | eGrant's own stable id of the support request | 1–100, unique per instance, never reused |
| `sent_at` | when eGrant made this version | ISO 8601 with a zone; required on an update |

No events on a ticket: the ticket's event is chosen by people.

- **The project is known** in the ticket's client (key row `egrant_id`) → the ticket gets it.
- **Unknown** → a project is created from `project` (`source = 'egrant'`, no description, no events, `egrant_delivered_at` null); the project endpoint's first delivery completes it (§5.2). Without `project` the name is "eGrant project <id>".
- **No client** → `tickets.egrant_project_ref` (`{ id, name }`) is kept and processed when a client is assigned or the ticket moves.

**Create or update.** Today eGrant sends a ticket once: a repeat `request_id` answers the first ticket and changes nothing, and the intake has no stable ticket id. With `external_id`, the intake decides:

1. a `request_id` already seen (on a ticket or in `ticket_intake_updates`) → the first answer again, nothing changes;
2. `external_id` known for the same instance (`external_key` = normalized host of `instance_url` + `|` + `external_id`, unique) → an **update**: `200 { id, number, updated: true, state, ignored }`;
3. otherwise a **create**: `201 { id, number }`.

An update changes **only the ticket's project** (`project_id`, `project`; decision 6a); every other field (subject, body, area, programme, requester, phone, due date, url, files, a status) is ignored and named in `ignored`. `sent_at` is required on an update; an older one than the ticket's `egrant_sent_at` answers `state: "stale"`. Each update carries a new `request_id`, recorded in `ticket_intake_updates (request_id pk, ticket_id → tickets on delete cascade, state, received_at)`, so its retries answer the first result.

The ticket's project follows the same pending mechanism (kind `ticket_project`):

- **`project_origin` is `egrant` or null** (nobody chose the project by hand): the incoming project applies at once and the event is cleared if it belonged to the old project (`state: "applied"`; `unchanged` when equal; `stored` without a client).
- **`project_origin` is `manual`:** a different incoming project becomes a pending `ticket_project` change (`state: "pending"`), shown on the ticket as a banner "New change from eGrant: project *Kultúra 2026*" with **Apply** and **Dismiss** (`POST /api/tickets/:id/egrant-change/apply` · `…/dismiss`, `canSetTicketProject`; `409 no_pending_change`). Apply sets the project (created by the rules above if needed), clears an event of the old project and sets `project_origin = 'egrant'`; Dismiss keeps the manual value, and only a different later value raises it again.
- A manual change of the ticket's project or event sets `project_origin = 'manual'` and drops a pending `ticket_project` row.

DTOs: `TicketDto.egrantChange: { kind: 'ticket' | 'project', project } | null` and `TicketListItem.egrantChange: 'ticket' | 'project' | null`, for admins and the group's clients only (stripped in `forReader` for a žiadateľ); `ProjectDto.egrantChanges: number`.

### 5.6 Name keys and aliases

- `name_key = normalizeSearch(name)` (the existing helper of `knowledge/search.ts`, moved to `infra/text/search.ts` by Phase 32 part B; if B has not merged, P3 imports it from knowledge).
- Creating a project inserts its key; a rename (by hand or by an accepted eGrant change) inserts the new key and keeps the old one (alias); an admin can remove an alias in the project's edit dialog ("Also matches: …" chips). Two projects can never share a key in one client (`409 project_name_taken` on create or rename, with the other project's name). Name keys matter only for the person-created project of §5.2 and for people searching; eGrant matching itself goes by the eGrant id.
- Merge: in one transaction under `lockGroupProjects`: move events, tasks and tickets (through their modules), files, linked knowledge, pending eGrant changes and **every key row** (`kind = 'name'` and `kind = 'egrant_id'`) to the survivor, then delete A. A's eGrant id keeps matching (and A's later deliveries become pending changes on the survivor).

## 6. Tasks and tickets (part P2)

- **Task form** (create and edit, the panel's Details tab): under the deadline a **Project** select (the client's active projects by name, "No project") and, when a project is chosen, an **Event** select (its events by date, coming ones first, then past, "No event"). Changing the project clears the event. Saved with the form (`project_id`, `event_id` in the create and PATCH bodies; `400 invalid_project` for a pair that does not fit).
- **AI review cards** (Turn into tasks from a ticket): inherit the ticket's project and event (decision 12), shown as the same two selects on each card.
- **Task card** on the boards: a small chip with the project's colour dot and name (and "· event" when set), after the deadline, truncated; hidden on cards of the global board when space is short (the panel shows it).
- **Ticket page**: Project and Event in the details list, as two selects that save at once (like the riešitelia field). Admins and the group's clients use them (`PUT /api/tickets/:id/project { projectId, eventId }`, `canSetTicketProject`); a žiadateľ sees the project's name only. A pending eGrant change shows as a banner above the details with Apply and Dismiss (§5.4). A ticket without a client shows the raw eGrant project (and event) name as text ("eGrant project: Culture 2026 – Jana") until a client is assigned.
- **Ticket list rows**: the project chip next to the area. While a change is pending, admins and the group's clients also see the "eGrant change" badge. The status filter row gets an "eGrant changes" pill (`egrant=pending`).
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
- **Clicking** the event's name opens the **event sheet** (side sheet on a computer, full-screen on phones): name, date, project, description (rendered Markdown), files, attached knowledge, and the same three lists without caps (paged). Admins and the group's clients get "Edit" there; "Delete" is for admins (decision 8a). A task row opens the task panel (`?task=<id>` on the overview route, like the admin home); a ticket row opens the ticket page.
- **Phones:** the strip shows only the line, the dots, the dates and the names (no rows). Tapping an event opens the event sheet (decision 17). The strip scrolls sideways with momentum; the dots have a 44 px tap area.
- **Header:** the project select (All projects [default]; each active project; "Archived" group below), "Earlier" and "Later" at the strip's ends (they load the next 15 events in that direction and keep the scroll position), "Today", and "+ Event" for admins and the group's clients (asks the project when "All projects" is shown).
- **Empty states:** no projects: "No projects yet. Projects group this client's tasks and tickets along a timeline." with "+ New project". A project without events: "No events yet." with "+ Event". A žiadateľ never reaches the tab.
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

- Rows: colour dot, name, "From eGrant" badge for `source = 'egrant'`, the number of events, the next coming event, open tasks and tickets counts (one grouped query each through the tasks and tickets modules). Active by default; an "Archived" pill shows the archived ones. A row opens the **project sheet** (description, files, knowledge, its events in date order with "+ Event", "Show on the timeline" which selects it in the timeline). Admins and the group's clients: "Edit", "Archive"/"Restore"; admins also "Merge into…" and "Delete" (decision 8a).
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
| `project:changed` | `{ groupId, projectId, kind: 'project' \| 'event' \| 'egrant' }` | `group:<id>` | after any project or event write, archive, merge or delete commits, and after an eGrant delivery or review changed the project or its pending changes (`kind: 'egrant'`) |

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

1. **Projects and events.** An admin opens a client's Prehľad, creates the project "Kultúra 2026" with a description and a PDF, adds three events (one past, one today, two coming); the timeline shows them in order with Today between. The client sees the same, adds an event and archives a project, and is offered no Merge or Delete.
2. **Tasks and tickets on events.** The admin sets a task's project and event in the panel; the event's column lists it under Tasks; completing it moves it into the done pile ("1 done"); the Tasks tab filtered by the event shows only it.
3. **eGrant projects.** `PUT /api/egrant/projects/prj-208` with a description and three events (`04.11.2026`, `20.12.2026`, `31.02.2026`) answers `201`: the project and two events are created "From eGrant", `skipped` names the third; the same body again answers `200 unchanged`. A delivery for an instance without a client answers `202`, and the project appears once the admin creates that client. A ticket with `project_id: "prj-208"` lands in the project; one with an unknown `project_id` and `project: "Šport 2026"` creates that project, which the next project delivery completes; a ticket without a client gets its project once the admin assigns the client.
4. **eGrant changes.** A later delivery renames the project, moves *Hodnotenie* from `04.11.2026` to `06.11.2026` (paired by name: a redate), renames the `20.12.2026` event (paired by date: a rename), adds one event and leaves one out: Prehľad and the project's tickets show "eGrant changes (5)"; the client accepts the name and the redate and dismisses the addition; the admin accepts the removal; the same delivery again raises nothing; a different date for the dismissed addition raises it again. An event renamed and moved at once shows as an addition plus a removal. A ticket whose project an admin changed by hand gets an update (same `external_id`, new `request_id`, `200`, `state: pending`) and shows the Apply / Dismiss banner; on an untouched ticket the update applies at once; a `subject` in the update is ignored and listed.
5. **Merge.** The admin merges "Nový projekt" into "Kultúra 2026"; its ticket moves; a new intake with "Nový projekt" lands in "Kultúra 2026".
6. **Active cards.** The admin assigned to one ticket and one task sees them first on the cards; a client sees their own first.
7. **Phone.** At 390 px the timeline shows dots only; tapping an event opens the sheet with its tasks, tickets and done pile.
8. **Description editor.** In a task description the admin dictates with the fake transcription, runs "Make it formal" (fake provider), attaches a public note, saves; a client sees the note card; making the note admins-only shows "Item unavailable".
9. **Finance filter** (P6). A finance admin filters the client's work log by the project: only that project's entries and totals remain.

## 15. The small feature: "From chat" → plain file

Owner request of 2026-10-17: a knowledge item of type "From chat" can be turned into an ordinary **File** item (kept when the message is deleted, editable, movable into folders). Built now on `feat/knowledge-chat-file-to-file` by another agent with its own short design; this spec only records the dependency: none. Phase 33 does not touch `chat_file` items (they cannot carry linked knowledge or the description editor while they stay chat files; once converted they are File items and get §10 like any other).

## 16. Testing (test-first)

Server: the policy table of §4 for admin, client, žiadateľ and outsider. A client creates, edits and archives projects and sets a ticket's project; a client's merge, delete and alias removal answer `403`; a žiadateľ gets `404` on every write. the composite FKs (a task cannot point at another client's project; an event of another project is refused; moving a ticket clears or re-matches); matching (id, key, alias, archived, create, concurrency of two intakes, id-only, none); merge (events, tasks, tickets, keys, ids move; future matches). Project deliveries: first creation, a ticket-created project completed directly or by pending changes (edited by a person or not), a person's project of the same name linked, strict `dd.mm.yyyy` parsing and skipped events, every change kind of §5.4, the pairing order (name and date, name alone, date alone, ambiguity, rename plus redate, a person's rename in Help), dismissed values staying dismissed, a newer pending value replacing an older one, a stale `sent_at`, idempotent repeats, the inbox (`202`, processed on client create or URL change, the 180-day cleanup), the rate limit, the review's accept and dismiss with a client and an admin (a client's removal `403`), `409 change_outdated`. The create-or-update rule: `request_id` replay before `external_id`, the same `external_id` from another instance creates a new ticket, `201` and `200` answers, `ignored` fields, `sent_at` required on an update, recorded update `request_id`s. The update states: every `state`, a stale `sent_at`, no client, origin `egrant` applies, origin `manual` holds, the dismissed key, a different value after a dismiss, Apply creating the project and the event, a manual change clearing the pending one, and a žiadateľ never seeing it. the filters and their `400`s; the timeline page (order around today, paging both ways, caps and counts, archived projects, six queries); the active cards' order; the description routes (AI tools per role, shared rate limits) and `knowledge_links` (shareable only, re-check on display, žiadateľ read-through, files rule, moved ticket); the finance hooks and filters (P6); EXPLAIN. Web: the selects (clearing the event), the filters (remembered, the one-client rule), the timeline (Today placement, gaps, done pile, keyboard, phones' sheet), the cards, the dialogs, the description field (lazy load, AI, voice, attach, undo).

## 17. Risks

- **eGrant must send the project.** Until it does, only manual assignment works; decision 1 names the fallback switch.
- **Automatic creation makes duplicates** from typos; merge (decision 4) and aliases fix them, and the "From eGrant" badge shows where they came from.
- **The timeline on a client with hundreds of events** stays fast through paging; the all-projects view of a very active client may feel crowded, which the project select answers.
- **The description editor everywhere** touches many forms; P5 keeps each form's own save logic and swaps only the field.
