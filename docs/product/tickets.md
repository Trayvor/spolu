# Technical support (tickets)

Support tickets come from eGrant's API, from clients and from admins. Each ticket belongs to one client (group), found by the client's eGrant instance link, or to no client yet. A ticket has its own chat, can be followed, and can be turned into tasks with AI. A person who reported a ticket but is not a client of that group gets a narrow **ziadatel** (requester) membership that sees only their own tickets.

Design: [Phase 21 spec](../superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md). Phase 21 supersedes Phases 12 and 13.

## Requirements

- **Sources.**
  - eGrant sends a ticket to `POST /api/tickets/intake` with one shared Bearer key (`TICKETS_API_KEY`); the field list is in [integrations](integrations.md). Every field is optional, but a ticket needs a subject, a body or an area. An optional `request_id` makes retries safe: a repeat answers the first ticket and creates nothing.
  - A client creates a ticket in one of their groups and is its initiator.
  - An admin creates a ticket for any client and names the initiator (email, name, phone), as eGrant does.
  - A ziadatel never creates tickets.
- **Fields**: subject, question area, grant programme, text, due date, a URL, links to files (up to 20 external links, never downloaded), the instance link as received, the initiator's name, email and phone, the number `#123` (one sequence for all tickets), status, source (`api` or `manual`), who created it, when it was created, changed and resolved. A ticket created by hand can also carry uploaded files.
- **Client by instance link.** The instance link is compared with the groups' eGrant URLs by host: scheme, a leading `www.`, the path and the case do not matter (`https://WWW.X.egrant.sk/app` matches `https://x.egrant.sk`). No match, or no link: the ticket is saved **without a client**. Only admins see it (global view, "Without client"); an admin assigns a client by hand. Until then there is no requester account and no email.
- **Initiator** (for a ticket with a client, by its email; an existing account is found by the exact address, else by its mailbox: case, spaces and a `+tag` never matter, nor, for Gmail, the dots and `googlemail.com`, preferring an admin; so an admin's address in another spelling never makes a second account):
  - an admin's email: that admin;
  - a client of the group: that client;
  - anyone else (a client of another group, a ziadatel of another client, a new person): gets a **ziadatel** membership of this group; a new person gets an account first (named from the ticket, Slovak);
  - someone an admin removed from this group, or a disabled account: no account is linked, only the name and email are kept, no email is sent.
- **"Ticket created" email.** The initiator gets one email per ticket (in their language) with the number, the subject, the first lines of the text and **Open the ticket**, which goes through the code login to `/tickets/<id>`. It is sent whatever the notification settings, never twice (not on a later move), and not when the initiator created the ticket themselves.
- **Statuses**: New, In progress, Resolved. Only admins change the status and the fields; resolving records the time, reopening clears it.
- **Assign or move the client** (admins). The initiator is found again for the new client and the "Ticket created" email goes if it never went. Followers who cannot read the ticket in the new client are dropped. A ticket with tasks cannot move (`409 has_tasks`): its tasks live on that client's board.
- **Following.** The initiator, the client's managers and the admin who created the ticket by hand follow it from the start. Anyone who reads a ticket can follow or stop following it.
- **Notifications** (part 21.6, through the **Ticket board** notification group, by default email and push, whatever the group's bell mode; see [notifications](notifications.md)):
  - a new ticket, or one that gets or changes its client: the client's managers ("New ticket #123 · <client>"); a ticket without a client: every admin ("New ticket #123 without client");
  - a chat message (also a thread reply): the followers ("#123 <subject>", "Jana: text");
  - a status change, a field change, turning into tasks: the followers ("#123 is now In progress", "#123 was changed", "#123 turned into 2 tasks");
  - someone named in the ticket chat who reads the ticket gets it even without following;
  - only followers who can still read the ticket, never the person who made the change; every notification opens `/tickets/<id>`, and the email batches one email per ticket.
- **Who sees what**:

  | | admin | client of the group | ziadatel of the group |
  |---|---|---|---|
  | tickets of the group | all, also without client | all | only their own |
  | create | for any client | in this group | no |
  | change status, fields, client | yes | no | no |
  | follow | yes | yes | own tickets |

- **Lists**: the group's Tickets tab, **My tickets** (the initiator's tickets across their groups) and the admins' **global view** with the client filter (default the clients I manage, "All", "Without client", chosen clients). Filters: status (default Open = New and In progress; Resolved; All), area, "Following". Newest first, 50 per page.
- **Chat.** A ticket with a client has its own chat (part 21.3, see [chat](chat.md)): admins, the group's clients and the initiator write there; it moves with the ticket. A ticket without a client has none until a client is assigned.
- **Turn into tasks** (part 21.5, see [ai-task-split](ai-task-split.md)): admins and the group's clients turn a ticket, or a message of its chat, into task cards on the client's board with the Phase 9 AI split and review dialog. The cards link to the ticket ("Ticket: #123 subject" in the task panel), and the ticket lists them; the list stays live when such a task is renamed, completed, moved or deleted. A requester sees only "Turned into N tasks", without links, and never the action. A ticket without a client cannot be turned into tasks. The followers hear `ticket.tasks` ("#123 turned into 2 tasks").

## Screens (part 21.4)

- **Where.** Admins: "Tickets" in the header (after Tasks) opens the global view `/tickets`; every group has a **Tickets** tab (Chat, Tasks, Tickets, Knowledge, Members). Clients: the group's Tickets tab; a client who also reported tickets for another client gets "My tickets" in the header. A requester with no client membership lands on **My tickets** (`/tickets`) and the header shows only "Tickets" and the user menu.
- **Lists** (one component for the three places): a row per ticket with the number, the subject (or the first words of the text), the initiator, the area, on My tickets and the global view the client ("Without client" for none), the due date (red when overdue and not resolved), the status and an eye for a followed ticket. Filters: status (Open by default, Resolved, All), area (the areas seen in the list) and Following; the global view adds the client filter of the global board (default the clients I manage) and "Without client". Filters live in the URL. Rows change live: an edited ticket's row is replaced in place, a new ticket refetches the list, a moved one leaves the old client's tab.
- **Ticket page** `/tickets/<id>` (all three lists open it): the number, the status and the client over the subject; from 1024 px the details on the left (text, initiator with email and phone, area, programme, due date, link, eGrant instance, links to files, uploaded files, created and resolved times, the client, followers with Follow / Following, and the ticket's tasks: for admins and the group's clients a "Tasks" section with a link per task (a completed one struck through) and **Turn into tasks** (while the AI is on; nothing shows without tasks and AI), for a requester only "Turned into N tasks") and the ticket chat on the right; on a phone the details fold above the chat. Admins change the status from the header, edit the content in place ("Edit"), and change the client ("Change client"; a ticket with tasks stays). A ticket without a client shows "No client yet" with **Assign client** for admins and no chat. A ticket the viewer cannot read answers the not-found page.
- **New ticket** (the group tab and, for admins, the global view): a dialog with the content fields, links to files (one per line) and uploaded files. Admins choose the client (fixed from a group's tab) and name the initiator by email, name and phone ("They get an email and can follow the ticket in Spolu."); a client is the initiator. After creating, the ticket's page opens.
- **Files in the ticket chat.** Everyone who writes in a ticket chat can attach files; they upload through the ticket (`POST /api/tickets/:id/files`, into the client's files), so the requester, who cannot upload to the group, can attach too. Files uploaded with the form are readable by whoever reads the ticket, also the requester, and move with the ticket.
- **Requesters** on the Members tab (see `groups.md`) and the task panel's line "Ticket: #123 subject" linking to the ticket, for tasks made from a ticket.
- **Ticket chat messages** of admins and clients have "Turn into tasks" in the message menu and "Turned into tasks:" links under them, like the group chat; the cards link both the message and the ticket. A requester gets neither, and the server sends them the chat's messages without task links.

## Phase

Phase 21. Built so far: part 21.1 (memberships), part 21.2 (server core: intake API, manual creation, initiator, "Ticket created" email, statuses and fields, assigning the client, following, lists), part 21.3 (ticket chat, server), part 21.4 (screens, above, with the ticket upload route, the requesters list and the task line), part 21.5 (ticket to tasks), part 21.6 (notifications) and part 21.7 (e2e and wrap-up: the intake's `request_id`, the eGrant [integration guide](../integrations/egrant-ticket-intake.md)). Phase 21 is done (local). End-to-end tests: `e2e/ticket-screens.spec.ts` (screens) and `e2e/tickets.spec.ts` (the whole flow: intake and retry, the "Ticket created" email and its login link, the requester sees only their ticket, chat, status, the requester's notification email, tasks, and the ticket's task list staying live when its tasks are completed or deleted).
