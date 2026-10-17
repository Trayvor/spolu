# Projects (Phase 33)

Requirements as built. Design: [Phase 33 spec](../superpowers/specs/2026-10-17-phase-33-projects-design.md) (its "Owner decisions" first), [plan](../superpowers/plans/2026-10-17-phase-33-projects.md). Built in six parts; each part fills its own section below.

## Concepts

- **Project** (sk "Projekt"): belongs to one client group. Name (1–200, required), description (Markdown, ≤ 10 000), files (0–20 ordinary group files), status **active** or **archived**, source **manual** or **egrant** ("From eGrant"), eGrant's project id (read-only), **aliases** (the name keys of its earlier names).
- **Event** (sk "Udalosť"): belongs to one project. Name (1–200), description, files, **date** (one day, required, past dates allowed). Events of one day are ordered by creation.
- A task or a ticket has at most one project and, inside it, at most one event (part P2 sets them). The database refuses another client's project and an event of another project ([ADR 0029](../decisions/0029-projects-composite-keys-and-egrant-matching.md)).
- Each project has a **colour** from the brand accents (purple, pink, blue, coral, green), picked by a hash of its id like avatars; shown only as a small dot.
- **Name key**: the name trimmed, inner spaces collapsed, lower-cased, without diacritics. Two projects of one client never share a name key; a rename keeps the old key as an alias ("Also matches"), which anyone who edits the project can remove.

## Who sees and does what

Admins and the group's clients (everyone who reads the group) see projects and events and **create, edit, archive, restore and delete** them, add files, and remove aliases (decisions 8 and 8a). A žiadateľ never reaches the group, so every project route answers them `404`; on their own ticket they will see only the project's name (part P2). Details: [permissions](../architecture/permissions.md#projects-phase-33).

## Foundation (part P1)

- **Prehľad tab** (EN "Overview"), `/groups/<id>/overview`: the **first** tab pill of a group; the group still opens on Chat. It is one lazy chunk (`overview-tab`) with the `projects` locale namespace. Part P4 adds the timeline above and the two active cards in the middle; P1 shows the projects card.
- **Projects card**: the client's projects by name, 30 a page with "Show more", **Active** or **Archived** (pills). Each row: the colour dot, the name, "From eGrant" for eGrant's projects, "eGrant changes (n)" (from part P3), then the number of events, the next coming event (from today, Bratislava) with its date, and the open tasks and open tickets (shown only when there are any). Empty: "No projects yet. Projects group this client's tasks and tickets along a timeline." "New project" opens the project dialog; a row opens the project sheet.
- **Project sheet**: name with its dot, "Archived" and "From eGrant" badges, the description (rendered Markdown), files, and the **events** by date with "Add event". The menu has Edit, Archive or Restore, and Delete. Delete asks first and names what happens: its events go too; its open tasks and tickets stay, without the project. Clicking an event opens it in the event dialog.
- **Project dialog**: name, description (the Markdown field with the chat toolbar; part P5 swaps in the description editor with AI, voice and knowledge), files; for an existing project the **Also matches** chips (aliases, each removable) and the eGrant project id (read-only). A taken name says which project has it; an edit made by someone else meanwhile asks to reopen (`409 project_changed`).
- **Event dialog**: the project (fixed), name, date, description, files; an existing event can be deleted there after a confirmation (its tasks and tickets keep the project).
- **Archive** is the normal way to end a project: it leaves the active list and the pickers' active section, stays in the Archived list and stays selectable for tasks and tickets. **Delete** removes the project, its events, files, aliases and links; its tasks and tickets keep existing without it. Deleting an event clears only the event on its tasks and tickets.
- **Live**: every write tells the group's room `project:changed`; an open Prehľad refetches 2 s after the last change.
- Merge ("Merge into…") is part P3's; "Show on the timeline" is part P4's.

## Links and filters (part P2)

Planned: the project and event selects on tasks and tickets, the chips, the filters on the Tasks and Tickets tabs.

## eGrant projects (part P3)

Planned: the project webhook, pending changes from eGrant, the intake's `project_id`, merge.

## Timeline and cards (part P4)

Planned: the timeline card, the event sheet, the active tickets and tasks cards.

## Description editor (part P5)

Planned: AI text tools, voice and attached knowledge in every description field.

## Finance (part P6)

Planned: Finance costs by project and event.
