# Spolu — Phase 21: Tickets and the ziadatel role (design)

Date: 2026-10-16 · Status: approved by the owner (2026-10-16)

Owner brief: [2026-10-16-next-work.md](../briefs/2026-10-16-next-work.md), item B. It **supersedes Phases 12 and 13** of the [roadmap](../../roadmap.md); what was useful from them is kept (URL normalization, three statuses, the global list with filters, manual assignment to a client, admin notification about a new ticket). Their reply-by-email with the manager in copy is replaced by ticket chat plus notifications (decision 6).

Builds on: [Phase 3](2026-10-15-phase-3-groups-and-invites-design.md) (groups, invites, `egrant-url.ts`), [Phase 5](2026-10-15-phase-5-group-chat-design.md) and [Phase 9](2026-10-15-phase-9-task-chat-and-ai-design.md) (conversation component, task chat, "Turn into tasks"), [Phase 6](2026-10-16-phase-6-notifications-design.md) (notification events), [Phase 18](2026-10-16-phase-18-client-managers-design.md) (managers), [Phase 20](2026-10-16-phase-20-admin-home-design.md) (client filter of the global board). Depends on brief item **C** (notification groups) for its notification part only; see [What B expects from C](#what-b-expects-from-c).

## Goal

eGrant (and people at eGrant) can open support tickets in Spolu. Each ticket lands at the right client by its instance link, has its own chat, can be followed, and can be turned into tasks with AI. People who report a problem but are not the client's users yet get a narrow account (`ziadatel`, "requester") that sees only their own tickets. Clients may belong to several groups.

## Owner decisions (2026-10-16, this brainstorm)

| # | question | decision |
|---|---|---|
| 1 | Ticket whose instance link is missing or matches no client | Saved **without a client**, visible to admins only (global view, filter "Without client"); an admin assigns a client by hand. Until then there is no chat, no requester account and no email to the requester. |
| 2, 11 | How to model ziadatel | Role **on the membership**: `group_members(user, group, role = client \| ziadatel)`. One person can be a client of X and Y and a ziadatel of Z. `user.role` stays `superadmin \| admin \| client` (every non-admin is `client` there). |
| 11 | Clients in several groups | Yes (owner addition). A client may belong to several groups; built as its own first part. |
| 3 | Form of the ticket board | A **list** with filters, not a kanban. Statuses **New / In progress / Resolved**. |
| 4 | What a client sees | **All tickets of their group**; writes in their chats; follows; **creates tickets** (initiator = themselves). Does not change status or fields. A ziadatel sees only tickets where they are the initiator. |
| 5 | Following | Automatic followers: the initiator, the client's managers, the admin who created the ticket by hand. Plus anyone who presses "Follow". A ticket without a client notifies **all admins**. |
| 6 | How the requester hears about replies | Through the **"ticket board" notification group of item C** (default push and email). The only direct email is "Ticket created", always sent. Replies are written in the ticket chat, not by email. |
| 7 | Ticket to tasks | "Turn into tasks" on the ticket and on ticket chat messages, for admins and the group's clients. The task links to the ticket, the ticket lists its tasks. A ziadatel sees only "Turned into N tasks", without links. A ticket without a client cannot be turned into tasks. |
| 8 | "Links to files" from the API | Stored as a list of external URLs and shown as links. The server never downloads them. Files can be uploaded in the ticket chat and in the manual form. |
| 9 | Navigation | Clients: a **Tickets** tab in the group. Ziadatel-only people: a **My tickets** page across all their clients. Admins: the Tickets tab in each group plus a global **/tickets** view. |
| 10 | A ziadatel who becomes a client | The group's invite link turns their ziadatel membership in **that** group into a client membership. Other memberships are untouched. No separate "promote" button. |

From the brief (owner answers of 2026-10-16): the ticket API is authenticated by one shared secret key (Bearer) in the server env; a ziadatel logs in with the same email code as clients, and the ticket email links to the login.

## Controller rulings (technical; the owner may override)

- The module is `modules/tickets` (server) and `features/tickets` (web), following the `new-module` skill.
- The ticket chat is a third channel kind, `'ticket'`, in the existing chat module (approach 1 of the brainstorm). Rejected: tickets as a special task (breaks the ziadatel's permissions and the statuses), and a separate simple comment thread (duplicates the conversation component and loses "Turn into tasks" on messages).
- Ticket numbers are one sequence across the system (`#123`), shown everywhere a ticket is named.
- `TICKETS_API_KEY` in `.env.example` (empty = intake disabled, `503 intake_disabled`). Compared in constant time.
- Phases 12 and 13 become "merged into 21" in the roadmap; `product/tickets.md` is rewritten by this phase.

## 1. Memberships: clients in several groups (part 21.1)

Today `group_members` has one row per client (`user_id` is the primary key) and every module asks `getMembershipGroupId(user)`. This part changes that before any ticket code.

**Schema.**
- `group_members`: primary key `(user_id, group_id)`; new `role text not null default 'client'` with check `role in ('client', 'ziadatel')`; new `removed_at timestamptz` (null = active). Indexes: `(group_id, role) where removed_at is null`, `(user_id) where removed_at is null`.
- Migration keeps every existing row as `role = 'client'`; existing disabled clients get `removed_at = disabled_at` on their one membership. `user.disabled_at` stays set for accounts with no active membership left.
- New table `pending_invites (user_id pk, group_id, created_at)`: the invite a person used before signing in.

**Service (`groups/service.ts`).**
- `getMembership(db, userId, groupId) → { role, removedAt } | null` and `listMemberships(db, userId) → [{ groupId, role }]` (active only). `getMembershipGroupId` is removed; every caller moves to one of these.
- `addMembership(db, userId, groupId, role)`: insert, or update a ziadatel row to client (never client to ziadatel), or reactivate only when the caller is an admin restoring it.

**Policy.** `canReadGroup(actor, groupId, actorGroupIds)` = admin, or `groupId` among the actor's active **client** memberships (`clientGroupIds`, one indexed query per request). A ziadatel membership never opens the group (chat, tasks, knowledge, members all answer `404`). Every module policy that took `actorGroupId` now takes `actorGroupIds`.

**Removal.** "Remove from group" (Members tab) sets `removed_at` on that membership only and drops that group's room from the person's sockets; when no active membership is left the account is disabled and signed out everywhere (today's behaviour), so it gets no login code. Restore clears `removed_at` and re-enables the account.

**Invites.** The invite flow adds a client membership to the group (or turns a ziadatel membership in it into client). The rule "a client belongs to exactly one group, other links do nothing" is dropped. As built: typing an email on an invite only stores it as the person's pending invite (`pending_invites`, the latest wins); it becomes a membership when they sign in with the code sent to that email, so nobody can add someone else's account to a group by knowing the link and the email.

**Realtime.** A client socket joins the rooms of all its active client groups, and `user:<id>`. Membership changes join or leave rooms live.

**API and web.** `GET /api/me` returns `groups: [{ id, name, role }]` instead of `groupId`. Client home `/`: one client group → redirect into it (today); several → a "My groups" list (logos, names, unread counts); none but ziadatel memberships → `/tickets`. The header gets a group switcher for clients with more than one group. Mentions, assignees and @all stay per group (the group's clients and managers), so a client of two groups is pickable in both.

**Product docs touched:** `groups.md`, `auth.md`, `roles-and-access.md`, `architecture/permissions.md`, `architecture/data-model.md`, `architecture/realtime.md`.

## 2. Tickets: data and permissions

**`tickets`**

| column | type | note |
|---|---|---|
| `id` | text pk | |
| `number` | bigint, unique, from a sequence | shown as `#123` |
| `group_id` | text null → `groups` (cascade) | null = without client |
| `status` | text, check `new \| in_progress \| resolved` | default `new` |
| `source` | text, check `api \| manual` | |
| `requester_user_id` | text null → `user` (set null) | the initiator's account, when there is one |
| `requester_name`, `requester_email`, `requester_phone` | text null | as received; kept even when the account exists |
| `area` | text null | "question area" |
| `subject` | text null | |
| `programme` | text null | grant programme name |
| `body` | text null | |
| `due_date` | date null | |
| `url` | text null | http(s) only |
| `instance_url` | text null | as received; matched after normalization |
| `file_links` | text[] not null default `{}` | ≤ 20 http(s) URLs, never fetched |
| `created_by` | text null → `user` | null for the API |
| `created_at`, `updated_at`, `resolved_at` | timestamptz | `resolved_at` set on Resolved, cleared when reopened |

Indexes: `(group_id, status, created_at desc)`, `(requester_user_id, created_at desc)`, `(created_at desc) where group_id is null`, `(due_date) where status <> 'resolved'`. Lengths: subject 300, area and programme 200, name 200, email 254, phone 50, URLs 2048 (the shared `MAX_URL_LENGTH`), body 20 000.

**`ticket_followers`**: `(ticket_id, user_id)` pk, `source text check in ('auto', 'manual')`, `created_at`; index `(user_id)`.

**`ticket_attachments`**: `(ticket_id, file_id)`, for files uploaded in the manual form (the files module, group-scoped; files of a ticket without a client are not possible, since the manual form always has a client).

**`tasks.source_ticket_id`** text null → `tickets` (set null), partial index `where source_ticket_id is not null`. Set by the tickets module through the tasks service (`createTasksFromSource`), never by touching the table directly.

**`channels`**: `kind` check gains `'ticket'`; new `ticket_id` → `tickets` (cascade), unique where not null; check `(kind = 'ticket') = (ticket_id is not null)`. Created when the ticket gets a client; moved with the ticket when the client changes (`channels.group_id` updated in the same transaction).

**Policy (`tickets/policy.ts`, test-first).** The actor's membership in the ticket's group is passed in.

| capability | admin | client of the group | ziadatel of the group | anyone else |
|---|---|---|---|---|
| Read a ticket | every ticket, also without client | every ticket of the group | only where `requester_user_id` = self | 404 |
| Write in its chat, follow / unfollow | yes | yes | yes, own tickets | 404 |
| Create a ticket | yes, any client, sets the initiator | yes, in this group, initiator = self | no (403) | — |
| Change status, fields, client | yes | 403 | 403 | 404 |
| Turn into tasks | yes | yes | 403 | 404 |
| Global view `/api/tickets/global` | yes | 403 | 403 | 401 without session |

A ziadatel's chat in the ticket channel is readable because `canReadChannel` for `kind = 'ticket'` delegates to `canReadTicket` (as the task chat delegates to the task). Mentions inside a ticket chat offer the group's clients and managers plus the ticket's initiator; @all reaches the ticket's followers only.

## 3. Flows

**Intake** — `POST /api/tickets/intake`, header `Authorization: Bearer <TICKETS_API_KEY>`. Wrong or missing key: `401`; key not configured: `503 intake_disabled`; more than 60 requests a minute: `429`. JSON body, every field optional (zod in `packages/shared`):

| field | meaning |
|---|---|
| `requester_name` | requester's name |
| `email` | requester's email |
| `phone` | requester's phone number |
| `area` | question area |
| `subject` | subject (title) |
| `programme` | grant programme name |
| `body` | text |
| `file_links` | array of URLs to files |
| `due_date` | `YYYY-MM-DD` |
| `url` | a URL link |
| `instance_url` | the client's eGrant instance |

A body with none of `subject`, `body`, `area` set answers `400 validation_failed` (an empty ticket helps no one). Unknown fields are ignored. A malformed field (bad email, URL, date) answers `400` naming it. Answer: `201 { "id": "...", "number": 123 }`. This table is copied into `product/integrations.md` so the owner can send it to the eGrant team.

1. Normalize `instance_url` with `groups/egrant-url.ts` and look the group up. No match → save without client; event `ticket.unassigned` to every admin; stop.
2. Match and an email → **`resolveRequester(groupId, email, name)`**, one function used by intake, manual creation and assignment:
   - the email is an admin's → initiator = that admin, no membership;
   - an active client membership in this group → initiator = that user;
   - a membership in this group removed by an admin → no account link; the name and email stay as text; no email is sent;
   - otherwise (an account with no membership here, or no account) → add a **ziadatel** membership in this group; a new account gets `role = 'client'`, the name from the ticket and the language `sk`;
   - no email → no initiator account, no email.
3. Auto followers: the initiator account and the group's active managers. Event `ticket.created` to the managers. The initiator gets the **"Ticket created"** email (their language; subject, `#number`, the first lines of the text, an **Open the ticket** button to `/login?redirect=/tickets/<id>`). It is sent whatever the notification settings, because it is the person's first contact and their way in; it is not sent when the initiator created the ticket themselves.

**Manual creation** — `POST /api/tickets`. An admin chooses the client (required), the initiator's email and name, and the same fields plus uploaded files; a client creates in their group's Tickets tab and is the initiator. Steps 2–3 run, and the creating admin is an auto follower too. The creator gets no event about their own ticket.

**Edit** — `PATCH /api/tickets/:id` (admins): fields and status. Event `ticket.status` on a status change, `ticket.updated` on any other field change (one event per save).

**Assign or move the client** — `PUT /api/tickets/:id/group` (admins). A ticket without a client gets its chat channel; a moved ticket moves its channel. Steps 2–3 run for the new group (the "Ticket created" email is sent once per ticket: only if it was never sent). Followers who cannot read the ticket in its new group are dropped. A ticket with tasks cannot move (`409 has_tasks`): tasks belong to the old group's board.

**Follow** — `PUT` / `DELETE /api/tickets/:id/follow` act on the signed-in user only.

**Turn into tasks** — the ticket's text (subject, area, programme, body, due date, file link names) goes through the Phase 9 AI split (`ai/split.ts` with a ticket source); the same review dialog; approved cards are created on the ticket group's board with `source_ticket_id` (and `source_message_id` when started from a ticket chat message). The ticket's due date is proposed as the cards' deadline. Event `ticket.tasks` to the followers.

## 4. Notifications

Events are written to `notification_events` (Phase 6) with `group_id` = the ticket's group. Recipients are the ticket's followers who can still read it; the actor never gets their own event; a message already read gets none.

| kind | sent to | push text (sk/en in the locale files) |
|---|---|---|
| `ticket.created` | the group's managers (followers) | "New ticket #123 · <client>" + subject |
| `ticket.unassigned` | all admins | "New ticket #123 without client" + subject |
| `ticket.message` | followers | "#123 <subject>" + "Jana: text" |
| `ticket.status` | followers | "#123 is now In progress" |
| `ticket.updated` | followers | "#123 was changed" |
| `ticket.tasks` | followers | "#123 turned into 2 tasks" |

A mention in a ticket chat (`chat.mention`) also reaches the mentioned person if they can read the ticket, even if they do not follow it. Every ticket push opens `/tickets/<id>` and uses the device tag `ticket:<id>`.

### What B expects from C

Item C (notification groups in the profile) is built in parallel: spec [2026-10-16-notification-groups-design.md](2026-10-16-notification-groups-design.md), branch `claude/admiring-cerf-lgc5tq`. Its session confirmed this contract on 2026-10-16, and C merged as PR #5 with it; part 21.6 still re-checks each point against the code first.

1. Group keys `chat | tasks | tickets | knowledge`, channels `email | push | both | none`; defaults `tickets = both`, the others `push`. Stored in `user.notification_channels` (jsonb; a missing key means the default).
2. B adds its kinds `ticket.created`, `ticket.unassigned`, `ticket.message`, `ticket.status`, `ticket.updated`, `ticket.tasks` to `NotificationKinds` (shared), to `KIND_RANK` (`notifications/decide.ts`) and to `NOTIFICATION_GROUP_OF` (`notifications/categories.ts`) as `'tickets'`. An unknown kind maps to `null`: the event is recorded as delivered and skipped.
3. The `tickets` group passes every bell mode, Off included; only its channel decides. C requires the recipient to belong to the event's group (`groupId`). **Two cases B needs from that check**, both covered by merged C (PR #5): a `tickets` event with `groupId = null` (`ticket.unassigned`, to admins) skips the membership check and gets its own digest email; and who belongs to the event's group comes from `notificationAudience(db, groupId, group)` in `notifications/categories.ts` (today `listGroupPeople`), which 21.1 changes so that `ziadatel` members count for `tickets` (and only for it).
4. Profile visibility comes from `visibleCategoriesFor(db, user)` in `notifications/categories.ts` (today all four groups). Part 21.1 changes only that function: for `isRequesterOnly(user)` it returns `['tickets']`. The API and the page already show only that list.
5. Digest: B adds a branch for ticket kinds to `digestEntry(row, ctx) → { line, url, button, topic } | null` (`notifications/digest-entries.ts`): line "#123 <subject>: Jana: text", url `/tickets/<id>`, button "Open ticket", topic (what the subject "N new messages in <topic>" names) e.g. "Ticket #123". Emails are split by `url`, so each ticket gets its own email. For an event without a client group `ctx.groupId` and `ctx.groupName` are null.
6. Push: B adds a branch to `buildPushPayload` (`notifications/push-content.ts`) and puts the number, subject, author and excerpt into the payload when recording (`recordNotifications`).
7. Migrations: C's `notification_channels` migration comes from `db:generate`. Whichever branch merges second regenerates its own migration.

## 5. Interface

Design replicates egrant.sk; every web part starts with the `frontend-design` skill. Texts live in a lazy `tickets` namespace (sk, en). All ticket screens are lazy routes.

- **Ticket list** — one component for the group tab, My tickets and the global view. Row: `#number`, subject (or the first words of the text), initiator, area, due date (red when overdue and not resolved), status badge, a "following" mark; on My tickets and the global view also the client. Filters: status (default "Open" = New + In progress; "Resolved"; "All"), area (free values seen in the data), "Following". The global view adds the client filter of Phase 20 (default "My clients", "All clients", "Without client", chosen clients). Newest first; cursor pagination, 50 per page.
- **Ticket page** `/tickets/:id` (also opened from the group tab) — on a computer two columns: left the fields (subject, status, initiator with email and phone, area, programme, due date, URL, instance, file links, created and resolved times), followers with **Follow / Unfollow**, linked tasks (or "Turned into N tasks" for a ziadatel), **Turn into tasks**; right the chat. On a phone the fields collapse into a summary above the chat. Admins edit fields and status in place and choose or change the client. A ticket without a client shows "No client yet" with **Assign client** and no chat.
- **New ticket** — a dialog with the same fields and file uploads; for admins also the client and the initiator's email and name (a hint: "They get an email and can follow the ticket in Spolu").
- **Ziadatel-only shell** — the header shows only Tickets and the user menu; `/` goes to `/tickets` (My tickets); any group URL answers not found.
- **Members tab** — a section "Requesters" (the group's ziadatel members) below the clients, with remove and restore for admins.
- **Task panel** — a line "Ticket: #123 <subject>" for people who can read the ticket.
- **Groups for multi-group clients** — "My groups" at `/` and the header switcher (part 21.1).

Realtime: `ticket:created`, `ticket:updated` and `ticket:moved` (a ticket left this group) go to `group:<id>` (clients and admins of the group) and to `user:<id>` of the initiator when they are a ziadatel; tickets without a client go to the `admins` room. Ticket chat messages use the existing chat events in the channel's room; a ziadatel's socket joins the ticket channel rooms of their own tickets.

## 6. Performance

Every list is one indexed query with cursor pagination; the followers' "following" mark is a left join on `ticket_followers (ticket_id, user_id)`; linked tasks are one query by `source_ticket_id`. No N+1 in the requester resolution (one lookup by email, one by membership). The ticket screens add nothing to the eager chunk except the route definitions and the header link (measured and recorded in the part that adds them).

## 7. Testing

- Test-first: `tickets/policy.ts` (every cell of the table above), `resolveRequester` (each branch), membership functions and `canReadGroup` with several memberships and with ziadatel memberships.
- Integration (Vitest + test DB): intake with and without key, disabled intake, URL normalization match and no match, manual creation by admin and client, ziadatel cannot reach the group's chat, tasks or knowledge (404), moving a ticket, `409 has_tasks`, following, the "Ticket created" email in the fake sender, events per kind.
- Web: list filters, ticket page per role, the ziadatel shell, the group switcher.
- e2e (`e2e/tickets.spec.ts`): eGrant posts a ticket → the new requester's "Ticket created" email arrives in Mailpit → they log in with a code, see only their ticket and write in its chat → an admin replies and sets In progress → the admin turns the ticket into 2 tasks and both link back to it. A second spec covers a client in two groups switching between them.

## 8. Parts

Each part is one pull request. Details and the ready-to-paste session prompts are in the [plan](../plans/2026-10-16-phase-21-tickets-and-requesters.md).

| part | content | waits for |
|---|---|---|
| 21.1 | Memberships: clients in several groups, role on the membership, removal per membership | — |
| 21.2 | Tickets core (server): tables, intake API, manual creation, `resolveRequester`, policy, edit, assign client, "Ticket created" email | 21.1 |
| 21.3 | Ticket chat: channel kind `ticket`, permissions, realtime | 21.2 |
| 21.4 | Web: lists, ticket page, new-ticket dialog, ziadatel shell, Requesters section | 21.2 (chat column switches on with 21.3) |
| 21.5 | Ticket to tasks with AI | 21.3, 21.4 |
| 21.6 | Following and notifications | 21.2 and item C |
| 21.7 | e2e, product docs, roadmap status | all |

21.3, 21.4 and 21.6 can run in parallel once 21.2 has merged (21.6 also needs C).

## Out of scope

Importing email replies into a ticket; downloading files from `file_links`; SLA timers; ticket priority; deleting tickets (an admin resolves them); a requester self-service form in Spolu (tickets come from eGrant, from clients and from admins); direct messages for ziadatel people (Phase 7 decides).
