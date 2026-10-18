# Reminders

One reminder feature serves the knowledge base and the task board: one or more date-times at which chosen people are notified, with export to a calendar. The automatic deadline and urgent reminders of the task board (see `task-board.md`) stay as they are, beside the custom ones.

## Requirements

- **Times:** one or more dates with a time, at most 20 not yet sent per reminder. A new or changed time must be at least one minute ahead and at most five years ahead. Times already sent stay listed (after the upcoming ones) and cannot be changed or removed.
- **Recipients:**
  - the author (the person who set the reminder; always included);
  - people the author adds, from the group's clients and its eGrant managers, as for assignees (Phase 18; admins-only knowledge: managers only). Someone added earlier who has since stopped managing the client stays until removed; someone who left the group is dropped at the next save;
  - anyone who can see the item can subscribe or unsubscribe themselves ("Remind me"). An added person can leave too; only the author cannot.
  - at most 50 added people. Recipients are listed author first, then by name.
  - when an item becomes eGrant only, everyone but admins and the author is removed.
- **Delivery** through the normal notifications (push, and email if turned on). Every recipient chose this reminder (the author, the people the author added, the people who subscribed), so it reaches them in every group mode, Off included; to stop it they unsubscribe. A notification opens the item. A reminder fires at most a minute after its time (the job runs every minute). A time missed by more than a day (server outage) is not sent late; after a shorter outage the missed times are sent when the server is back. Recipients of an admins-only item who are not admins get nothing.
- **Calendar export:** "Add to calendar" downloads an `.ics` file (named after the title) with one 15-minute event per upcoming time, in UTC, with an alert at the time, the body (first 1 000 characters) and a link to the item. Each event carries the time's last change (`SEQUENCE`, `LAST-MODIFIED`), so importing a newer export moves an event whose time changed. It works with Apple, Google and Outlook calendars, and exporting again updates the same events instead of duplicating them. The file is a snapshot; later changes need a new export.
- **Knowledge base:** the reminder item type (see `knowledge-base.md`). Its times are edited with the item, by the author and admins.
- **Task board:**
  - Anyone who can edit a task can add custom reminders to it. The person who adds the first one is the author of the task's reminders, and anyone else who adds a time becomes a recipient (added by themselves). Someone who only removes a time does not.
  - Each change (add a time, remove a time, change the recipients) saves on its own, not with the task form. When two people edit at once, a change only removes the times its sender had loaded: a time someone else added meanwhile is kept, and a time someone else removed meanwhile is not brought back. Changing only the times leaves the recipients as they are. Adding a moment that someone else added meanwhile adds nothing (no double push), and the panel refuses a moment already in the list ("This time is already in the list.").
  - Removing the last upcoming time ends the task's reminders: their recipients go too, and whoever adds the next time becomes the author of a new set. So nobody stays bound to a task's reminders after their own are gone.
  - Custom reminders do not replace the automatic ones: assignees still get the deadline reminders (3, 2 and 1 days before, at 09:00) and the urgent reminders (every 3 hours).
  - A custom reminder that comes at the same moment as an automatic one shows as one notification on the device.
  - A task in Completed sends no reminders; its panel says so instead of the automatic-reminder line.
  - The task's calendar file holds the deadline, as an all-day event titled "Deadline: <title>" in the requester's language with no alert (the automatic reminders already cover the days before), and its upcoming custom reminders. A task with neither has no calendar file.
  - A card shows a bell when the task has upcoming custom reminders.
- **Finance (Phase 32 part B):** a finance item's reminders (a contract's, proposed 30 days before its end at 09:00) are edited on their own like a task's. Only finance admins read, edit, subscribe to or receive them: recipients are picked from the finance admins only (any other is refused), and a recipient who lost the right is skipped when a time fires. They belong to the **Finance** notification group and open the item in the client's Finance tab ([finance.md](finance.md#documents-and-contracts)). Since Phase 32 E an expense has them too (proposed the day before its date at 09:00), and an item of the organisation (no client, `reminder_sets.group_id` null) opens on `/finance` ([finance.md](finance.md#organisation-level)).
- Example of done: a reminder set for a time reaches its author and recipients by push at that time, and its `.ics` file adds the times to a calendar.

## Status

Built for knowledge items (Phase 17): the reminders module (`modules/reminders`: times, recipients, subscription, the `.ics` export, the every-minute fire job) and its web parts (`features/reminders`: the times and recipients fields, the reminder block). Built for tasks (Phase 19, in progress: built and tested locally, end-to-end test `e2e/task-reminders.spec.ts` written): the module takes tasks as a second subject (`reminder_sets.task_id`), stand-alone edits (`PUT /api/tasks/:id/reminders`) that only remove the times the sender loaded, editors as recipients, the deadline in the calendar file, task pushes with the task's tag, the live card bell, and the reminders section in the task panel (`features/tasks/task-reminders.tsx`). Built for finance items (Phase 32 part B): the subject kind `finance` (`modules/finance/reminder-subject.ts`, routes `/api/finance-items/:id/reminders`), stand-alone edits, and the adapter hook `filterRecipients` (used by `replaceReminderSet`, `subscribe` and the fire job) that keeps finance admins only.

## Phase

Phase 17 (the reminders module, knowledge reminders, calendar export). Phase 19 (custom reminders on tasks). Delivery uses Phase 6.
