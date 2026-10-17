# Phase 34 — Internal admin group and the three-tab attachment picker: design

Date: 2026-10-17 · Status: **approved** by the owner on 2026-10-17: every row of the "Owner decisions" table is accepted as written (part P34-B built on `feat/admin-group`; the rest not yet). Plan: [2026-10-17-phase-34-admin-group.md](../plans/2026-10-17-phase-34-admin-group.md). Roadmap: [Phase 34](../../roadmap.md#phase-34--internal-admin-group). Builds on [Phase 33](2026-10-17-phase-33-projects-design.md) (projects dashboard, description editor), [Phase 32](2026-10-17-finance-module-design.md) (Finance), [Phase 28 attachments](2026-10-17-phase-28-reactions-and-attachments-design.md) (knowledge items in messages), [groups](../../product/groups.md), [client managers](../../product/client-managers.md), [notifications](../../product/notifications.md). Rules: [permissions](../../architecture/permissions.md), [performance](../../architecture/performance.md), [realtime](../../architecture/realtime.md).

## Owner's request (2026-10-17, translated from Ukrainian, intent kept)

1. **Internal admin chat (admin group).** Like a client group but **without the Tickets and Members tabs**, because its members are all admins. It also has the **projects dashboard** (Phase 33) and a **full finance administration** (Phase 32) of its own.
2. Admins can send **knowledge from the admin group anywhere**; the knowledge lists and pickers mark that an item comes from the admin group. Decide the visibility: who can open such an item when it is attached in a client chat (clients must not get admin-internal content unless intended).
3. **Attachment picker with three tabs** (with Phase 34 or before). The message attachment menu (today: knowledge items, Phase 28) gets three tabs: **Knowledge, Tasks, Tickets**. In client groups the tasks and tickets are only that client's; in the **admin group** tasks, tickets and knowledge of **all clients** can be attached, so its search has a **client filter**, and the filter marks **my clients** (the clients I manage) so I can tell them apart. Define the cards for an attached task or ticket, the permission checks on send and on display (like knowledge attachments), and the žiadateľ rules in ticket chats.

## Owner decisions

Approved by the owner on 2026-10-17. **B** marks a business choice.

| # | Question | Recommendation | Why |
|---|---|---|---|
| 1 | How is the admin group stored? | **A special row in `groups`** with `kind = 'admin'` (new column, default `'client'`), exactly one (partial unique index), created by the migration. Not a new entity. | Every per-group feature (chat, tasks, knowledge, finance, projects, files, reminders, rooms, notifications) is keyed by `group_id`; a group row gets all of them for free. A new entity would mean a second key in every one of those modules. |
| 2 | How are "all admins members" without membership rows? | **Nothing to add:** `canReadGroup` already lets every admin read every group, and admins never have `group_members` rows. The admin group simply has no client members, and every route that would add one refuses (`409 admin_group`). Readers = every active admin; **pickable people** (assignees, mentions, reminder recipients) = **every active admin** in the admin group (instead of "clients and managers"). | The current model already says it; only the pickable rule needs a branch on the kind. |
| 3 | **B** Its name. | **"eGrant tím"** (EN "eGrant team"), editable by admins like a group name, with the egrant logo by default. | Short, says who is inside; the owner may prefer "Interný chat". |
| 4 | Tabs. | **Prehľad (projects), Chat, Tasks, Knowledge** and, for finance admins, **Financie**. No Tickets, no Members (owner's words). | — |
| 5 | **B** Where it appears for admins. | **Pinned first** in the admin home's client list (its own section "Internal", above "My clients"), on `/groups` as a row above the client list, and in the header's group switcher. Its unread and "my tasks" counts work like a client's. Never on a client's screen. | It is the team's home; it must not be lost among 3 000 clients. |
| 6 | **B** Default notification mode. | **All messages** for every admin in the admin group (a computed default for `kind = 'admin'`, so no rows), changeable with the bell as everywhere. Elsewhere admins keep Mentions and replies. | A team chat that nobody hears is not a chat; the bell gives anyone the quiet option. |
| 7 | Is the admin group a "client" in global lists? | **No, but it is selectable.** It is left out of every "clients" count, the Groups page's count, bulk email audiences, the intake's client matching (it has no eGrant link), ticket client pickers and the finance rankings. In the **client filters** (global board, knowledge list, `/finance`) it is one extra option at the top, "eGrant tím", **included by default** in the global board and knowledge list (every admin is effectively its manager) and **excluded by default** on `/finance` (decision 13). | The team's own tasks belong on "my" boards; its money is not client revenue. |
| 8 | Tickets in the admin group. | **None.** Creating a ticket there, moving a ticket into it or matching one by intake is refused (`400 invalid_group`); its Tickets tab and route do not exist (`404`). "Watch tickets" does not apply. | Owner's words. |
| 9 | Invites and members. | **None:** no invite link (the join route answers `404` for its token, which is never shown), no "Add member", no managers (the manager routes answer `409 admin_group`). The Members route is `404`. | Members are all admins by definition. |
| 10 | **B** Who opens an admin-group knowledge item attached in a **client** chat? | **Only items explicitly marked "Shareable with clients"** can be attached outside the admin group. Admin-group items are created **admins-only by default**; the existing visibility switch is shown there as "Only eGrant" (default) / **"Shareable with clients"**. Attached in a client's chat (or a client's task, ticket, project or event description, Phase 33 §10), a shareable item is opened by **that chat's readers read-only** through the message (like a žiadateľ's read-through of Phase 28): no browsing the admin group, no edits, comments or reminders. Making it "Only eGrant" again turns every such card into "Item unavailable". | Nothing internal leaks by accident: sharing needs a conscious switch, shown again in the picker ("Clients of X will be able to open this item"). A live link (not a copy) keeps one version to correct. Alternative (not recommended): attaching **copies** the item into the client's knowledge base; safer against later edits, but duplicates and stale copies pile up. |
| 11 | Mark "from the admin group". | A small badge **"eGrant tím"** (the egrant mark and the name) on such items in the knowledge pickers, the global knowledge list, the attached cards in client chats (so the client sees it comes from the eGrant team) and the item's read-only view. | Owner's words; the same mark everywhere. |
| 12 | Who attaches what in the admin group? | Admins attach **any** knowledge item of **any** client (also admins-only items: the admin group's readers are admins, who read everything), any task and any ticket (also one without a client). | Readers of the admin group read all of it already; there is nothing to hide from them. |
| 13 | **B** Finance in the admin group. | The full Financie tab (documents, contracts, notes, work log, overview, rates as everywhere). **Time is asked** on its tasks like on a client's (internal work has a cost). The system-wide page treats it as decision 7 says: an option "eGrant tím (internal)" in the client filter, **off by default**, never in the rankings. Contracts there use the same fields; whether they mean income or expense is the owner's (see §8). | Internal time is real cost the owner wants to see; mixing it into client revenue and rankings would distort both. |
| 14 | Projects in the admin group. | The Phase 33 dashboard as in any group (internal projects with events), with its own tasks. **No cross-client links** in this phase (a client's ticket cannot sit on an internal event). | Projects belong to one group by construction (composite keys); cross-client planning can come later. |
| 15 | Three-tab picker before the admin group? | **Yes: build it first for client groups** (part P34-A), then extend it to the admin group (P34-D). | Owner allowed "with Phase 34 or before"; it is independent and useful at once. |
| 16 | **B** Limits. | Per message at most **5 knowledge items** (unchanged), **5 tasks** and **5 tickets**. A message may consist of attachments only. | Same rule as Phase 28; a message is not a list. |
| 17 | **B** Attached tasks and tickets for a **žiadateľ** in a ticket chat. | **Tasks: never shown** to a žiadateľ (stripped from their copy of the message, as the "Turned into tasks" links are today). **Tickets: shown only when they can read that ticket** (their own); otherwise stripped. No placeholder, so they do not learn that something was attached. A žiadateľ gets no picker. | Matches Phase 21's rule that a requester never sees the client's tasks, and Phase 28's that they see only what is meant for them. |
| 18 | Notifying the attached task's or ticket's people. | **No notification** when a task or ticket is attached to a message. | An attachment is a reference, not an assignment. |
| 19 | Cards. | **Task card:** done state, title, bucket, assignee avatars (up to 3), deadline (red when overdue), urgent mark, and the client in the admin group. **Ticket card:** `#number`, subject, status pill, riešitelia avatars, and the client (or "Without client") in the admin group. A click opens the task panel / the ticket page. A card the viewer can no longer reach shows "Task unavailable" / "Ticket unavailable". | Enough to recognise the item without opening it; the same pieces as the board and the ticket list. |

## 1. The admin group (part P34-B)

### 1.1 Data

Migration (groups module, number at merge time):

- `groups.kind text not null default 'client' check (kind in ('client','admin'))`.
- `groups.egrant_url` becomes **nullable**, with `check (kind = 'admin' or egrant_url is not null)`; its unique index stays (nulls do not collide). `findGroupByEgrantUrl` already ignores null.
- `create unique index groups_one_admin on groups ((true)) where kind = 'admin'`.
- `insert` the row: `kind = 'admin'`, name "eGrant tím", the egrant logo, a random `invite_token` that is never shown (the column stays not null), and its four fixed buckets (through the tasks module's `createGroupBuckets`, called by a small post-migration step in `ensureAdminGroup` at server start, idempotent like `ensureSuperadmin`, because migrations do not call services).
- `GroupDto` gains `kind`. Nothing else in the schema changes: chat channels, buckets, knowledge, finance, projects and files of the admin group are ordinary rows with its `group_id`.

### 1.2 Server rules (each in its own module's policy or service)

| module | change |
|---|---|
| groups | `isAdminGroup(group)`; `listPickablePeople` / `isPickablePerson` / `getGroupPeopleRoles`: in the admin group every active admin is pickable; the group list (`GET /api/groups`) returns it with `kind`; `managedGroupIdsOf` includes it for every admin (decision 7); the invite, join, add-member, invited, remove, restore, requesters and manager routes answer `409 admin_group` (`404` for the join token); the delete of a group refuses it. |
| tickets | `canCreateTicket`, the group move and the client pickers refuse the admin group (`400 invalid_group`); `GET /api/groups/:id/tickets` and the watch routes `404` for it; the global ticket list's client filter never lists it. |
| notifications | the effective mode for the admin group falls back to `all` before the user's default and the role default (decision 6); the per-group override and the bell work as everywhere. Digests treat it as a group ("eGrant tím"). |
| home | the sidebar returns it first in its own section (`internal`); the counts (unread, my tasks) as for a client. |
| bulk email | audiences exclude it (it has no clients anyway; a guard keeps an empty row out of the picker). |
| finance | rankings exclude it; the overview and work log accept it in `clients` only when asked (decision 13). |
| knowledge | §2. |
| projects | nothing: the dashboard works as for any group. |
| ai | Translate is never offered there (no eGrant link, so no foreign domain); Fix and Formal are. |

Realtime: unchanged. Admin sockets join `group:<id>` through `group:join` as for any group; no client socket can join it (no membership). `admin:activity` covers it.

### 1.3 Web

- `group-tabs.tsx` builds the list from `group.kind`: admin → Overview, Chat, Tasks, Knowledge (+ Finance); client → as today (+ Overview first, Phase 33). The router's guards answer the not-found screen for `/groups/<admin>/tickets` and `/members`.
- The group header shows the egrant mark and "eGrant tím" with no eGrant link and no invite box.
- The admin home's sidebar: an "Internal" section with the one row above "My clients"; phones: the row above the client list.
- `/groups`: a pinned row above the list, without the manager avatars or the members link; its edit dialog has name and logo only.
- Client filters (`components/client-filter.tsx`): the "eGrant tím" option at the top with the egrant mark (decision 7).
- Locales: `groups`, `group`, `adminHome` texts in nine languages.

## 2. Knowledge from the admin group (part P34-C)

- In the admin group the visibility control reads **"Only eGrant"** (`admins`, the default for a new item there) and **"Shareable with clients"** (`public`). The stored values stay `admins` / `public`, so every existing rule (folders cascade, files' `admins_only`, reminders' recipients) works unchanged; there are no clients in the admin group, so `public` there has no reader other than admins until the item is attached elsewhere.
- **`isShareableInto(item, folderChain, targetGroupId)`** (knowledge policy, replacing `isShareable` for every attach check): an item of the target group that is public in a public folder chain (Phase 28's rule), **or** an item of the admin group that is public in a public folder chain (decision 10), **or**, when the target is the admin group, any item of any group (decision 12).
- Chat (`checkKnowledgeIds`, `loadMessageKnowledge`) and the Phase 33 description links (`setLinkedItems`, `linkedItemCards`) call it with the channel's or subject's group. The re-check on display uses the same function, so an admin-group item switched back to "Only eGrant", moved into an admins-only folder or deleted shows "Item unavailable" in every client place at once.
- **Opening in a client place:** a reader of the client's group who is not an admin opens an admin-group item through the read-through routes (`GET /api/messages/:id/knowledge/:itemId` and the Phase 33 `GET /api/tickets/:id/knowledge/:itemId`, extended to tasks, projects and events as `GET /api/knowledge-links/:subjectKind/:subjectId/:itemId`): read-only, no reminders, no folder path beyond the item's own title, files through the read rule `fileOfAttachedKnowledge` (and its description-link twin), which now also accepts an admin-group file of a shareable item, never an admins-only or finance-only file. Admins open it in the usual knowledge dialog (they read every group).
- **The mark** (decision 11): `KnowledgeCardDto.source: 'admin_group' | null`; the cards, pickers and the global list show the "eGrant tím" badge.
- **The picker in a client group** gets a source switch: "This client" (default) and "eGrant tím" (only shareable items, with the badge). Picking an "Only eGrant" item is impossible (not listed); a short line under the switch says "Only items marked Shareable with clients are listed."
- **Making an item shareable from the picker** is not offered: an admin switches it in the item's own dialog, which states the consequence ("Clients of the groups where you attach it will be able to open it.").
- The global knowledge list (`/knowledge`) lists admin-group items under the "eGrant tím" filter option.

## 3. The three-tab attachment picker (parts P34-A and P34-D)

### 3.1 What the person sees

The composer's attach menu (next to the file button) opens one dialog (a sheet on phones) with three tabs: **Knowledge · Tasks · Tickets** (the last remembered per person). Each tab has a search field (from 2 characters; empty shows the newest), a list of results with checkboxes, and at the bottom the picked items as chips across all three tabs and **"Attach (n)"**. The composer shows the picked items as chips above the text, removable, as for knowledge today.

- **Client group** (its group chat, task chats and ticket chats): Knowledge = the Phase 28 list (this client's shareable items) plus the "eGrant tím" source of §2; Tasks = this client's tasks (open first, then completed; the bucket and assignees on each row); Tickets = this client's tickets (open first; number, subject, status).
- **Admin group:** every tab has a **client filter** at the top: the shared client filter component with "eGrant tím", then **My clients** (the clients I manage, marked with the manager dot used on `/groups`), then the other clients, searchable; default **all clients**; tickets add "Without client". Each result row names its client with the logo, and my clients' rows carry the same small mark. Knowledge also lists admins-only items there (decision 12), marked "Only eGrant".
- A **žiadateľ** sees no attach menu (as today).
- Editing a sent message never changes its attachments (Phase 28 rule kept), so the edit box has no attach menu.

### 3.2 Data (chat module, migration of part P34-A)

```
message_task_links   (message_id → messages on delete cascade, task_id text, position int, pk (message_id, task_id))
  idx (task_id)
message_ticket_links (message_id → messages on delete cascade, ticket_id text, position int, pk (message_id, ticket_id))
  idx (ticket_id)
```

No foreign key to `tasks` / `tickets` (the chat never touches their tables; a deleted one stays as an unavailable card), like `message_knowledge_items`.

### 3.3 Send and display checks

- Send body gains `taskIds` (≤ 5) and `ticketIds` (≤ 5) next to `knowledgeIds`. `canAttachWork(actor, channelGroup)`: `canReadGroup` on the channel's group (admins and the group's clients; a žiadateľ `403 forbidden`).
- **Tasks** (`tasks` module exports `attachableTaskCards(db, targetGroupId, ids)`): a task of the channel's group, or any task when the channel's group is the admin group. Anything else `400 invalid_attachment`.
- **Tickets** (`tickets` module exports `attachableTicketCards(db, targetGroupId, ids)`): a ticket of the channel's group, or any ticket (also without a client) in the admin group. Else `400 invalid_attachment`.
- **On display** every page re-checks in one batched call per kind with the same functions: a task moved away is impossible (tasks stay in their group), but a deleted task, a ticket moved to another client or a deleted ticket shows the unavailable card. The cards carry live values (bucket, done, status), so the message shows the current state.
- **Who sees the cards:** a channel's readers are its group's readers (all admins and the group's clients), who read every task and ticket of that group, so one DTO per room is right. In the admin group the readers are admins, who read everything. In a **ticket chat**, the žiadateľ's copy (`forReader`, already used for task links) drops `tasks` entirely and keeps only the tickets `canReadTicket` allows for them (decision 17); `emitMessage` sends the extra rooms that copy.
- **Opening:** a task card opens the task panel in its group (`/groups/<g>/tasks?task=<id>`, or over the current screen like the admin home does); a ticket card opens `/tickets/<id>`. The panel and page do their own permission checks.

### 3.4 Search endpoints for the picker

| tab | client group | admin group |
|---|---|---|
| Knowledge | `GET /api/groups/:id/knowledge?shareable=1&q=` (Phase 28) + `?source=admin_group` | `GET /api/knowledge?clients=&q=` (admins; exists) with `clients` including the admin group |
| Tasks | new `GET /api/groups/:id/tasks/search?q=&after=` (title trigram, 20 a page, open first) | new `GET /api/tasks/search?clients=&q=&after=` (`requireAdmin`) |
| Tickets | new `q` on `GET /api/groups/:id/tickets` (subject, number `#123` or `123`, body start) | the same `q` on `GET /api/tickets/global` with `clients` |

Task title search uses a trigram index `tasks (title gin_trgm_ops)` (ADR 0015 already allows trigram search); tickets a trigram index on `subject` and the number's exact match. Both in part P34-A's migration, with EXPLAIN cases.

### 3.5 Cards (web)

`features/chat/work-cards.tsx` (in the chat chunks): the task and ticket cards of decision 19, under the message next to the knowledge cards, in the order picked. The picker is the lazy `attach-picker` chunk (the current knowledge picker becomes its Knowledge tab without changing its own props, so the Phase 33 description field keeps using it alone).

## 4. Projects and the description editor in the admin group

Nothing new: the Phase 33 overview, timeline and description editor work as in a client group. The description editor's "Attach knowledge" in the admin group offers every client's knowledge with the client filter (decision 12), through the same picker component.

## 5. Realtime

No new events. Attached work cards update on the next page or refetch; the Phase 28 `chat:message` carries them. A ticket's or task's change does not re-emit messages that reference it (the card refreshes when the messages are refetched or scrolled back into a new page); acceptable for a reference, noted as a limit.

## 6. i18n

Texts in `chat` (the picker's tabs, the cards, the unavailable states), `knowledge` (the admin-group visibility words, the badge), `groups`, `group`, `adminHome` (the Internal section), `notifications` (the admin group in digests) in all nine languages; Slovak first, the rest machine-drafted for a native speaker (Phase 26 rule).

## 7. Performance

- The picker is lazy; the cards add about 1 kB to the chat chunk. The eager shell gains `GroupDto.kind` and a branch in the tabs (< 0.2 kB).
- One batched query per attachment kind per message page (`attachableTaskCards`, `attachableTicketCards`), so a message page stays a fixed number of queries.
- The search endpoints are paged (20) and indexed (trigram, `(group_id, …)`); EXPLAIN cases on the home test volume.

## 8. Finance in the admin group (part P34-E, after Phase 32 D)

- The Financie tab appears there for finance admins (it already appears for any group; P34-B's tab list keeps it).
- Time requests on its tasks as everywhere (decision 13): Phase 32's decision 4 ("an opt-out per client can come later if an internal group appears") is answered "no opt-out" by this recommendation; if the owner prefers not to ask time on internal tasks, the hook skips `kind = 'admin'` in one place (`onTaskCompleted`'s caller passes `askTime: false`).
- `/finance`: the client filter has "eGrant tím (internal)", off by default; the rankings never include it; the overview's "All clients" means all client groups.
- **Owner question:** internal contracts (suppliers, rent, licences) are expenses, not income. This phase shows them with the same "Paid / To be paid" words; a contract **direction** (income / expense) is proposed as a later change if the owner wants the admin group's money view to show costs.

## 9. Docs to update

New sections: `product/groups.md` ("The admin group"), `product/chat.md` (the three-tab picker and cards), `product/knowledge-base.md` (admin-group items and sharing), `product/admin-home.md` (the Internal section), `product/notifications.md` (its default mode), `product/finance.md` (internal option), `product/roles-and-access.md`; `architecture/data-model.md`, `permissions.md`, `realtime.md` (no new events; the žiadateľ copy), `overview.md` (API), `performance.md`; `glossary.md` (admin group, shareable with clients, attached work); ADR `00NN-admin-group-as-a-group-row.md` (decision 1 and its alternatives); `roadmap.md`.

## 10. End-to-end scenarios (`e2e/admin-group.spec.ts`, `e2e/chat-attachments.spec.ts`)

1. **The group.** Admin A opens "eGrant tím" from the top of the home sidebar: tabs Overview, Chat, Tasks, Knowledge; writes a message; admin B gets it as a notification under All messages; a client has no way to reach it (`/groups/<id>` not found).
2. **Assignees.** In the admin group's task form every active admin is offered, no client.
3. **Three tabs in a client chat.** A client attaches one of their tasks and one of their tickets to a group chat message; the admin sees both cards with live status; the ticket's žiadateľ, in a ticket chat where an admin attached a task and their own ticket, sees only the ticket card.
4. **Admin group cross-client.** Admin A, manager of client X, opens the picker in the admin group, sees X marked as theirs, filters to X, attaches X's ticket and Y's knowledge note (admins-only); admin B opens both.
5. **Sharing.** A creates an "Only eGrant" note in the admin group; it is not offered in X's picker; A switches it to "Shareable with clients"; it is offered under "eGrant tím"; attached in X's chat, X's client opens it read-only with the "eGrant tím" badge; A switches it back; the card shows "Item unavailable".
6. **No tickets.** Creating a ticket for the admin group through the API answers `400`; the intake never lands there.
7. **Finance** (P34-E). A finance admin logs time on an admin-group task; `/finance` rankings do not list the admin group; choosing "eGrant tím (internal)" shows its hours.

## 11. Out of scope (later)

Several admin groups (teams), linking client tasks or tickets to admin-group projects and events, a contract direction (income or expense), clients in an internal group, re-emitting messages when an attached task or ticket changes.
