# Task board

Each group has a Kanban board with custom buckets (columns) and task cards. Tasks can be dragged between and within buckets. Clients can create and edit tasks. Each task has its own chat with threads and attachments. Tasks can be created from chat messages.

## Requirements

- Kanban board within a group.
- Users can **create their own buckets** (columns), rename them, delete them and change their order.
- **Drag & drop** of tasks between buckets and inside a bucket.
- **A client can create and edit tasks.**
- Tasks can be created, edited and deleted.
- Realtime: changes by other users are visible immediately.
- **Task card:**
  - title;
  - description;
  - assignee;
  - deadline;
  - priority;
  - labels;
  - attachments (files, images);
  - link to the source message in chat (if the task was created from chat);
  - **task chat**: a separate chat inside each task with **threads** (replies to messages within the task), mentions and attachments.
- Notifications from the task chat (see `notifications.md`).
- **Creating a task from chat, one message = one task:**
  - a task card is created from the message, the message text becomes its content;
  - before creating, a form opens: the user can **edit** the task fields and **choose the bucket**;
  - the task links to the source message, and the chat message is marked "converted to task".
- Creating several tasks from one message with AI: see `ai-task-split.md`.

## Phase

Phase 8 (board, buckets, tasks, drag & drop, realtime). Phase 9 (task attachments and task chat). Phase 10 (message to task).
