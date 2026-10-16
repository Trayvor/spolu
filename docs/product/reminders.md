# Reminders

One reminder feature serves the knowledge base and the task board: one or more date-times at which chosen people are notified, with export to a calendar. The automatic deadline and urgent reminders of the task board (see `task-board.md`) stay as they are, beside the custom ones.

## Requirements

- **Times:** one or more dates with a time, at most 20 not yet sent per reminder. A new or changed time must be at least one minute ahead and at most five years ahead. Times already sent stay listed (after the upcoming ones) and cannot be changed or removed.
- **Recipients:**
  - the author (the person who set the reminder; always included);
  - people the author adds, from the people of the group (admins-only knowledge: admins only);
  - anyone who can see the item can subscribe or unsubscribe themselves ("Remind me"). An added person can leave too; only the author cannot.
  - at most 50 added people. Recipients are listed author first, then by name.
  - when an item becomes eGrant only, everyone but admins and the author is removed.
- **Delivery** through the normal notifications (push, and email if turned on). Every recipient chose this reminder (the author, the people the author added, the people who subscribed), so it reaches them in every group mode, Off included; to stop it they unsubscribe. A notification opens the item. A reminder fires at most a minute after its time (the job runs every minute). A time missed by more than a day (server outage) is not sent late; after a shorter outage the missed times are sent when the server is back. Recipients of an admins-only item who are not admins get nothing.
- **Calendar export:** "Add to calendar" downloads an `.ics` file (named after the title) with one 15-minute event per upcoming time, in UTC, with an alert at the time, the body (first 1 000 characters) and a link to the item. Each event carries the time's last change (`SEQUENCE`, `LAST-MODIFIED`), so importing a newer export moves an event whose time changed. It works with Apple, Google and Outlook calendars, and exporting again updates the same events instead of duplicating them. The file is a snapshot; later changes need a new export.
- **Knowledge base:** the reminder item type (see `knowledge-base.md`). Its times are edited with the item, by the author and admins.
- **Task board:**
  - Anyone who can edit a task can add custom reminders to it. The person who adds the first one is the author, and someone who adds a time is reminded too.
  - Custom reminders do not replace the automatic ones: assignees still get the deadline reminders (3, 2 and 1 days before, at 09:00) and the urgent reminders (every 3 hours).
  - A custom reminder that comes at the same moment as an automatic one shows as one notification on the device.
  - A task in Completed sends no reminders.
  - The task's calendar file holds the deadline (an all-day event) and its upcoming custom reminders.
  - A card shows a bell when the task has upcoming custom reminders.
- Example of done: a reminder set for a time reaches its author and recipients by push at that time, and its `.ics` file adds the times to a calendar.

## Phase

Phase 17 (the reminders module, knowledge reminders, calendar export). Phase 19 (custom reminders on tasks). Delivery uses Phase 6.
