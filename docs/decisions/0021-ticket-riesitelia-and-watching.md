# 0021 Ticket riešitelia, and watching tickets instead of managing the client

Date: 2026-10-17
Status: accepted, amended 2026-10-17 (watching until assigned, no per-ticket following)

## Context
Ticket notifications went to the client's managers (Phase 21.6), who also followed every new ticket of their clients, and the dashboard's Tickets card listed "the tickets of the clients I manage". The owner asked (2026-10-17) for real ownership: zero or more riešitelia (assignees) per ticket, and a per-user, per-client "Watch tickets" switch that decides who hears about new tickets: on by default for clients, off for admins, on for a group's managers while they manage it, and an explicit choice kept.

## Decision
- Riešitelia are a table of the tickets module (`ticket_assignees`); adding one also added a follower row (until the amendment below removed following). The policy is two pure functions (`canAssignTicket`, `canBeTicketAssignee`).
- "Watch tickets" stores only a user's explicit choice (`ticket_watch_settings`, `watching` boolean). The default is computed, not written: clients on, a group's active managers on, other admins off (`watch.ts`). This gives the "origin manager" behaviour of the notification mode (Phase 18) without rows to keep in step: becoming or stopping being a manager needs no write in the tickets module, and no data migration was needed for today's managers and clients.
- `ticket.created` goes to the watchers; managers no longer follow new tickets by themselves. The group notification mode still does not filter ticket board events (Off included).
- The dashboard's "mine" is: a riešiteľ of it, or no riešiteľ in a watched client, or no client.

## Consequences
- A manager who wants a ticket's later events follows it or becomes its riešiteľ; existing follower rows are kept as they were.
- Clients now get a "New ticket" notification for their group's tickets by default; they can untick "Watch tickets".
- Computing the default reads `group_managers` through the groups module (`listGroupPeople`, `isGroupManager`, `managedGroupsSql`), never its table directly.

## Amendment (2026-10-17): watch until assigned, no per-ticket following

### Context
Following tickets one by one (initiator, creating admin and new riešiteľ automatically, anyone by the Follow button) made two overlapping ways to hear about a ticket. The owner decided (2026-10-17) that "Watch tickets" is the only switch, per client, and that a ticket with a riešiteľ belongs to its riešitelia.

### Decision
- **Who answers a ticket** (`ticketOwnerIds`, `modules/tickets/audience.ts`): its riešitelia once it has at least one; while it has none, the people who watch its client's tickets (`watch.ts`, unchanged defaults), or every active admin for a ticket without a client.
- **Who hears an update** (chat messages, status and field changes, turned into tasks; `ticketAudienceIds`): those owners plus the ticket's initiator, only people who can still read the ticket, never the person who made the change. `@all` in the ticket chat reaches the same people.
- A new ticket, or one that gets or changes its client, goes to the watchers as `ticket.created` (every admin as `ticket.unassigned` without a client) while it has no riešiteľ; one that already has riešitelia goes to them as `ticket.updated`. A new riešiteľ still hears `ticket.assigned`; removing one notifies nobody, and removing the last hands the updates back to the watchers.
- **Owner decisions** (confirmed 2026-10-17): the initiator keeps getting the updates (admin replies in the chat, status changes) so a requester always hears back, and the "Ticket created" email as before; someone named (@mention) in the ticket chat who can read the ticket still gets the mention; while a ticket has no client and no riešiteľ, its updates go to every admin.
- Per-ticket following is removed: the Follow button, the followers list, the "Following" list filter and row marker, `PUT`/`DELETE /api/tickets/:id/follow`, `GET /api/tickets/:id/followers`, the DTO's `following`, and the `ticket_followers` table (migration `0033_drop_ticket_followers`).
- The dashboard's Tickets card and header count show the same tickets the updates notify: a riešiteľ of it; no riešiteľ in a watched client; no client and no riešiteľ (a ticket without a client that has a riešiteľ is no longer on every admin's card).

### Consequences
- Existing follower rows are dropped with the table; a manager who wants a ticket's updates after someone took it becomes one of its riešitelia.
- A client of the group watches by default, so they get every update of their client's tickets until someone is assigned.
- No new dependency; the rules are one module file with integration tests (`notify.test.ts`).

