# The dashboard follows the notification settings (design)

Date: 2026-10-17 · Status: approved by the owner (2026-10-17); a Phase 27 follow-up, see the [roadmap](../../roadmap.md).

Builds on [notification groups](2026-10-16-notification-groups-design.md), [Phase 6](2026-10-16-phase-6-notifications-design.md), the [admin home](2026-10-16-phase-20-admin-home-design.md) and [meetings](2026-10-17-knowledge-meetings-design.md). Requirements: [notifications](../../product/notifications.md), [admin home](../../product/admin-home.md).

## Principle (owner)

The dashboard shows only what the person was, or would be, notified about under their notification settings. The rules below mirror the delivery rules exactly (`notificationGroupOf`, `passesMode`, and `recordNotifications` skipping a `none` channel); the SQL lives in the notifications module (`modules/notifications/follows.ts`), so `modules/home` and `modules/knowledge` never read the notification tables themselves.

## 1. Mentions card

A mention is listed only when it would notify the viewer:

| the message is in | listed when |
|---|---|
| a ticket chat | the viewer's **Ticket board** channel is not None (ticket events pass every mode, Off included) |
| a task chat | the **Task board** channel is not None **and** the viewer's mode for the group is not Off |
| the group chat | the **Chat** channel is not None **and** the mode for the group is not Off |

All messages and Mentions and replies both list mentions (a mention passes both). The effective mode is the delivery's: the per-group choice, else the user's default for all groups, else the role default (clients All messages, admins Mentions and replies). The count is the count of the listed (notifying) mentions.

## 2. Admin sidebar unread counts

A group's unread number is 0 when its group chat would never notify the admin: their mode for the group is **Off**, or their **Chat** channel is **None** (then every group shows 0). Under Mentions and replies the number still counts every unread message (the Chat tab's number), since the group's chat does notify (mentions, replies). The row itself stays, and its section order uses the shown number. Still one statement: the channel is one lookup of the admin's row and the mode one primary key lookup per group (`group_notification_settings`), checked by the EXPLAIN test on the seeded volume.

## 3. Unchanged

The Tickets card, My tasks and Upcoming reminders show assigned work whatever the settings (owner).

## 4. Meeting notifications

A fifth notification group **Meetings** (`meetings`; default **Push**; SK "Stretnutia"), on `/settings` for everyone except requester-only people (they see only Ticket board). It covers:

| kind | when | to whom | modes it passes |
|---|---|---|---|
| `meeting.scheduled` | a meeting is created with a start in the future | the group's people (its clients and every admin; only admins for an admins-only meeting), not its author | **All messages** only |
| `meeting.rescheduled` | an edit changes the start, and the new start is in the future | the same | **All messages** only |
| `meeting.summary_ready` | an AI run ("Spracovať s AI") ends with a summary | the admin who pressed the button | every mode, Off included |
| `meeting.summary_failed` | the run failed for good (after its retries) | the admin who pressed the button | every mode, Off included |
| `reminder.due` of a meeting | the meeting's own optional reminder fires | its recipients (reminders module, unchanged) | every mode, Off included (as every reminder) |

- **No second reminder.** A meeting already has an optional reminder (the form proposes 15 minutes before). It is the meeting's reminder notification; there is no automatic "starts soon" event on top, so nobody is notified twice. Its events now belong to the Meetings group (the payload carries `meeting: true`); other knowledge reminders stay in Knowledge base.
- Push: title "<meeting title> · <client>", text "New meeting: Thu 22 Oct, 10:00" / "Meeting moved to Thu 22 Oct, 10:00" / "AI summary is ready" / "AI processing failed"; opens the item in the group's Knowledge tab, device tag `knowledge:<id>` (shared with its reminder). Email digest: "<title>: <text>" with "Open meeting" to the item.
- Who counts: delivery's audience check (a person of the group now), the channel, and the mode as in the table. An admin who does not manage the client stays on Mentions and replies by default, so only clients (All messages by default) and the client's managers (All messages when they become manager) hear about scheduling: not noisy for the team.

### Meetings card

The card keeps its scope (the clients the admin manages, every client when none) and lists only meetings the admin gets meeting notifications for: their **Meetings** channel is not None, and either their mode for the meeting's group is **All messages** (they hear its scheduling) or they are a recipient of the meeting's reminder (reminders pass every mode). Counts follow the same rule.

## Owner decisions (2026-10-17)

1. Mentions and sidebar mirror delivery exactly (table above); Mentions and replies still counts every unread message in the sidebar.
2. Chat channel None hides every group's sidebar number.
3. Meetings get their own notification group, default Push (not email: low noise), shown to everyone but requester-only people.
4. Scheduling and rescheduling notify only under All messages; an AI result notifies only the admin who started the run, in every mode.
5. The meeting's existing optional reminder is its only reminder; it moves to the Meetings group. No automatic reminder.
6. A meeting created or moved into the past notifies nobody; deleting a meeting notifies nobody (later, if wanted).
7. The Meetings card follows the rule above inside its old scope; an admin who manages no client and keeps the default mode sees only meetings whose reminder they get.

## Storage

No migration: channels live in `user.notification_channels` (a missing key is the default), the requester of an AI run travels in the job's data (`requestedBy`; a job queued before this change notifies nobody).

## Testing

Server tests first: `notificationGroupOf` and `passesMode` for the new kinds; push and digest texts; recording on create, reschedule and the AI run (author left out, admins only for an admins-only meeting, nothing for the past); the Mentions card per row of the table; the sidebar for Off, None and Mentions and replies; the Meetings card for each rule; the EXPLAIN check of the sidebar and mentions queries. Web: the fifth row on `/settings`. E2E: the settings spec lists the Meetings row.
