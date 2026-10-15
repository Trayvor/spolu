# Group chat

Each group has one chat (at the start) with realtime messages, threads like Slack, @mentions and attachments. Messages can be turned into tasks with AI. The same chat is used inside every task. Users can edit and delete their own messages, see unread indicators, and missed messages are loaded after a reconnect.

## Requirements

- **One chat per group** (at the start).
- Messages in real time (WebSocket).
- After a lost connection, missed messages are caught up (loaded) after reconnect.
- **Threads:** under each message a reply thread can be opened (like Slack). Inside a thread every message has "Reply": no nested thread, the reply shows a quote of the message it answers.
- **Formatting:** bold, italic, strikethrough, lists, links, quotes, code.
- **Mentions (@tags)** of users: any client of the group or any admin, and **@all** for everyone in the group and all admins.
- **Attachments:** files and images, with image previews.
- Users can edit and delete their own messages.
- Unread indicator.
- Message actions on hover: **"Reply in thread"** and **"Turn into tasks"** (AI, see `ai-task-split.md`). A message turned into tasks is marked "Turned into tasks" with links to them.
- The same chat component is used for the task chat (see `task-board.md`).
- Message search within a group (see `profile.md`, phase 16).

## Phase

Phase 5 (realtime, catch-up, edit/delete own, unread, threads, mentions, attachments with previews). Phase 9 (task chat, "Turn into tasks"). Phase 6 (notifications).
