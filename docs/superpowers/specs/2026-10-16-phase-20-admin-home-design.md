# Spolu — Phase 20: Admin home: dashboard, client sidebar and global task board (design)

Date: 2026-10-16 · Status: approved by the controller under the owner's overnight authorization (2026-10-16); rulings in 2026-10-16-phases-17-20-brief.md

Requirements: [admin-home](../../product/admin-home.md), [client-managers](../../product/client-managers.md), [task-board](../../product/task-board.md), [chat](../../product/chat.md). Builds on [Phase 18](2026-10-16-phase-18-client-managers-design.md) (managers, `managedGroupsSql`, the `admins` room), [Phase 9](2026-10-15-phase-9-task-chat-and-ai-design.md) (task chats, unread tasks, `TasksTabBadge`) and [Phase 6](2026-10-16-phase-6-notifications-design.md). The reminders card and the client filter come from [Phase 17](2026-10-16-phase-17-knowledge-base-design.md) (`modules/reminders`, `<ClientFilter>`), extended by Phase 19.

Built on branch `phase-20`, cut from `main` **after Phase 18 has merged**. It does not wait for Phases 17 and 19: the reminders card switches itself on when their module is there (see "Upcoming reminders before Phases 17 and 19").

## Goal

An admin opens Spolu and sees, on one screen, what needs them: the tasks assigned to them, their upcoming reminders and the unread messages where they were mentioned, next to a compact list of clients ordered by what is waiting. A global task board shows tasks across clients, filtered by default to the clients they manage. Everything loads with one query per card and one for the sidebar.

## Owner decisions (cite: `.next-phases-brief.md`, part B.2, B.3 and the answers of 2026-10-16)

| question | decision |
|---|---|
| Assigned tasks card | A wide card. Left: the count of tasks assigned to me and how many are urgent. Right: a list, urgent first, then the nearest deadline, then later ones, then tasks with no deadline (B.2). |
| Upcoming reminders card | Chronological, with the count on the left (B.2). |
| Unread mentions card | The count on the left and the list on the right. Clicking a message opens the chat at that message (B.2). |
| Clicking | Every item on every card goes to the item (B.2). |
| Client list | On the left, compact; the dashboard on the right. Managed clients and other clients visually separated. Order: unread first, then clients with tasks assigned to me. Each client shows its unread count and its count of tasks assigned to me (B.3). |
| Úlohy tab | A black dot with the unread count and a **yellow** dot with the number of tasks assigned to me (B.3). |
| Global task board | Admins get a global task board across all clients, with the same client filtering as the knowledge list: by default the clients I manage; add or remove, managed and other clients separated (answers). |
| Reminder recipients | The author, plus people the author adds; people can subscribe themselves (answers; built in Phases 17 and 19). |

## Controller rulings (technical; the owner may override)

- **Routes.** `/` for an admin becomes the dashboard (today it redirects to `/groups`). `/tasks` is the global task board. `/groups` stays the full list of all clients with Create group, the manager toggle and the bells (Phase 18). Clients are unchanged: `/` still redirects them to their group.
- **Header navigation for admins**: Home, Tasks, Groups, Admins (Phase 17 inserts Knowledge above Groups). Under 641 px they stay in the user menu, as today.
- **The admin shell.** For admins, on screens ≥ 1024 px, the client sidebar is part of the signed-in layout: it stays on the dashboard, the global board and every group page, so moving between clients never reloads it. It can be collapsed to a 56 px rail of logos (per device, `localStorage`, read in try/catch). Under 1024 px there is no sidebar; see Phones.
- **Lazy, for the budget.** Only about 2.7 kB of the 200 kB eager budget is left. The dashboard, the sidebar and the global board are three lazy chunks: `admin-shell` (sidebar, loaded by the lazy authed layout only when the user is an admin, so clients never download it), `admin-home` and `global-board`. Their `adminHome.*` texts (English and Slovak) live in the chunk and are added with `i18next.addResourceBundle` when it loads (the first lever named in `architecture/performance.md`), so they add nothing to the entry chunk. Eager additions are limited to the two route definitions, the header links and the yellow pill in `TasksTabBadge`, together under 0.6 kB gzip; the phase measures and records it.
- **Sidebar order** (inside each section, "Managed by you" first, then "Other clients", the same headings as the Phase 17 client filter):
  1. clients with unread messages;
  2. then clients with open tasks assigned to me;
  3. then the rest;
  and by name inside each tier. Within a tier the order stays stable (by name, not by the latest message), so rows do not jump while the admin reads. Unread is the group chat's count, the same number as the groups list and the Chat tab badge today.
- **Counts on a client row**: black pill = unread group chat messages (`UnreadPill`, capped "99+"); yellow pill = my open assigned tasks in that group (not in Completed). Both hidden at 0.
- **The yellow.** egrant.sk has no yellow. A new token `--attention: #FFCE3A` (Tailwind `attention`) with `ink` text (contrast about 13:1). It is used only for "assigned to me" counts: the sidebar, the Úlohy tab, the dashboard. Never for fills larger than a pill.
- **Úlohy tab.** `TasksTabBadge` shows the black pill (unread tasks, Phase 9, unchanged) and then the yellow pill (my open assigned tasks in this group). For clients too: they are assigned tasks as well. Data: `GET /api/groups/:id/tasks/mine-count` → `{ open: number }` (one indexed count, key `['tasks', groupId, 'mine']`); it is refetched, debounced 500 ms, after any `board:task` or `board:task_deleted` event in the group room.
- **Assigned tasks card ordering** (owner's order made exact): urgent tasks first (by deadline, no deadline last among them); then the rest by deadline ascending (overdue first, as their dates are earliest); then tasks with no deadline, oldest first. Completed tasks are not listed. The card lists the first 20; "Show all 37" opens the global board filtered to `assignee=me` and all clients.
- **Unread mentions**: a message where I am mentioned by name, or an @all message in a group I manage (Phase 18: @all reaches managers), by someone else, not deleted, and still unread for me:
  - top-level message: newer than my read mark of its channel;
  - thread reply: newer than my read mark of that thread.
  Task chats count too. Only the last 90 days are considered, so the query stays bounded no matter how long the history is. The list shows 20; the count is capped at 100 ("99+"), like other unread counts.
- **A mention in a reply makes me one of the thread's people.** Today a reply is unread only for the thread's root author and repliers (`thread_read_states`). This phase extends `sendMessage`: a reply that mentions me by name inserts my thread read row (read mark just before the reply), so the reply counts as unread, the thread gets its dot, and opening it clears both the dot and the dashboard item. For @all in a reply nobody is added (it would make a whole group follow the thread); such a reply counts as unread on the dashboard while it is newer than my channel read mark. This is the only change to chat.
- **Upcoming reminders before Phases 17 and 19.** Phase 17 builds the query in its reminders module, `listUpcomingForUser(db, actor, { limit })` (the user's next reminder times across groups, as author, added recipient or subscriber). Phase 20 does not import it directly; it reads reminders through a small slot in `modules/home`, `registerReminderSource(source)`, so the two phases can merge in either order:
  - **Phase 17 not merged yet:** no source is registered. `GET /api/me/home/reminders` answers `{ available: false }` and the dashboard does not render the card: the assigned tasks card keeps the full width and Mentions takes the whole second row. On phones there are two tiles.
  - **Whichever of 17 and 20 merges second** registers the source in `app.ts` (three lines) and adds its test. From then on the card appears with no other change. Phase 19 adds task reminders to the same module, so they appear in the card without touching Phase 20.
  - The contract the source implements (a thin wrapper over `listUpcomingForUser`; one query for the list, one for the count):

  ```ts
  type ReminderSource = {
    /** My next reminder times from `from`, earliest first. */
    upcoming(db: Db, userId: string, opts: { from: Date; limit: number }): Promise<UpcomingReminder[]>;
    /** How many reminder times I have from `from` to `from + 7 days` (capped at 100). */
    countNextWeek(db: Db, userId: string, from: Date): Promise<number>;
  };
  type UpcomingReminder = {
    id: string;          // the reminder time's id
    at: string;          // ISO
    title: string;       // the knowledge item's or the task's title
    groupId: string;
    groupName: string;
    target: { kind: 'knowledge'; itemId: string } | { kind: 'task'; taskId: string };
  };
  ```

  If Phase 17 ships `listUpcomingForUser` with a different shape, the wrapper maps it; this contract is the dashboard's, not the reminders module's. The count needs an index on `reminder_times (at) where fired_at is null` and `reminder_recipients (user_id)`, both already in the Phase 17 spec.
  The deadline and urgent reminders of Phase 6 are not "upcoming reminders": they are about tasks, which the assigned tasks card already shows with their deadlines.
- **Global task board: columns by step, not by bucket.** Groups have different custom buckets, so the global board shows five columns by bucket kind: **To do**, **Other steps** (every custom bucket; the card shows the bucket's name), **eGrant review**, **Client review** (the card names the client), **Completed**. Completed is hidden by default ("Show completed" adds it, last 30 days).
- **No drag on the global board.** Moving a task changes its place inside one group's board, which the global board does not show. A card opens the task panel; the panel's bucket select moves it (the Phase 8 panel, reused). Inside a column, cards are sorted like the assigned tasks card (urgent, deadline, no deadline), then by client name.
- **Global board filters** (all in the URL, so a view can be bookmarked and the "Show all" link works):
  - `clients`: the Phase 17 `<ClientFilter>` (same URL format `?clients=<id>,<id>`, same `localStorage` memory under its own key `globalBoard.clients`); absent = the clients I manage (all, if I manage none);
  - `assignee`: `me` | `anyone` (default) | `none` (unassigned) | a person id (from the people of the chosen clients);
  - `urgent=1`;
  - `due`: `overdue` | `week` (next 7 days) | `none` (no deadline);
  - `q`: title search (case-insensitive, `ilike`, at least 2 characters);
  - `completed=1`.
- **Paging.** Each column shows its first 50 cards and a count; "Show 50 more" loads the next page of that column (keyset on the sort key). One request answers all columns for the first page.
- **Live updates.** Admins are not in every group room. After a message or a task change, the server also sends a tiny `admin:activity { groupId, kind: 'chat' | 'task' }` to the `admins` room (Phase 18). The sidebar, the open dashboard cards and the global board refetch their one query, debounced 2 s and only while the document is visible; they also refetch on window focus. For the group the admin has open, the existing group-room events stay the source (exact and instant).
- **Opening items.**
  - Task: `/groups/:groupId/tasks/:taskId` (Phase 8). From the global board the panel opens over the board at `/tasks?…&task=<id>` instead, so closing it returns to the same filtered board.
  - Mention: the Phase 5 / 9 links, `/groups/:groupId/chat?message=<id>` (a thread reply opens its thread), or `/groups/:groupId/tasks/:taskId?tab=chat&message=<id>` for a task chat.
  - Reminder: the knowledge item `?k=<id>` (Phase 17) or the task.

## User experience

All copy is the English source; Slovak goes in `sk.json` (Úlohy is the Slovak name of the Tasks tab). Designed with `frontend-design` on the egrant.sk tokens: the `base` page, white `card` blocks with `rounded-xl` and no shadow, ink pills. The one place this screen is bold is the **counts**: each card leads with one large number (`text-large`, 36 px, weight 600, tabular figures) in a narrow left column, and the list sits to its right. Everything else is quiet: no icons for decoration, no charts, no color except the urgent pill, the overdue date and the yellow "assigned to me" pills.

### Desktop (≥ 1024 px)

```
┌ header pill:  Spolu by eGrant        Home  Tasks  Groups  Admins   (VH) SK ┐
└──────────────────────────────────────────────────────────────────────────┘
┌ Clients ───────────[«]┐  Good morning, Vlad
│ 🔍 Find a client      │  ┌ Assigned to me ─────────────────────────────────────────────┐
│ Managed by you        │  │  37        │ Urgent  Fix budget table      ABC s.r.o.  18 Oct │
│ ▸ ABC s.r.o.    (4)(2)│  │  assigned  │ Urgent  Sign annex            Dolany     no date │
│ ▸ Obec Dolany   (1)   │  │            │ Report for SAV               Krok        20 Oct │
│ ▸ Nadácia Krok     (3)│  │  5 urgent  │ Upload invoices              ABC s.r.o.  22 Oct │
│ ▸ Mesto Brezno        │  │            │ …                                                 │
│ ───────────────────── │  │            │ Show all 37                                       │
│ Other clients         │  └────────────┴─────────────────────────────────────────────────┘
│ ▸ Obec Lúky     (12)  │  ┌ Upcoming reminders ───────────┐ ┌ Mentions ───────────────────┐
│ ▸ Spolok Tri       (1)│  │  3       │ Tue 21 Oct 09:00   │ │  2      │ Jana · ABC s.r.o.  │
│ ▸ Firma XY            │  │  next    │ Call the auditor   │ │  unread │ "@Vlad can you…"   │
│ ▸ …                   │  │  7 days  │ Thu 23 Oct 14:00   │ │         │ Peter · Dolany     │
│                       │  │          │ Grant deadline ABC │ │         │ "@all the form…"   │
└───────────────────────┘  └──────────┴────────────────────┘ └─────────┴────────────────────┘
   (4) black = unread messages     (2) yellow = tasks assigned to me
```

**Client sidebar** (232 px, sticky, scrolls on its own):

- A search field at the top filters the list as you type (client-side; the list is already loaded).
- Two sections, "Managed by you" and "Other clients", each with a small `text-micro` `muted-foreground` heading; a hairline between them. An admin who manages nothing sees one unlabelled list. Sections never hide clients: every client is in one of them.
- A row is 40 px: 24 px logo, name (one line, truncated), then the black pill and the yellow pill. The current client's row is the filled `secondary` (`surface-2`) row with weight 600; hover is `accent`. The whole row is the link to the group (it opens the Chat tab, as today).
- Collapsed (`«`): a 56 px rail with logos only; a pill becomes a 8 px dot on the logo corner (black if unread, else yellow if assigned). The tooltip is the name.

**Dashboard cards** (`card`, padding 20 px, gap 16 px):

- Each card: a title line (`text-body` weight 600), then two columns: the **count** (left, 112 px) with a one-line caption under it, and the **list** (right). Rows are 44 px, the whole row is a link, hairline between rows; no row icons.
- **Assigned to me** (full width): count = open tasks; caption "assigned"; under it "5 urgent" (with the `destructive` dot when > 0). Row: the urgent pill (Phase 8's) when urgent, title (one line), client name (`muted-foreground`), deadline on the right ("18 Oct"; `error-ink` when overdue; "no date" in `muted-foreground`). Empty: "Nothing is assigned to you."
- **Upcoming reminders** (half width): count = reminder times in the next 7 days; caption "next 7 days". Row: day and time ("Tue 21 Oct 09:00", `tabular-nums`), the title, the client. Shows the next 10 (not only this week). Empty: "No reminders coming up."
- **Mentions** (half width): count = unread mentions; caption "unread". Row: author and client on one line, the first 80 characters of the message on the second (the existing plain-text excerpt; two-line row, 56 px). Opening a row navigates to the message; the item disappears when the message is read there. Empty: "No unread mentions."
- The greeting line ("Good morning, Vlad") is the page's `h1` at `text-medium`; it changes by Bratislava time (morning / afternoon / evening). Nothing else in the header area.
- Loading: each card shows its title and three grey row placeholders (static, no shimmer). An error in one card shows "Could not load this. Try again." in that card only.

### Phones and tablets (< 1024 px)

No sidebar. The home screen is one column:

```
Good morning, Vlad
┌──────────┐┌──────────┐┌──────────┐
│ 37       ││ 3        ││ 2        │
│ assigned ││ reminders││ mentions │
│ 5 urgent ││ 7 days   ││ unread   │
└──────────┘└──────────┘└──────────┘
🔍 Find a client
Managed by you
 ABC s.r.o.            (4)(2)
 Obec Dolany           (1)
 ─────────────
Other clients
 Obec Lúky             (12)
 …
```

- The three cards collapse into three **count tiles** in one row (each ≥ 44 px tall, the count at `text-large`). Tapping a tile opens its full list as a full-screen sheet (the full-screen sheet primitives of the task panel, Phase 8), with a back button; the list rows are the same as on desktop.
- Below them, the client list itself (the sidebar's rows at full width, 48 px tall), with the same sections, order, pills and search. This is how an admin reaches a client on a phone.
- With no reminders source the row has two tiles.
- Inside a group on a phone there is no sidebar; the header's Home link returns to this list.

### Úlohy tab badge

```
[ Chat (3) ]  [ Úlohy (2)(4) ]  [ Members ]
               black  yellow
```

Black = unread task chats (Phase 9), yellow = my open assigned tasks here. Screen readers hear "2 tasks with unread messages, 4 tasks assigned to you".

### Global task board (`/tasks`)

```
Tasks
[ Clients: My clients (3) ▾ ] [ Assignee: anyone ▾ ] [ Urgent ] [ Due ▾ ] [🔍 Search tasks ] [ ] Show completed
┌ To do  24 ──────────┐ ┌ Other steps  6 ───┐ ┌ eGrant review  4 ┐ ┌ Client review  9 ┐
│┌───────────────────┐│ │┌─────────────────┐│ │                  │ │                  │
││(logo) ABC s.r.o.  ││ ││(logo) Dolany    ││ │                  │ │                  │
││Urgent             ││ ││In translation   ││ │                  │ │                  │
││Fix budget table   ││ ││Annex 2          ││ │                  │ │                  │
││(VH)(JN)    18 Oct ││ ││(JN)     no date ││ │                  │ │                  │
│└───────────────────┘│ │└─────────────────┘│ │                  │ │                  │
│ Show 50 more        │ │                   │ │                  │ │                  │
└─────────────────────┘ └───────────────────┘ └──────────────────┘ └──────────────────┘
```

- The Phase 8 board look: 288 px columns on `muted`, white cards, horizontal scroll, scroll-snap under 641 px. The card is Phase 8's `<TaskCard>` with one added line at the top: the client's 16 px logo and name (`text-micro`, `muted-foreground`), and for Other steps the bucket name under it.
- Filters are a row of pills that wraps; on phones they collapse into one "Filters (3)" pill that opens a sheet. "Clear filters" appears when anything differs from the defaults.
- Empty with filters: "No tasks match these filters." with "Clear filters".
- No "+ Add task" here: a task belongs to one client's board, created there.

## Architecture

### Module

`modules/home` (server, read-only): the dashboard, sidebar and global board queries. It reads tasks, chat and groups tables in single statements (the same documented read-only exception as `listGroups`), and writes nothing. Web: `features/admin-home` (shell, sidebar, dashboard) and `features/global-board`.

### Endpoints (admins only, `requireAdmin`; clients 403)

| method | path | what | queries |
|---|---|---|---|
| GET | `/api/me/home/sidebar` | `[{ groupId, name, hasLogo, updatedAt, managed, unread, assigned }]`, already ordered | 1 |
| GET | `/api/me/home/tasks` | `{ total, urgent, items: AssignedTask[] }` (first 20) | 1 |
| GET | `/api/me/home/mentions` | `{ total, items: MentionItem[] }` (first 20, total capped at 100) | 1 |
| GET | `/api/me/home/reminders` | `{ available: false }` or `{ available: true, nextWeek, items: UpcomingReminder[] }` (first 10) | 2 (source) |
| GET | `/api/tasks/global` | query: the filters above, `column?` and `after?` for "Show 50 more" → `{ columns: { kind, total, items: GlobalTaskDto[], next: string \| null }[] }` | 1 |
| GET | `/api/groups/:id/tasks/mine-count` | any reader of the group → `{ open }` | 1 |

`AssignedTask` = `{ id, groupId, groupName, title, urgent, dueDate, bucketKind }`. `MentionItem` = `{ messageId, channelId, taskId, parentId, groupId, groupName, authorName, excerpt, createdAt }`. `GlobalTaskDto` = Phase 8 `TaskDto` plus `groupName`, `groupHasLogo`, `groupUpdatedAt`, `bucketKind`, `bucketName`. All in `packages/shared/src/home.ts` (its own module, so `sideEffects: false` keeps it out of the entry chunk).

### The queries

- **Sidebar** (one statement): `groups` left-joined with (a) the per-group unread counts from the existing `unreadPerChannel(userId, kind = 'group')` fragment, (b) `select t.group_id, count(*) from task_assignees ta join tasks t on t.id = ta.task_id where ta.user_id = $me and t.completed_at is null group by t.group_id`, (c) `managedGroupsSql($me)`; ordered by `managed desc, (unread > 0) desc, (assigned > 0) desc, name, id`.
- **Assigned tasks** (one statement): `task_assignees ta join tasks t join groups g join buckets b` where `ta.user_id = $me and t.completed_at is null`, with `count(*) over ()` and `count(*) filter (where urgent) over ()` for the left column, `order by t.urgent desc, t.due_date asc nulls last, t.created_at asc limit 20`.
- **Mentions** (one statement): the union of (a) `message_mentions mm join messages m` where `mm.user_id = $me`, and (b) `messages m` where `m.mentions_all` and the channel's group is in `managedGroupsSql($me)`; both `m.author_id <> $me`, `m.deleted_at is null`, `m.created_at > now() - 90 days`; then the unread test against `read_states` (top-level) or `thread_read_states` (replies; for an @all reply without a thread row, the channel read mark); `count(*) over ()` capped through a `limit 100` subquery; ordered newest first; the first 20 with group name and author name. The excerpt is made from the body in code with the existing `plainExcerpt`.
- **Global board** (one statement): `tasks t join buckets b join groups g` where `t.group_id in (<clients>)` plus filters; `row_number() over (partition by <column kind> order by <sort>)` and `count(*) over (partition by <column kind>)`, keep rows ≤ 50; assignees and file counts joined in the same statement as arrays (the way `selectTasks` already does it). "Show 50 more" runs the same statement for one column with a keyset `after`.
- **`mine-count`**: `count(*)` from `task_assignees join tasks` where `user_id = $me and group_id = $g and completed_at is null`.

### Indexes (migration `00xx_admin_home`)

| index | serves |
|---|---|
| `message_mentions_user_message_idx` on `message_mentions (user_id, message_id)` | mentions of me (today only the PK `(message_id, user_id)` exists) |
| `messages_mentions_all_idx` on `messages (channel_id, created_at)` where `mentions_all and deleted_at is null and parent_id is null` and a second partial one with `parent_id is not null` | @all messages in my managed channels after the read mark |
| `tasks_open_group_idx` on `tasks (group_id, completed_at)` | the global board's client filter without Completed (replaces scanning `tasks_group_id_idx` and filtering) |
| existing `task_assignees_user_id_idx`, `group_managers` (`user_id`) from Phase 18, `read_states` PK, `thread_read_states_unread_idx` | assigned counts, managed groups, unread tests |
| `pg_trgm` is **not** added | the title search is `ilike` over the already filtered rows of the chosen clients (hundreds, not millions); revisit only if measured slow |

Each query gets an `EXPLAIN` check in its test against a seeded database (100 groups, 20 000 tasks, 200 000 messages): no sequential scan on `messages` or `message_mentions`, and under 50 ms locally.

### Realtime

| event | room | payload | sent when |
|---|---|---|---|
| `admin:activity` | `admins` | `{ groupId, kind: 'chat' \| 'task' }` | after a group or task chat message is sent, edited or deleted, and after a task is created, edited, moved or deleted (sent next to the existing group-room events, after commit) |

Clients never receive it. The web coalesces bursts (2 s debounce) into one refetch per visible consumer.

### Web

- `features/admin-home/admin-shell.tsx`: sidebar + `<Outlet>`; collapse state.
- `features/admin-home/client-sidebar.tsx` (also the phone client list), `home-page.tsx`, `count-card.tsx` (one component for the three cards: `count`, `caption`, `subline`, `rows`, `showAll`), `count-tile.tsx` + sheet for phones.
- `features/global-board/global-board.tsx`: reuses `<TaskCard>` (Phase 8) with a `groupLine` slot, the task panel route, `<ClientFilter>` (Phase 17). If Phase 20 starts before Phase 17 has merged, it builds `<ClientFilter>` exactly as the Phase 17 spec describes it, in `components/client-filter.tsx`, and Phase 17 reuses it.
- `TasksTabBadge`: the yellow `<AssignedPill>` (new, 10 lines, eager).

## Error handling

- Every card and the sidebar fail independently: an error shows "Could not load this. Try again." in that block only.
- A dashboard item whose target was deleted meanwhile (task, message, knowledge item): the target page answers 404 and shows its existing "This task was deleted." / not-found state; the card's next refetch drops the item.
- A client calling any `/api/me/home/*` or `/api/tasks/global`: 403. A bad filter value (unknown `due`, malformed id) answers 400 `invalid_filter`, and the web resets that filter to its default.
- The reminders source throws: the endpoint answers `{ available: true, nextWeek: 0, items: [], error: true }` and the card shows its error line; the rest of the dashboard is unaffected.

## Testing

- **Server (test-first):**
  - sidebar: sections, the three tiers, name order, unread counts equal `unreadByGroup`, assigned counts exclude Completed and other users, a disabled manager's group is under "Other clients";
  - assigned tasks: the exact order (urgent with and without deadline, overdue, later, none), totals and urgent count, Completed excluded;
  - mentions: by name; @all only in managed groups; own messages, deleted messages and read ones excluded; a mention in a reply adds the thread read row and clears when the thread is read; task chat mentions with `taskId`; the 90-day bound; the cap;
  - reminders: no source → `available: false`; a fake source → items and `nextWeek`; a throwing source → `error: true`;
  - global board: default client set = managed, or all when none; every filter alone and combined; columns by kind with custom buckets in Other steps; Completed only with `completed=1` and within 30 days; per-column paging with keyset; one statement (query count asserted);
  - `mine-count`; clients get 403 on admin endpoints; `admin:activity` reaches only admins;
  - the `EXPLAIN` checks above.
- **Web:** the shell shows the sidebar only for admins and only ≥ 1024 px; collapse remembered; sidebar search; the count card layout and links; the phone tiles and sheets; the reminders card absent with `available: false` and the layout reflow; the Úlohy badge with both pills and its screen reader text; the global board filters round-trip through the URL; the client line on cards; the panel opens over the global board and closes back to it; debounced refetch on `admin:activity`.
- **E2E:** an admin who manages one of two groups; a client of the managed group mentions the admin and is assigned nothing; the admin's dashboard shows the mention, opens it at the message, and it disappears; a task assigned to the admin shows on the dashboard, in the sidebar's yellow pill and on the Úlohy tab; the global board defaults to the managed group, and adding the other group shows its tasks; on a 390 px viewport the home shows three tiles and the client list.

## Done when

On the local stack an admin lands on the dashboard and sees their assigned tasks in the owner's order, their unread mentions (and, once Phases 17 and 19 are merged, upcoming reminders), each opening its item; the sidebar lists managed clients apart from the others, ordered unread first then assigned, with black and yellow counts that follow live changes; the Úlohy tab shows both dots; the global board shows the managed clients' tasks by default and the filters work; on a phone the home collapses to tiles and the client list; the eager JS stays under 200 kB gzip.

## Documentation updates in this phase

`product/admin-home.md` (status), `product/task-board.md` (the global board, the Úlohy yellow dot), `product/chat.md` (a mention in a reply makes you one of the thread's people), `architecture/overview.md` (`modules/home`, the reminder source slot), `architecture/data-model.md` (the new indexes), `architecture/realtime.md` (`admin:activity`), `architecture/performance.md` (the measured eager size, the three lazy chunks, the resource bundles), `architecture/permissions.md` (admin-only home endpoints), `docs/design/tokens.md` (`--attention`, the count card, the sidebar, the tiles), glossary (dashboard, global board, assigned to me), `roadmap.md` (Phase 20 row, added by the controller).

## Out of scope

Drag and drop on the global board; creating tasks from the global board; customising or reordering dashboard cards; charts or statistics; a dashboard for clients; ticket and contract cards (Phases 12–15 may add cards with the same `count-card`); pinning or hiding clients in the sidebar; a "last activity" order; full-text search; unread task chats in the sidebar's black count (it stays the group chat count).
