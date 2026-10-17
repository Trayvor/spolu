# 0021 Ticket riešitelia, and watching tickets instead of managing the client

Date: 2026-10-17
Status: accepted

## Context
Ticket notifications went to the client's managers (Phase 21.6), who also followed every new ticket of their clients, and the dashboard's Tickets card listed "the tickets of the clients I manage". The owner asked (2026-10-17) for real ownership: zero or more riešitelia (assignees) per ticket, and a per-user, per-client "Watch tickets" switch that decides who hears about new tickets: on by default for clients, off for admins, on for a group's managers while they manage it, and an explicit choice kept.

## Decision
- Riešitelia are a table of the tickets module (`ticket_assignees`); adding one also adds a follower row in the same transaction, removing one leaves the follow. The policy is two pure functions (`canAssignTicket`, `canBeTicketAssignee`).
- "Watch tickets" stores only a user's explicit choice (`ticket_watch_settings`, `watching` boolean). The default is computed, not written: clients on, a group's active managers on, other admins off (`watch.ts`). This gives the "origin manager" behaviour of the notification mode (Phase 18) without rows to keep in step: becoming or stopping being a manager needs no write in the tickets module, and no data migration was needed for today's managers and clients.
- `ticket.created` goes to the watchers; managers no longer follow new tickets by themselves. The group notification mode still does not filter ticket board events (Off included).
- The dashboard's "mine" is: a riešiteľ of it, or no riešiteľ in a watched client, or no client.

## Consequences
- A manager who wants a ticket's later events follows it or becomes its riešiteľ; existing follower rows are kept as they were.
- Clients now get a "New ticket" notification for their group's tickets by default; they can untick "Watch tickets".
- Computing the default reads `group_managers` through the groups module (`listGroupPeople`, `isGroupManager`, `managedGroupsSql`), never its table directly.
