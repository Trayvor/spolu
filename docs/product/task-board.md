# Task board

Each group has a Kanban board with four fixed buckets (columns) and custom buckets between them. Clients and admins create, edit and move task cards. Each task has its own chat, the same as the group chat. Tasks can be created from chat messages with the help of AI.

## Requirements

- Kanban board within a group, created with the group.
- **Four fixed buckets**, in this order, created automatically for every group. They cannot be renamed, deleted or moved:
  1. **To do**;
  2. **eGrant review** (eGrant checks the work);
  3. **<client> review** (the client checks the work; the name follows the group name);
  4. **Completed**.
- **Custom buckets**: admins create, rename, delete and reorder them; they always sit between To do and Completed. Deleting a custom bucket moves its tasks to To do.
- **Drag & drop** of tasks between buckets and inside a bucket.
- **Clients and admins** create, edit and move tasks. Only admins manage buckets.
- **New task**: "Add task" in a column opens the full task form (every field) with that column chosen; nothing is saved until "Create", and closing discards the draft.
- Realtime: changes by other users are visible immediately.
- **Task card:**
  - title;
  - description;
  - creator (who created it);
  - assignees (one or more people: clients of the group or admins);
  - deadline (date);
  - **urgent** flag;
  - attachments (files, images);
  - link to the source message in chat (if the task was created from chat): opens the chat at that message;
  - **task chat**: the same chat as the group chat (threads, @mentions of anyone in the group and admins, @all, attachments).
- **Notifications** (delivered from Phase 6):
  - when a task moves to another bucket, its creator and its assignees are notified (not the person who moved it);
  - every assignee is reminded 3, 2 and 1 days before the deadline, at 09:00 (Europe/Bratislava), while the task is not in Completed;
  - an **urgent** task reminds its assignees every 3 hours between 08:00 and 20:00 (Europe/Bratislava) until it is in Completed or no longer urgent;
  - task chat messages notify like the group chat.
- **Creating tasks from a chat message** (with AI): see `ai-task-split.md`.

## Phase

Phase 8 (built: board, buckets, tasks with attachments and the urgent flag, drag & drop with pointer, touch and keyboard, realtime, the task panel; end-to-end test in `e2e/tasks.spec.ts`). Phase 9 (task chat, tasks from chat messages). Phase 6 (task notifications and reminders).
