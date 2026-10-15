# Group chat

Each group has one chat (at the start) with realtime messages, threads like Slack, @mentions and attachments. Messages can be turned into tasks with AI. The same chat is used inside every task. Users can edit and delete their own messages, see unread indicators, and missed messages are loaded after a reconnect.

## Requirements

- **One chat per group** (at the start).
- Messages in real time (WebSocket).
- After a lost connection, missed messages are caught up (loaded) after reconnect.
- **Threads:** under each message a reply thread can be opened (like Slack). Inside a thread every message has "Reply": no nested thread, the reply shows a quote of the message it answers.
- **Formatting:** bold, italic, strikethrough, lists, links, quotes, code.
  - As built (`apps/web/src/features/chat/format/`): `**bold**`, `_italic_` (only at a word edge; an underscore inside a word never counts, so `snake_case` and `__init__` stay text), `~~strike~~`, `` `code` ``, fenced ```` ``` ```` blocks (an unclosed fence runs to the end; a one-word first line such as `js` is a language tag and is not shown), `> ` quotes (up to 3 levels), `- ` and `N. ` lists (a list keeps its first number), bare URLs (trailing `.,;:!?*~` and an unmatched `)` are not part of the URL; an invalid one or one over 2048 characters stays text) and `[text](url)` (text without `` ` `` or `[`). Links work only for `http`, `https` and `mailto` and open in a new tab with `rel="noreferrer noopener"` and show their real address as a tooltip (`title`); anything else, like `javascript:`, stays text. HTML in a message is shown as text. Mentions show as pills with the person's name (`@unknown` when the person is no longer known). The parser is linear-time on hostile input and takes its mention tokens from the shared `splitMentionTokens`, so pills match the people the server notifies (shared cases in `packages/shared/src/chat-mention-cases.ts`).
- **Mentions (@tags)** of users: any client of the group or any admin, and **@all** for everyone in the group and all admins.
- **Attachments:** files and images, with image previews.
- Users can edit and delete their own messages.
- Unread indicator. As built (polish C1): a message counts as unread on the Chat tab and in the groups list when it is newer than the user's read mark and it is a top-level message, a reply in a thread the user started or replied in, or a reply that quotes the user's message. The user's own messages never count. Reading the main feed does not read the threads: a thread with unread replies shows a purple dot before its "N replies" link until the user opens it; opening it marks those replies read and the badge drops by that number at once (also on the user's other devices).
- Message actions: **"Reply in thread"** (inside a thread: **"Quote"**), **"Turn into tasks"** (AI, see `ai-task-split.md`; as built it sits behind "More" on desktop and in the phone sheet, only when the server has the AI on and only on messages with text, and opens the review dialog), and Edit and Delete on your own messages. On a computer they show on hover, above the message. On a phone or tablet a "⋯" next to the time, or a long press on the message, opens them as a list at the bottom of the screen. A message turned into tasks is marked "Turned into tasks" with links to them.
- The same chat component is used for the task chat (see `task-board.md`).
- Message search within a group (see `profile.md`, phase 16).

## Phase

Phase 5 (realtime, catch-up, edit/delete own, unread, threads, mentions, attachments with previews). Phase 9 (task chat, "Turn into tasks"). Phase 6 (notifications).
