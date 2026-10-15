# Spolu — Phase 5: Group chat (design)

Date: 2026-10-15 · Status: approved by the owner in brainstorming, written spec awaiting review

Requirements: [chat](../../product/chat.md). Roadmap entry: [Phase 5](../../roadmap.md#phase-5--group-chat). Builds on [Phase 4](2026-10-15-phase-4-shared-foundation-design.md) (files, notification events, group rooms, group tabs).

Built on branch `phase-5`, cut from `phase-4`, **in parallel with Phase 8** (`phase-8`, task board). This branch touches only `modules/chat`, `features/chat`, its migration, its i18n keys, its docs and the shared types it adds. Whichever of 5 and 8 merges second regenerates its drizzle migration.

## Goal

Each group has a realtime chat like Slack: messages, threads, @mentions (people and @all), files with image previews, edit and delete own messages, unread counts, catch-up after a lost connection. The chat is one reusable component, `<Conversation>`, so Phase 9 puts the very same chat inside each task.

## Owner decisions (brainstorming, 2026-10-15)

| question | decision |
|---|---|
| Scope | Old Phases 4 and 5 together: core chat plus threads, mentions, files. |
| Reuse | The task chat (Phase 9) is the same chat: same component, same features. |
| Mentions | Anyone in the group (its clients) and any admin can be tagged; **@all** tags all of them. |
| Message actions | On hover: "Reply in thread" and "Turn into tasks". The second one is built in Phase 9; this phase leaves a slot for it. |
| Notifications | Recorded as events only; delivered in Phase 6. |

Controller rulings (technical, owner informed):

- A message is plain text (line breaks kept, links made clickable), max 10 000 characters, max 10 attachments. No Markdown.
- Mentions are stored in the text as tokens `<@userId>` and `<@all>`; the server checks them and keeps a `message_mentions` table. The UI shows names.
- Users edit and delete only their own messages, with no time limit. A deleted message stays as "Message deleted" so threads keep their parent; its files are deleted.
- Thread replies do not count in the chat's unread number (Slack-like); a thread shows its own reply count.
- Catch-up uses one counter per chat (`seq`) that grows on every change (new, edited, deleted message, new reply), so a reconnect also catches edits and deletions, not only new messages.
- The group chat is created lazily the first time it is read (`ensureGroupChannel`), so the groups module is not touched and old groups need no backfill.

## User experience

All copy is the English source; Slovak goes in `sk.json`. Designed with `frontend-design` on the egrant.sk tokens (`docs/design/tokens.md`).

### Layout (Chat tab)

```
┌ group header (compact) ─────────────────────────────────────────┐
│ [Chat●3] [Tasks] [Members]                                      │
├──────────────────────────────────────────┬──────────────────────┤
│ ── Yesterday ──                          │ Thread          [×]  │
│ (JN) Jana Nováková  14:02                │ root message         │
│      Can you check the budget table?     │ ── 3 replies ──      │
│      [📎 budget.xlsx 48 KB]              │ replies …            │
│      3 replies, last at 15:10            │                      │
│ (VH) Vlad  eGrant  14:05      [↩][✦][⋯]  │                      │
│      @Jana Nováková yes, today.          │                      │
│ ── New messages ──                       │                      │
│ …                                        │ [composer]           │
│ [ Message the group…            📎  ➤ ]  │                      │
└──────────────────────────────────────────┴──────────────────────┘
```

- The chat fills the height below the tabs; only the message list scrolls. Page background `base` (#F5F3F1); the list sits on a white `card` panel with the card radius.
- **Messages are rows, not bubbles**, left-aligned: `<Avatar>` 32 px (Phase 4), name (weight 600), time (muted), "(edited)" when edited. Messages from the same person within 5 minutes stack without repeating avatar and name.
- **eGrant people are marked**: an admin's name carries a small `secondary` pill "eGrant", so a client always sees who speaks for eGrant. This is the chat's one distinctive mark; nothing else is decorated.
- Day dividers ("Today", "Yesterday", then the date in the user's language). A "New messages" line above the first unread message when the chat opens.
- A message that mentions me (by name or @all) gets a `muted` background and a 2 px `brand-purple` left edge.
- Mentions render as `secondary` pills with the person's name. Links open in a new tab (`rel="noreferrer noopener"`).
- Attachments under the text: images as previews (max 320 × 240, aspect ratio from the stored size so nothing jumps, click opens the full image), other files as chips (icon, name, size; click downloads). Both from `features/files`.
- **Hover actions** (desktop): a small toolbar at the message's top right: "Reply in thread", the Phase 9 slot ("Turn into tasks"), and "More" (Edit, Delete — own messages only). Touch: the toolbar is opened by a tap on a "More" button that is always visible on small screens. Every action has a tooltip and an aria-label.
- **Thread summary** under a message with replies: "3 replies, last at 15:10" (a link). It opens the thread panel.
- **Thread panel**: right side, 400 px, from 1024 px up; below that it covers the chat as a full-width panel with a back button. Shows the root message, a divider with the reply count, the replies and its own composer. URL: `?thread=<messageId>` so it survives reload and can be linked.
- **Composer**: white field with the egrant.sk 2 px input border; grows up to 8 lines, then scrolls. Enter sends, Shift+Enter adds a line (on touch devices Enter adds a line and the send button sends). Paperclip button, drag-and-drop of files onto the chat, paste of images. Files show as chips with upload progress above the text; send is disabled until uploads finish. Typing `@` opens the mention list: "Everyone in this group" (@all) first, then people (avatar, name, "eGrant" pill), filtered as you type, keyboard navigable.
- **Edit** happens in place (the text turns into a composer; Enter saves, Esc cancels). **Delete** asks in a small inline confirm ("Delete this message?" Delete / Cancel), not a browser dialog.
- **Jump to latest**: when scrolled up and new messages arrive, a pill "New messages ↓" appears at the bottom; click scrolls down. When at the bottom, new messages scroll into view.
- **Unread**: the Chat tab shows the unread count (ink pill); the groups list (admins) shows each group's unread count. Opening the chat at the bottom marks it read.
- Empty chat: "No messages yet. Write the first one to start the conversation."
- Optimistic sending: a sent message shows at once in muted color; on failure it shows "Not sent. Retry" with a retry link.

### Performance

- Pages of 50 messages: the newest page on open, older pages when scrolling to the top (scroll position kept). At most ~300 messages stay in memory per chat; older ones are dropped and re-fetched when scrolled to.
- Message rows use `content-visibility: auto` with an intrinsic size, so long lists stay cheap without a virtualization library.
- The chat feature is a lazy route chunk; the initial JS budget (200 kB gzip) is not touched.
- One socket event per change, carrying the full message, applied to the query cache (no refetch).

## Architecture

### Reuse: `<Conversation>`

`features/chat/conversation.tsx` exports `<Conversation channelId groupId messageActions? renderMessageFooter? />`:

- `messageActions`: extra hover actions `{ id, label, icon, onSelect(message) }[]`; Phase 9 passes "Turn into tasks".
- `renderMessageFooter(message)`: extra content under a message; Phase 9 renders "Turned into tasks" links.
- The Chat tab is `<Conversation channelId={groupChannel.id} groupId={id} />`. Phase 9's task chat is the same component with the task's channel. Nothing in the component knows whether it is a group or a task chat.

Inside: `MessageList`, `MessageItem`, `Composer` (also used for edit and in the thread panel), `MentionPicker`, `ThreadPanel`, `useChannelMessages(channelId)` (pages, catch-up, socket updates). People and avatars come from Phase 4 (`useGroupPeople`, `<Avatar>`).

### Data (`modules/chat`)

| table | columns |
|---|---|
| `channels` | `id`, `group_id` (FK cascade), `kind` (`group` \| `task`, CHECK), `task_id` (nullable; FK added in Phase 9), `last_seq` bigint default 0, `created_at`. Partial unique index on `group_id` where `kind = 'group'`. |
| `messages` | `id`, `channel_id` (FK cascade), `author_id` (FK user), `parent_id` (nullable, FK messages; only a top-level message can be a parent), `body` text, `mentions_all` boolean, `client_id` text (unique with `author_id`, for safe retries), `change_seq` bigint, `reply_count` int default 0, `last_reply_at`, `edited_at`, `deleted_at`, `created_at`. Indexes: (`channel_id`, `parent_id`, `created_at`), (`channel_id`, `change_seq`). |
| `message_mentions` | `message_id`, `user_id` (PK both, cascade) |
| `message_attachments` | `message_id`, `file_id`, `position` (PK `message_id`,`file_id`, cascade) |
| `read_states` | `user_id`, `channel_id` (PK both, cascade), `last_read_at` timestamptz |

`seq`: every write takes the channel row (`UPDATE channels SET last_seq = last_seq + 1 … RETURNING last_seq`, which also serialises writers of one chat) and stores it as the message's `change_seq`. A new reply also bumps its parent's `change_seq` (new `reply_count`).

Unread count = top-level, not deleted messages of the channel by other authors created after `last_read_at`.

### Policy

`modules/chat/policy.ts`: `canReadChannel(actor, channel, actorGroupId)` = `canReadGroup(actor, channel.groupId, actorGroupId)` (Phase 9 keeps this: a task chat belongs to the task's group). `canEditMessage` / `canDeleteMessage`: author only, not deleted. Unreadable channel or message: 404.

### Endpoints

| method | path | what |
|---|---|---|
| GET | `/api/groups/:id/chat` | the group channel (created lazily) `{ id, lastSeq, lastReadAt, unread }` |
| GET | `/api/channels/:id/messages?before=<createdAt,id>&limit=50` | a page of top-level messages, newest first, with authors, mentions, attachments (`FileInfo`) |
| GET | `/api/channels/:id/changes?afterSeq=N` | catch-up: every message (top-level and replies) with `change_seq > N`, ascending, max 500; `{ messages, lastSeq, truncated }` (when `truncated` the client reloads the newest page) |
| GET | `/api/messages/:id/thread` | root plus all replies, oldest first |
| POST | `/api/channels/:id/messages` | `{ body, parentId?, fileIds?, clientId }` → 201 message; a repeated `clientId` returns the existing message. Rate limit 30/min per user. |
| PATCH | `/api/messages/:id` | `{ body }` → message (mentions re-parsed) |
| DELETE | `/api/messages/:id` | soft delete; files deleted; 204 |
| POST | `/api/channels/:id/read` | `{ at }` marks read up to that time → 204 |
| GET | `/api/chat/unread` | `{ [groupId]: count }` for every group the user can read |

Validation with zod in `packages/shared` (`MessageDto`, `SendMessageInput`, …). A mention of someone who is not one of the group's people answers 400 `invalid_mention`; a file not uploadable to this message answers 400 `invalid_attachment` (Phase 4 `attachFiles`).

### Realtime

Into the group room (`emitToGroup`, Phase 4) after commit:

- `chat:message` `{ channelId, message }` — new, edited, deleted message or a parent's new reply count. The client upserts by id and moves its `lastSeq` forward.

Into the user room: `chat:read` `{ channelId, lastReadAt }` so the user's other devices clear their unread count.

Reconnect: `useGroupRoom` rejoins (Phase 4), then `useChannelMessages` calls `changes?afterSeq=` with its highest seen seq.

### Notification events (recorded, not delivered)

In the message transaction (`recordNotifications`, Phase 4), never for the author:

- `chat.message` — to every one of the group's people (Phase 6 filters by each user's mode);
- `chat.mention` — to each mentioned user, or to everyone for @all;
- `chat.thread_reply` — to the thread's root author and everyone who replied in it.

Payload: `{ channelId, messageId, groupId, authorName, excerpt (first 140 chars, mention tokens replaced by names) }`.

## Error handling

Network failure while sending: the optimistic message shows "Not sent. Retry"; retrying sends the same `clientId`, so no duplicate. Editing or deleting someone else's message: 403 `forbidden` (the UI never offers it). A message deleted while its thread is open: the panel shows "Message deleted" and keeps the replies. Upload errors come from `features/files` (`file_too_large`: "This file is larger than 25 MB.").

## Testing

- Server (test-first): policy; send with mentions, @all, attachments, thread reply; reply to a reply refused; `clientId` idempotency; edit re-parses mentions; delete keeps the thread and removes files; `change_seq` grows on each change and catch-up returns edits and deletions; unread count ignores own messages and thread replies; notification events per kind and never to the author; another group's client gets 404 everywhere; rate limit.
- Web: composer (Enter vs Shift+Enter, mention picker keyboard, file chips), message grouping, optimistic send and retry, catch-up merge (no duplicates, edits applied), thread panel open from URL, unread line and badge.
- E2E (two browsers): admin and client exchange messages live; a thread reply; a mention; an image upload with preview; edit and delete; go offline, the other side writes, come back online, the missed message appears.

## Done when

An admin and a client chat in real time with thread replies, mentions (including @all) and files, without reloading the page; after a lost connection missed messages, edits and deletions appear; unread counts show on the Chat tab and in the groups list.

## Documentation updates in this phase

`architecture/data-model.md` (Channel, Message, Mention, Attachment, ReadState built), `architecture/realtime.md` (chat events, catch-up by `change_seq`), `architecture/permissions.md` (chat policy), `architecture/overview.md` (chat module), `docs/design/tokens.md` (chat screen as built), glossary (thread, mention, @all).

## Out of scope

"Turn into tasks" (Phase 9), task chat (Phase 9), delivery of notifications (Phase 6), message search (Phase 16), reactions, typing indicators, read receipts per person, pinned messages, Markdown.
