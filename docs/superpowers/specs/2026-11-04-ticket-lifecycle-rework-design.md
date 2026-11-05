# Ticket lifecycle rework: design

Date: 2026-11-04. Status: implemented ([ADR 0075](../../decisions/0075-tickets-assigned-to-managers-finished-by-both-sides.md)). Delivered as one pull request, one commit per part.

## 1. Goal

Help's tickets now mostly carry questions from clients' managers, answered by admins. Requesters (žiadatelia) still send tickets, but only on one question area. The ticket system still assumes a wide audience: tables of automatic assignees, a personal watch switch, and a free-text grant programme.

This rework makes three things simple:

- **Who handles a ticket:** the client's admin managers, automatically.
- **What a ticket is about:** a project of the client, never a free-text programme.
- **When a ticket is finished:** both sides say so, and silence ends it after 5 days.

Success: nobody configures assignment, a new ticket always has someone answering it, a ticket never stays in "In progress" only because the author went quiet, and no dead code stays behind.

## 2. Terms

- **Manager** here always means an admin in `group_managers` (active, derived substitute rows included). A client's own user is a **client** (role `client`).
- **Author** means the ticket's initiator (`tickets.requester_user_id`).
- **Confirmable author:** the author exists, is not an admin, has an active account and can read the ticket. The same people who can rate it (`canRateTicket`). On a ticket created on behalf of someone, this is the named person, not the manager who created it.

## 3. Part A: programme becomes project

The new-ticket dialog and the ticket page already offer the project and event, so nothing new is built.

- **Removed:** the programme field from the new-ticket dialog, the edit form and the ticket details; `programme` from the create and patch request schemas, the MCP ticket tools' inputs and outputs, and `TicketDto`.
- **Kept on purpose:**
  - the intake's `programme` field, so eGrant's requests keep working;
  - the `tickets.programme` column;
  - the name match of `TICKETS_PROJECT_FIELD=programme`;
  - the AI context (`ai/` readers of the column);
  - old audit rows.
- **The project stays optional:** a client may have no projects.

## 4. Part B: assignment

### 4.1 The rule

The new `modules/tickets/manager-assign.ts` adds a client's active managers as riešitelia:

| Event | Effect |
|---|---|
| New ticket, from any source | Every manager becomes a riešiteľ, on top of anyone already assigned |
| Ticket gets a client, or moves to another client | Managers are added only if the ticket has no riešiteľ left after the existing move rules |
| An admin becomes a manager of the client (`addManager`, and a substitution's derived rows; a handler registered with the groups module runs in that transaction) | They become a riešiteľ only of the client's open tickets without a riešiteľ |
| Release (one-off, in the data migration) | The rule above, for every open ticket, without notifications |

- Open means `new` or `in_progress`.
- Stopping being a manager changes nothing: a riešiteľ stays until removed by hand.
- Adding and removing riešitelia by hand stays. The limit of 10 holds: managers are added in the order they became managers until the ticket has 10 riešitelia, and the rest are skipped.
- Each automatic riešiteľ gets `ticket.assigned`, never about their own action, and an audit row `ticket.assignee_added` authored by the system actor `tickets.manager-autoassign`. A just-assigned manager gets only `ticket.assigned`, no `ticket.created` on top.
- The release backfill writes those audit rows too; it waives only the notifications.

### 4.2 Who hears what

| Ticket | Who hears updates |
|---|---|
| Has riešitelia | Riešitelia and the author |
| No riešiteľ (client without a manager, or no client) | Every active admin and the author |

- `ticketOwnerIds` becomes this rule. `ticketResolvedAudienceIds` goes: resolving reaches the same audience.
- A 👎 rating goes to the admin riešitelia; on a ticket with no admin riešiteľ it reaches every active admin who reads it, so the alert is not lost.
- Other clients of the group stop getting new-ticket and resolved notifications about tickets of colleagues (owner decision 2026-11-04). They still read every ticket on the Tickets tab.
- **Dashboard:** tickets I am a riešiteľ of, and open tickets without a riešiteľ, of any client or of none (the new partial index `tickets_open_created_idx`). A ticket without a client that has someone else as riešiteľ is not on my card. The header's count stays the tickets with a change I have not seen.

### 4.3 Removed

- **Automatic assignees by area** (ADR 0064, ADR 0069), including the clients' own setup added on 2026-10-22:
  - the `ticket_area_rules` table;
  - `area-rules.ts`, `area-rules-routes.ts`, the dialog and its icon button;
  - `packages/shared/src/ticket-areas.ts`;
  - `PUT /api/egrant/ticket-areas` (the owner removes the call in eGrant);
  - MCP `list_ticket_areas` and `set_ticket_areas`;
  - `e2e/ticket-area-autoassign.spec.ts`;
  - the "Ticket areas" section of the eGrant integration guide.
- **Watch tickets:**
  - the `ticket_watch_settings` table;
  - `watch.ts`, the checkbox and its info bubble;
  - the "New tickets" column of `/settings/notifications`;
  - `GET` and `PUT /api/groups/:id/ticket-watch`;
  - the MCP watch tools.
- **Kept:** the `area` field and its list filter, and old audit rows of `ticket_area_rules`, which stay readable.

## 5. Part C: lifecycle

### 5.1 Data

No new status. `tickets` gets `admin_done_at` and `admin_done_by` (`set null` on user delete), plus a partial index on `admin_done_at` where it is not null. `admin_done_cleared_at` records that a mark ended and was not set again, whether by the author, a status change or a move, and also that the ticket left `resolved`; it drives the time review of section 5.4.

The mark exists only while the status is `in_progress`; any status change, and moving the ticket to another client, clears it in the same statement. Lists show a derived badge "Awaiting confirmation". The Open filter and every `('new', 'in_progress')` query stay as they are.

### 5.2 New to In progress

Opening the ticket page sets `in_progress` through the existing "seen" `POST`, never a `GET`, so MCP reads never count. All of these must hold:

- the status is `new`;
- the ticket has a client;
- the actor is a riešiteľ of it, or it has no riešiteľ and the actor is any admin;
- the actor did not create the ticket.

The update is conditional on `status = 'new'`, so two people opening it at once change it once. It is an ordinary status change with the actor's name: audit row, socket event, notification to the author.

### 5.3 The actions

| Actor | Action | Route | Allowed when | Effect |
|---|---|---|---|---|
| Any admin | "Solved on our side" | `POST /api/tickets/:id/admin-done` | `in_progress`, no mark | With a confirmable author: sets the mark, notifies the author. Without one: resolves at once |
| Confirmable author | "Solved" or "Yes, solved" | `POST /api/tickets/:id/confirm` | `new` or `in_progress`, mark or not | `resolved`, rating opens |
| Confirmable author | "Not solved yet" | `POST /api/tickets/:id/decline` | Mark set | Clears the mark, notifies the riešitelia |
| Confirmable author | Writes in the ticket chat (thread replies too) | Chat write, through an exported tickets service function | Mark set | Clears the mark |
| System | Job `tickets.auto-resolve` | Hourly at :15, Bratislava time | `admin_done_at` at least 5 days old | `resolved` as the system actor, `ticket.resolved` notification, rating opens |

- New policy functions in `policy.ts`: `canMarkTicketDone` and `canConfirmTicket`.
- The period is the constant `TICKET_CONFIRM_DAYS = 5` in `packages/shared`, in calendar days.
- The job gives each ticket its own transaction: it locks the row with `for update skip locked` and checks the mark again on the locked row, so an author's click at the same moment wins cleanly, and one failure stops nothing else. It pages by keyset on `(admin_done_at, id)` through the partial index. Its handler throws until the app has attached its deps and sockets (`attachTicketJobs`), so an early run fails loudly and the next hour takes the tickets.
- The admin's status control stays as it is: an admin may set Resolved directly (duplicates, spam) and reopen.
- A message of thanks clears the mark too, on purpose: Help does not guess what a message means. The admin presses the button again.
- A resolved ticket does not reopen by itself. An author's message changes nothing; only an admin reopens, as today.

### 5.4 Time

Today the time request fires on `resolved`. It moves to the moment the admin finished: `onTicketResolved` is split so asking can run at the mark. One entry per admin per ticket stays, so a repeat updates that entry and never adds a second.

| Situation | What the admin sees |
|---|---|
| First press of "Solved on our side" | The ordinary time dialog |
| Author confirms, or the job resolves, with the mark still set | Nothing more |
| The mark was cleared, then the admin presses again | The dialog prefilled with their minutes, with "No change" |
| The mark was cleared, then the author resolves with no second press | Notification `ticket.time_review` and a dashboard row, opening the same prefilled dialog |
| The author resolves before any press | `ticket.time_missing`, as for a riešiteľ who is not the actor today |
| An admin resolves directly, after a clearing | The prefilled dialog, as for a second press |
| An admin resolves directly, with the mark set | Asked as usual, as on any resolve; nobody else is told |
| An admin resolves directly, otherwise | As today |

- A review answered with nothing leaves the earlier entry valid; it never counts as missing.
- A review goes only to admins who have filled time. The others keep their ordinary request.
- Other admin riešitelia are asked by notification, never by dialog. An author or the system never gets a dialog.
- A cleared mark keeps unanswered requests. Only leaving `resolved` drops them, as today.
- The entry counts on the Bratislava day of the first press (or the resolution, when there was no press). An entry filled while the ticket is marked counts on the press's day.
- Finance has no closed periods, so a reviewed entry can always change.
- `finance_time_entries.review_requested_at` marks a review; it shows in the time-request rows, and a save or "No change" clears it. Finance's missing-time reports read `minutes` only, so a review never counts as missing.

### 5.5 Screens

One bar above the chat, not folded into the details on a phone:

| State | Admin | Confirmable author |
|---|---|---|
| New | Nothing | Button "Solved" |
| In progress, no mark | Button "Solved on our side" | Button "Solved" |
| Awaiting confirmation | "Waiting for confirmation until <date>" | Card "The team considers this solved" with "Yes, solved", "Not solved yet" and a hint about the automatic end |
| Resolved | As today | As today, the rating card |

A notification link opens `/tickets/<id>?confirm=1`, which only scrolls to and focuses the card, like `?rate=1`. Writing needs a click in a signed-in session, because mail scanners open links.

Visual work starts with the `frontend-design` skill during implementation.

### 5.6 Notifications

New kinds in the Ticket board group, with server texts in all nine languages:

- `ticket.awaiting_confirmation` to the author;
- `ticket.confirmation_declined` to the riešitelia, or every admin while it has none, and the admin who pressed;
- `ticket.time_review` to the admin.

Unseen-change summaries gain their lines.

### 5.7 Audit

The mark being set and cleared, and each status change above, are recorded in the ticket's history, with the person as author or the system actors `tickets.auto-resolve` and `tickets.manager-autoassign`.

## 6. Dead code

The repository has no `noUnused*` compiler option, no `knip` and no check for unused locale keys, so nothing would catch leftovers. The plan has a separate step:

1. **Delete, never disable.** Remove entry points first (routes, calls, exports), then follow the compiler's errors.
2. **`knip` before and after.** Run through `pnpm dlx knip` with no new dependency, compare the two reports, and act on new findings only.
3. **Search each removed name down to zero:** `ticket_area`, `ticketArea`, `areaRules`, `area-rules`, `AutoAssignIcon`, `ticket_watch`, `ticketWatch`, `ticket-watch`, `watchesTickets`, `ticketWatcherIds`. Allowed leftovers are old migrations and audit labels.
4. **Locale keys** in all nine web locales and server i18n, for areas, watch and programme, because `knip` cannot see them.
5. **Migrations drop both tables**, with their indexes.
6. **Intentional leftovers** are the ones listed in sections 3 and 4.3.

A permanent `knip` check in `ci.sh` is a separate task, because it needs a dependency and an ADR.

## 7. Testing

Test-first for server logic and permissions.

- **Server:** policy functions; every transition of sections 5.2 and 5.3, also refused ones; the job with an injected clock and no wall-clock budget; races through the conditional updates; the time table of section 5.4; assignment on every event of section 4.1; the audience of section 4.2; the data migration.
- **Web:** the bar and card in every state and role, the prefilled time dialog, the new-ticket dialog without programme.
- **End to end:** one new spec for the whole path: a manager creates a ticket, the riešiteľ opens it, marks it done, the author declines, the mark returns, the author confirms, the rating appears.

## 8. Docs

Update `docs/product/tickets.md`, `notifications.md`, `finance.md`, `groups.md`, `admin-home.md`, `docs/integrations/egrant.md`, `docs/integrations/egrant-ticket-intake.md`, `docs/integrations/mcp.md` (`mark_ticket_done`, `confirm_ticket`, `decline_ticket`, and the area and watch tools gone), `docs/architecture/performance.md`, `docs/design/wording.md`, the glossary and the roadmap.

New ADR: "Tickets are assigned to the client's managers and finished by both sides", superseding ADR 0064 and ADR 0069 and amending ADR 0021.

## 9. Delivery

One pull request, with commits in this order:

1. Part A, programme.
2. Part B, assignment and removals. The owner removes eGrant's `ticket-areas` call before the release.
3. Part C, lifecycle, which needs part B for "a riešiteľ opened it".
4. Dead-code pass and docs.

Check the latest migration number on `origin/main` before generating each migration.
