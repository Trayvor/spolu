# Spolu — Phase 19: Task reminders (design)

Date: 2026-10-16 · Status: written spec awaiting the owner's review

Requirements: [reminders](../../product/reminders.md), [task-board](../../product/task-board.md), [notifications](../../product/notifications.md). Roadmap entry: Phase 19 (added to `docs/roadmap.md` when the phase starts). Builds on [Phase 17](2026-10-16-phase-17-knowledge-base-design.md) (the reminders module), [Phase 6](2026-10-16-phase-6-notifications-design.md) (the automatic deadline and urgent reminders, the delivery pipeline) and [Phase 9](2026-10-15-phase-9-task-chat-and-ai-design.md) (the task panel).

Built on branch `phase-19`, cut from `main` after Phase 17 has merged. It is independent of Phase 18 and can run in parallel with it. This branch touches `modules/reminders` (the task subject), `modules/tasks` (the adapter, the board query's reminder count), the reminders `.ics` builder (the deadline event), `features/tasks` (the panel section, the card icon), one migration, the reminders locale files and docs.

## Goal

Anyone working on a task can set their own reminders on it: one or more date-times, sent to themselves and to the people they add. Others can subscribe to the reminders themselves. The task's deadline and all its custom reminders export to a calendar as one `.ics` file. The automatic deadline and urgent reminders from Phase 6 stay as they are.

## Owner decisions (brief of 2026-10-16, part A and the owner answers)

| question | decision |
|---|---|
| Reminders on the task board | Add the same reminder module as the knowledge base to the task board. The board already has deadline and urgent reminders (Phase 6); think about how the two fit together. |
| Reminder | One or more date+time values, with a button to export to a calendar. |
| Recipients | The author, plus people the author adds. People can also subscribe to a reminder themselves. |
| Existing reminders (Phase 6, as built) | Every assignee is reminded 3, 2 and 1 days before the deadline at 09:00 (Europe/Bratislava) while the task is not in Completed. An urgent task reminds its assignees at 08:00, 11:00, 14:00, 17:00 and 20:00 until it is in Completed or no longer urgent. |

## Controller rulings

From the brief: delivery as the Phase 6 event kind added in Phase 17 (`reminder.due`), in modes All and "Mentions and replies", not Off. Calendar export as a standard `.ics` file with one VEVENT per reminder time.

Made in this spec:

### Automatic and custom reminders side by side

**Keep the automatic deadline and urgent reminders unchanged, and add custom reminders beside them.** One `.ics` export holds the deadline and every upcoming custom reminder. This follows the controller's leaning, for these reasons:

1. **The automatic reminders are a safety net that needs no setup.** Every task with a deadline or the urgent flag reminds its assignees, including tasks made by the AI from a message, and tasks made by clients who never open a reminders section. Replacing them with custom ones would leave every task without reminders until someone sets them.
2. **They answer different questions.** Automatic ones say "this is due" to the people doing the work, on a fixed rhythm. Custom ones say "do this at that moment" ("call the ministry Tuesday at 14:00"), to anyone who asks, assignee or not. Merging them would force one to imitate the other.
3. **Turning the automatic ones into editable custom rows was rejected.** It would need rows for every task with a deadline, rewriting them on every deadline change and on assignee changes, and a backfill. The urgent cadence would need hundreds of rows per task, or a second mechanism anyway. The Phase 6 crons already read `tasks` and `task_assignees` directly, and that stays the simplest correct model.
4. **No double buzz.** A custom reminder that lands at the same time as an automatic one uses the same push tag `task:<taskId>`, so the newer notification replaces the older one on the device instead of stacking. The pipeline's `dedupeKey`s differ (`deadline:…`, `urgent:…`, `reminder:…`), so neither is lost. Only the device shows one.
5. **The panel explains the automatic ones in one muted line** above the custom times, so nobody adds "1 day before" by hand without knowing it already exists.
6. **One calendar file.** The deadline (an all-day event) and the custom reminders (timed events) are what a person wants in their calendar. The automatic reminders are not exported: they are Spolu's own nudges and would add three to five events per task to the calendar.

### Other rulings

- **Same rule for Completed.** A custom reminder of a task that is in Completed when the reminder is due is marked fired without a notification, like the automatic ones. A task moved out of Completed before the time reminds normally. Deleting a task deletes its reminders (foreign key, cascade).
- **Who edits task reminders:** anyone who can edit the task (`canUseBoard`: the group's clients and every admin). Task editing is already open to everyone in the group, and reminders follow it. Anyone who reads the task can subscribe or unsubscribe.
- **Authorship on a task:** the person who adds the first time becomes the set's author. Anyone else who adds a time and is not yet a recipient becomes one (`added`, by themselves). The rest follows the Phase 17 module rules: the author always stays, and others can be added, removed or unsubscribe.
- **Times are absolute.** Changing the deadline does not move custom reminders. A custom time after the deadline is marked in the list ("after the deadline") but allowed: a reminder to check something after the due date is legitimate.
- **Saved on their own, not with the task form.** The reminders section is not part of `TaskDraft`. Each change (add a time, remove a time, change recipients) saves at once with one `PUT`. Three reasons:
  - `TaskDraft` stays the exact shape the AI review and the create endpoint use, so Phase 9's flow is untouched.
  - Reminders are per person and not part of the task's content.
  - The task form's 409 "changed by someone else" check does not trip on other people's reminders.

  The section shows "Saved" briefly after each change. Create mode has no reminders section: the hint "Add reminders after creating the task" stands in its place.
- **Recipient suggestions:** the recipients picker offers a one-click "Add assignees" when the task has assignees not yet in the list.
- **Board card:** a 14 px bell in the card's meta row when the task has at least one upcoming custom reminder (with no count, to keep the card quiet). The board's single query gains one aggregate; no per-card fetch.

## User experience

All copy is the English source; Slovak goes in the reminders locale files from Phase 17. Designed with `frontend-design` on the egrant.sk tokens, reusing Phase 17's `<ReminderTimesField>`, `<RecipientsField>` and `<ReminderPanel>` pieces.

### Task panel, Details tab

The section sits under the urgent switch and above the files, separated by a 2 px `border` rule, so the dates of a task (deadline, urgency, reminders) read together.

```
Deadline        [ 20.10.2026 ]
[●  ] Urgent
───────────────────────────────────────────────────────────────
Reminders
Assignees are reminded automatically 3, 2 and 1 days before the deadline.
┌──┐ Thu 16 Oct 2026, 14:00                                  [×]
│16│
└──┘
┌──┐ Wed 22 Oct 2026, 09:00   after the deadline             [×]
│22│
└──┘
[+ Add reminder]
Reminded: (VH)(JN)  Vladyslav H. (set them), Jana Nováková   [Change]
[✓ Remind me]                                    [Add to calendar]
───────────────────────────────────────────────────────────────
Files
```

- The muted line (`text-micro text-muted-foreground`) depends on the task:
  - with a deadline: "Assignees are reminded automatically 3, 2 and 1 days before the deadline.";
  - urgent: "…and every 3 hours while urgent.";
  - neither: no line.
- Each time row: the Phase 17 calendar leaf, the date and time in the UI language, an "after the deadline" `text-micro` muted tag when it applies, and a 32 px × "Remove reminder" (44 px hit area on phones). Fired times are hidden in the panel: a task's past reminders are noise.
- "+ Add reminder" (ghost small) opens an inline row with a native date input (default: the deadline if it is in the future, else today), a time input (default 09:00), and primary small "Add" and ghost "Cancel". Enter adds. The row saves at once.
- "Reminded:" lists the recipients (avatars and names, the author marked "(set them)"). "Change" opens `PeopleSelect` with the group people, the "Add assignees" shortcut on top, and Done.
- "Remind me" is the Phase 17 toggle. "Add to calendar" downloads the task's `.ics`. It is disabled only when the task has no deadline and no upcoming custom reminder.
- With no custom reminders, the section shows the muted line, "+ Add reminder" and "Add to calendar" (if there is a deadline) only.
- Phones: the same section in the full-screen panel, every control at least 44 px (the panel's existing rule).

### Board card

```
┌─────────────────────────────┐
│ ○  Urgent                   │
│    Fix the budget table     │
│ (VH)(JN)  18 Oct   🔔  📎 2  │
└─────────────────────────────┘
```

The bell sits before the paperclip, `text-muted-foreground`, labelled "Has reminders" for screen readers. It is not a color; the urgent pill stays the card's one loud signal.

### Notification

Push title "<task title> · <group name>", body "Reminder for 14:00" (or "Reminder for Thu 16 Oct, 14:00" when it fires late), opening the task panel. Its tag is `task:<taskId>`, shared with the automatic task reminders.

## Architecture

### Reminders module: the task subject

- **Migration:** `reminder_sets.task_id` (FK `tasks.id`, on delete cascade, nullable, unique), and the CHECK becomes `num_nonnulls(knowledge_item_id, task_id) = 1`. No backfill.
- **Adapter** (`modules/tasks/reminder-subject.ts`, registered with the reminders module), `kind: 'task'`. `loadMany` reads the tasks in one query: `groupId`, `title`, `adminsOnly: false`, `active: completed_at is null`, `canRead` = `canEdit` = `canUseBoard`.
- **Author on first time:** `replaceReminderSet` creates the set lazily on the first time, with the actor as `author`. Phase 19 adds the rule that an actor who adds a time and is not yet a recipient is added (`added`, `added_by` = actor). It is a flag of the adapter (`addEditorsAsRecipients: true`), so knowledge items keep the Phase 17 behaviour.
- **Fire job:** unchanged. It already asks the adapter for `active` and skips inactive subjects silently. Task events carry `taskId` in the `ReminderDuePayload`, so the push shows the current task title through the existing `getTaskTitles` lookup, and `buildPushPayload` picks the task URL and the tag `task:<taskId>` when `subjectKind = 'task'`.

### Endpoints

| method | path | what |
|---|---|---|
| GET | `/api/tasks/:id/reminders` | `ReminderSetDto` (Phase 17 type); empty when the task has no set |
| PUT | `/api/tasks/:id/reminders` | `{ times: { id?, at }[], recipientIds, baseTimeIds }` → `ReminderSetDto`; anyone with `canUseBoard`. `baseTimeIds` are the unfired time ids the sender had loaded: only those that are missing from `times` are deleted |
| POST | `/api/tasks/:id/reminders/subscription` | subscribe the caller; 204 |
| DELETE | `/api/tasks/:id/reminders/subscription` | unsubscribe the caller; 204 |
| GET | `/api/tasks/:id/reminders/calendar.ics` | the deadline and the upcoming custom reminders |

All of them go through the Phase 17 routes with `:kind = tasks`: no new route code beyond registering the adapter. An unreadable task answers 404. Errors are Phase 17's: `invalid_reminder`, `reminder_in_past`, `invalid_recipient`, `author_recipient`. Rate limit: the tasks module's 120 writes/min.

The panel fetches `GET …/reminders` when the Details tab renders for an existing task (one small request, cached by TanStack Query under `['reminders', 'task', id]`).

### Board data

The board query (`GET /api/groups/:id/board`) adds `upcomingReminders: number` per task, from one grouped subquery over `reminder_sets` joined to `reminder_times` where `fired_at is null`, using the `(set_id, at)` index. `TaskDto` gets the field; `TaskDraft` does not change.

### Realtime

`reminders:task` `{ taskId, upcomingReminders }` to the group room after a `PUT`, and after the fire job fires a task's time. The board updates the card's bell; an open panel for that task invalidates its `['reminders', 'task', id]` query. Subscription changes are personal and emit nothing.

### Calendar export

`buildIcs` gets the deadline event for task subjects:

- `UID:task-<taskId>-deadline@spolu`.
- `DTSTART;VALUE=DATE:<due_date>`, `DTEND;VALUE=DATE:<due_date + 1 day>`: an all-day event. A deadline is a date, and an all-day event shows on that day in every time zone.
- `SUMMARY:Deadline: <title>` in the requester's language, `DESCRIPTION` the description as plain text (first 1 000 characters) plus the task link, `URL` the task link.
- No `VALARM`: the automatic reminders already cover the days before.

Then one timed VEVENT per upcoming custom time, exactly as in Phase 17 (`UID:reminder-<timeId>@spolu`, UTC times, 15 minutes, `VALARM` at the time). Stable UIDs mean exporting again after a deadline change updates the existing calendar events instead of duplicating them. Filename `<task-title-slug>.ics`.

### Performance

- The reminders section is in the lazy `task-panel` chunk; the shared reminder components come from the chunk Phase 17 split out. Nothing eager grows except no-op route code; the reminders texts are in the lazy locale bundle.
- The board stays one query; the reminder count is an indexed aggregate.
- The fire job is unchanged and its due query stays on the partial index.

### Migrations

One migration: `reminder_sets.task_id` with its foreign key and unique index, and the widened CHECK.

## Error handling

- Adding a time that passed while the row was open: `reminder_in_past`, with the row kept and the message "This time has passed. Pick a later one."
- A `PUT` on a task deleted meanwhile: 404, and the panel shows the existing "This task was deleted." notice.
- Two people editing the reminders at once: last write wins for the time list. The `PUT` carries `baseTimeIds`, the times the sender had loaded, and deletes only those of them that are missing from `times`. A time someone else added meanwhile is therefore never deleted by accident. The panel refetches on the `reminders:task` event.
- An `.ics` request for a task with neither a deadline nor upcoming reminders answers 404; the button is disabled in that state.

## Testing

**Server** (test-first):

- The adapter: `active` false for a task in Completed; read and edit follow `canUseBoard`; another group's client answers 404 on every endpoint.
- `PUT`:
  - creates the set lazily with the actor as author;
  - a second editor who adds a time becomes `added`;
  - fired times are kept;
  - times added concurrently by others survive a `PUT` that did not know them;
  - past times and the 21st time are refused;
  - recipients must be group people.
- Fire job with task subjects:
  - fires for an open task;
  - is silent for a task in Completed (and `fired_at` is set);
  - fires again normally for a task reopened before the time;
  - a deleted task's times are gone.
- Coexistence: on a task with a deadline tomorrow, the 09:00 cron records `task.deadline` and a custom 09:00 reminder records `reminder.due`, both delivered, both with tag `task:<id>`; the Phase 6 deadline and urgent tests pass unchanged.
- The board query returns `upcomingReminders` in one query (asserted with the query counter used by the board tests).
- `.ics`: an all-day deadline event with `VALUE=DATE` and the next day as end, timed events for custom reminders, stable UIDs, no deadline event when there is no deadline.

**Web:**

- The section:
  - the automatic-reminder line per deadline and urgent state;
  - add, remove, "after the deadline" tag;
  - "Add assignees";
  - "Remind me";
  - "Add to calendar" disabled state;
  - hidden in create mode with its hint.
- The card bell follows `upcomingReminders` and the `reminders:task` event.
- `TaskForm` and the AI review are unchanged (their tests pass untouched).

**E2E:** the admin adds a reminder one minute ahead on a task and adds the client as a recipient; the client sees the bell on the card live; the fire job runs (triggered by the test) and the fake push sender records the client's push with the task URL; the admin downloads the `.ics` and the test finds one all-day deadline event and one timed event.

## Done when

On the local production-like stack:

- An admin and a client set custom reminders on a task, add each other or subscribe, and both get a push at the set time, while the automatic deadline reminders keep arriving as before.
- A task in Completed stays silent.
- The task's `.ics` puts the deadline and the custom reminders into Apple, Google and Outlook calendars.

## Documentation updates in this phase

- `product/task-board.md`: custom reminders and how they sit beside the automatic ones.
- `product/reminders.md`: tasks as built.
- `product/notifications.md`: task reminder notifications.
- `architecture/data-model.md`: `reminder_sets.task_id`.
- `architecture/permissions.md`: task reminders follow `canUseBoard`.
- `architecture/realtime.md`: `reminders:task`.
- `architecture/overview.md`: the task reminder subject.
- `docs/design/tokens.md`: the reminders section, the card bell.
- `docs/roadmap.md`: the Phase 19 row and section.
- `docs/glossary.md`: automatic and custom reminders.

## Out of scope

- Changing or turning off the automatic deadline and urgent reminders per task or per user.
- Reminders relative to the deadline ("1 day before"), which would move with it.
- Recurring reminders.
- Reminders in the AI review and create flows.
- Exporting the automatic reminders.
- A live calendar feed.
- A time of day on deadlines.
- The admin dashboard's "Upcoming reminders" card (part B; it can use `listUpcomingForUser` from Phase 17).
- The global task board.
