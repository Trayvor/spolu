# Spolu — Phase 9: Task chat and message to tasks with AI (design)

Date: 2026-10-15 · Status: approved by the owner with changes (unread tasks, collapsed review cards, no limit, file names to the AI)

Requirements: [task-board](../../product/task-board.md), [chat](../../product/chat.md), [ai-task-split](../../product/ai-task-split.md), [integrations](../../product/integrations.md). Roadmap entry: [Phase 9](../../roadmap.md#phase-9--task-chat--message-to-tasks-with-ai). Builds on [Phase 5](2026-10-15-phase-5-group-chat-design.md), [Phase 8](2026-10-15-phase-8-task-board-design.md) and the [5/8 polish](2026-10-15-phase-5-8-polish-design.md).

## Goal

Every task has its own chat, the same component as the group chat. Any chat message, in the group chat or in a task chat, can be turned into one or more task cards. The AI proposes them, the user reviews each card in the full task form, and only the approved cards are created. The message and its tasks link to each other.

## Owner decisions (from the brief)

| question | decision |
|---|---|
| Task chat | The same as the group chat: threads, quotes inside threads, @mentions, @all, files, formatting, edit, delete. |
| Who sees "Turn into tasks" | Everyone who can read the chat, admins and clients. |
| AI | OpenAI API. The message goes in, a JSON list of one or more cards comes out. |
| Review | One screen with every proposed card in the full task form; approve or reject each card; approved cards go to To do. |
| Limit | None (owner, 2026-10-15). |
| Unread tasks | A new message in a task chat marks the task as unread for everyone else until they open its chat. |
| Review cards | All proposed cards are visible at once in a compact form; a card becomes editable only after the user opens it. |
| Files | The AI gets the names of the message's files and assigns them to the cards. |
| Links | The message shows "Turned into tasks" with links; each task shows "Created from a message" with a link back. |

## Controller rulings (technical, owner informed)

- **Task channel.** It is created lazily the first time the task chat is read or written: a `channels` row with `kind = 'task'` and `task_id`. A partial unique index allows one channel per task. A new migration adds the missing foreign keys:
  - `channels.task_id` → `tasks.id`, on delete cascade;
  - `tasks.source_message_id` → `messages.id`, on delete set null.

  Deleting a task deletes its chat, including messages and attachments (files go through the existing detach + `deleteDetachedFiles` path).
- **Permissions.** A task chat is readable and writable by anyone who can read the task's group, exactly like the group chat. Mentions and @all in a task chat reach the same people as in the group chat. Notification events record `chat.message`, `chat.mention` and `chat.thread_reply` with `channelId` and `taskId` in the payload; Phase 6 delivers them.
- **Unread.** Task chats do not count towards the group's Chat tab badge or the groups list. A task is **unread** for a user when its chat has a message newer than the user's read mark that the user did not write (top-level messages and, as in polish C1, replies in threads the user is part of). An unread task's card shows its title in bold and a filled dot on the chat icon (with the message count); the **Tasks** tab shows the number of unread tasks of the group, updated live. Opening the task's Chat tab marks it read. One query per board load returns counts and unread flags for all tasks of the board (no per-card fetches); the Tasks tab count is one query per group.
- **Task panel layout.** The panel gets two tabs under the title: **Details** (the form, as today) and **Chat (N)**. On desktop the panel widens to 560 px when Chat is open. On phones it stays the full-screen sheet. The chat is the existing `<Conversation>` mounted for the task channel, with the thread panel opening over it inside the panel. Create mode has no Chat tab.
- **Links.** Chat links are `?message=<id>&c=<channelId>`.
  - From the group chat, a link to a task-chat message opens the board with that task's panel on the Chat tab, scrolled to the message: `/groups/:id/tasks/:taskId?tab=chat&message=<id>`.
  - "Created from a message" uses the source message's channel, so group and task sources both work.
- **AI call.**
  - It runs on the server only. The key is `OPENAI_API_KEY` and the model is `OPENAI_MODEL`, default `gpt-5-mini`. If the key is not set, the action is hidden and the endpoint answers 503 `ai_unavailable`.
  - The call uses Chat Completions with a strict JSON schema (structured output): `{ tasks: [{ title ≤ 200, description ≤ 5000, assigneeIds: string[], fileIds: string[], deadline: 'YYYY-MM-DD' | null, urgent: boolean }] }`, with 1 to 10 tasks.
  - The prompt gives the message text (with its quoted parent, if any), the names of the message's files as `id — file name`, the group's people as `id — name`, today's date in Europe/Bratislava, and the instruction to write in the message's language. It must split only distinct jobs, set assignees, deadline and urgent only when the message states them clearly, and give each file to the card(s) it belongs to (`fileIds`; a file may go to several cards or to none).
  - The server drops assignee ids that are not group people, file ids that are not the message's files, and dates that are not real dates.
  - Timeout is 30 s, with no retry. Errors answer 502 `ai_failed`, and the UI offers "Try again".
  - Only the message text, the file names and the people's names leave the server; file contents are not sent.
- **No rate limit** (owner). The global API rate limit still applies to the endpoint; every call is logged (user, message, duration, outcome, token usage) at info level for cost tracking.
- **Message files on cards.** A file attached to a message cannot be attached again (`attachFiles` refuses it), so a card that keeps a message file gets a **copy**: a new `files` row in the same group, uploaded by the creating user, with its own storage objects copied server-side (`copyFile(deps, { fileId, groupId, userId })` in the files service). Deleting the task deletes only its copies. In the review the user can remove a proposed file from a card or attach new ones.
- **Creating approved cards.**
  - One request, `POST /api/groups/:id/tasks/from-message`, carries `{ messageId, tasks: (TaskDraft & { messageFileIds: string[] })[] }` (1–10). The drafts use the same validation as normal task create; files uploaded in the review go in `fileIds`, the source message's files in `messageFileIds` (validated against the message, then copied).
  - Everything is created in one transaction at the top of To do, in the order shown, with `source_message_id` set.
  - It records the usual task events, then sends `board:task` for each task and one `chat:message_tasks` event so open chats update the message footer live.
- **Message footer.** Under a message with tasks: "Turned into tasks:" followed by links with each task's title. A deleted task disappears from the list; a title shown struck through means that task is in Completed. The data comes with the message list (`tasks: { id, title, completed }[]`) through one joined query per page.
- **Reuse.** The review screen lists every proposed card at once as a compact summary (title, two lines of description, assignee avatars, deadline, urgent mark, file chips), the same visual as a board card plus the description excerpt. A card becomes editable only when the user opens it: on desktop it expands in place into the full `TaskForm` (one open at a time; opening another collapses the first, keeping its edits); on phones it opens as a full-screen sheet over the list with a "Done" button that returns to the list. Approve and reject are buttons on each summary (≥ 44 px), with "Approve all". The single submit "Create N tasks" is disabled until every card is either approved or rejected, and at least one is approved.
- **Message action.** "Turn into tasks" goes into the message action list: the desktop hover bar's "More" menu and the phone action sheet. It is hidden on deleted messages and on messages that have no text.

## User experience

All copy is the English source; Slovak goes in `sk.json`. Designed with `frontend-design` on the egrant.sk tokens.

### Turn into tasks

1. The user picks "Turn into tasks" on a message.
2. A dialog opens: a full-screen sheet on phones, a centred 720 px dialog on desktop. It shows the quoted message and a light "AI is reading the message…" state: three shimmering card outlines. The animation respects reduced motion and falls back to static outlines.
3. The proposed cards appear stacked as compact summaries, each with "Approve" / "Reject". Tapping a summary opens it for editing (in place on desktop, a full-screen sheet on phones). A rejected card shrinks to a single struck-through line with "Undo". The footer (sticky on phones) shows "Create 3 tasks" and "Cancel".
4. After creation the dialog closes, and a toast says "3 tasks created" with a link to the board. The message footer shows the links.

Errors use the same dialog: "The AI did not answer. Try again." / "The AI found no tasks in this message." In the last case the dialog offers "Create one task by hand", which opens one empty card prefilled with the message text as the description.

### Task chat

The panel gets the Details | Chat (2) tabs. The Chat tab is the conversation with its composer pinned to the bottom of the panel. On cards, a chat bubble icon with the count sits in the meta row, after the paperclip, and carries a dot when there are unread messages.

## Error handling

New error codes in `packages/shared` `ErrorCodes`: `ai_unavailable`, `ai_failed`, `ai_no_tasks`. Turning a message from another group into tasks answers 404, as does a message the user cannot read.

## Testing

- **Server:**
  - Task channel created lazily, once under concurrency, and deleted with its task.
  - Task chat permissions: another group's client gets 404.
  - Unread flags per task, in one query.
  - The AI endpoint with a mocked OpenAI client: schema-valid output; unknown assignee ids dropped; invalid dates dropped; timeout → 502; missing key → 503; file ids assigned, invalid ones dropped.
  - `copyFile`: a copy has its own row and storage; deleting the task keeps the message's file.
  - `from-message`: all-or-nothing transaction, message files copied, order at the top of To do, `source_message_id` set, events sent.
  - Message footer data after a task is deleted.
- **Web:**
  - The review dialog: loading, compact cards, opening one for editing (desktop in place, phone sheet), approve and reject, undo, and submit enabled only when every card is decided.
  - Unread task: bold card, dot, Tasks tab count, cleared on opening the Chat tab.
  - The task panel tabs.
  - Card chat icon and unread dot.
  - The message footer links.
  - The link to a task-chat message opens the right panel.
- **E2E:** with the AI mocked at the server through a test-only fake provider enabled by `AI_PROVIDER=fake`, a message describing 5 jobs becomes 5 proposed cards. The user rejects one and edits one, and 4 tasks appear in To do. The message shows 4 links, and each task's Chat tab works with a message and a thread reply.

## Done when

On the local stack and then on the test server, a message describing 5 jobs becomes 5 cards after the user's review, the message shows links to them, each task links back, and each task has its own chat with threads, mentions and files.

## Documentation updates in this phase

`product/task-board.md`, `product/chat.md`, `product/ai-task-split.md` (status), `architecture/data-model.md` (task channels, foreign keys, task read marks), `architecture/realtime.md` (`chat:message_tasks`), `architecture/overview.md` (the AI client), `architecture/permissions.md`, `runbooks/deploy.md` (`OPENAI_API_KEY`, `OPENAI_MODEL`), `deploy/test.env.example`, `docs/design/tokens.md` (review dialog, task panel tabs).

## Out of scope

Delivery of notifications (Phase 6), AI on files or images, AI for anything other than splitting a message, automatic task creation without review.
