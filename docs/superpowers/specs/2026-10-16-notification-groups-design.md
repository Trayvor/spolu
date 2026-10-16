# Spolu — Notification groups in the profile (brief item C, design)

Date: 2026-10-16 · Status: draft for the owner's review

Brief: [2026-10-16-next-work.md](../briefs/2026-10-16-next-work.md), item C. Builds on [Phase 6](2026-10-16-phase-6-notifications-design.md) (delivery, modes, profile), [Phase 17](2026-10-16-phase-17-knowledge-base-design.md) and [Phase 19](2026-10-16-phase-19-task-reminders-design.md) (`reminder.due`). Requirements: [notifications](../../product/notifications.md), [profile](../../product/profile.md).

Built in parallel with item A (the "only where I take part" board filter) and the spec of item B (tickets). This work touches neither: no task board filter, no ticket tables, no `ziadatel` role.

## Goal

Each user picks, per **notification group**, how they hear about it: **email**, **push**, **both** or **none**. The groups are **chat**, **task board**, **ticket board** and **knowledge base**. Defaults: ticket board both, every other group push only. The groups replace the two global switches (Push, Email) of Phase 6. Item B (tickets) can use the ticket board group without changing this work's code paths, only adding its event kinds to one classification function.

## Owner decisions (2026-10-16)

| question | decision |
|---|---|
| Relation to the Push and Email switches | The groups **replace** them. The per-group bell mode (All / Mentions and replies / Off) stays: it decides *what* arrives, the notification group decides *by which channel*. |
| Task chat | Messages in a task's chat belong to the **task board** group. A task's custom reminder too; a Knowledge base reminder belongs to **knowledge base**. |
| Existing users | Everyone starts on the new defaults; the old switches are not carried over. |
| Ticket board row before item B | Shown right away, for every role. |
| iOS without web push (the Phase 6 fallback) | Once per user, every group set to push becomes both. Email, both and none stay. A later manual change is never undone. |

## Model

### Shared (`packages/shared/src/notifications.ts`)

- `NotificationCategories = ['chat', 'tasks', 'tickets', 'knowledge'] as const`, type `NotificationCategory`. The UI order is this order.
- `NotificationChannels = ['email', 'push', 'both', 'none'] as const`, type `NotificationChannel`.
- `DEFAULT_CHANNELS: Record<NotificationCategory, NotificationChannel>` = `{ chat: 'push', tasks: 'push', tickets: 'both', knowledge: 'push' }`.
- `wantsPush(channel)` (push or both) and `wantsEmail(channel)` (email or both).
- `resolveChannels(stored: Partial<Record<…>>)`: the stored choices over the defaults, so every category has a value.
- `visibleCategories(role)`: every category for every role today. Item B adds the `ziadatel` branch (only `tickets`). The profile shows only these rows, and the server refuses to set any other (`validation_failed`).
- `NotificationPrefsSchema` becomes `{ channels: Record<NotificationCategory, NotificationChannel>, vapidPublicKey: string | null }`. `NotificationPrefsPatchSchema` becomes `{ category, channel }` (strict). `NotificationFallbackSchema` stays the prefs plus `turnedOn`.
- `pushEnabled` and `emailEnabled` disappear from the shared types.

### Storage

- `user.notification_channels jsonb not null default '{}'`: only the user's own choices, keyed by category. A missing key means the category's default, so a new category (or a changed default) needs no data migration.
- `user.push_enabled` and `user.email_enabled` are dropped. That is the reset to defaults the owner asked for. `user.email_fallback_at` stays.
- The migration is generated with `pnpm --filter @spolu/server db:generate`.
- No new index: nothing filters by this column; delivery reads it with the user row it already loads.

### Which group an event belongs to

One pure function in `apps/server/src/modules/notifications/categories.ts`:

`categoryOf(kind: NotificationKind, payload: Record<string, unknown>): NotificationCategory`

| kind | category |
|---|---|
| `chat.message`, `chat.mention`, `chat.thread_reply` without `taskId` in the payload | chat |
| the same with `taskId` (task chat) | tasks |
| `task.moved`, `task.assigned`, `task.deadline`, `task.urgent` | tasks |
| `reminder.due` with `subjectKind: 'task'` | tasks |
| `reminder.due` with `subjectKind: 'knowledge'` | knowledge |

It is the only place that maps events to groups. It is exhaustive over `NotificationKind` (a `switch` with a `never` check), so a new kind does not compile until it is classified.

### How item B uses the ticket board group

Item B only:
1. adds its kinds to `NotificationKinds` (for example `ticket.created`, `ticket.changed`) and to `KIND_RANK`;
2. classifies them in `categoryOf` as `tickets`, and a ticket chat message (a `chat.*` event carrying `ticketId`) as `tickets` too;
3. adds the `ziadatel` branch to `visibleCategories`.

Recording (`recordNotifications`), delivery, the email digest, the API and the profile row already handle `tickets` with its default both. The ticket-created email to a requester (item B) is a direct message, not a notification, and does not go through these settings.

## Server

- **`recordNotifications`** takes the category from `categoryOf(kind, payload)` and marks an event delivered at insert when the recipient's channel for that category can send nothing:
  - disabled user → delivered;
  - channel wants email → pending;
  - channel wants push and the user has a push subscription → pending;
  - otherwise → delivered.

  The channel is read in the same statement: `coalesce(u.notification_channels ->> $category, $default)`.
- **`decideEvent`** takes `channel: NotificationChannel` instead of `pushEnabled` and `emailEnabled`: push when `wantsPush(channel)`, the server has push and the user has a device; email when `wantsEmail(channel)`. The mode filter, read marks, actor and membership rules are unchanged.
- **Delivery** (`deliverBatch`): `reachable` and the decision use each event's own channel. `NotificationProfile` carries `channels` (resolved) instead of the two booleans.
- **Email digest**: an event goes out by email only if its category still wants email when the digest is due (switching a group away from email before then means no email, as switching email off does today). One email per user and group stays; it may now mix chat and task lines only if both groups want email.
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
  - `categoryOf`, row by row of the table above;
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
