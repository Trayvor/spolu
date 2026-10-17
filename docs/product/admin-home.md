# Admin home

What an administrator sees after signing in: a dashboard of what needs them, a compact list of clients, and a global task board across clients. Clients do not have this screen; they open their own group.

## Requirements

- **Layout.** On a computer, the client list is on the left, compact, and the dashboard is on the right. The client list stays on the left on group pages too, so moving between clients is one click.
- **Client list.**
  - Clients the administrator manages (see `client-managers.md`) and the other clients are shown in two separate sections.
  - Order inside each section: clients with unread messages first, then clients with tasks assigned to me, then the rest, by name.
  - Each client shows its unread message count (black) and its count of open tasks assigned to me (yellow).
  - A search field filters the list.
- **Dashboard cards.** Each card has a count on the left and a list on the right; clicking an item opens it.
  - **Tickets** (a wide card, the first row): the active tickets (New or In progress) that are mine to answer: those I am a riešiteľ of, those without a riešiteľ of the clients whose tickets I watch ("Watch tickets": by default the clients I manage), and the tickets without a client, which nobody has placed yet. The count is all of them, with how many are New and how many have no riešiteľ. The list: New tickets first (marked "New"), then the newest first; each row shows `#number`, the subject (or the first words of the text), the client ("Without client" for none) and the due date (red when overdue) and opens the ticket page.
  - **My tasks** (a wide card, the next row; called "Assigned to me" before 2026-10-17): the number of open tasks assigned to me and how many are urgent. The list: urgent tasks first, then by the nearest deadline, then later deadlines, then tasks with no deadline.
  - **Upcoming reminders**: my next reminders in time order, with the count for the next 7 days. It comes from the reminders of the knowledge base and the task board (Phases 17 and 19) and appears once they exist.
  - **Mentions**: unread messages where I was mentioned (by name, or by @all in a client I manage). Clicking one opens the chat at that message (a ticket chat's message opens the ticket page). A ticket chat's message is listed only while the viewer can read the ticket (checked when the card loads, in one batch).
- **Header counts.** For administrators the header's "Tasks" link shows the number of my open tasks (assigned to me, not in Completed; unassigned tasks do not count), and "Tickets" the Tickets card's total (the same three kinds of active tickets). A count is hidden at 0 and shows `99+` above 99; where the header has no room for the links (under 1280 px), the same counts are in the section menu's rows.
- **Tasks tab (Úlohy).** In a group's tab bar, the Tasks tab shows a black dot with the number of tasks with unread chat messages and a yellow dot with the number of open tasks assigned to me. Clients see it too.
- **Global task board.** Administrators have a task board across all clients:
  - columns by step: To do, then the custom buckets of the chosen clients as their own columns (custom buckets with the same name in different clients share one column), eGrant review, Client review, Completed (Completed hidden unless chosen); cards keep showing their client;
  - a client filter that by default shows the clients I manage; I can add or remove clients, with managed and other clients shown separately;
  - filters by assignee (me, anyone, unassigned, a person), urgent, "only where I take part" (tasks I created or am an assignee of), deadline (overdue, next 7 days, none), title search, and showing completed tasks;
  - clicking a task opens it; tasks are moved from the task panel, not dragged.
- **Phones.** The client list and dashboard become one column: four count tiles, two per row (Tickets, My tasks, Upcoming reminders, Mentions; each shows its title and opens its list) above the client list.
- **Speed.** The dashboard and the client list each load with one request; nothing slows down the first screen for clients.

## As built (Phase 20)

- `/` is the admin's dashboard; clients are still sent to their group. A greeting by the Bratislava time of day ("Good morning, Vlad"), then the three cards: Assigned to me (the first 20, "Show all" opens the global board filtered to me and every client), Upcoming reminders (the next 10, the count of the next 7 days) and Mentions (the newest 20 unread, the count capped at 99+). Each row opens its item: the task panel, the knowledge item, or the chat at the message (in its thread for a reply, in the task's Chat tab for a task chat). Opening a mention and reading it there removes it from the card.
- The card and the sidebar counts follow changes live: a message or a task change in any group, or reading a chat (also on another device), refetches them within about 2 seconds while the page is visible, and again when the window gets the focus.
- Upcoming reminders lists the knowledge base reminders the admin receives (author, added or subscribed); task reminders join when Phase 19 is merged, through the same source, with no change to the dashboard.
- Each card fails on its own: "Could not load this. Try again." with a retry.
- From 1024 px the client sidebar is on the left of every signed-in page for admins and can be collapsed to a rail of logos (remembered on the device). A long client list scrolls inside the sidebar; it never makes the page or the chat taller than the window. Under 1024 px the home shows the count tiles (four since 2026-10-17) that open their lists, then the client list.
- An end-to-end test (`e2e/admin-home.spec.ts`) covers an admin who manages one of two clients: the mention, the assigned task, the sidebar sections and pills, the Úlohy pill, the global board's default scope and adding a client, and the phone tiles. It was written in Phase 20 but not yet run (the shared e2e stack was busy); run it before the phase is marked done.

## Tickets card and header counts (owner request, 2026-10-17)

- The Tickets card sits in the first row and the tasks card, renamed **My tasks** (SK "Moje úlohy"), moves to the second row, so the two cannot be confused. The tickets card is **Tickets** (SK "Tikety"), caption "open", sublines "N new" and "N without assignee" (SK "bez riešiteľa"; it was "N without client" before riešitelia existed). It lists the first 20; "Show all tickets" opens the global ticket list (`/tickets`, by default the clients I manage).
- **"Assigned to me" (owner decision, 2026-10-17, replaces the first default).** A ticket is mine when I am one of its riešitelia (`tickets.md`), in any client. A ticket without a riešiteľ is on my card when I watch its client's tickets; one with someone else as riešiteľ is not (even of a client I manage). Tickets without a client stay on every admin's card. An admin who watches nothing and is no riešiteľ sees only the tickets without a client. The rows still mark New tickets and "Without client"; the second subline counts the listed tickets without a riešiteľ.
- **Decision (default): active.** Active means New or In progress; Resolved tickets never count. "New" is the ticket status New, marked with a "New" badge on the row.
- Live: the Tickets card refetches on every `ticket:created`, `ticket:updated` and `ticket:moved` (admins room), and the header counts on those and on task activity (`admin:activity` of kind `task`), within about 2 seconds, and again when the window gets the focus. Becoming or stopping being a manager updates them on the next focus or event.
- Server: `GET /api/me/home/tickets` (`HomeTickets`) and `GET /api/me/home/counts` (`NavCounts`, `{ tasks, tickets }`), admins only (clients get 403). See `architecture/overview.md`, Admin home API.
- End-to-end: `e2e/admin-home.spec.ts` also covers the Tickets card (a New ticket of the managed client, its link, resolving it removes it), the live header Tasks count and the phone tiles' new titles; written, not yet run.

## Custom bucket columns (owner decision, 2026-10-16)

The owner decided that the global board shows the custom buckets of the clients in the client filter as their own columns, instead of one merged "Other steps" column. Custom buckets with the same name in different clients share one column; a unique name gets its own column. Cards keep showing their client.

- **Decision (default): same name.** Two names are the same when they match after trimming, collapsing inner spaces, ignoring upper and lower case, and ignoring the diacritics of Slovak, Czech, German and Hungarian letters (a fixed character map in the query, no database extension): "Preklad", " preklad " and "Preklád" share a column. The column shows the most common spelling among the merged buckets (a tie goes to the first in code-point order).
- **Decision (default): place and order.** The custom columns sit where "Other steps" was, between To do and eGrant review. They are ordered by their typical position on the boards (the average rank of the merged buckets on their boards, counting the fixed buckets too), then by name.
- **Decision (default): which buckets.** Every custom bucket of the clients in the client filter makes a column, also an empty one, as on the group board. The other filters (assignee, urgent, deadline, search, "only where I take part", "Show completed") change the cards and the counts, never the set of columns, so the board does not jump while filtering.
- **Decision (default): no custom buckets.** No extra column, and no "Other steps": To do, eGrant review, Client review (and Completed when shown).
- **Decision (default): the cap.** At most 12 custom columns. When the client filter (for example "All clients") has more names, the 12 with the most open tasks in the chosen clients (counted before the other filters; a tie goes to the earlier typical position, then the name) keep their columns, and the buckets of every other name are folded into one **Other steps** column after them, whose cards name their bucket. "Other steps" appears only then.
- **Decision (default): Show 50 more.** Each custom column pages on its own, like the fixed ones. The column is identified by `custom:<the merged name's key>` (the name as compared: lower case, without diacritics), which the page request sends as `column`; the cursor is the last card's sort key, as before.
- **Moving cards.** The global board has no drag and drop (a card opens the task panel, whose bucket select lists the buckets of that card's own client), so a card always moves inside its own client's board; nothing changes here.
- Filters, counts, the live refresh and the URL are unchanged. The board is still one SQL statement (see `architecture/overview.md`, Admin home API).

## Meetings card (Phase 30)

A wide card "Meetings" under "My tasks" (the Tickets card stays first): meetings of the clients the admin manages (every client when they manage none, as in the global knowledge list) that start in the next 7 days, soonest first, then those of the last 30 days without a summary, marked "No summary"; 10 of each. The count is the coming week's, the line under it the number without a summary. A row shows the day and time, the client and the title, and opens the item in its group's Knowledge tab. On phones it is one more tile. `GET /api/me/home/meetings` (`modules/knowledge/meeting-dashboard.ts`, read through the knowledge module's service).

## Phase

Phase 20 ([spec](../superpowers/specs/2026-10-16-phase-20-admin-home-design.md), [plan](../superpowers/plans/2026-10-16-phase-20-admin-home.md)), built on top of Phases 17 and 18; in progress until it is walked with the owner. The reminders card shows the knowledge base reminders (Phase 17) now and the task reminders once Phase 19 is merged.
