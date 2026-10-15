# Group chat

Each group has one chat (at the start) with realtime messages, threads like Slack, @mentions and attachments. Messages can be turned into tasks. Users can edit and delete their own messages, see unread indicators, and missed messages are loaded after a reconnect.

## Requirements

- **One chat per group** (at the start).
- Messages in real time (WebSocket).
- After a lost connection, missed messages are caught up (loaded) after reconnect.
- **Threads:** under each message a reply thread can be opened (like Slack).
- **Mentions (@tags)** of users.
- **Attachments:** files and images, with image previews.
- Users can edit and delete their own messages.
- Unread indicator.
- Message action **"Create task"** moves the message to the task board (see `task-board.md`). The task keeps a link to the source message, and the message in chat is marked **"converted to task"**.
- Message action **"Split into tasks with AI"** (see `ai-task-split.md`).
- Message search within a group (see `profile.md`, phase 16).

## Phase

Phase 4 (core chat: realtime, catch-up, edit/delete own, unread). Phase 5 (threads, mentions, attachments with previews). Phase 10 ("Create task", "converted to task" mark). Phase 11 (AI split action).
