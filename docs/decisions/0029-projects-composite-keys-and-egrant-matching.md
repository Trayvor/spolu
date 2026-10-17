# 0029 — Projects: composite keys, exact-key matching with aliases, and created by eGrant

Status: accepted (2026-10-17, Phase 33 part P1)

## Context

Phase 33 gives every client projects with dated events, and tasks and tickets carry a project and an event ([spec](../superpowers/specs/2026-10-17-phase-33-projects-design.md)). Projects are per client, so a task must never point at another client's project, and an event must belong to the task's project. eGrant also creates and updates projects through a webhook (part P3) and links tickets to them by its project id, so matching must be predictable and safe against renames, merges and concurrent deliveries.

## Decision

1. **Composite foreign keys.** `projects` has `unique (id, group_id)` and `project_events` `unique (id, project_id)`. `tasks` and `tickets` reference `(project_id, group_id)` → `projects (id, group_id)` and `(event_id, project_id)` → `project_events (id, project_id)`, with `CHECK event_id is null or project_id is not null` (and on tickets `project_id is null or group_id is not null`). The database itself refuses another client's project and an event of another project.
2. **Column-list `ON DELETE SET NULL`** (PostgreSQL 15+): deleting a project clears only `project_id`, never `group_id`; deleting an event clears only `event_id`. Drizzle cannot express the column list, so migration 0037 has those two clauses written by hand (the schema files say so). A project FK cannot clear `event_id` (it is not one of its columns), so the projects service **deletes the events first**, then the project: the event FK clears `event_id`, the project FK `project_id`, and the CHECK holds in between. A client's deletion cascades everything at once. The event FK also has `ON UPDATE CASCADE`, so a merge (part P3) moves an event to the survivor and its tasks and tickets follow.
3. **Exact keys, with aliases, no fuzzy matching.** `project_name_keys (group_id, kind, key)` is the primary key: `kind = 'name'` holds the `normalizeSearch` key of the current name and of every earlier name (aliases), `kind = 'egrant_id'` eGrant's project id. One project per key and client: a create or rename onto a taken key answers `409 project_name_taken` with the other project's name; aliases are removable by hand. eGrant tickets match by the eGrant id only; a person's project is linked to an eGrant project by its name key. Edit-distance matching would merge "Projekt A" and "Projekt B".
4. **eGrant creates projects automatically** (part P3) under a per-client advisory lock (`lockGroupProjects`), so two concurrent deliveries create one project; later differences become pending changes (`egrant_changes`) a person accepts or dismisses, never silent overwrites.
5. The migration of part P1 holds every table of the phase (`egrant_changes`, `egrant_project_inbox`, `knowledge_links` too), so the parallel parts P2–P5 need no migration of their own.

## Consequences

- A ticket moved to another client must clear (or re-match) its project and event in the same statement, or the FK refuses the move (part P2/P3).
- Every new FK leads an index (`infra/db/foreign-key-indexes.test.ts`): the composite ones are served by `(group_id, project_id, event_id)` and partial `(event_id, project_id)` indexes, the events' by `(project_id, group_id, occurs_on, id)`.
- Two projects of one client can never share a name, even an old one, until the alias is removed.
- No new dependency.
