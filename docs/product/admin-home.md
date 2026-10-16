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
  - **Assigned to me** (a wide card): the number of open tasks assigned to me and how many are urgent. The list: urgent tasks first, then by the nearest deadline, then later deadlines, then tasks with no deadline.
  - **Upcoming reminders**: my next reminders in time order, with the count for the next 7 days. It comes from the reminders of the knowledge base and the task board (Phases 17 and 19) and appears once they exist.
  - **Mentions**: unread messages where I was mentioned (by name, or by @all in a client I manage). Clicking one opens the chat at that message.
- **Tasks tab (Úlohy).** In a group's tab bar, the Tasks tab shows a black dot with the number of tasks with unread chat messages and a yellow dot with the number of open tasks assigned to me. Clients see it too.
- **Global task board.** Administrators have a task board across all clients:
  - columns by step: To do, Other steps (custom buckets), eGrant review, Client review, Completed (Completed hidden unless chosen);
  - a client filter that by default shows the clients I manage; I can add or remove clients, with managed and other clients shown separately;
  - filters by assignee (me, anyone, unassigned, a person), urgent, deadline (overdue, next 7 days, none), title search, and showing completed tasks;
  - clicking a task opens it; tasks are moved from the task panel, not dragged.
- **Phones.** The client list and dashboard become one column: three count tiles (each opens its list) above the client list.
- **Speed.** The dashboard and the client list each load with one request; nothing slows down the first screen for clients.

## Phase

Phase 20 ([spec](../superpowers/specs/2026-10-16-phase-20-admin-home-design.md)). Needs Phase 18; the reminders card needs Phases 17 and 19.
