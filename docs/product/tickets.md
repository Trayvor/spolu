# Technical support (tickets)

Support tickets come from eGrant's API, from clients and from admins. Each ticket belongs to one client (group), found by the client's eGrant instance link, or to no client yet. A ticket has its own chat, can be followed, and can be turned into tasks with AI. A person who reported a ticket but is not a client of that group gets a narrow **ziadatel** (requester) membership that sees only their own tickets.

Design: [Phase 21 spec](../superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md). Phase 21 supersedes Phases 12 and 13.

## Requirements

- **Sources.**
  - eGrant sends a ticket to `POST /api/tickets/intake` with one shared Bearer key (`TICKETS_API_KEY`); the field list is in [integrations](integrations.md). Every field is optional, but a ticket needs a subject, a body or an area.
  - A client creates a ticket in one of their groups and is its initiator.
  - An admin creates a ticket for any client and names the initiator (email, name, phone), as eGrant does.
  - A ziadatel never creates tickets.
- **Fields**: subject, question area, grant programme, text, due date, a URL, links to files (up to 20 external links, never downloaded), the instance link as received, the initiator's name, email and phone, the number `#123` (one sequence for all tickets), status, source (`api` or `manual`), who created it, when it was created, changed and resolved. A ticket created by hand can also carry uploaded files.
- **Client by instance link.** The instance link is compared with the groups' eGrant URLs by host: scheme, a leading `www.`, the path and the case do not matter (`https://WWW.X.egrant.sk/app` matches `https://x.egrant.sk`). No match, or no link: the ticket is saved **without a client**. Only admins see it (global view, "Without client"); an admin assigns a client by hand. Until then there is no requester account and no email.
- **Initiator** (for a ticket with a client, by its email):
  - an admin's email: that admin;
  - a client of the group: that client;
  - anyone else (a client of another group, a ziadatel of another client, a new person): gets a **ziadatel** membership of this group; a new person gets an account first (named from the ticket, Slovak);
  - someone an admin removed from this group, or a disabled account: no account is linked, only the name and email are kept, no email is sent.
- **"Ticket created" email.** The initiator gets one email per ticket (in their language) with the number, the subject, the first lines of the text and **Open the ticket**, which goes through the code login to `/tickets/<id>`. It is sent whatever the notification settings, never twice (not on a later move), and not when the initiator created the ticket themselves.
- **Statuses**: New, In progress, Resolved. Only admins change the status and the fields; resolving records the time, reopening clears it.
- **Assign or move the client** (admins). The initiator is found again for the new client and the "Ticket created" email goes if it never went. Followers who cannot read the ticket in the new client are dropped. A ticket with tasks cannot move (`409 has_tasks`): its tasks live on that client's board.
- **Following.** The initiator, the client's managers and the admin who created the ticket by hand follow it from the start. Anyone who reads a ticket can follow or stop following it. Notifications to followers come in part 21.6 (through the `tickets` notification group of brief item C).
- **Who sees what**:

  | | admin | client of the group | ziadatel of the group |
  |---|---|---|---|
  | tickets of the group | all, also without client | all | only their own |
  | create | for any client | in this group | no |
  | change status, fields, client | yes | no | no |
  | follow | yes | yes | own tickets |

- **Lists**: the group's Tickets tab, **My tickets** (the initiator's tickets across their groups) and the admins' **global view** with the client filter (default the clients I manage, "All", "Without client", chosen clients). Filters: status (default Open = New and In progress; Resolved; All), area, "Following". Newest first, 50 per page.
- **Chat.** A ticket with a client has its own chat (part 21.3, see [chat](chat.md)): admins, the group's clients and the initiator write there; it moves with the ticket. A ticket without a client has none until a client is assigned.
- A ticket can be turned into tasks with AI (part 21.5).

## Phase

Phase 21. Built so far: part 21.1 (memberships), part 21.2 (server core: intake API, manual creation, initiator, "Ticket created" email, statuses and fields, assigning the client, following, lists) and part 21.3 (ticket chat, server). Parts 21.4–21.7: screens, ticket to tasks, notifications, e2e.
