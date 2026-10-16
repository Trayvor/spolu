# Spolu — Phase 18: Client managers (design)

Date: 2026-10-16 · Status: approved by the controller under the owner's overnight authorization (2026-10-16); rulings in 2026-10-16-phases-17-20-brief.md

Requirements: [client-managers](../../product/client-managers.md), [notifications](../../product/notifications.md), [roles-and-access](../../product/roles-and-access.md). Builds on [Phase 6](2026-10-16-phase-6-notifications-design.md) (group notification modes) and [Phase 9](2026-10-15-phase-9-task-chat-and-ai-design.md) (task chat, @all in task chats, the AI split). Used by [Phase 17](2026-10-16-phase-17-knowledge-base-design.md) (the default of the global knowledge list's client filter) and [Phase 20](2026-10-16-phase-20-admin-home-design.md) (the admin home).

Built on branch `phase-18`, cut from `main` **after Phases 9 and 6 have merged**. Phases 17 and 19 may run in parallel with it; they touch other modules. Phase 20 starts after this phase merges, because it needs the helpers below.

## Goal

An admin can become a **manager** of a client group, and stop being one, from the list of all clients. A group can have many managers, and an admin can manage many groups. Managers are the eGrant people "on" a client: only they (with the group's clients) appear in the mention and assignee pickers, @all reaches them, and their notifications for that client switch to All. Every other admin keeps full read and write access, but stays quiet by default.

## Owner decisions (cite: `.next-phases-brief.md`, part B.1 and the answers of 2026-10-16)

| question | decision |
|---|---|
| Becoming a manager | An admin can "become manager of a client" and stop being one. The button is in the view of all clients (B.1). |
| How many | Many-to-many: a group can have several managers, and an admin can manage several groups (controller ruling, recorded in the brief). |
| Pickers | Only managers can be @-mentioned in that client's chat or chosen as task assignees. Non-manager admins do not appear in the mention and assignee pickers (B.1). |
| @all | Reaches the group's clients and that client's managers. Non-manager admins are not reached by @all (answers). |
| Access | A non-manager admin can still read and write the chat and everything else (B.1). |
| Notification default | For all admins on all clients the default is Mentions only. Becoming a manager turns on All for that client, unless the admin changes the setting (B.1). |

## Controller rulings (technical; the owner may override)

- **Self-service only.** An admin makes only themselves a manager, or stops being one. Nobody assigns another admin as manager in this phase (out of scope; see the questions in the report).
- **Who counts as a manager.** An active admin or superadmin (`role in ('admin','superadmin')`, `disabled_at is null`) with a `group_managers` row. A disabled admin keeps the row but counts as nobody until re-enabled; a deleted user loses it by cascade. Clients can never be managers (the service refuses, and the route only acts on the caller, who must be an admin).
- **Two sets of people per group.** Today one set, `listGroupPeople`, decides both who reads the group and who is offered in pickers. This phase splits them:
  - **Readers** (unchanged): the group's named, verified, active clients and every active admin. They read and write; they get `chat.message` events (filtered by their mode in Phase 6); old mentions and assignees among them still render by name.
  - **Pickable people** (new): the group's named, verified, active clients and the group's active managers. Only they are offered in the mention and assignee pickers, accepted as new mentions and new assignees, reached by @all, and offered to the AI split.
- **`GET /api/groups/:id/people` keeps returning the readers**, with a new `isManager` flag on each `GroupPerson`. The web needs the readers anyway, to render names of people mentioned or assigned before (the chat's `nameOf`, the assignee chips). Pickers filter with the shared `isPickable(person)` = `!person.isAdmin || person.isManager`. One request, one cache key, no second list.
- **Mentions.** New mentions must be pickable; anything else answers 400 `invalid_mention`, as today. On edit, mentions already stored on the message stay valid (the existing rule in `editMessage`), so a message that mentioned someone who has since stopped managing the group can still be edited. Old messages render the name, because the person is still a reader.
- **@all.** `chat.mention` for a message with `mentions_all` goes to the pickable people (minus the author), not to every reader. `chat.message` still goes to every reader. Same in task chats (they use the same code).
- **Assignees.** A new assignee must be pickable; anything else answers 400 `invalid_assignee`, as today. **An existing assignment is kept**: when a task is edited, assignee ids that are already on the task stay valid even if that person is not a manager (any more). The same rule as for mentions on edit, so one mental model.
- **What the assignee picker shows for an existing non-manager assignee.** Their chip stays with their name, avatar and the "eGrant" pill, plus a muted note "not a manager" (`tasks.assignee.notManager`). The chip can be removed; once removed the person is not offered again. They are not in the drop-down list. Board cards show them like any assignee (no note there: the card stays quiet). A person who left the group entirely still shows "(removed)" as today.
- **The AI split** (Phase 9) gets the pickable people as `id — name`, and the server drops other assignee ids, as it already drops unknown ones.
- **Notification modes: materialised, not computed.** Phase 6 already has the per-group override table and the precedence "per-group row, then the user's all-groups default, then the role default" (admins: Mentions). This phase adds one column, `group_notification_settings.origin` (`'user'` | `'manager'`, default `'user'`):
  - **Becoming a manager** inserts `(user, group, 'all', origin 'manager')` **only if the admin has no row for that group** (`on conflict do nothing`). An existing row means the admin already chose a mode for this group themselves, and it is kept. The all-groups default does not block it: managing one client is more specific than a blanket choice, and "becoming manager turns on all notifications" is the owner's rule.
  - **Changing the mode with the bell** (Phase 6 `setGroupMode`) writes `origin 'user'`, also on conflict. From then on it is the admin's own choice.
  - **Stopping being a manager** deletes the row **only when `origin = 'manager'`**. The admin falls back to their all-groups default or the role default (Mentions). A mode the admin picked themselves stays.
  - Phase 6's "All groups at once" (`setDefaultMode`) deletes all of the user's rows, including manager rows, as it does today: the admin said every group follows one mode. Becoming a manager later inserts the All row again.
  - The delivery decision (`effectiveGroupMode`, `decideEvent`) does not change.
- **The bell explains itself.** When the current group's row has `origin 'manager'`, the bell menu shows one muted line under the options: "All messages, because you manage this client." `NotificationModes` gains `managerSet: string[]` (group ids whose row has origin `manager`).
- **Groups list data.** `GET /api/groups` (`GroupSummary`) gains `managers: { id, name }[]` (active managers, by name) and `managedByMe: boolean`. One extra aggregated join in `listGroups`, no N+1. Phase 17 and Phase 20 build their client filters from this list; no new endpoint.
- **The client filter belongs to Phase 17.** The Phase 17 spec builds `<ClientFilter>` ("Managed by you" / "Other clients") with a seam, `managedGroupIdsOf`, that returns null until this phase exists. Whichever of 17 and 18 merges second points that seam at `managedGroupIds` below. Phase 20 reuses the same component. This phase builds no filter UI of its own.
- **Realtime.** A new `admins` room: every admin socket joins it on connect (the server decides by role; no client request). After a manager change the server sends `group:managers { groupId, managers }` to `group:<id>` (pickers of everyone looking at the group refresh the people query) and to `admins` (every open groups list and client filter updates). Payload is small: ids and names.
- **No backfill.** The migration makes nobody a manager. Until admins opt in, the pickers of a group list only its clients, and @all reaches only clients. The release note and the Groups page hint say so. Open question for the owner: should the migration seed managers instead (for example from current task assignments)?

## User experience

All copy is the English source; Slovak goes in `sk.json`. Designed with `frontend-design` on the egrant.sk tokens (`docs/design/tokens.md`). The one new visual element is the manager toggle; everything else reuses the pickers, the bell and the groups list as they are.

### Groups page (the list of all clients)

Each row gains, on the right, the managers' avatars and one toggle button for the current admin. The bell from Phase 6 stays where it is.

```
Groups                                                       [ Create group ]
┌───────────────────────────────────────────────────────────────────────────┐
│ (logo) ABC s.r.o.        (2)   ●VH ●JN    [ ✓ Managing ]   🔔   12 members │
│ (logo) Obec Dolany              ●JN       [ Manage     ]   🔔@   4 members │
│ (logo) Nadácia Krok                       [ Manage     ]   🔔@   7 members │
└───────────────────────────────────────────────────────────────────────────┘
  Clients with no manager: only their own people can be mentioned or assigned.
```

- **Toggle**: a small pill button (`size="sm"`). Not managing: secondary pill "Manage". Managing: filled ink pill with a check, "Managing". Clicking toggles at once (optimistic, rolled back on error) and does not navigate (the row is a link; the button stops propagation and has its own focus ring). `aria-pressed` carries the state; the accessible name is "Manage ABC s.r.o." in both states.
- **Managers' avatars**: up to 3 overlapping 24 px avatars, then "+2"; the names are in a visually hidden list next to them. A group with no managers shows nothing there.
- **Order** stays alphabetical in this phase (Phase 20 moves the list into the sidebar with its own order).
- Under 641 px the row wraps into two lines: logo, name and unread on the first; avatars, toggle, bell and members on the second.
- When the admin becomes a manager and had no own mode for that group, the bell turns to "All" at once and a toast says "You manage ABC s.r.o. now. Notifications: all messages." Stopping: "You no longer manage ABC s.r.o." (and "Notifications: mentions and replies" when the manager row was removed).

### Members tab

Above the clients, a short read-only section "eGrant managers" lists the active managers (avatar, name). No managers: "No eGrant manager yet." Admins get a link "Change on the Groups page".

### Pickers

- **Mention picker** (chat and task chat): "Everyone in this group" first, then clients and managers. Managers keep the "eGrant" pill. Non-manager admins are not listed. The "Everyone" row's hint reads "The group's clients and its eGrant managers".
- **Assignee select**: the same people. An existing non-manager assignee shows as a chip with "not a manager" in `muted-foreground` and the remove button. When the list is empty for a query and the user is an admin who is not a manager, the empty line says "Only clients and the client's managers can be assigned."
- The AI review dialog uses the assignee select, so it follows automatically.

## Architecture

### Data

| table | columns |
|---|---|
| `group_managers` (new, `modules/groups`) | `group_id` (FK groups, cascade), `user_id` (FK user, cascade), `created_at`. PK (`group_id`, `user_id`); index (`user_id`) for `managedGroupIds` and the dashboard joins. |
| `group_notification_settings` (Phase 6, changed) | adds `origin text not null default 'user'`, CHECK `origin in ('user','manager')`. |

Migration `00xx_group_managers`: the new table, the column with its default (existing rows become `user`, which is what they are). No data backfill.

### Server helpers (`modules/groups/managers.ts`)

These are the names other phases use.

| helper | what |
|---|---|
| `isGroupManager(db, groupId, userId): Promise<boolean>` | an active admin with a row for the group. One indexed lookup. |
| `managedGroupIds(db, userId): Promise<string[]>` | the groups this user actively manages (empty for clients and disabled admins). Phase 17's `managedGroupIdsOf` seam (it calls it `listManagedGroupIds`) calls this. |
| `managedGroupsSql(userId): SQL` | the same as a subquery fragment (`select group_id from group_managers gm join "user" u … where gm.user_id = $1 and u.disabled_at is null`), for other modules' single-statement queries (Phase 17 default filter, Phase 20 sidebar and board). |
| `listGroupManagers(db, groupId): Promise<GroupManager[]>` | `{ id, name }` of active managers, by name. |
| `addManager(db, groupId, userId)` / `removeManager(db, groupId, userId)` | one transaction each: the row, and the notification row rule above (insert `all`/`manager` on conflict do nothing; delete where `origin = 'manager'`). Idempotent; return whether anything changed and the new managers list. |

In `modules/groups/service.ts`:

| helper | what |
|---|---|
| `listGroupPeople(db, groupId)` | **unchanged meaning** (readers), plus `isManager` per row (a left join on `group_managers`). Phase 6's delivery check (`isGroupPerson` in `decideEvent`) keeps using readers. |
| `isGroupPerson(db, groupId, userId)` | unchanged (reader). |
| `listPickablePeople(db, groupId)` (new) | clients as today, union managers instead of every admin. Used by chat (`sendMessage`, `editMessage`) for mention validation and @all, and by the AI split. |
| `isPickablePerson(db, groupId, userId)` (new) | the same condition for one user. Used by task create and edit for new assignees. |

`packages/shared/src/groups.ts`: `GroupPerson` gains `isManager: boolean`; `isPickable(person)`; `GroupManager = { id, name }`; `GroupSummary` gains `managers: GroupManager[]` and `managedByMe: boolean`. `packages/shared/src/notifications.ts`: `NotificationModes` gains `managerSet: string[]`.

### Changes in other modules

- `modules/chat/messages.ts`: `sendMessage` validates mentions against `listPickablePeople`; `chat.mention` for @all goes to the pickable people; `chat.message` and the thread people filter keep the readers (`listGroupPeople`). `editMessage`: pickable people plus mentions already stored.
- `modules/tasks/task-service.ts`: create checks `isPickablePerson` for every assignee; update checks `isPickablePerson` only for ids **not already assigned** to the task (read under the existing row lock).
- `modules/ai/split.ts`: the people list is `listPickablePeople`.
- `modules/notifications/modes.ts`: `setGroupMode` writes `origin: 'user'` in both the insert and the conflict update; `getModeSettings` returns `managerSet`.

### Endpoints

| method | path | what |
|---|---|---|
| PUT | `/api/groups/:id/managers/me` | admin only (`requireAdmin`); makes the caller a manager. 200 `{ managers, managedByMe: true, mode }` (`mode` is the caller's effective mode for the group, so the bell updates without a refetch). Idempotent. Unknown group: 404. |
| DELETE | `/api/groups/:id/managers/me` | admin only; stops. 200 `{ managers, managedByMe: false, mode }`. Idempotent. |
| GET | `/api/groups` | as today, with `managers` and `managedByMe`. |
| GET | `/api/groups/:id/people` | as today, with `isManager`. |
| GET | `/api/notifications/modes` | as today, with `managerSet`. |

Rate limit: the existing per-user write limit. Policy: `canBeManager(actor)` = `isAdmin(actor)` in `modules/groups/policy.ts`, written test-first. A client calling either route gets 403 (`requireAdmin`).

### Realtime

| event | room | payload | sent when |
|---|---|---|---|
| `group:managers` | `group:<id>` and `admins` | `{ groupId, managers: GroupManager[] }` | after an add or remove that changed something |

The `admins` room is joined on connect by every socket whose user is an admin (`infra/realtime`), and left when an admin is disabled (the existing session disconnect covers it). Web: the people query of that group is invalidated, the groups list patches `managers` and recomputes `managedByMe` from the session id; Phase 17's client filter reads the same groups query, so it re-renders too.

## Error handling

- Both manager routes are idempotent, so a double click or a retry is harmless; the optimistic toggle rolls back on any non-2xx with "Could not change it. Try again."
- A mention of a non-pickable person (an old client tab with a stale people list, or a crafted request): 400 `invalid_mention`. The composer keeps the text and shows "Someone you mentioned can't be mentioned here any more." and refetches the people.
- A new non-pickable assignee: 400 `invalid_assignee`; the task form refetches the people and shows "Someone you chose can't be assigned here any more."
- A disabled admin who still has rows: invisible everywhere (all helpers filter on `disabled_at is null`).

## Testing

- **Server (test-first):**
  - policy: admin yes, client no;
  - `addManager` / `removeManager`: idempotent; many managers per group, many groups per admin; a client id refused;
  - the notification rule, row by row: no row → `all/manager` inserted; an existing `user` row (any mode) kept; stop deletes only `manager` rows; a bell change after becoming manager flips origin to `user` and survives stopping; "All groups" removes manager rows; the effective mode for a manager with an all-groups default of Off is All;
  - `isGroupManager`, `managedGroupIds`, `managedGroupsSql`: disabled admins excluded;
  - `listGroupPeople` carries `isManager`; `listPickablePeople` = clients + active managers;
  - chat: mentioning a non-manager admin → 400; editing a message that mentions a former manager keeps working; @all records `chat.mention` for clients and managers only; `chat.message` still reaches every reader;
  - tasks: assigning a non-manager → 400; editing a task whose assignee is no longer a manager (title change, assignee list unchanged) → 200; re-adding that person after removing them → 400;
  - AI split: the prompt lists pickable people only; other ids dropped;
  - `GET /api/groups` with managers and `managedByMe` in one query (query count asserted);
  - `group:managers` reaches the group room and the admins room, not a client of another group.
- **Web:** the toggle (optimistic, rollback, `aria-pressed`, does not navigate); the managers' avatars; the mention picker and assignee select filter non-managers; the "not a manager" chip; the bell's manager line.
- **E2E (two browsers):** admin A becomes manager of a group; admin B (not a manager) types `@` in that group's chat and sees the client and A, not themselves; B sends `@all`; A's notification record exists, B's does not; A stops managing and disappears from the client's picker live.

## Done when

On the local stack, two admins and a client: admin A becomes manager of the client from the Groups page and sees the bell switch to All; the client's mention and assignee pickers show A but not admin B; @all notifies the client and A; B can still read and write everything; a task assigned to B before keeps B; A stops managing and falls back to Mentions.

## Documentation updates in this phase

`product/client-managers.md` (status), `product/notifications.md` (the manager rule and origin), `product/roles-and-access.md` (managers are admins with a per-group flag, not a role), `product/chat.md` (@all and pickers), `product/task-board.md` (assignees), `architecture/data-model.md` (`group_managers`, `origin`), `architecture/permissions.md` (readers vs pickable people, the policy), `architecture/realtime.md` (`admins` room, `group:managers`), `architecture/overview.md` (the helpers as the cross-module API), `docs/design/tokens.md` (the manager toggle), glossary (manager, pickable people), `roadmap.md` (Phase 18 row, added by the controller).

## Out of scope

Assigning someone else as manager, a "lead" manager or roles inside the managers, limiting what non-manager admins can read or write, notifying admins when someone becomes a manager, a manager-only view of tickets or contracts (Phases 12–15 may use `managedGroupIds` later), the admin home and sidebar (Phase 20), backfilling managers from history.
