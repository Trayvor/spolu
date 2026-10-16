# Reminders

One reminder feature serves the knowledge base and the task board: one or more date-times at which chosen people are notified, with export to a calendar. The automatic deadline and urgent reminders of the task board (see `task-board.md`) stay as they are, beside the custom ones.

## Requirements

- **Times:** one or more dates with a time, at most 20 per reminder. Each new time must be in the future. Times already sent stay listed and cannot be changed.
- **Recipients:**
  - the author (the person who set the reminder; always included);
  - people the author adds, from the people of the group (admins-only knowledge: admins only);
  - anyone who can see the item can subscribe or unsubscribe themselves ("Remind me").
- **Delivery** through the normal notifications (push, and email if turned on), in the group modes All messages and Mentions and replies, not in Off. A notification opens the item. A time missed by more than a day (server outage) is not sent late.
- **Calendar export:** "Add to calendar" downloads an `.ics` file with one event per upcoming time. It works with Apple, Google and Outlook calendars, and exporting again updates the same events instead of duplicating them. The file is a snapshot; later changes need a new export.
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
