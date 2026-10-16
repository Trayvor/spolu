# Phase 21: Tickets and the ziadatel role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support tickets from eGrant, clients and admins, each with its own chat, followers and AI task split; a narrow `ziadatel` membership for requesters; clients in several groups.

**Architecture:** Memberships become `(user, group, role)` rows first (part 21.1). A new `tickets` module owns tickets, followers and requester resolution; the ticket chat is channel kind `'ticket'` in the chat module, whose permission delegates to the tickets policy (like task chats). Notifications use the `tickets` group of item C.

**Tech Stack:** Fastify, Drizzle (PostgreSQL 17), Socket.IO, pg-boss, zod in `@spolu/shared`, React + TanStack Router/Query, Vitest, Playwright.

**Spec:** [2026-10-16-phase-21-tickets-and-requesters-design.md](../specs/2026-10-16-phase-21-tickets-and-requesters-design.md). Read it together with this plan; section numbers below (§1–§8) refer to it.

## Global Constraints

- English in code, comments, docs and commits; UI texts only through i18n keys, sk and en, in the lazy namespace `tickets` (`apps/web/src/locales/tickets/{en,sk}.json`).
- Test-first for every policy function, `resolveRequester` and membership function (`test-driven-development`).
- Permissions only through policy functions; an unreadable resource answers `404 not_found`, a readable one the actor may not change `403 forbidden`.
- Writes go through HTTP; sockets only push events after a successful write.
- Modules talk through exported service functions (tickets never writes `tasks`, `channels` or `group_members` directly).
- One migration per part, generated with `pnpm --filter @spolu/server db:generate --name <name>`; if another branch merged a migration first, regenerate and renumber.
- Every web part starts by invoking the `frontend-design` skill; every new screen is a lazy route.
- Each part ends with `update-kb`, `bash scripts/ci.sh` green, one PR to `main` (never push to `main`).
- Values pinned by the spec: statuses `new | in_progress | resolved`; sources `api | manual`; membership roles `client | ziadatel`; follower sources `auto | manual`; `file_links` ≤ 20 http(s) URLs; lengths subject 300, area/programme/name 200, email 254, phone 50, URLs 2000, body 20 000; intake 60 requests a minute; list pages of 50; env `TICKETS_API_KEY` (empty = `503 intake_disabled`).

## Review Focus

1. A client who belongs to two groups opens a URL of a group they left (removed membership) → 404, and their sockets stopped receiving that group's events at once. Test in Task 1.3.
2. The same email arrives in two tickets for two different clients → one account, two ziadatel memberships, both tickets visible on My tickets, never the groups' chats. Test in Task 2.2.
3. An intake email in a different case or with spaces (`" Jana@X.sk "`) → matched to the existing lower-case account, never a duplicate account. Test in Task 2.2.
4. A ticket moved to another client while a ziadatel of the old client follows it → the follower is dropped and the ticket disappears from their list and their socket room. Test in Task 2.4.
5. A ziadatel guesses a task id or a group chat channel id of their group → 404 (the ziadatel membership never opens the group). Test in Task 1.2 and 3.1.

---

## Handoff (2026-10-16, end of the first session)

Read this first when you continue Phase 21.

**Where things are.** Parts 21.1–21.3 are built, each in its own pull request, stacked:

| part | branch | pull request | state |
|---|---|---|---|
| docs (spec, plan, roadmap) | `claude/bold-cori-e7s8yr` | #3 | CI green, waiting for the owner's merge |
| 21.1 memberships | `phase-21-1-memberships` | #4 | CI green; includes item C (#5, merged) |
| 21.2 tickets core (server) | `phase-21-2-tickets-core` | #6 | CI green, base `phase-21-1-memberships` |
| 21.3 ticket chat (server) | `phase-21-3-ticket-chat` | #7 | CI green, base `phase-21-2-tickets-core` |

The owner merges them in order #3 → #4 → #6 → #7; GitHub then retargets each to `main`. Migrations so far: `0016_notification_groups` (item C), `0017_memberships`, `0018_tickets`, `0019_ticket_chat`. A new part adds `0020_…`; if a branch below yours changes, merge it in and regenerate your migration with `db:generate` (keep hand-written SQL).

**What comes next.**
- **21.4 Ticket screens** and **21.6 Following and notifications** can be built in parallel. While #7 is not merged into `main`, cut the branch from `phase-21-3-ticket-chat` and open the pull request with that base (stacked); after it is merged, cut from `main`.
- **21.5 Ticket to tasks** after 21.4 (it needs the ticket page). **21.7 e2e and wrap-up** last.

**Open points the next parts must handle** (also in the "As built" notes of each part below):
1. *(Done in 21.4: `POST /api/tickets/:id/files`.)* A ziadatel cannot upload files: the upload route `POST /api/groups/:id/files` needs the group. 21.4 either hides the attach button for a ziadatel in the ticket chat, or adds `POST /api/tickets/:id/files` (files of the ticket's group, readable through the ticket chat's file rule). Recommended: the route, it is small.
2. Done in 21.6: a ticket chat message notifies the followers as `ticket.message`, a mention notifies the named reader as a `tickets` event; both link to `/tickets/<id>`.
3. *(Done in 21.4.)* The web ticket chat must take its people from `GET /api/channels/:id/people`, not `/api/groups/:id/people` (a ziadatel gets 404 there).
4. *(Done in 21.4: `MentionItem.ticketId`.)* The admin home "Unread mentions" card and chat message links know only group and task chats; a ticket chat message must link to `/tickets/<id>` (21.4 or 21.6, whichever touches it first).
5. *(Done in 21.4.)* `/` for a person with only ziadatel memberships goes to `/settings` today; 21.4 changes it to `/tickets` (home route in `apps/web/src/router.tsx`, `clientGroups` in `features/auth/roles.ts`).
6. Suggested separately, not part of Phase 21: an index on `notification_events.group_id` (a group delete scans that table).
7. The owner pushed "Phase 21 — Members & groups page" to `main` (commit 28508cb); it becomes **Phase 22** through PR #9 (item C's session). After #9 merges, merging `main` into #4, #6 and #7 conflicts only in `docs/roadmap.md` (the table and the "Next" list): keep both, row 21 (tickets) above row 22. Phase 22's plan must be reconciled with 21.1's membership model (roles, `pending_invites`, several groups) before it is built.

**Local setup notes.** Node 24 (`engine-strict`) and Docker for PostgreSQL 17 and Mailpit (`docker compose -f docker-compose.dev.yml up -d --wait`). If server tests time out at 5 s in unrelated files, the local test database has grown (millions of `notification_events` rows over many runs): run `psql postgres://spolu:spolu@localhost:5432/postgres -c "drop database spolu_test"` and run the tests again (the setup recreates it). Do the same after switching between stacked branches with different migrations.

## Parts and order

| part | branch | PR content | waits for | can run in parallel with |
|---|---|---|---|---|
| 21.1 | `phase-21-1-memberships` | Clients in several groups, membership roles | — (start now) | item C |
| 21.2 | `phase-21-2-tickets-core` | Tickets server core | 21.1 merged | — |
| 21.3 | `phase-21-3-ticket-chat` | Ticket chat | 21.2 merged | 21.4, 21.6 |
| 21.4 | `phase-21-4-tickets-web` | Ticket screens | 21.2 merged | 21.3, 21.6 |
| 21.5 | `phase-21-5-ticket-tasks` | Ticket to tasks with AI | 21.3 and 21.4 merged | 21.6 |
| 21.6 | `phase-21-6-ticket-notifications` | Following and notifications | 21.2 and item C merged | 21.3, 21.4, 21.5 |
| 21.7 | `phase-21-7-tickets-e2e` | e2e, product docs, roadmap | all merged | — |

Each branch is cut from the latest `main`. The ticket page of 21.4 renders the chat column only when the ticket DTO carries `channelId` (added by 21.3), so 21.3 and 21.4 merge in either order. 21.6 changes no screen, only notification code and the follow endpoints' events.

---

## Part 21.1 — Memberships (spec §1)

**As built (2026-10-16, branch `phase-21-1-memberships`).** Differences from the tasks below, which later parts must use:
- Policies take the actor's **client groups**, not a role: `canReadGroup(actor, groupId, actorGroupIds: readonly string[])`, and the same `actorGroupIds` parameter in `canUseBoard`, `canReadChannel`, `canReadFile`, `canReadItem`, `canEditItem` and the reminder adapters' `canRead`. Routes pass `isAdmin(actor) ? [] : await clientGroupIds(db, actor.id)`. There is no `memberRoleIn`; when the role in one group matters (tickets), use `getMembership(db, userId, groupId) → { role, removedAt } | null`.
- A signed-in client joins another group's invite with one button (`POST /api/join/:token/accept`, session required; admins 403, removed membership `403 removed`).
- An invite is not applied when the email is typed: it is stored in `pending_invites` (one per user, the latest wins) and applied on sign-in (`applyPendingInvite`, called from the session-create hook in `auth/auth.ts`). `moveUnverified` is gone (`rememberInvite`).
- Removal keeps using `user.disabled_at` for the account: removing the **last** active membership disables the account (as before); removing one of several only sets `removed_at`. The migration copies `disabled_at` of removed clients to their membership's `removed_at`.
- `Me.groups` items are `{ id, name, role, hasLogo, updatedAt }`. `clientGroups(me)` in `features/auth/roles.ts`; `/` sends a client with one group into it, with several to `/my-groups`, with none to `/settings` (part 21.4 changes that last case to `/tickets`).
- Item C merged first, so 21.1 also did C's two B-1 changes: `visibleCategoriesFor` returns `['tickets']` for `isRequesterOnly`, and `notificationAudience` adds the group's active `ziadatel` members for the `tickets` group only (`activeMemberIds`). The memberships migration is `0017_memberships` (after C's `0016_notification_groups`).

### Task 1.1: Schema and membership service

**Files:**
- Modify: `apps/server/src/modules/groups/schema.ts` (`groupMembers`)
- Modify: `apps/server/src/modules/groups/service.ts` (remove `getMembershipGroupId`, `addMember`; add the functions below)
- Create: `apps/server/src/modules/groups/memberships.ts`, `memberships.test.ts`
- Modify: `packages/shared/src/groups.ts` (`MemberRole`)
- Migration: `db:generate --name memberships`

**Interfaces:**
- Produces (shared): `type MemberRole = 'client' | 'ziadatel'`.
- Produces (`groups/memberships.ts`):
  - `getMembership(db, userId, groupId): Promise<{ role: MemberRole; removedAt: Date | null } | null>`
  - `listMemberships(db, userId): Promise<{ groupId: string; role: MemberRole }[]>` (active only, ordered by group name)
  - `addMembership(db, userId, groupId, role: MemberRole): Promise<'added' | 'promoted' | 'unchanged' | 'removed'>` — insert; ziadatel→client when `role = 'client'`; never client→ziadatel; a removed row stays removed (`'removed'`).
  - `removeMembership(db, groupId, userId): Promise<{ lastActive: boolean }>`, `restoreMembership(db, groupId, userId): Promise<void>`
  - `hasActiveMembership(db, userId): Promise<boolean>`, `isRequesterOnly(db, user: SessionUser): Promise<boolean>` (not admin, no active client membership).

- [ ] **Step 1: Write failing tests** in `memberships.test.ts`: `addMembership adds a client`, `adds a ziadatel beside a client membership of another group`, `promotes ziadatel to client in the same group ('promoted')`, `never demotes client to ziadatel ('unchanged')`, `keeps a removed row removed`, `listMemberships skips removed rows`, `removeMembership reports lastActive only for the last active row`, `isRequesterOnly is true with only ziadatel rows, false for admins and for any client row`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server exec vitest run src/modules/groups/memberships.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Schema.** `groupMembers`: pk `(user_id, group_id)`, `role text not null default 'client'` with check `group_members_role_check`, `removed_at timestamptz`; indexes `group_members_group_active_idx (group_id, role) where removed_at is null`, `group_members_user_active_idx (user_id) where removed_at is null`. Generate the migration, then hand-append to it: `update group_members m set removed_at = u.disabled_at from "user" u where u.id = m.user_id and u.role = 'client' and u.disabled_at is not null; update "user" set disabled_at = null where role = 'client' and disabled_at is not null;` (removal moves from the account to the membership).
- [ ] **Step 4: Implement** `memberships.ts`; `addMembership` uses `insert … on conflict (user_id, group_id) do update set role = 'client' where group_members.role = 'ziadatel' and group_members.removed_at is null`.
- [ ] **Step 5: Run** the test — expect PASS. Commit `feat(groups): memberships with roles, several groups per client`.

### Task 1.2: Policies take the membership role

**Files:**
- Modify: `groups/policy.ts`, `chat/policy.ts`, `tasks/policy.ts`, `files/policy.ts`, `knowledge/policy.ts`, `reminders/subjects.ts`, `tasks/reminder-subject.ts`, `knowledge/reminder-subject.ts` and their tests
- Modify every route that called `getMembershipGroupId` (list: `grep -rn getMembershipGroupId apps/server/src`)
- Create: `apps/server/src/modules/groups/access.ts`

**Interfaces:**
- Produces: `canReadGroup(actor: SessionUser, role: MemberRole | null): boolean` = admin, or `role === 'client'`. Every module policy that took `actorGroupId` now takes `role: MemberRole | null` (the actor's role **in the resource's group**), e.g. `canUseBoard(actor, role)`, `canReadChannel(actor, role)`, `canReadFile(actor, file, role)`, `canReadItem(actor, item, role)`. Reminder adapters: `canRead(actor, role)`.
- Produces (`groups/access.ts`): `memberRoleIn(db, actor: SessionUser, groupId: string): Promise<MemberRole | null>` (null for admins and non-members; reads `getMembership`, ignores removed rows). Routes call it once per request for the resource's group.

- [ ] **Step 1: Rewrite the policy tests** to the new signatures and add, in each module's `policy.test.ts`: `a ziadatel membership does not read the group` (`canReadGroup(client, 'ziadatel') === false`, same for board, channel, file, knowledge item) and `a client of two groups reads both` (route-level, in Task 1.3).
- [ ] **Step 2: Run** `pnpm --filter @spolu/server exec vitest run src/modules/*/policy.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the signatures and `memberRoleIn`; replace every `getMembershipGroupId` call in routes with `memberRoleIn(db, request.user, <group of the resource>)`. Queries that listed "the client's group" (e.g. `reminders/service.ts listUpcomingForUser`) filter with `exists (select 1 from group_members where user_id = $me and group_id = x.group_id and role = 'client' and removed_at is null)`.
- [ ] **Step 4: Run** `pnpm --filter @spolu/server test` — expect PASS (existing route tests pass unchanged: their clients have one group).
- [ ] **Step 5: Commit** `refactor: policies take the actor's role in the resource's group`.

### Task 1.3: Invites, removal, sockets, `/api/me`

**Files:**
- Modify: `groups/service.ts` (`joinWithEmail`, `moveUnverified`, `listMembers`), `groups/join-routes.ts`, `groups/routes.ts` (remove/restore member), `auth/routes.ts` (`/api/me`), `auth/auth.ts` (who may get a code), `infra/realtime/socket.ts`, `infra/realtime/rooms.ts`
- Modify: `packages/shared/src/` the `Me` schema (`groups: { id, name, role }[]` replaces `groupId`)
- Modify, only if item C has merged: `notifications/categories.ts visibleCategoriesFor` returns `['tickets']` when `isRequesterOnly` (otherwise 21.6 does it)
- Test: `groups/join-routes.test.ts`, `groups/routes.test.ts`, `infra/realtime/socket.test.ts`, `auth/auth.test.ts`

**Interfaces:**
- Produces: `GET /api/me` → `{ id, name, email, role, groups: { id: string; name: string; role: MemberRole }[] }`.
- Produces: `joinGroupRoom(io, userId, groupId)` / `leaveGroupRoom(io, userId, groupId)` in `rooms.ts` (all sockets of the user, through `userRoom`).
- Produces: `listMembers(db, groupId, { removed: boolean; role: MemberRole })` and `GET /api/groups/:id/members?role=ziadatel` (admins only for `ziadatel`), used by the Requesters section in 21.4; `canRemoveMember(actor, target)` allows removing a ziadatel membership too.

- [ ] **Step 1: Failing tests:** `an invite adds a second group to a signed-in client` (both groups readable, `/api/me.groups` has 2); `an invite turns a ziadatel membership into client`; `removing a client from one of two groups keeps them signed in and drops only that room`; `removing the last active membership signs them out (sessions deleted, sockets disconnected)`; `a login code is refused for an account with no active membership`; `a client socket joins the rooms of every active client group on connect` (not ziadatel groups); `restore joins the room again`.
- [ ] **Step 2: Run** these files — expect FAIL.
- [ ] **Step 3: Implement.** Drop the "other links do nothing" rule; keep the unverified rule (an unverified user's single unverified membership moves). Remove/restore use `removeMembership`/`restoreMembership`, then `leaveGroupRoom`/`joinGroupRoom`; `lastActive` → today's sign-out path.
- [ ] **Step 4: Run** `pnpm --filter @spolu/server test` — expect PASS. Commit `feat(groups): clients join several groups by invite`.

### Task 1.4: Web for several groups

**Files:**
- Modify: `apps/web/src/features/auth/use-session.ts`, `roles.ts`, `authed-layout.tsx`, `user-menu.tsx`, `welcome-page.tsx`, `apps/web/src/router.tsx` (client `/`)
- Create: `apps/web/src/features/groups/my-groups-page.tsx`, `group-switcher.tsx` (+ tests)
- Locales: `apps/web/src/locales/{en,sk}.json` keys `groups.mine.title`, `groups.switcher.label`

**Interfaces:**
- Consumes: `Me.groups` from Task 1.3.
- Produces: `clientHome(me: Me): string` in `features/auth/roles.ts` — one client group → `/groups/<id>`; several → `/my-groups`; none but ziadatel → `/tickets` (the route arrives in 21.4; until then `/my-groups` shows "No groups").

- [ ] **Step 1: Invoke `frontend-design`.** Then failing tests: `clientHome` (3 cases); `MyGroupsPage lists logos, names and unread counts`; `GroupSwitcher shows only with 2+ client groups and navigates`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web exec vitest run src/features/auth src/features/groups` — FAIL.
- [ ] **Step 3: Implement**; replace every `me.groupId` use (grep) with `clientHome(me)` or the current route's group.
- [ ] **Step 4: Run** `pnpm --filter @spolu/web test` and `pnpm --filter @spolu/web build` — PASS; record the eager-chunk size change in the PR.
- [ ] **Step 5: Docs** (`update-kb`): `product/groups.md`, `auth.md`, `roles-and-access.md`, `architecture/permissions.md`, `data-model.md`, `realtime.md`. Commit `feat(web): my groups and the group switcher`.

### Task 1.5: e2e and PR

- [ ] Add `e2e/memberships.spec.ts`: a client opens a second group's invite, switches between both groups with the header switcher, an admin removes them from one, the other still works.
- [ ] Run `bash scripts/ci.sh` — all green. Push `phase-21-1-memberships`, open the PR.

---

## Part 21.2 — Tickets core, server (spec §2, §3)

**As built (2026-10-16, branch `phase-21-2-tickets-core`).** Differences from the tasks below that later parts must use:
- Socket events carry only `{ ticketId, groupId }` (`TicketEventPayload`); listeners refetch. Rooms: `admins`, `group:<id>`, the initiator's `user:<id>`.
- `TicketDto.requester` is `{ userId, name, email, phone }`; `TicketListItem` adds `requesterName` and `excerpt`. `channelId` is always null until 21.3 fills it in `toTicketDto`.
- Hooks: `onTicketChange((deps, change) => Promise<void>)` in `tickets/hooks.ts`; `TicketChange = { kind: 'created' | 'status' | 'updated' | 'moved' | 'tasks', ticket: TicketRow, actorId, previousGroupId? }`. Assigning a client to a ticket without one fires `created` (with `previousGroupId: null`), a move fires `moved`.
- Instance matching is `findGroupByEgrantUrl` in the groups service: by host, ignoring scheme, `www.`, path and case.
- The "Ticket created" link is `/login?redirect=/tickets/<id>`; `requester_notified_at` makes it once per ticket.
- `readingFollowerIds(db, ticket)` (followers who can still read it) and `roleIn(db, actor, groupId)` are exported for 21.3 and 21.6.
- `TICKETS_API_KEY` needs at least 16 characters.

### Task 2.1: Shared contracts, schema, policy

**Files:**
- Create: `packages/shared/src/tickets.ts` (+ `tickets.test.ts`), export from `index.ts`
- Create: `apps/server/src/modules/tickets/schema.ts`, `policy.ts`, `policy.test.ts`
- Modify: `apps/server/src/infra/db/schema.ts` (export), `tasks/schema.ts` (`sourceTicketId`)
- Migration: `db:generate --name tickets`

**Interfaces:**
- Produces (shared): `TicketStatus`, `TicketSource`, `TicketIntakeBody` (zod, every field optional, the spec §3 field names and lengths; refine "one of subject, body, area"), `TicketCreateBody` (admin: `groupId`, `requesterEmail`, `requesterName` + the same fields + `fileIds`; client: same without `groupId`/`requester*`), `TicketPatchBody`, `TicketDto` (all columns as camelCase, plus `groupName: string | null`, `following: boolean`, `taskCount: number`, `channelId: string | null` — null until 21.3), `TicketListItem`, `TicketListQuery` (`status: 'open' | 'resolved' | 'all'`, `area?`, `following?`, `clients?: string[]`, `scope?: 'mine' | 'all' | 'none'`, `cursor?`).
- Produces (`tickets/policy.ts`): `type TicketAccess = { role: MemberRole | null }`; `canReadTicket(actor, ticket: { groupId: string | null; requesterUserId: string | null }, role): boolean`; `canCreateTicket(actor, role): boolean`; `canEditTicket(actor): boolean`; `canSplitTicket(actor, ticket, role): boolean`.

- [ ] **Step 1: Failing tests:** one test per cell of the spec §2 policy table, named after the cell (`admin reads a ticket without client`, `client reads every ticket of the group`, `ziadatel reads only own ticket`, `ziadatel cannot create`, `client cannot edit`, `ziadatel cannot split`, `nobody but admins reads a ticket without client` …); shared: `intake rejects a body without subject, body and area`, `intake accepts every field empty but subject`, `file_links rejects 21 links and a ftp: link`, `email is trimmed and lower-cased`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server exec vitest run src/modules/tickets/policy.test.ts` and `pnpm --filter @spolu/shared test` — FAIL.
- [ ] **Step 3: Implement** the schema exactly as spec §2 (`tickets`, `ticket_followers`, `ticket_attachments`, sequence `tickets_number_seq`, the four indexes; `tasks.source_ticket_id` with partial index `tasks_source_ticket_id_idx`). Generate the migration.
- [ ] **Step 4: Run** — PASS. Commit `feat(tickets): schema, contracts and policy`.

### Task 2.2: `resolveRequester`

**Files:**
- Create: `apps/server/src/modules/tickets/requester.ts`, `requester.test.ts`

**Interfaces:**
- Consumes: `getMembership`, `addMembership` (21.1); `findUserByEmail`, `createUser` from the users service (add `createUser(db, { email, name, language: 'sk' })` there if missing).
- Produces: `resolveRequester(tx, groupId: string, email: string | null, name: string | null): Promise<{ userId: string | null; notify: boolean }>` — branches exactly as spec §3 step 2; `notify` false for the removed-membership branch and for no email.

- [ ] **Step 1: Failing tests**, one per branch: `admin email → that admin, no membership`; `active client in the group → that client`; `client of another group → ziadatel membership added here, still client there`; `unknown email → new account role client, language sk, name from the ticket, ziadatel membership`; `removed membership → userId null, notify false`; `no email → null, notify false`; Review Focus 2 and 3: `same email in tickets of two clients → one account, two ziadatel rows`, `" Jana@X.sk " matches jana@x.sk`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS). Commit `feat(tickets): resolve the requester`.

### Task 2.3: Service, intake and manual creation

**Files:**
- Create: `tickets/service.ts`, `tickets/service.test.ts`, `tickets/emails.ts` ("Ticket created", sk/en), `tickets/routes.ts`, `tickets/routes.test.ts`, `tickets/events.ts`
- Modify: `apps/server/src/app.ts` (register under `/api`), `infra/config/config.ts` + `.env.example` (`TICKETS_API_KEY`), `groups/managers.ts` (use `listGroupManagers`)

**Interfaces:**
- Produces (`service.ts`):
  - `createTicket(deps, input: { source: TicketSource; groupId: string | null; createdBy: string | null; fields: TicketFields; requester: { email: string | null; name: string | null; phone: string | null }; fileIds?: string[] }): Promise<TicketRow>` — one transaction: insert, `resolveRequester` when `groupId`, auto followers (initiator account, active managers, `createdBy` admin), then (after commit) the "Ticket created" email when `notify` and the initiator is not `createdBy`, and the socket event.
  - `getTicketForActor(db, actor, id): Promise<TicketDto | null>` (null when unreadable).
  - `listTickets(db, actor, query: TicketListQuery & { groupId?: string; mine?: boolean }): Promise<{ items: TicketListItem[]; nextCursor: string | null }>` — one query, keyset on `(created_at, id)`, 50 per page; a ziadatel sees `requester_user_id = me` only; `mine` = My tickets across groups.
  - `matchGroupByInstance(db, instanceUrl: string | null): Promise<string | null>` (uses `egrant-url.ts`).
- Produces (routes): `POST /api/tickets/intake` (Bearer, `401`/`503 intake_disabled`/`429` at 60/min, `201 { id, number }`); `POST /api/tickets` (admin or client); `GET /api/tickets/:id`; `GET /api/groups/:id/tickets`; `GET /api/tickets/mine`; `GET /api/tickets/global` (admins, `400 invalid_filter`).
- Produces (`events.ts`): `emitTicket(io, event: 'ticket:created' | 'ticket:updated' | 'ticket:moved', ticket)` → `groupRoom(groupId)`, `userRoom(requesterUserId)` when the initiator is ziadatel-only in that group, `admins` room when `groupId` is null.

- [ ] **Step 1: Failing route tests:** `intake without key → 401`, `with TICKETS_API_KEY empty → 503 intake_disabled`, `61st request in a minute → 429`, `matching instance_url https://WWW.X.egrant.sk/app → ticket in group x`, `no match → group null, visible in global with scope none, not in any group list`, `the "Ticket created" email reaches the fake sender with the login link /login?next=/tickets/<id>`, `a client creates in their group (initiator = self, no email)`, `a ziadatel POST /api/tickets → 403`, `an admin creates for a client with a new email → ziadatel account and email`, `ziadatel GET /api/groups/:id/tickets → only own`, `ziadatel GET /api/groups/:id/tasks → 404` (Review Focus 5), `GET /api/tickets/mine lists tickets of two clients`, `global default scope = managed clients`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS). The intake key is compared with `crypto.timingSafeEqual` on equal-length buffers. Commit `feat(tickets): intake API, manual creation and lists`.

### Task 2.4: Edit, status, assign client, follow

**Files:** `tickets/service.ts`, `tickets/routes.ts`, tests.

**Interfaces:**
- Produces: `updateTicket(deps, actor, id, patch: TicketPatchBody): Promise<{ ticket: TicketDto; statusChanged: boolean; fieldsChanged: boolean }>`; `assignTicketGroup(deps, actor, id, groupId): Promise<TicketDto>` (throws `TicketHasTasksError` → `409 has_tasks`); `follow(db, actor, id)`, `unfollow(db, actor, id)`; `listFollowers(db, id)`.
- Produces: an in-module hook list `onTicketChange: ((change: TicketChange) => Promise<void>)[]` with `type TicketChange = { kind: 'created' | 'status' | 'updated' | 'moved' | 'tasks'; ticket: TicketRow; actorId: string | null }`, called after commit; 21.6 registers the notifier there, 21.3 the channel creator.
- Routes: `PATCH /api/tickets/:id`, `PUT /api/tickets/:id/group`, `PUT` and `DELETE /api/tickets/:id/follow`, `GET /api/tickets/:id/followers`.

- [ ] **Step 1: Failing tests:** `status resolved sets resolved_at, reopening clears it`; `client PATCH → 403, ziadatel PATCH → 403, stranger → 404`; `assign a ticket without client runs resolveRequester and sends the email once`; `moving again never sends a second email`; `moving drops followers who cannot read the ticket in the new group` (Review Focus 4: the ziadatel's list no longer has it and `ticket:moved` reached their user room); `moving a ticket with tasks → 409 has_tasks`; `follow is idempotent; unfollow of an auto follower removes it`.
- [ ] **Step 2–4:** run, implement, run. Commit `feat(tickets): edit, status, client and following`.

### Task 2.5: Docs and PR

- [ ] `update-kb`: rewrite `product/tickets.md` (as built), the intake field table into `product/integrations.md`, `roles-and-access.md` (ziadatel), `architecture/permissions.md` (tickets policy table), `data-model.md`; roadmap Phase 21 → `in progress`.
- [ ] `bash scripts/ci.sh` green; push `phase-21-2-tickets-core`; open the PR.

---

## Part 21.3 — Ticket chat (spec §2 channels, §5 realtime)

**As built (2026-10-16, branch `phase-21-3-ticket-chat`, stacked on 21.2).** For later parts:
- `modules/chat/access.ts`: `registerChannelKind(kind, { canRead, extraRooms, extraPeople, allRecipients })`, `actorReadsChannel`, `extraRoomsOf`, `channelKindAccess`. The tickets module registers `ticket` in `tickets/chat.ts` (`registerTicketChat()`, called in `app.ts`), together with the create/move hook and the file read rule.
- Chat service: `ensureTicketChannel`, `getTicketChannel`, `moveTicketChannel` (moves the messages' files to the new group with `moveFilesToGroup`).
- Routes: `GET /api/tickets/:id/chat` (a `GroupChannel`; 404 while the ticket has no client) and `GET /api/channels/:id/people` (pickable people plus the initiator; the web ticket chat must use it, not `/groups/:id/people`).
- A ticket chat records **no** chat notifications (no `chat.message`, `chat.mention`, `chat.thread_reply`); part 21.6 adds `ticket.message` for followers and decides how mentions in a ticket chat notify. `allRecipients` (the reading followers) is ready for it.
- Files: `files/read-rules.ts` (`registerFileReadRule`); a ziadatel downloads files attached to their ticket chat. A ziadatel cannot upload yet (the upload route needs the group); 21.4 either hides attaching for them or adds a ticket upload route.

### Task 3.1: Channel kind `ticket`

**Files:**
- Modify: `chat/schema.ts` (`kind` check, `ticketId`, unique index, check), `chat/policy.ts`, `chat/routes.ts`, `chat/service.ts`, `chat/messages.ts` (mention candidates, @all)
- Create: `chat/ticket-channels.ts` (+ test); `tickets/channel-hook.ts`
- Migration: `db:generate --name ticket_chat`

**Interfaces:**
- Produces (chat): `ensureTicketChannel(tx, ticketId, groupId): Promise<string>`, `moveTicketChannel(tx, ticketId, groupId): Promise<void>`; a reader registry `registerChannelReader('ticket', (db, actor, channel) => Promise<boolean>)` so chat does not import tickets.
- Consumes: `onTicketChange` (21.2) — `channel-hook.ts` creates the channel on `created` with a group and on `moved`; `canReadTicket` for the reader.
- `TicketDto.channelId` now filled.
- Mentions in a ticket chat: the group's clients and managers plus the ticket's initiator; `@all` reaches the ticket's followers only.

- [ ] **Step 1: Failing tests:** `a ticket with a client gets a channel; one without gets none, then one on assignment`; `the channel moves with the ticket`; `a ziadatel reads and writes in own ticket chat, 404 in another ticket's chat and in the group chat` (Review Focus 5); `a client of the group writes in every ticket chat`; `@all in a ticket chat mentions followers only`; `the initiator is offered as a mention candidate`.
- [ ] **Step 2–4:** run, implement, run.
- [ ] **Step 5: Sockets:** a ziadatel-only socket joins `channel` rooms of its own tickets on connect and on `ticket:created` for them; test in `socket.test.ts`. Commit `feat(chat): ticket chat`.
- [ ] **Step 6:** `update-kb` (`product/chat.md`, `architecture/realtime.md`, `permissions.md`), `bash scripts/ci.sh`, push, PR.

---

## Part 21.4 — Ticket screens (spec §5)

**As built (2026-10-16, branch `phase-21-4-tickets-web`, stacked on 21.3).** For later parts:
- Handoff open points done here: 1 (`POST /api/tickets/:id/files`: whoever reads a ticket with a client uploads into its client's files, `409 no_client` without one; the preview route lets the uploader set their own file's preview without the group read check), 3 (the ticket chat reads its people from `GET /api/channels/:id/people` and uploads through the ticket: `ChatScope` in `features/chat/chat-scope.ts`, passed as `<Conversation scope>`), 4 (`MentionItem.ticketId` from `home/mentions.ts`; `mentionTarget` and `chatMessageLocation` link a ticket chat message to `/tickets/<id>?message=…&c=…`) and 5 (`/` sends a person with only requester memberships to `/tickets`).
- Web: `features/tickets/` (`api.ts` with `ticketsQuery(source, filter)`, `ticketQuery`, `useCreateTicket`, `usePatchTicket`, `useAssignGroup`, `useFollow`, `patchTicketInLists`; `ticket-list.tsx` `<TicketList source filter onFilterChange>`; `ticket-page.tsx`; `new-ticket-dialog.tsx`; `use-ticket-events.ts`; `search.ts` for the URL filters). Routes `/tickets` (admins: global view; others: My tickets), `/tickets/$ticketId` (loader 404 → not found; no search schema, so chat links pass through) and the group tab `tickets`. Texts in the lazy `tickets` namespace.
- The ticket page has **no "Turn into tasks" yet** and shows "Turned into N tasks" without links for everyone: 21.5 adds the button (admins and the group's clients, never for a ticket without a client), the linked task list and the message action in the ticket chat (the chat passes no `messageActions` today).
- `TicketDto.files` (the manual form's uploads, `FileInfo[]`): readable by whoever reads the ticket (`fileOfReadableTicket`, a file read rule registered in `tickets/chat.ts`) and moved with the ticket (`assignTicketGroup`).
- `TaskDetailDto.sourceTicket` (`{ id, number, subject } | null`, `tickets/refs.ts` `getTicketRef`, only a ticket of the task's group) and the task panel's line "Ticket: #123 subject"; 21.5 only needs to set `tasks.source_ticket_id`.
- Requesters: `GET /api/groups/:id/requesters` (readers of the group) and `/requesters/removed` (admins); remove and restore use the member routes; a restored requester's sockets no longer join the group room (that was a leak in 21.1's restore).
- The area filter offers the areas seen in the loaded list (no endpoint). The requester's ticket chat catches up on every socket `connect` (they cannot join the group room).
- e2e: `e2e/ticket-screens.spec.ts` (intake → requester logs in, sees only their ticket, writes in its chat; admin sets In progress and replies; admin creates a ticket from the group tab and sees the requester on the Members tab). `playwright.config.ts` sets `TICKETS_API_KEY`. 21.7's `e2e/tickets.spec.ts` can build on it.
- Bundle: initial JS 199.6 kB gzip (+2.1 kB) on the stacked base; 197.9 kB after merging `main` (21.6, 22a); see `architecture/performance.md`.
- Not done: screenshots in the PR (the orchestrator runs the e2e and the app).

All tasks start with the `frontend-design` skill. Web tests mock HTTP with the shared schemas of 21.2.

### Task 4.1: API client, list and filters

**Files:**
- Create: `apps/web/src/features/tickets/api.ts`, `ticket-list.tsx`, `ticket-filters.tsx`, `status-badge.tsx`, `use-ticket-events.ts` (+ tests)
- Create: `apps/web/src/locales/tickets/{en,sk}.json`; register the namespace in `src/i18n/namespaces.ts`

**Interfaces:**
- Produces: `ticketsQuery(params)`, `ticketQuery(id)`, `useCreateTicket()`, `usePatchTicket(id)`, `useAssignGroup(id)`, `useFollow(id)`; `<TicketList source={{ kind: 'group', groupId } | { kind: 'mine' } | { kind: 'global' }} />`.

- [ ] **Step 1: Failing tests:** `default filter shows Open (new + in_progress)`; `overdue due date is red only when not resolved`; `global view has the client filter with "Without client"`; `the "Following" filter sends following=true`; `rows update on ticket:updated without refetching the page`.
- [ ] **Step 2–4:** run (`pnpm --filter @spolu/web exec vitest run src/features/tickets`), implement, run. Commit.

### Task 4.2: Ticket page and new-ticket dialog

**Files:** `ticket-page.tsx`, `ticket-fields.tsx`, `ticket-followers.tsx`, `new-ticket-dialog.tsx` (+ tests); chat column reuses the conversation component with `channelId`.

- [ ] **Step 1: Failing tests:** `admin edits status in place`; `client sees fields read-only and can follow`; `ziadatel sees no "Turn into tasks" and "Turned into N tasks" without links`; `without client: "No client yet" + Assign client, no chat`; `chat column hidden while channelId is null`; `admin dialog requires a client and shows the initiator hint`; `client dialog has no client or initiator fields`.
- [ ] **Step 2–4:** run, implement, run. Commit.

### Task 4.3: Routes, tabs, ziadatel shell, Requesters, task line

**Files:** `apps/web/src/router.tsx` (`/tickets`, `/tickets/:id`, group tab `tickets`), `features/groups/group-tabs.tsx`, `features/auth/authed-layout.tsx` + `user-menu.tsx` (ziadatel-only header), `features/groups/members-tab.tsx` (Requesters section), `features/tasks/task-panel.tsx` (line "Ticket: #123 subject" from `TaskDto.sourceTicket`, added to the task DTO here on the server: `{ id, number, subject } | null`, only when the reader can read the ticket).

- [ ] **Step 1: Failing tests:** `ziadatel-only user lands on /tickets and has only Tickets in the header`; `group tab order Chat, Tasks, Tickets, Knowledge, Members`; `admin header has Tickets next to Úlohy`; `Requesters lists ziadatel members with remove/restore for admins`; `task panel shows the ticket line`.
- [ ] **Step 2–4:** run, implement, run; `pnpm --filter @spolu/web build`, record the eager-chunk delta in the PR.
- [ ] **Step 5:** `update-kb` (`product/tickets.md` UI part, `design/` if a new pattern), `bash scripts/ci.sh`, push, PR.

---

## Part 21.5 — Ticket to tasks with AI (spec §3 "Turn into tasks")

**As built (2026-10-16, branch `phase-21-5-ticket-tasks`, from `main` with 21.1–21.4 and 21.6).** No migration. For 21.7:
- Server: `POST /api/tickets/:id/task-split` (in `ai/routes.ts`; 404 unreadable, 409 `no_client`, 403 ziadatel, then the message route's answers; logged with `ticketId`). `buildTicketSplitRequest(db, ticket, now)` (no `people`/`lang` parameters: it reads the group's pickable people itself, and the labels are English like the rest of the prompt) sends "Support ticket #n", subject, area, programme, due date, the file links' names (last path segment, no query) and the body; the ticket's uploaded files go as the request's files. `proposeTicketTasks` gives a card without a deadline the ticket's due date (the AI's own date wins).
- `createTasksFromSource(deps, actor, groupId, { tasks }, { messageId?, ticketId?, fileIds })` in `tasks/task-service.ts`; `createTasksFromMessage` wraps it. `POST /api/groups/:id/tasks/from-ticket` (`TasksFromTicketSchema` = `{ ticketId, tasks }`, the ticket's uploaded files as `messageFileIds`) and the from-message route for a ticket chat message (sets both ids) emit `ticket:updated` and run `runTicketChange({ kind: 'tasks', count })`.
- **Deviation:** no `GET /api/tickets/:id/tasks`. The ticket DTO carries `tasks: MessageTaskLink[] | null` (`listTasksFromTicket`, one indexed query; `null` for a ziadatel, who keeps `taskCount`), so the page needs no second request and refreshes with the ticket on `ticket:updated`. A task's later move, completion or delete does not emit `ticket:updated`; the list is fresh on the next ticket fetch.
- Added (decision 7, "a ziadatel sees no links"): a reader who cannot read the channel's group gets ticket chat messages without `tasks` (chat routes' `forReader`; `emitMessage` sends the extra rooms a stripped copy with `.except(groupRoom)`), and `POST /api/messages/:id/task-split` answers them 403.
- Web: `ReviewDialog` takes `source: SplitSource` (`{ kind: 'message' | 'ticket' }`); `review-model.ts` `toDrafts` replaces `toRequest`, `cardByHand(text)`. The lazy dialog loads `forms`, `tasks`, `taskSplit`. `features/tickets/ticket-tasks.tsx` (Tasks section: links, "Turn into tasks" while the AI is on, toast with Open the board); `TicketChat` passes `useMessageTaskTools` actions and footers to admins and clients only.
- Tests: `tickets/tasks.test.ts` (13 cases), web `ticket-page.test.tsx` "turn into tasks", `review-dialog.test.tsx` ticket case. e2e: a third test in `e2e/ticket-screens.spec.ts` (admin turns an intake ticket into 2 tasks with the fake AI; both task panels show "Ticket: #n"; the ticket lists them). Not run here (the orchestrator runs e2e).
- Bundle: initial JS 197.7 kB gzip, unchanged (see `architecture/performance.md`).

### Task 5.1: Server

**Files:** `ai/split.ts` (a ticket source), `ai/routes.ts` (`POST /api/tickets/:id/task-split`), `tasks/task-service.ts` (`createTasksFromSource`), `tasks/task-routes.ts` (`POST /api/groups/:id/tasks/from-ticket`), `tickets/service.ts` (`taskCount`, linked tasks list), tests.

**Interfaces:**
- Produces: `buildTicketSplitRequest(ticket: TicketRow, people, lang)`; `createTasksFromSource(deps, actor, groupId, source: { messageId?: string; ticketId?: string }, cards)` — `createTasksFromMessage` becomes a wrapper; sets `source_ticket_id` and, from a ticket chat message, both ids; fires `onTicketChange({ kind: 'tasks' })`.
- `GET /api/tickets/:id/tasks` → `{ id, title, bucket }[]` for admins and clients; a ziadatel gets `{ count }` only.

- [ ] **Step 1: Failing tests:** `the request carries subject, area, programme, body, due date and file link names`; `the ticket's due date is the proposed deadline`; `ziadatel → 403`; `ticket without client → 409 no_client`; `a ticket chat message split links both message and ticket`; `ziadatel tasks endpoint returns only the count`.
- [ ] **Step 2–4:** run, implement, run. Commit.

### Task 5.2: Web

**Files:** `features/task-split/use-message-task-tools.tsx` (a ticket source), `features/tickets/ticket-tasks.tsx`, `ticket-page.tsx` (button), tests.

- [ ] **Step 1: Invoke `frontend-design`.** Failing tests: `the review dialog quotes the ticket subject and body`; `after create the ticket lists the new tasks`; `the button is absent for ziadatel and for a ticket without client`.
- [ ] **Step 2–4:** run, implement, run.
- [ ] **Step 5:** `update-kb` (`product/ai-task-split.md`, `tickets.md`), `bash scripts/ci.sh`, push, PR.

---

## Part 21.6 — Following and notifications (spec §4, "What B expects from C")

**As built (2026-10-16, branch `phase-21-6-ticket-notifications`, stacked on 21.3).** No migration. The contract check is in the spec ("Contract check (part 21.6)"). For later parts:
- `notifyTicketChange(deps, change)` in `tickets/notify.ts`, registered as an `onTicketChange` hook by `registerTicketNotifications()` (in `app.ts`, after `registerTicketChat`). `created` and `moved` → `ticket.created` to the client's managers (`moved` too: "steps 2–3 run for the new group"), or `ticket.unassigned` to every active admin with `groupId` null; `status`, `updated`, `tasks` → followers who still read the ticket; never the actor. Payload `{ ticketId, number, subject, groupId }` plus `status` or `count`.
- **21.5 must pass `count`**: `TicketChange` gained `count?: number`; run `runTicketChange(deps, { kind: 'tasks', ticket, actorId, count }, log)` after the cards are created.
- Ticket chat messages: `ChannelKindAccess` gained `messageNotice(db, channel) → { kind, recipients, payload } | null`; the tickets module answers `ticket.message`, the reading followers and `ticketPayload(ticket)`. `sendMessage` records it for every message (replies too; no `chat.message` / `chat.thread_reply` in a ticket chat) and records `chat.mention` for the named people (`@all` = `allRecipients`, the reading followers) with the ticket in the payload. Open point 2 is decided this way: such a mention is a `tickets` event (`notificationGroupOf` maps a `chat.*` payload with `ticketId` to `tickets`), passes every bell mode and opens `/tickets/<id>`. A named follower gets one notification (`ticket.message` ranks 1, `chat.mention` 2).
- Push: title and body per spec §4 (title "#123 is now In progress", body the subject, and so on; see `docs/product/notifications.md`); url `/tickets/<id>` without a message anchor, tag `ticket:<id>`. Digest: one email per ticket, line `<push title>: <push body>`, button "Open ticket", topic "Ticket #123" ("Tiket #123" in Slovak).
- `readingFollowerIds` is three queries (followers, `getActiveRoles`, `activeRolesIn`) decided by `canReadTicket`; `assignTicketGroup` uses it to drop followers in one delete.
- Tests: an intake without a client now notifies every admin of the test database, so tests that make many such tickets give them a client (the intake rate-limit test), and the digest sweep test makes only its own event due.
- Open point 4 (ticket chat links on the admin home) is not done here: `MentionItem` has no `ticketId` yet; 21.4 (or a follow-up) adds it to `home/mentions.ts` (`channels.ticket_id`) and links the item to `/tickets/<id>`.

### Task 6.1: Verify the C contract

- [ ] Read C's merged code: `NotificationKinds`, `KIND_RANK`, `notifications/categories.ts` (`NOTIFICATION_GROUP_OF`, `visibleCategoriesFor`), `digest-entries.ts`, `push-content.ts`, the recipient check. Write any difference from spec §4 points 1–7 into the spec before coding (`update-kb`).

### Task 6.2: Kinds, recording and the recipient check

**Files:** `packages/shared/src/notifications.ts`, `notifications/decide.ts`, `notifications/categories.ts`, the recipient check in `notifications/deliver.ts`, `tickets/notify.ts` (+ tests).

**Interfaces:**
- Consumes: `onTicketChange` (21.2), the chat message hook used by task chats (Phase 9) for `ticket.message`.
- Produces: `notifyTicketChange(deps, change: TicketChange): Promise<void>` — recipients = followers who still `canReadTicket`, minus the actor; `ticket.created` → managers; `ticket.unassigned` → all active admins (`groupId` null); payload `{ ticketId, number, subject, authorName?, excerpt?, status?, count? }`.
- `visibleCategoriesFor` returns `['tickets']` for `isRequesterOnly` (if 21.1 did not).
- The recipient check accepts `groupId = null` for admins and a `ziadatel` membership for `tickets` kinds only.

- [ ] **Step 1: Failing tests:** `status change notifies followers but not the actor`; `a removed-from-group follower gets nothing`; `ticket.unassigned reaches every admin with groupId null`; `a ziadatel follower gets ticket.message even with the group mode Off`; `a ziadatel gets no chat.message from the group chat` (membership counts for tickets kinds only); `KIND_RANK and NOTIFICATION_GROUP_OF cover every ticket kind`; `profile categories of a ziadatel-only user = ['tickets']`; `a mentioned person who reads the ticket but does not follow it gets chat.mention from the ticket chat`.
- [ ] **Step 2–4:** run, implement, run. Commit.

### Task 6.3: Push and digest texts

**Files:** `notifications/push-content.ts`, `notifications/digest-entries.ts`, `notifications/texts.ts` (sk/en), tests.

- [ ] **Step 1: Failing tests:** each spec §4 push text in sk and en; device tag `ticket:<id>`; url `/tickets/<id>`; digest line `#123 <subject>: Jana: text` with button Open; two tickets → two digest emails.
- [ ] **Step 2–4:** run, implement, run.
- [ ] **Step 5:** `update-kb` (`product/notifications.md`), regenerate this part's migration if C merged one after the branch was cut, `bash scripts/ci.sh`, push, PR.

---

## Part 21.7 — e2e and wrap-up (spec §7)

**As built (2026-10-16, branch `phase-21-7-tickets-wrapup`).** Migration `0021_ticket_request_id` (after `0020_bulk_email` of Phase 23.1). Beyond the tasks below:
- e2e `e2e/tickets.spec.ts`: intake with `request_id` and its retry (`200`, same `{ id, number }`), a second requester's ticket of the same client, the "Ticket created" email (once) and its `/login?redirect=` link, the code login landing on the ticket, My tickets with only their own ticket, not-found for the other ticket and the group's chat and tasks, a chat message, the admin's In progress and reply, the requester's batched notification email (subject with `Tiket #n`), the admin's split into 2 tasks (task panel links back; the requester sees only "Premenený na 2 úlohy"), then a task moved to Done and one deleted through the API while the ticket page is open: the list updates live. Helper `waitForMessage` in `e2e/mailpit.ts`. Ran green locally (`pnpm exec playwright test e2e/tickets.spec.ts`).
- Intake idempotency: `request_id` (1..100, trimmed) in `TicketIntakeBodySchema`, `tickets.request_id` unique. The route answers an existing id with `200` before doing anything; `createTicket` inserts with `on conflict (request_id) do nothing` and returns `duplicate: true` with the winner's row, so concurrent duplicates make one ticket and only the winner emails, emits and notifies. Documented in `product/integrations.md` and the new guide `docs/integrations/egrant-ticket-intake.md` (linked from `docs/README.md`).
- Admin home mentions: `getMentions(db, viewer)` drops a ticket chat's message when `readableTicketIds` (new in `tickets/service.ts`, two queries for any number of tickets) says the viewer cannot read the ticket; `total` is lowered by the dropped items. For admins (the only callers today) every ticket is readable and a moved ticket's channel moves with it, so in practice this guards future non-admin callers; the statement count stays 1 when no ticket chat is listed.
- Ticket task list freshness: `getTaskRef` and `deleteTask` return `sourceTicketId`; the task routes call `emitTicketRefresh(io, db, ticketId)` (`tickets/events.ts`) after a task edit, an actual move (completing is a move to Done) and a delete. It only emits `ticket:updated`; no ticket hook runs, so followers are not notified.
- Test hygiene: `routes.test.ts`, `screens.test.ts`, `chat.test.ts` and `requester.test.ts` deactivate the admins they create (`notify.test.ts` and `tasks.test.ts` already did). The tests that make a ticket without a client all test that path, so they keep it.
- Deviation: the roadmap marks Phase 21 `done (local)`; Phases 12 and 13 were already `merged into 21`. `roles-and-access.md` needed no change (21.4 already described the requester's app); the glossary gained `initiator` and `request_id`.

### Task 7.1: e2e

**Files:** `e2e/tickets.spec.ts`, helpers in `e2e/mailpit.ts` if needed; the e2e env sets `TICKETS_API_KEY`.

- [ ] Write the scenario of spec §7: intake → Mailpit "Ticket created" → code login as ziadatel → only own ticket, no group pages (direct URL → not found) → message in the chat → admin replies and sets In progress → the requester's notification email arrives (ticket group, email on by default) → admin turns the ticket into 2 tasks, both show "Ticket: #n" and the ticket lists them.
- [ ] Run `pnpm test:e2e` — PASS.

### Task 7.2: Docs and close

- [ ] `update-kb`: `product/tickets.md`, `roles-and-access.md`, `glossary.md` (ziadatel, requester, follower), roadmap Phase 21 → `done (local)`, Phases 12 and 13 → `merged into 21`. `bash scripts/ci.sh`, push, PR.

---

## Session prompts

Paste one into a new Claude Code session on the `trayvor/spolu` repository. Each is self-contained.

### Prompt 21.1 — Memberships

```text
Implement part 21.1 (Memberships: clients in several groups, membership role client|ziadatel) of Phase 21 in Spolu.

Read first: CLAUDE.md, docs/superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md (§1 and the decisions table) and docs/superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md (Global Constraints, Review Focus, Part 21.1, Tasks 1.1–1.5).

Work on a new branch `phase-21-1-memberships` cut from the latest main. Never push to main. Follow the plan task by task with the test-driven-development skill; the web task starts with the frontend-design skill. If item C (notification groups) has already merged into main, also change `visibleCategoriesFor` in apps/server/src/modules/notifications/categories.ts to return ['tickets'] for `isRequesterOnly` users (plan Task 1.3); otherwise leave it for part 21.6.

Done when: every task's tests pass, `bash scripts/ci.sh` is green, docs are updated with update-kb, and a pull request to main is open. Give me the PR link.
```

### Prompt 21.2 — Tickets core (server)

```text
Implement part 21.2 (Tickets core, server) of Phase 21 in Spolu. Part 21.1 (memberships) must already be merged into main; check that `group_members` has `role` and `removed_at` and that apps/server/src/modules/groups/memberships.ts exists. If not, stop and tell me.

Read first: CLAUDE.md, docs/superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md (§2, §3, decisions table) and docs/superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md (Global Constraints, Review Focus, Part 21.2, Tasks 2.1–2.5). Use the new-module skill for the tickets module layout.

Work on a new branch `phase-21-2-tickets-core` cut from the latest main. Never push to main. Test-first for the policy and resolveRequester. Add TICKETS_API_KEY to .env.example and the config. Expose the onTicketChange hook list exactly as the plan's Task 2.4 Interfaces say: parts 21.3, 21.5 and 21.6 depend on it.

Done when: every task's tests pass, `bash scripts/ci.sh` is green, docs are updated with update-kb (product/tickets.md, integrations.md with the intake field table, roles-and-access.md, permissions.md, data-model.md, roadmap status), and a pull request to main is open. Give me the PR link.
```

### Prompt 21.3 — Ticket chat

```text
Implement part 21.3 (Ticket chat: channel kind 'ticket') of Phase 21 in Spolu. Part 21.2 must already be merged into main (check apps/server/src/modules/tickets/ and the onTicketChange hook). It can run at the same time as parts 21.4 and 21.6 in other sessions; touch only the files Part 21.3 names.

Read first: CLAUDE.md, docs/superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md (§2 channels and policy, §5 realtime) and docs/superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md (Global Constraints, Review Focus, Part 21.3). Look at how task chats (Phase 9) delegate permissions and copy that pattern; chat must not import the tickets module (use the reader registry from the plan).

Work on a new branch `phase-21-3-ticket-chat` cut from the latest main. Never push to main. Test-first.

Done when: tests pass, `bash scripts/ci.sh` is green, docs updated with update-kb, a pull request to main is open (regenerate the migration if another part merged one first). Give me the PR link.
```

### Prompt 21.4 — Ticket screens

```text
Implement part 21.4 (Ticket screens: lists, ticket page with its chat, new-ticket dialog, ziadatel shell, Requesters section, ticket line on tasks) of Phase 21 in Spolu. Parts 21.1-21.3 are built (PRs #4, #6, #7); read the plan's Handoff section first, including its open points 1, 3, 4 and 5, which this part handles. If PR #7 is not merged into main yet, cut your branch from phase-21-3-ticket-chat and open the PR with that base; otherwise cut it from main. It can run at the same time as part 21.6 in another session.

Start by invoking the frontend-design skill (the UI replicates egrant.sk; see docs/design/README.md). Read: CLAUDE.md, docs/superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md (§5, decisions 3, 4, 9) and docs/superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md (Global Constraints, Part 21.4). Texts go into the lazy namespace `tickets` (sk and en); every screen is a lazy route; keep the eager chunk within the budget in docs/architecture/performance.md.

Work on a new branch `phase-21-4-tickets-web` cut from the latest main. Never push to main.

Done when: web tests pass, the build reports the eager-chunk delta, `bash scripts/ci.sh` is green, docs updated with update-kb, a pull request to main is open with screenshots (computer and phone width) of the ticket list and the ticket page. Give me the PR link.
```

### Prompt 21.5 — Ticket to tasks

```text
Implement part 21.5 (Turn a ticket into tasks with AI) of Phase 21 in Spolu. Parts 21.3 and 21.4 must already be merged into main; check for channel kind 'ticket' and apps/web/src/features/tickets/. If not, stop and tell me.

Read: CLAUDE.md, docs/superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md (decision 7, §3 "Turn into tasks"), docs/product/ai-task-split.md and docs/superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md (Part 21.5). Reuse the Phase 9 split and review dialog; do not fork them. The web task starts with the frontend-design skill.

Work on a new branch `phase-21-5-ticket-tasks` cut from the latest main. Never push to main. Test-first on the server.

Done when: tests pass, `bash scripts/ci.sh` is green, docs updated with update-kb, a pull request to main is open. Give me the PR link.
```

### Prompt 21.6 — Following and notifications

```text
Implement part 21.6 (ticket notifications through the `tickets` notification group) of Phase 21 in Spolu. Item C is merged (PR #5) and parts 21.1-21.3 are built (PRs #4, #6, #7); read the plan's Handoff section first, including its open points 2 and 4. If PR #7 is not merged into main yet, cut your branch from phase-21-3-ticket-chat and open the PR with that base; otherwise cut it from main. It can run at the same time as part 21.4 in another session.

Read: CLAUDE.md, docs/superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md (§4 and "What B expects from C"), the C spec, and docs/superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md (Part 21.6). First do Task 6.1: compare C's merged code with the 7 contract points and record any difference in the Phase 21 spec before coding. Two cases to make sure of: ticket.unassigned has groupId null and goes to admins; a ziadatel membership counts as group membership for tickets kinds only.

Work on a new branch `phase-21-6-ticket-notifications` cut from the latest main. Never push to main. Test-first.

Done when: tests pass, `bash scripts/ci.sh` is green, docs updated with update-kb, a pull request to main is open. Give me the PR link.
```

### Prompt 21.7 — e2e and wrap-up

```text
Finish Phase 21 in Spolu: part 21.7 (e2e and docs). Parts 21.1–21.6 must all be merged into main; check the roadmap and the code, and tell me what is missing if any is not.

Read: CLAUDE.md, docs/superpowers/specs/2026-10-16-phase-21-tickets-and-requesters-design.md (§7) and docs/superpowers/plans/2026-10-16-phase-21-tickets-and-requesters.md (Part 21.7). Write e2e/tickets.spec.ts with the full scenario, fix what it finds (systematic-debugging), then update the docs with update-kb: product/tickets.md, roles-and-access.md, glossary.md, roadmap (Phase 21 done (local), Phases 12 and 13 merged into 21).

Work on a new branch `phase-21-7-tickets-e2e` cut from the latest main. Never push to main.

Done when: `pnpm test:e2e` and `bash scripts/ci.sh` are green and a pull request to main is open. Give me the PR link and a short checklist I can walk on the local stack to accept the phase.
```
