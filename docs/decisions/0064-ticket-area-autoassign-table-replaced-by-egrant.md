# 0064 Automatic ticket assignees: a per-client area table keyed by a folded area, replaced whole by eGrant

Date: 2026-10-21
Status: accepted

## Context
Admins assigned every ticket by hand, though who handles a ticket mostly follows from its question area (eGrant's „oblasť“, the ticket's `area`) and the client. The owner asked for a table per client of area → responsible admin, editable in Help and sent by eGrant, that assigns new tickets automatically. eGrant names some areas with a technical prefix (`zend.Projekty`), and areas are typed by people with varying case, spaces and diacritics.

## Decision
- **A table `ticket_area_rules`** in the tickets module (migration 0068): `group_id`, `area_key`, `area` (as written), `user_id`, `position`; primary key `(group_id, area_key, user_id)`, so several admins per area are allowed and a new ticket's admins are one primary-key prefix read. Only active admins can stand in a row (`canBeAreaAssignee`); only admins read or write it (`canManageTicketAreas`, others 404).
- **One normalizer for both sides**, `ticketAreaKey` in `packages/shared`: trim, drop one leading lower-case `zend` before a dot, whitespace or a capital, NFD with the combining marks removed (and đ ł ø ß æ spelled out), lower-case, whitespace collapsed. The key is computed in JS and stored, not in SQL, so the web, the server and the tests use the same function.
- **Replace, not merge**: the web dialog, MCP's `set_ticket_areas` and eGrant's `PUT /api/egrant/ticket-areas` all send the full table and `replaceAreaRules` swaps it in one transaction under a per-client advisory lock, with one `ticket_area_rules.updated` audit row (refs added and removed). eGrant's call is the source of truth (owner decision): it overwrites manual edits. Its emails are matched to active admins; the others come back in `unmatched` and are logged, never creating users.
- **eGrant uses the groups webhook's key and signing secret** (`egrantWebhookKey(config, 'groups')`, `egrantSignature(config, 'groups')`): it is client configuration like the group itself, and no new secret has to be issued and rotated.
- **Assignment after the write, through `addAssignee`**: the routes call `autoAssignByArea` after a ticket's creation (intake and the form, which MCP uses too), after an area change and after a client change, and run the `assigned` hooks for each added admin, so notifications, socket events, the limit of riešitelia and the audit (`ticket.assignee_added` by the system job `tickets.area-autoassign`) are the manual path's. A creation adds the area's admins to any riešiteľ already there; a later change assigns only a ticket nobody handles.

## Consequences
- A new ticket costs one indexed read more (and the roles of the matched admins); the auto-assign runs in its own transactions after the ticket's commit, so a failure there is logged and the ticket stays.
- The watchers still hear `ticket.created` first (the ticket had no riešiteľ when it was announced), then the area admin hears `ticket.assigned`.
- Changing the normalizer changes the stored keys' meaning: a later change needs a migration that recomputes `area_key`.
- A ticket created without a client and moved to one later gets the new client's admins only while it has no riešiteľ.
