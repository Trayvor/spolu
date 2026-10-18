# Unseen changes (design)

Date: 2026-10-17 · Status: approved by the owner (2026-10-17); built on `feat/unseen-changes`. Yellow markers, "what changed" and the banner: owner brief 2026-10-18 (see "Yellow markers and what changed"). See the [roadmap](../../roadmap.md).

Builds on [the dashboard follows the notification settings](2026-10-17-dashboard-follows-notifications-design.md) (whose §3 this reverses for tasks, tickets and the header), the [admin home](2026-10-16-phase-20-admin-home-design.md) and [Phase 6 notifications](2026-10-16-phase-6-notifications-design.md). Requirements: [admin home](../../product/admin-home.md), [task board](../../product/task-board.md), [tickets](../../product/tickets.md).

## Principle (owner)

The sidebar, the header and the global views point at what changed since I last looked, not at everything that is mine. A change is a notification I got; it stays "unseen" until I open the task or ticket.

## Definition

A task or ticket has an **unseen change** for me when a `notification_events` row for me with its `taskId` / `ticketId` in the payload exists, created after my last "seen" of it, and still passes delivery's mode and channel rules (the `follows.ts` mirror, at read time):

| counted kinds | rule |
|---|---|
| `task.assigned`, `task.moved`, `task.deadline`, `task.due_changed`, `task.overdue` (2026-10-18, migration 0049), task chat `chat.message` / `chat.mention` / `chat.thread_reply` | Task board channel not None; group mode not Off; a plain `chat.message` only under All messages |
| every `ticket.*` kind (`created`, `unassigned`, `message`, `status`, `updated`, `tasks`, `assigned`, `time_missing`, `resolved` since 2026-10-18) and a ticket chat `chat.mention` | Ticket board channel not None (every mode passes) |

Not counted: `task.urgent` (hourly), `reminder.due`, `task.time_missing`, group chat messages (`taskId` null). A recipient whose channel was None at the time got no row at all (Phase 27 S5), so it never counts.

- Completed tasks and resolved tickets still count until opened.
- A ticket without a client notifies every admin (`ticket.unassigned`), so it counts for each admin until they open it. When it gets its **first** riešiteľ, it is marked seen for every active admin (nobody else needs to look); the new riešiteľ's own `ticket.assigned`, recorded right after, still counts for them.
- Changes before the release do not count: migration 0036 marks every (user, task) and (user, ticket) pair that has events as seen.
- Events are purged after 30 days, so an older change no longer counts.

## Storage (migration 0036)

`task_seen (user_id, task_id, seen_at)` and `ticket_seen (user_id, ticket_id, seen_at)`, primary key (user, item), foreign keys with cascade (user, task / ticket), an index on the item for the cascade. Owned by `modules/notifications`. Two partial expression indexes on `notification_events`: `(user_id, payload->>'taskId', created_at)` where the kind is a counted task kind and the `taskId` is set, and the same for `ticketId`. The predicates come from one list (`notifications/unseen-kinds.ts`) shared by the schema and the queries, inlined as literals so the planner matches the partial index.

All SQL fragments are in `modules/notifications/unseen.ts`: `taskUnseenSql(userId, taskId)` / `ticketUnseenSql` (a per-row subquery giving the mark, `message`, `change` or null), `unseenTaskIdsSql(userId)` / `unseenTicketIdsSql` (the ids, one row each, with a `message` flag; the caller joins its own `tasks` / `tickets` for what still exists and its group), `markTaskSeen`, `markTicketSeen`, `clearTicketUnseenForAdmins` and `emitSeen`. The home, tasks and tickets modules use only these exports.

## Marking seen

Opening the task panel (either tab) or the ticket page while the page is visible sends `POST /api/tasks/:id/seen` or `POST /api/tickets/:id/seen` (204; 404 when the viewer cannot read it: `canUseBoard` / `actorReadsTicket`). The server upserts `seen_at = now()` and emits `seen:changed` (`{ kind, id }`) to the user's room, like `chat:read`, so the other devices refetch. The web hook `useMarkSeen` (`lib/use-mark-seen.ts`) also marks again when the page becomes visible and 1.5 s after a live change of the open item (its board event, a message in its chat, `ticket:updated`), so what the viewer looks at never counts.

## Where it shows

- **Sidebar.** One black badge per client: unread group chat messages + its tasks with an unseen change + its tickets with an unseen change. The screen-reader label lists the parts ("3 správy, 1 úloha, 1 tiket"). The yellow "assigned to me" pill is gone; the collapsed rail shows an ink dot only. Order: managed, then badge > 0, then name. It refetches on chat and task activity, `chat:read`, ticket events and `seen:changed`.
- **Header.** "Tasks" = tasks with an unseen change, "Tickets" = tickets with an unseen change (no-client ones included). The totals of open assigned tasks and active tickets stay on the dashboard's My tasks and Tickets cards and on the global board.
- **Marks.** On the global board, the group board, the ticket lists (`/tickets`, a client's Tickets tab, My tickets) and the dashboard's My tasks and Tickets cards a row or card with an unseen change gets a bold title and a yellow marker (2026-10-18, below; it replaced the ink dot). Computed in the same queries, per row of the page after the limit (no N+1): each row's `unseen` is the mark (`UnseenMark`: `change`, `message` or null); the group board asks `GET /api/groups/:id/board/unseen` (`{ taskIds, messageTaskIds }`, per viewer, since board events are shared by the group room) and refetches it on the group's task and task chat events and on `seen:changed`.

## Yellow markers and what changed (2026-10-18)

- **Marker.** In the `attention` yellow. When the unseen changes include a message in the item's chat (`TASK_MESSAGE_KINDS`: `chat.message`, `chat.mention`, `chat.thread_reply`; `TICKET_MESSAGE_KINDS`: `ticket.message`, `chat.mention`, in `unseen-kinds.ts`) it is a yellow ring with a yellow dot inside (`message`); for any other change a plain yellow dot (`change`). It is a focusable 24 px button (`features/unseen/marker.tsx`, `UnseenMarker`), a sibling of the row's link, never inside it, named "Nová správa" or "Nová zmena". On a board card it sits in the top right corner; on a dashboard row over the start of the link; in a ticket list row in a left gutter every row keeps, so the numbers stay aligned.
- **Tooltip "what changed".** Hover, keyboard focus, a click or tap, or a long press (450 ms) shows the lines of the viewer's own unseen events of that item, fetched on first open from `GET /api/tasks/:id/unseen-summary` or `GET /api/tickets/:id/unseen-summary` (`UnseenSummary`), so the lists stay one query. The tooltip is the button's `aria-describedby`; Escape or a tap elsewhere closes it.
- **Summary.** `taskUnseenSummary` / `ticketUnseenSummary` read the same events as the mark (`taskSummarySql` / `ticketSummarySql`: after the last open, mode and channel rules, newest 500, on the partial indexes), and `unseen-summary.ts` (`summarizeUnseen`) turns them into one line per kind of change, ordered by each kind's newest event: `created` (Nový tiket), `moved` (from the first move's column to the last one's: "Presunuté: Na spracovanie → Hotové"), `assigned` (Priradené vám), `deadline` (the due day: the reminder's Bratislava day plus its days left; "Termín zajtra"), `messages` (chat messages, thread replies and ticket messages: "2 nové správy (Jana)", up to three authors), `mentions` ("Zmienka od: Peter"), `status` (the latest: "Stav: Vyriešený"), `updated`, `tasks` (summed), `timeMissing`. At most 5 lines, the rest as "a N ďalších zmien". Only counts, names of people and columns, statuses and dates; never a message's text. `ticket.assigned` goes to the new riešiteľ only, so it reads "Priradené vám", not a name.
- **Policy.** The summaries answer only who reads the item now (`readableTask`: `canUseBoard`; `actorReadsTicket`), else 404, and only with the caller's own events: a ticket moved to another client is gone for its old client, a žiadateľ reads only their own tickets and no board.
- **Banner on open.** The task panel and the ticket page fetch the summary first (`useOpenSummary` in `features/unseen/banner.tsx`) and only then mark the item seen (`useMarkSeen(target, ready)`); a failed fetch still marks it. The panel shows the same lines in a small yellow banner at the top (above its notices; on the ticket page under the header), kept as fetched while the item stays open, until Skryť (Dismiss) or closing. Nothing changed: no banner.
- **Texts** in the lazy `unseen` namespace (nine languages), loaded with the home, both boards, the task panel, the ticket lists and the ticket page.

## Performance

`home/explain.test.ts` seeds 200 000 notification events (a seventh the admin's, hourly urgent ones among them) and seen marks on `home/test-volume.ts`; the sidebar, the cards, the global board, both header counts, the board's marks and (2026-10-18) both summaries read `notification_events` only through the partial indexes (no sequential scan, checked on the first seeding). The 50 ms bound runs only with `RUN_BENCH=1`. The initial JS did not grow (the code is in lazy chunks).
