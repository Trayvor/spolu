# Spolu — Notification groups in the profile (brief item C, design)

Date: 2026-10-16 · Status: draft for the owner's review

Brief: [2026-10-16-next-work.md](../briefs/2026-10-16-next-work.md), item C. Builds on [Phase 6](2026-10-16-phase-6-notifications-design.md) (delivery, modes, profile), [Phase 17](2026-10-16-phase-17-knowledge-base-design.md) and [Phase 19](2026-10-16-phase-19-task-reminders-design.md) (`reminder.due`). Requirements: [notifications](../../product/notifications.md), [profile](../../product/profile.md).

Built in parallel with item A (the "only where I take part" board filter) and item B (tickets). This work touches neither: no task board filter, no ticket tables, no `ziadatel` role. Item B's session asked for the contract in [How item B uses the ticket board group](#how-item-b-uses-the-ticket-board-group); this spec follows it.

## Goal

Each user picks, per **notification group**, how they hear about it: **email**, **push**, **both** or **none**. The groups are **chat**, **task board**, **ticket board** and **knowledge base**. Defaults: ticket board both, every other group push only. The groups replace the two global switches (Push, Email) of Phase 6. Item B (tickets) can use the ticket board group without changing this work's code paths, only adding its event kinds to one classification function.

## Owner decisions (2026-10-16)

| question | decision |
|---|---|
| Relation to the Push and Email switches | The groups **replace** them. The per-group bell mode (All / Mentions and replies / Off) stays: it decides *what* arrives, the notification group decides *by which channel*. |
| Task chat | Messages in a task's chat belong to the **task board** group. A task's custom reminder too; a Knowledge base reminder belongs to **knowledge base**. |
| Existing users | Everyone starts on the new defaults; the old switches are not carried over. |
| Ticket board row before item B | Shown right away, for every user. |
| Ticket events and the bell mode | Ticket events pass every mode; only the `tickets` channel decides (item B's request). |
| iOS without web push (the Phase 6 fallback) | Once per user, every group set to push becomes both. Email, both and none stay. A later manual change is never undone. |

## Model

### Shared (`packages/shared/src/notifications.ts`)

- `NotificationCategories = ['chat', 'tasks', 'tickets', 'knowledge'] as const`, type `NotificationCategory`. The UI order is this order.
- `NotificationChannels = ['email', 'push', 'both', 'none'] as const`, type `NotificationChannel`.
- `DEFAULT_CHANNELS: Record<NotificationCategory, NotificationChannel>` = `{ chat: 'push', tasks: 'push', tickets: 'both', knowledge: 'push' }`.
- `wantsPush(channel)` (push or both) and `wantsEmail(channel)` (email or both).
- `resolveChannels(stored: Partial<Record<…>>)`: the stored choices over the defaults, so every category has a value.
- `NotificationPrefsSchema` becomes `{ channels: Record<NotificationCategory, NotificationChannel>, visibleCategories: NotificationCategory[], vapidPublicKey: string | null }`. The web shows the rows the server lists in `visibleCategories`; it has no role logic of its own. `NotificationPrefsPatchSchema` becomes `{ category, channel }` (strict). `NotificationFallbackSchema` stays the prefs plus `turnedOn`.
- `pushEnabled` and `emailEnabled` disappear from the shared types.

### Storage

- `user.notification_channels jsonb not null default '{}'`: only the user's own choices, keyed by category. A missing key means the category's default, so a new category (or a changed default) needs no data migration.
- `user.push_enabled` and `user.email_enabled` are dropped. That is the reset to defaults the owner asked for. `user.email_fallback_at` stays.
- The migration is generated with `pnpm --filter @spolu/server db:generate`.
- No new index: nothing filters by this column; delivery reads it with the user row it already loads.

### Which group an event belongs to

One map and one function in `apps/server/src/modules/notifications/categories.ts`:

- `NOTIFICATION_GROUP_OF: Record<NotificationKind, NotificationCategory>`, the one place that maps a kind to its group:

  | kind | group |
  |---|---|
  | `chat.message`, `chat.mention`, `chat.thread_reply` | chat |
  | `task.moved`, `task.assigned`, `task.deadline`, `task.urgent` | tasks |
  | `reminder.due` | tasks |

- `notificationGroupOf(kind: string, payload: Record<string, unknown>): NotificationCategory | null` reads the map and refines two cases by the payload:
  - a `chat.*` event with `taskId` (task chat) → `tasks`;
  - `reminder.due` with `subjectKind: 'knowledge'` → `knowledge`.

  A kind missing from the map (an old row of a kind that no longer exists) gives `null`. It never throws: `recordNotifications` stores such an event already delivered, and delivery and the digest skip it with a warning, as delivery does today for unknown kinds.

### Ticket events skip the group mode

The bell mode (All / Mentions and replies / Off) is about a client group's chat and tasks. Ticket events go to people who follow the ticket (or own it), which is an explicit choice, so **every event of the `tickets` group passes every mode**, Off included. Only the `tickets` channel decides how it arrives. `passesMode` takes the event's group: `tickets` → always true; `reminder.due` → always true (unchanged); the rest as today. Membership of the event's client group is still required (item B makes requesters members, see below).

### Ticket events without a client group, and who counts as a group person

Two rules for the `tickets` group only (item B's request); every other group keeps today's rules.

- **No client group.** A ticket event may have `groupId = null` (for example `ticket.unassigned`, which goes to the admins before a client is known). Such an event skips the membership check: the module that records it chooses the recipients. An event of any other group without a client group stays a bug upstream: it is logged and dropped, as today. Its push title and its digest email come from item B's branches (below); the digest groups these events per user under no client group.
- **Who counts as a group person.** Delivery asks `notificationAudience(db, groupId, group): Promise<Set<string>>` in `categories.ts` who belongs to the event's client group. Today it is the group's people (`listGroupPeople`: its clients and every admin) for every group. Item B-1 changes only this function: for `tickets`, members with the `ziadatel` role count too; for every other group they do not (B-1 keeps them out of `listGroupPeople`, or filters them here).

### How item B uses the ticket board group

The key is `tickets`; channels `email | push | both | none`; default `both`. Item B only:
1. adds its kinds to `NotificationKinds` (`ticket.created`, `ticket.unassigned`, `ticket.message`, `ticket.status`, `ticket.updated`, `ticket.tasks`), to `KIND_RANK` and to `NOTIFICATION_GROUP_OF` as `tickets` (the compiler asks for both maps once the kinds exist);
2. adds a branch for them to `buildPushPayload` (push title, body, url, tag) and to `digestEntry` (below, with its own `topic`, for example "Ticket #123"), carrying in the payload what those need (ticket number, subject, author, excerpt);
3. changes `visibleCategoriesFor(db, user)` (below) to return only `['tickets']` for a requester-only user, and `notificationAudience` (above) to count `ziadatel` members for `tickets` only. B-1 defines that as a user who is not an admin and has no active `client` membership (`group_members.role`), through a function such as `isRequesterOnly(user)`.

Recording, the decision, the mode bypass, the email batching, the API and the profile row already handle `tickets` with its default both. The ticket-created email to a requester (item B) is a direct message, not a notification, and does not go through these settings.

## Server

- **`visibleCategoriesFor(db, user): Promise<NotificationCategory[]>`** in `categories.ts`: all four groups for every user today. Item B-1 narrows it for requester-only users. The prefs API, the PATCH check and the iOS fallback use it.
- **`recordNotifications`** takes the group from `notificationGroupOf(kind, payload)` (`null` → recorded already delivered) and marks an event delivered at insert when the recipient's channel for that category can send nothing:
  - disabled user → delivered;
  - channel wants email → pending;
  - channel wants push and the user has a push subscription → pending;
  - otherwise → delivered.

  The channel is read in the same statement: `coalesce(u.notification_channels ->> $category, $default)`.
- **`decideEvent`** takes the event's `group` and `channel: NotificationChannel` instead of `pushEnabled` and `emailEnabled`: push when `wantsPush(channel)`, the server has push and the user has a device; email when `wantsEmail(channel)`. The mode filter, read marks, actor and membership rules are unchanged.
- **Delivery** (`deliverBatch`): `reachable` and the decision use each event's own channel. `NotificationProfile` carries `channels` (resolved) instead of the two booleans.
- **Email digest**: an event goes out by email only if its group still wants email when the digest is due (switching a group away from email before then means no email, as switching email off does today).
  - Each event becomes a digest entry through one function, `digestEntry(row, ctx): { line: string; url: string; button: string; topic: string } | null`, in `digest-entries.ts`: chat lines ("Jana: text"), task lines, reminder lines, each with the group chat link, "Open <group>" and the topic the subject names ("3 new messages in <topic>"), the group's name, as today. A kind it does not know, or an event of another group than `tickets` without a client group, gives `null` (skipped, never thrown). `ctx.groupId` and `ctx.groupName` are null for an event without a client group.
  - The rows of one user and group (still locked together, as today) are split into emails by the entries' `url`: today every entry has the group chat url, so it stays one email per user and group. Item B returns, for ticket kinds, the line "#123 Subject: Jana: text", `url` `/tickets/<id>` and a button "Open ticket", so each ticket gets its own email.
- **API** (all for the signed-in user only):
  - `GET /api/notifications/preferences` → `{ channels, vapidPublicKey }`, every category resolved;
  - `PATCH /api/notifications/preferences` with `{ category, channel }` → the new prefs; an unknown category or channel, or a category not visible to the role, answers 400 `validation_failed`. It stores the value with `jsonb_set`, so concurrent changes of two groups do not overwrite each other;
  - `POST /api/me/notification-fallback` → once per user (`email_fallback_at`), every visible category whose resolved channel is push is stored as both; `turnedOn` is true when any category changed. The update is one statement guarded by `email_fallback_at is null`.

## Web

- **Notifications card on `/settings`:**
  - **This device**, at the top: the existing `DeviceLine` (on / not set up with "Turn on for this device" / blocked with how to unblock / the iPhone Home Screen hint / not supported). Shown when push is configured on the server and at least one visible group wants push. Without VAPID keys: "Push notifications are not available on this server", and the Push and Both choices are disabled.
  - **One row per visible group**, in the order chat, task board, ticket board, knowledge base: the group's name, one line of what it covers, and the existing `Select` with Email, Push, Email and push, None.
    - Chat: "Messages, mentions and replies in group chats."
    - Task board: "Task moves, assignments, deadlines, reminders and task chats."
    - Ticket board: "Support tickets and their conversations."
    - Knowledge base: "Knowledge base reminders."
  - A change saves at once (optimistic) and rolls back with the existing error line when the save fails.
  - Choosing Push or Email and push while this device is not set up subscribes the device in the same gesture, before the save (the browser asks for permission only inside a user gesture), as the Push switch does today.
  - The exact look is made with the `frontend-design` skill, to match egrant.sk.
- **`<AppPrompt>`**: the "turn on notifications on this device" card's condition `pushEnabled` becomes "at least one visible group wants push". The iOS fallback card keeps its three texts: turned on; already on (some group already wanted email); off (no group wants email, with where to turn it on).
- **Texts**: every new string in `apps/web/src/locales/{en,sk}.json` under `settings.notifications.*`; the old switch keys are removed.

## Error handling

No new error codes. A bad PATCH body is `validation_failed`. A stored value outside `NotificationChannels` (only possible by hand in the database) is ignored and the default applies.

## Testing

- **Shared**: `resolveChannels` fills defaults and keeps choices; `wantsPush` and `wantsEmail` for each channel; the schemas accept each category and channel and refuse others.
- **Server, unit**:
  - `notificationGroupOf`, row by row of the table above, plus an unknown kind → `null`;
  - delivery and digest of a `tickets` event without a client group (a test kind mapped to `tickets` through a module mock, since no ticket kind exists yet): delivered to a recipient who is no group's member, one digest email with the entry's topic; a `chat` event without a client group is still dropped;
  - `passesMode`: a `tickets` event passes Off (tested with a `tickets` group passed in, since no ticket kind exists yet);
  - `digestEntry`: each current kind gives the line and group url it gives today; an unknown kind → `null`;
  - `decideEvent` for each channel, with and without a device, with push unavailable.
- **Server, integration** (test database):
  - `recordNotifications`: delivered at insert for none, for push without a device and for a disabled user; pending for email, both, and push with a device; per category (chat none and tasks email for the same user give different results);
  - delivery: push only for groups that want push; digest only for groups that want email (chat push, tasks both → the email has only the task line); a group switched away from email before the digest is due sends nothing;
  - routes: GET resolves defaults for a new user; PATCH stores one group and leaves the others; invalid category or channel → 400; another user's settings are never touched;
  - fallback: push → both once, email/both/none kept, `turnedOn` false when nothing changed, a second call changes nothing, a later manual change is kept.
- **Web**:
  - the card shows four rows with the resolved values and the device line;
  - a change is optimistic and rolls back on failure;
  - choosing push on a device that is not set up subscribes it;
  - without VAPID keys, push choices are disabled;
  - `choosePrompt` with "some group wants push" and "none wants push".
- **E2E**: the existing push and email tests move to the new settings (for example, the email digest test sets chat to Email and push through the profile).

## Done when

On the local production-like stack:
- the profile shows the four groups with their defaults (ticket board Email and push, the rest Push);
- a client with chat set to None gets no push for a message, and with chat Email gets a batched email;
- with the task board on Push and chat on None, moving a task notifies, and a chat message does not;
- the iOS fallback turns Push groups into Email and push once.

## Documentation updates

`product/notifications.md` (delivery channels become notification groups; the fallback), `product/profile.md` (the Notifications section), `architecture/data-model.md` (`user.notification_channels`, the dropped columns), `glossary.md` (notification group, channel), `roadmap.md` (item C with this spec and its plan).

## Out of scope

Tickets and the `ziadatel` role (item B); the board filter (item A); a different channel per client group; quiet hours; notification history.
