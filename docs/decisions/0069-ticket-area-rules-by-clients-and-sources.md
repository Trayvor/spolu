# 0069 Clients edit their automatic ticket assignees; Help's and eGrant's rows kept apart

Date: 2026-10-22
Status: accepted (amends [0064](0064-ticket-area-autoassign-table-replaced-by-egrant.md))

## Context
ADR 0064 made the per-client table of question area → riešiteľ admins only, and let eGrant's sync replace the whole table. The owner asked (2026-10-22) that a client's own people set it up too, and decided: every `client` of the group (never a žiadateľ) reads and edits it; a row may name an active admin or an active client of the same group (as a riešiteľ by hand); eGrant's sync must not wipe what the client set in Help.

## Decision
- **Policy.** `canManageTicketAreas(actor, role)`: an admin, or the actor's active role in the group is `client`; anyone else `404`. `canBeAreaAssignee(role, memberRole)`: an active admin, or an active `client` member of the group. The same rule filters the rows when a ticket is assigned, so someone who left the group or was disabled is skipped.
- **Two sources in one table.** `ticket_area_rules.source` (`help` | `egrant`, default `help`; migration 0072) joins the primary key `(group_id, area_key, user_id, source)`, which still serves the lookup `group_id = ? and area_key = ?`. `replaceAreaRules(…, source)` replaces only that source's rows: the web and MCP save `help` rows, eGrant's sync `egrant` rows. The same person for the same area from both sources assigns once. Help's rows list first, then eGrant's.
- **The answer carries `candidates`** (`listGroupPeople`: the group's active admins and verified clients), so a client can fill the dialog without the admins-only `/api/admins`.
- eGrant rows are read-only in the dialog; they change in eGrant.

## Consequences
- A client can make an admin of the team a riešiteľ of their tickets; admins accepted that (it equals assigning by hand, which clients can already do).
- eGrant's contract changes: an empty list now empties only eGrant's rows. Its answer's `rules` are its own rows.
- Existing rows became `help` rows (none existed on production on 2026-10-22).
