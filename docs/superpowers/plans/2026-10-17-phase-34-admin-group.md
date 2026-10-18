# Phase 34 — Internal admin group and the three-tab attachment picker: plan

Spec: [2026-10-17-phase-34-admin-group-design.md](../specs/2026-10-17-phase-34-admin-group-design.md) (read its "Owner decisions" first). Status: **approved** by the owner on 2026-10-17 (every decision as written); ready to start. The joint merge order with Phases 32 and 33 is in the [Phase 33 plan](2026-10-17-phase-33-projects.md#joint-merge-order-of-phases-32-rest-33-and-34).

Five pull requests. **P34-A** (the picker in client groups) and **P34-B** (the admin group) are independent and start at once. **P34-C** (knowledge sharing) follows P34-B and Phase 33 P5; **P34-D** (cross-client picker) follows P34-A and P34-B; **P34-E** (finance) follows P34-B and Phase 32 D. Each part is test-first, runs `bash scripts/ci.sh` before merging and updates its docs with `update-kb`; screen work starts with the `frontend-design:frontend-design` skill.

```
P34-A picker in client groups ─────────────┐
P34-B admin group foundation ──┬───────────┴── P34-D picker in the admin group (client filter, my clients)
                               ├── P34-C admin-group knowledge sharing   (also after Phase 33 P5)
                               └── P34-E finance in the admin group     (also after Phase 32 D)
```

## Conflict rules

- **Migrations:** P34-A (`message_task_links`, `message_ticket_links`, trigram indexes on `tasks.title` and `tickets.subject`) and P34-B (`groups.kind`, nullable `egrant_url`, the one-admin index) each write one; the second to merge renumbers. P34-C and P34-E need none; P34-D turned out to need one index (0043).
- **Server:** P34-A owns `modules/chat/work-links.ts`, `tasks/attachable.ts`, `tickets/attachable.ts`, the search routes; P34-B owns `groups/admin-group.ts` (`isAdminGroup`, `ensureAdminGroup`) and one guard line in each refusing route; P34-C owns `knowledge/policy.ts`'s `isShareableInto` and the read-through extension; P34-D only widens P34-A's checks for the admin group (one branch each); P34-E owns the finance changes.
- **Web:** P34-A owns `features/chat/attach-picker/` (the dialog and the Tasks and Tickets tabs; the existing `knowledge-picker.tsx` is mounted as the Knowledge tab, props unchanged) and `work-cards.tsx`; P34-B owns the tabs' kind switch, the sidebar section, the `/groups` row, the header; P34-C the knowledge visibility words, the badge and the picker's source switch; P34-D the client filter inside the picker tabs.
- **Locales:** A `chat`; B `groups`, `group`, `adminHome`, `notifications`; C `knowledge`; D `chat` (its own `attach.clients.*` keys); E the finance namespaces.

## Part P34-A — Three-tab picker in client groups (branch `feat/chat-attach-work`)

Server: the migration; send body `taskIds`, `ticketIds` (≤ 5 each, `canAttachWork`, `400 invalid_attachment`); `attachableTaskCards`, `attachableTicketCards` (exported by tasks and tickets; one query per page each, live fields); `toMessageDtos` loads both with the other attachments in parallel; the žiadateľ copy (`forReader`) drops tasks and keeps only their readable tickets; search routes `GET /api/groups/:id/tasks/search`, `q` on `GET /api/groups/:id/tickets`; EXPLAIN cases.

Web: `attach-picker/` (tabs remembered, search, cross-tab chips, "Attach (n)"), the composer's chips for tasks and tickets, `work-cards.tsx` (decision 19), unavailable states, opening the panel or the ticket page.

Tests (first): send checks per role and kind (another client's task, a deleted ticket, a žiadateľ `403`), the display re-check (ticket moved, deleted), the žiadateľ copy (tasks stripped, own ticket kept, other ticket stripped), the room payloads, query counts; web: tabs, search, chips, cards; e2e scenario 3 (`e2e/chat-attachments.spec.ts`).

Docs: `product/chat.md`, `architecture/permissions.md`, `architecture/data-model.md`, `architecture/overview.md`, `architecture/performance.md`.

Done when: a client attaches their task and ticket to a message and everyone sees live cards; a žiadateľ sees only their own ticket's card.

## Part P34-B — Admin group foundation (branch `feat/admin-group`)

Status: **done** (migration 0037, ADR 0029; tests in `modules/groups/admin-group.test.ts`, e2e `e2e/admin-group.spec.ts` written, run by whoever merges). The groups have no delete route, so "the delete refuses it" needs nothing; the header group switcher is the sidebar.

Server: the migration; `ensureAdminGroup` at start (buckets, channel); `GroupDto.kind`; the rules table of spec §1.2 (pickable people, refusals with `409 admin_group` / `400 invalid_group`, no tickets, the notification default `all`, the sidebar's `internal` section, managed-groups default inclusion, bulk email exclusion, the client filter option); ADR `00NN-admin-group-as-a-group-row.md`.

Web: tabs by kind, the router guards, the header, the sidebar section and phone row, the `/groups` pinned row and its edit dialog, the client filter option.

Tests (first): every refusal; pickable people in both kinds; a client cannot read or join it (also through sockets); the effective mode; the sidebar order; the global board and knowledge list defaults with the option; the intake never matching it; e2e scenarios 1, 2, 6 (`e2e/admin-group.spec.ts`).

Docs: `product/groups.md`, `product/admin-home.md`, `product/notifications.md`, `product/roles-and-access.md`, `product/client-managers.md`, `architecture/data-model.md`, `permissions.md`, `realtime.md`, `glossary.md`, the ADR.

Done when: every admin chats, plans tasks and keeps knowledge in "eGrant tím", pinned first, with no way in for a client.

## Part P34-C — Knowledge from the admin group (branch `feat/admin-group-knowledge`; after P34-B and Phase 33 P5)

Status: **done** (migration 0042, data only; tests in `modules/knowledge/admin-group-sharing.test.ts` and `policy.test.ts`, web `features/chat/admin-group-knowledge.test.tsx`, e2e `e2e/admin-group-knowledge.spec.ts`). Decisions taken while building: the picker's "eGrant tím" source is for **admins only** (a client never browses the team's knowledge; they open only what an admin attached in their place); the description read-through is one route `GET /api/knowledge-links/:kind/:subjectId/:itemId` (tickets keep theirs); files sent in the team's chat are "Only eGrant" items and never shareable; earlier public admin-group items were reset to "Only eGrant" by the migration; an item of the admin group shows no folders in client places. P34-C also adds the admin-group target branch of `isShareableInto` (any item into the admin group), which P34-D's knowledge check then only uses.

Server: `isShareableInto` replacing `isShareable` in chat and description links (spec §2); `KnowledgeCardDto.source`; the read-through routes and file rules accepting a shareable admin-group item; the picker's `source=admin_group`; the global list option.

Web: the visibility words in the admin group ("Only eGrant" default, "Shareable with clients" with its consequence line), the "eGrant tím" badge on cards, pickers, the global list and the read-only view; the picker's source switch.

Tests (first): an "Only eGrant" item is refused everywhere outside; a shareable one is accepted, opened read-only by a client (and a žiadateľ in a ticket chat), its files readable, never an admins-only file; switching back or moving into an admins-only folder makes every card unavailable; e2e scenario 5.

Docs: `product/knowledge-base.md`, `product/chat.md`, `architecture/permissions.md`.

## Part P34-D — The picker in the admin group (branch `feat/admin-group-picker`; after P34-A and P34-B)

Status: **done** (tests in `modules/chat/admin-group-work.test.ts`, `attach-picker.test.tsx`, `work-cards.test.tsx`; EXPLAIN cases in `home/explain.test.ts`). Decisions taken while building: `q` on `GET /api/tickets/global` already existed (P34-A's `listTickets`), so tickets needed no server change; "Without client" is a switch next to the filter (as on `/tickets`), not a filter row, because the list's `scope=none` excludes `clients`; the knowledge branch lives in the chat (`itemCardsIn`) with a new `knowledge/admin-group-items.ts`, leaving `knowledge/policy.ts` and `chat-items.ts` to P34-C; the description editor's picker in the admin group is unchanged (P34-C owns description links); a migration (0043, one index `tasks_search_order_idx`) was needed after all, because the default "all clients" page without a title scanned `tasks`; e2e scenario 4 is `e2e/admin-group-picker.spec.ts` (the second admin opening both is in the server tests).

Server: the admin-group branch in `attachableTaskCards`, `attachableTicketCards` and the knowledge check (any group, any visibility; tickets without a client); `GET /api/tasks/search?clients=` (admins); `q` on `GET /api/tickets/global`.

Web: the client filter in each picker tab (the admin group option, **My clients** marked with the manager dot, then the others; default all; "Without client" for tickets), the client on each result row and card.

Tests (first): cross-client attach in the admin group only (the same ids refused in a client group), the filter's order and marks; e2e scenario 4.

Docs: `product/chat.md`.

## Part P34-E — Finance in the admin group (branch `feat/admin-group-finance`; after P34-B and Phase 32 D)

Server: rankings exclude `kind = 'admin'`; `/finance` accepts the admin group in `clients` only when chosen ("All clients" = client groups); time requests on its tasks as everywhere (or skipped if the owner answers decision 13 so).

Web: the "eGrant tím (internal)" option in `/finance`'s client filter, off by default.

Tests (first): rankings never list it; the overview with and without it; time on its task; e2e scenario 7.

Docs: `product/finance.md`, `architecture/permissions.md` (unchanged rule, the option).
