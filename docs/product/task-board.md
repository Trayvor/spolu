# Task board

Each group has a Kanban board with four fixed buckets (columns) and custom buckets between them. Clients and admins create, edit and move task cards. Each task has its own chat, the same as the group chat. Tasks can be created from chat messages with the help of AI.

## Requirements

- Kanban board within a group, created with the group.
- **Four fixed buckets**, in this order, created automatically for every group, in this order at first. They cannot be renamed or deleted, but admins can reorder them like any other bucket:
  1. **To do**;
  2. **eGrant review** (eGrant checks the work);
  3. **<client> review** (the client checks the work; the name follows the group name);
  4. **Completed**.
- **Custom buckets**: admins create, rename, delete and reorder them; a new one goes after the last bucket, where "Add column" sits. Deleting a custom bucket moves its tasks to To do.
- **Bucket order**: admins drag any bucket, fixed ones included, by its handle (mouse, touch or keyboard) to reorder the board. The order is stored per group and everyone looking at the board sees it change live. Clients cannot reorder buckets. "Add column" sits after the last bucket.
- **Drag & drop** of tasks between buckets and inside a bucket.
- **Done circle** on every card and in the task panel: checking it moves the task to the top of Completed, unchecking it moves it to the top of To do (it notifies like any move). Tasks in Completed show a checked circle and a struck-through title. Anyone who can move tasks can use it.
- **Clients and admins** create, edit and move tasks. Only admins manage buckets.
- **New task**: "Add task" in a column opens the full task form (every field) with that column chosen; nothing is saved until "Create", and closing discards the draft.
- Realtime: changes by other users are visible immediately.
- **Task card:**
  - title;
  - description;
  - creator (who created it);
  - assignees (one or more people: clients of the group or its managers; an admin who is not a manager of the group cannot be chosen). Existing assignments are kept when a task is edited, even if the person has since stopped being a manager; only newly added assignees are checked (400 `invalid_assignee`);
    - Picker (Phase 18): the list offers only the group's clients and its eGrant managers. An existing assignee who is an admin but not a manager keeps their chip with a muted "not a manager" and can be removed, but is not offered again. An admin who does not manage the group and finds no one to pick sees "Only clients and the client's managers can be assigned." A save refused with `invalid_assignee` shows "Someone you chose can't be assigned here any more." and refetches the group's people. See [client-managers.md](client-managers.md).
  - deadline (date);
  - **urgent** flag;
  - attachments (files, images);
  - link to the source message in chat (if the task was created from chat): opens the chat at that message, in the group chat or in the task chat it was written in;
  - **task chat**: the same chat as the group chat (threads, @mentions of anyone in the group and admins, @all, attachments, "Turn into tasks" and the "Turned into tasks:" links under a message).
- **Task panel tabs** (as built, Phase 9): under the task title the panel has two tabs, **Details** (the form) and **Chat (N)** (the task chat). The open tab is part of the address (`?tab=chat`), so a link can open a task straight on its chat at a message. Switching tabs keeps unsaved changes in the form, and closing the panel still asks about them. Opening the Chat tab marks the task's chat read. On phones the panel is a full-screen sheet and the chat fills it, with the message box at the bottom. A new task has no Chat tab until it is created.
- **Unread tasks** (as built, Phase 9): a new message in a task chat marks the task unread for everyone else; a reply in a thread you are in does too. An unread task's card shows its title in bold and a dot on the chat icon next to the message count. The group's **Tasks tab** shows the number of unread tasks, live (a black pill), and next to it (Phase 20) a yellow pill with the number of open tasks assigned to you in that group (not in Completed), for clients too; screen readers hear "2 tasks with unread messages, 4 tasks assigned to you". The yellow count follows task changes in the group live (refetched 500 ms after the last change). Opening the task's Chat tab reads the whole chat and clears it (on every device). Your own messages never make a task unread for you.
- **Notifications** (delivered from Phase 6):
  - when a task moves to another bucket, its creator and its assignees are notified (not the person who moved it);
  - every assignee is reminded 3, 2 and 1 days before the deadline, at 09:00 (Europe/Bratislava), while the task is not in Completed. The job `tasks.deadline-reminders` runs daily and records a `task.deadline` event per assignee, at most one per task and day, counted in Bratislava days (so daylight saving changes do not shift it);
  - an **urgent** task reminds its assignees every 3 hours between 08:00 and 20:00 (Europe/Bratislava) until it is in Completed or no longer urgent. The job `tasks.urgent-reminders` runs at 08, 11, 14, 17 and 20 and records a `task.urgent` event per assignee, at most one per task and Bratislava hour slot. A task without assignees reminds nobody;
  - task chat messages notify like the group chat.
- **Creating tasks from a chat message** (with AI): see `ai-task-split.md`. The approved cards go to the top of To do, in the order shown in the review, all at once or none; each keeps a link to its message, and a message file kept on a card is copied, so the card and the message each have their own file.

## Phase

Phase 8 (built: board, buckets, tasks with attachments and the urgent flag, drag & drop with pointer, touch and keyboard, realtime, the task panel; end-to-end test in `e2e/tasks.spec.ts`). Phase 9 (task chat, tasks from chat messages). Phase 6 (task notifications and reminders).

## Global task board (as built, Phase 20)

Admins have a board across clients at `/tasks` (header link "Tasks"):

- Five columns by step, the same for every client: **To do**, **Other steps** (every custom bucket; the card names the bucket), **eGrant review**, **Client review** and, with "Show completed", **Completed** (the last 30 days). Each column shows its total and its first 50 cards; "Show 50 more" loads the next ones. Cards are sorted urgent first, then by deadline (none last), then by client name.
- Each card is the group board's card with a line on top: the client's logo and name. It has no done circle and cannot be dragged: a card opens the task panel over the board (`/tasks?…&task=<id>`), whose bucket select moves the task; closing the panel returns to the same filtered board. There is no "+ Add task": a task is created on its client's board.
- Filters, all in the address so a view can be bookmarked: clients (the knowledge list's client filter; by default the clients I manage, or all when I manage none; the last explicit choice is remembered on the device), assignee (me, anyone, unassigned, or a person among the assignees of the chosen clients), urgent, deadline (overdue, next 7 days, no deadline; by Bratislava's date), a title search (from 2 characters) and "Show completed". "Clear filters" appears when anything differs from the defaults. On phones the filters collapse into one "Filters (n)" pill that opens a sheet. A filter the server refuses (an old bookmark) resets the board to its defaults.
- The board follows changes in any client live (refetched about 2 seconds after the last change while the page is visible).

