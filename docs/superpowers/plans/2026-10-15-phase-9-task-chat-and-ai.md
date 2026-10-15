# Spolu Phase 9 — Task chat and message to tasks with AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every task gets its own chat (the same `<Conversation>` as the group chat, with unread tasks on the board), and any chat message can be turned into reviewed task cards proposed by OpenAI, with links both ways.

**Architecture:** The chat module gains lazily created task channels (`channels.kind = 'task'`, FK to `tasks`, cascade) and a per-board unread summary query; the tasks module gains `POST /groups/:id/tasks/from-message` (one transaction, message files copied through a new `copyFile`); a new server-only `ai` module wraps a small `TaskSplitProvider` interface (OpenAI over `fetch`, or `AI_PROVIDER=fake`). The web adds Details | Chat tabs to the task panel, unread marks on cards and the Tasks tab, a "Turned into tasks" message footer, and a lazy review dialog that reuses `TaskForm` per card.

**Tech Stack:** Fastify 5, Drizzle + Postgres, socket.io, zod 4, React 19, TanStack Router/Query, i18next, Tailwind 4, `radix-ui` Dialog, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-phase-9-task-chat-and-ai-design.md`

Branch: `phase-9`, cut from `integration`. Migration: `0009_task_chats` (last is `0008_thread_read_states`).

## Global Constraints

- Everything in the repo is in English. Every new UI string goes in both `apps/web/src/locales/en.json` and `sk.json`; `src/i18n/locales.test.ts` requires identical base keys and an `_other` form for every plural key.
- Performance first: one query per board load returns chat counts and unread flags for all tasks of the board (no per-card fetches); the Tasks tab count is one query per group (the same query, shared through TanStack Query).
- Initial JS stays ≤ 200 kB gzip (`docs/architecture/performance.md`). The review dialog is loaded with `React.lazy`; all OpenAI-facing code is server-only (`apps/server/src/modules/ai/`). No new web runtime dependency; no OpenAI SDK on the server (plain `fetch`).
- The AI call runs inside the request (spec: 30 s timeout, no retry, 502 `ai_failed`). This is a documented exception to the performance rule "AI calls run in pg-boss jobs"; record it in `performance.md`.
- AI: key `OPENAI_API_KEY`, model `OPENAI_MODEL` default `gpt-5-mini`, Chat Completions with a strict JSON schema; 1–10 tasks; title ≤ 200, description ≤ 5000; dates `YYYY-MM-DD`; today in `Europe/Bratislava`; only message text, file names and people's names leave the server.
- `AI_PROVIDER=fake` selects a deterministic test provider (e2e and tests); `AI_PROVIDER=openai` (default) without a key means AI is unavailable: the action is hidden and the endpoint answers 503 `ai_unavailable`.
- No AI rate limit (owner). Every AI call is logged at info level with user, message, duration, outcome and token usage.
- No fancy effects; every animation is `motion-safe:` only (static under reduced motion). Touch targets on phones ≥ 44 px.
- UI tasks invoke `frontend-design:frontend-design` first, on the egrant.sk tokens in `docs/design/tokens.md`, and record what they build in `tokens.md`.
- Reuse: one `TaskForm` (its `files`/`onFilesChange` are required), one `<Conversation>` (mounted under `GroupRoomProvider`), one `UnreadPill`, one action list in `message-item.tsx`. Pass stable (`useMemo`/`useCallback`) `messageActions` and `renderMessageFooter` props.
- Chat links are `?message=<id>&c=<channelId>`; a task-chat message link is `/groups/:groupId/tasks/:taskId?tab=chat&message=<id>&c=<channelId>`.
- `attachFiles` refuses files already attached: a card keeps a message file only as a copy (`copyFile`).
- Test-first. Server tests share databases: unique emails and groups per test (`randomUUID()`), never truncate.
- Docs are updated in the same commit as the code they describe.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017ePsEvddJdebom9HRHr5oh
  ```

## Review Focus

1. **The AI returns junk** (blank or 400-character titles, 14 tasks, duplicate or unknown assignee ids, `2026-02-31`, unknown file ids): the user still gets at most 10 clean cards; a card whose title is blank after trimming is dropped; if none remain the answer is 422 `ai_no_tasks`, never a 500. Test: Task 6 `sanitizeProposals` cases.
2. **The message changes between proposal and "Create"** (deleted, or a file removed by an edit): "Create" answers 404 or 400 `invalid_attachment`, nothing is created, and the dialog keeps every card and edit with an error line. Tests: Task 7 route cases; Task 11 dialog keeps cards on a failed submit.
3. **Double-clicking "Create N tasks"** sends one request; the button is disabled while it is on its way. Test: Task 11.
4. **Closing the review after work** (Escape, a backdrop click) must not silently throw away edited or decided cards: a backdrop click does nothing; Escape or Cancel after any edit or decision asks "Discard the proposed tasks?". Test: Task 11.
5. **Unsaved Details edits survive switching to the Chat tab and back**, and leaving the panel still asks. Test: Task 8.

---

## File Structure

Server (`apps/server/src/`):
- `modules/chat/schema.ts` — `channels.taskId` FK (cascade), kind/task check, partial unique index on `task_id`, index on `group_id`.
- `modules/tasks/schema.ts` — `tasks.sourceMessageId` FK to `messages.id` (set null).
- `infra/db/migrations/0009_task_chats.sql` (+ meta) — generated.
- `modules/chat/service.ts` — `ensureTaskChannel`, `taskChatSummaries`, `markAllRead`, `taskChatFileIds`.
- `modules/chat/messages.ts` — `findReadableMessage`, `getMessageFiles`, `getSourceMessage`, `messageTasksEvent`; notification payload `taskId`.
- `modules/chat/dto.ts` — `MessageDto.tasks` (one extra query per page).
- `modules/chat/events.ts` — `taskId` on every chat event; `emitMessageTasks`.
- `modules/chat/routes.ts` — `GET /tasks/:id/chat`, `GET /groups/:id/task-chats`, `POST /channels/:id/read-all`.
- `modules/tasks/service.ts` — `listTasksForMessages`.
- `modules/tasks/positions.ts` — `keysBefore`.
- `modules/tasks/task-service.ts` — `deleteTask` removes chat files and returns `sourceMessageId`; `getTask` fills `sourceMessage`; `createTasksFromMessage`.
- `modules/tasks/task-routes.ts` — `POST /groups/:id/tasks/from-message`; `chat:message_tasks` after writes to sourced tasks.
- `infra/storage/storage.ts`, `disk-storage.ts` — `copy(fromKey, toKey)`.
- `modules/files/service.ts` — `copyFile`.
- `modules/ai/provider.ts`, `openai-provider.ts`, `fake-provider.ts`, `index.ts`, `split.ts`, `routes.ts` — the AI module.
- `infra/config/config.ts`, `deps.ts`, `app.ts`, `test/test-app.ts`, `test/test-config.ts` — `ai` config and dependency.

Shared (`packages/shared/src/`): `chat.ts` (message tasks, event fields, task chat summaries), `tasks.ts` (source message fields, from-message schema), new `ai.ts`, `users.ts` (`ErrorCodes`), `index.ts`.

Web (`apps/web/src/`):
- `features/chat/message-item.tsx` — `MessageAction.inMenu` and `isAvailable`.
- `features/chat/links.ts` — `chatMessageHref`.
- `features/chat/api.ts` — `taskChatQuery`, `markAllRead`.
- `features/chat/conversation.tsx`, `thread-panel.tsx` — `threadMode="over"`.
- `features/chat/use-channel-messages.ts`, `use-thread.ts` — apply `chat:message_tasks`.
- `features/chat/message-tasks.tsx` — the footer.
- `features/chat/chat-tab.tsx` — wires the message tools.
- `features/chat/unread.tsx` — `UnreadPill` takes an optional `label`.
- `features/tasks/task-chats.ts` — `taskChatsQuery`, `useTaskChatEvents` (eager, tiny).
- `features/tasks/tasks-tab-badge.tsx` — the Tasks tab count.
- `features/tasks/task-card.tsx` — `TaskCardMeta` extracted; chat icon, dot, bold unread title.
- `features/tasks/task-panel.tsx`, `panel-parts.tsx` — Details | Chat tabs; `task-chat.tsx` new.
- `features/tasks/source-message.tsx` — link through `chatMessageHref`.
- `features/task-split/api.ts`, `use-message-task-tools.tsx`, `review-model.ts`, `review-dialog.tsx` (lazy), `review-card.tsx`.
- `components/ui/toast.tsx`, `lib/use-media-query.ts`.
- `features/groups/group-layout.tsx` — Tasks tab badge.

E2E: `e2e/ai-tasks.spec.ts`; `playwright.config.ts` env `AI_PROVIDER: 'fake'`.

---

### Task 1: Message action slot for "Turn into tasks"

Builds on the single action list in `features/chat/message-item.tsx` (the `RowAction[]` built inside `MessageItem`, rendered by both the desktop hover bar and the phone `ActionSheet`). If that list has moved or been renamed by the time this task starts, apply the same change to wherever the one list is built; do not add a second list.

**Files:**
- Modify: `apps/web/src/features/chat/message-item.tsx` (the `MessageAction` type and the loop that appends `messageActions` to the action list)
- Test: `apps/web/src/features/chat/message-actions.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type MessageAction = {
    id: string;
    label: string;
    icon: ReactNode;
    /** Desktop: behind "More" instead of on the hover bar. The phone sheet lists every action. */
    inMenu?: boolean;
    /** Hidden on messages where this returns false (deleted and unsent messages never show actions). */
    isAvailable?: (message: MessageDto) => boolean;
    onSelect(message: MessageDto): void;
  };
  ```
  Order in the list stays: reply/quote, the extra actions, Edit, Delete. Inside "More" the extra `inMenu` actions come before Edit and Delete.

- [ ] **Step 1: Write the failing tests** in `message-actions.test.tsx`, reusing its existing render helper:

```tsx
it('puts an inMenu action behind "More" on desktop and in the phone sheet', async () => {
  const onSelect = vi.fn();
  const action = { id: 'tasks', label: 'Turn into tasks', icon: <span />, inMenu: true, onSelect };
  renderItem({ message: msg({ body: 'Do it' }), messageActions: [action] }); // desktop media
  const bar = screen.getByRole('toolbar');
  expect(within(bar).queryByRole('button', { name: 'Turn into tasks' })).toBeNull();
  await user.click(within(bar).getByRole('button', { name: t('chat.actions.more') }));
  await user.click(await screen.findByRole('menuitem', { name: 'Turn into tasks' }));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ body: 'Do it' }));
});

it('hides an action whose isAvailable says no, in the bar, the menu and the sheet', async () => {
  const action = { id: 'tasks', label: 'Turn into tasks', icon: <span />, inMenu: true,
    isAvailable: (m: MessageDto) => m.body.trim() !== '', onSelect: vi.fn() };
  renderItem({ message: msg({ body: '', attachments: [file()] }), messageActions: [action], touch: true });
  await user.click(screen.getByRole('button', { name: t('chat.actions.open') }));
  expect(screen.queryByRole('button', { name: 'Turn into tasks' })).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/web test -- src/features/chat/message-actions.test.tsx`
Expected: FAIL (the action shows on the bar; `isAvailable` ignored).

- [ ] **Step 3: Implement** — in the loop over `messageActions`, skip actions whose `isAvailable?.(message) === false` and copy `inMenu` onto the `RowAction`. Update the type's doc comment (it no longer says "hover toolbar" only).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @spolu/web test -- src/features/chat/`
Expected: PASS (all chat tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/chat/message-item.tsx apps/web/src/features/chat/message-actions.test.tsx
git commit -m "feat(chat): message actions can sit in More and hide per message"
```
(with the two trailer lines from Global Constraints)

---

### Task 2: Task channels, foreign keys and the task chat endpoint

**Files:**
- Modify: `apps/server/src/modules/chat/schema.ts`, `apps/server/src/modules/tasks/schema.ts`
- Create: `apps/server/src/infra/db/migrations/0009_task_chats.sql` (+ `meta/0009_snapshot.json`, `_journal.json`, generated)
- Modify: `apps/server/src/modules/chat/service.ts`, `messages.ts`, `events.ts`, `routes.ts`
- Modify: `apps/server/src/modules/tasks/task-service.ts` (`deleteTask`)
- Modify: `packages/shared/src/chat.ts`
- Modify: `apps/web/src/features/chat/*.test.ts(x)` event fixtures (add `taskId: null`)
- Test: `apps/server/src/modules/chat/service.test.ts`, `routes.test.ts`, `messages.test.ts`, `apps/server/src/modules/tasks/task-service.test.ts`
- Docs: `docs/architecture/data-model.md` (task channels, FKs), `docs/architecture/permissions.md` (task chat = group's readers), `docs/architecture/realtime.md` (`taskId` on chat events), `docs/architecture/overview.md` (Chat API: `GET /api/tasks/:id/chat`)

**Interfaces:**
- Schema: `channels`: check `channels_task_check` = `(kind = 'task') = (task_id is not null)`; `uniqueIndex('channels_task_unique').on(taskId).where(kind = 'task')`; `index('channels_group_id_idx').on(groupId)`; `taskId` references `tasks.id` on delete cascade. `tasks.sourceMessageId` references `messages.id` on delete set null. The two schema files import each other: use lazy references typed `(): AnyPgColumn => tasks.id` / `(): AnyPgColumn => messages.id` so neither import is read at module load.
- Produces (server):
  - `ensureTaskChannel(db: Db, task: { id: string; groupId: string }): Promise<ChannelRow>` — insert on conflict do nothing on `channels_task_unique`, then select; safe under concurrency.
  - `taskChatFileIds(tx: Db, taskId: string): Promise<string[]>` — file ids attached to any message of the task's channel.
  - `deleteTask(...)` now returns `{ groupId: string; sourceMessageId: string | null }` and detaches + deletes (after commit) the task chat's files together with the task's own.
  - `findReadableMessage(db: Db, actor: SessionUser, id: string): Promise<{ message: MessageRow; channel: ChannelRow } | null>` in `messages.ts` (the logic of the routes' `readableMessage`, which now calls it).
  - `emitMessage(io, channel: Pick<ChannelRow, 'groupId' | 'taskId'>, message, isNew)`; `emitRead` / `emitThreadReply` events carry `taskId`.
  - `GET /api/tasks/:id/chat` → `GroupChannel` (`{ id, lastSeq, lastReadAt, unread }`), 404 when the task is missing or unreadable (`getTaskRef` + `canReadGroup`); a task deleted while the channel is created (FK violation) is 404.
  - Notification payloads of `chat.message`, `chat.mention`, `chat.thread_reply` gain `taskId: string | null`.
- Produces (shared): `ChatMessageEvent.taskId: string | null`, `ChatThreadReplyEvent.taskId: string | null`, `ChatReadEvent.taskId: string | null`.

- [ ] **Step 1: Write the failing server tests**

```ts
// chat/service.test.ts
describe('ensureTaskChannel', () => {
  it('creates one task channel under 5 parallel calls', async () => {
    const { group, task } = await newTask();
    const rows = await Promise.all(Array.from({ length: 5 }, () => ensureTaskChannel(db, task)));
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(rows[0]).toMatchObject({ kind: 'task', taskId: task.id, groupId: group.id });
  });
});
// tasks/task-service.test.ts
it('deleting a task deletes its chat, messages and their files', async () => {
  // a task, its channel, a message with an uploaded file (sendMessage with fileIds)
  await deleteTask(deps, task.id);
  expect(await getChannel(db, channel.id)).toBeNull();
  expect(await getFile(db, fileId)).toBeNull();
  expect(await storage.exists(storageKey)).toBe(false);
});
it('a task made from a message in another task\'s chat loses only its source when that task goes', async () => {
  // t2.source_message_id = a message in t1's chat (db.update); deleteTask(t1)
  expect((await getTaskRef(db, t2.id))).not.toBeNull();
  expect((await getTask(db, t2.id))!.sourceMessageId).toBeNull();
});
// chat/routes.test.ts
it('GET /api/tasks/:id/chat creates the channel; another group\'s client gets 404', async () => {
  expect((await get(admin, `/api/tasks/${task.id}/chat`)).statusCode).toBe(200);
  expect((await get(otherClient, `/api/tasks/${task.id}/chat`)).statusCode).toBe(404);
  expect((await post(otherClient, `/api/channels/${channelId}/messages`, body)).statusCode).toBe(404);
});
// chat/messages.test.ts
it('task chat notifications carry the taskId', async () => {
  // send in a task channel, read notification_events for the message
  expect(payload).toMatchObject({ channelId, taskId: task.id });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/server test -- src/modules/chat src/modules/tasks/task-service.test.ts`
Expected: FAIL (`ensureTaskChannel` not exported, route 404 for admin).

- [ ] **Step 3: Change both schemas, then generate the migration**

Run: `pnpm --filter @spolu/server db:generate -- --name task_chats`
Expected: `0009_task_chats.sql` with the check, the two indexes and two FKs. Review it by hand: the FKs must say `ON DELETE cascade` (channels) and `ON DELETE set null` (tasks).

- [ ] **Step 4: Implement** the service functions, `deleteTask` change (call `taskChatFileIds` inside the transaction before deleting the task; detach the union; `deleteDetachedFiles` after commit), the route, the event signature change at every call site, the notification `taskId`, and the shared event fields (fix web test fixtures that build these events).

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @spolu/server test && pnpm --filter @spolu/web typecheck && pnpm --filter @spolu/web test`
Expected: PASS.

- [ ] **Step 6: Update the four docs, commit**

```bash
git add apps/server packages/shared apps/web/src/features/chat docs/architecture
git commit -m "feat(chat): task channels created lazily and deleted with their task"
```

---

### Task 3: Unread task chats in one query

**Files:**
- Modify: `apps/server/src/modules/chat/service.ts`, `routes.ts`, `events.ts`
- Modify: `packages/shared/src/chat.ts`
- Test: `apps/server/src/modules/chat/unread.test.ts`, `routes.test.ts`
- Docs: `docs/architecture/overview.md` (Chat API), `docs/architecture/realtime.md` (`chat:read` with `all`), `docs/architecture/data-model.md` (task read marks reuse `read_states` / `thread_read_states`)

**Interfaces:**
- Shared:
  ```ts
  export const TaskChatSummarySchema = z.object({ count: z.number().int(), unread: z.boolean() });
  export const TaskChatSummariesSchema = z.record(z.string(), TaskChatSummarySchema); // by taskId
  export type TaskChatSummary = z.infer<typeof TaskChatSummarySchema>;
  export type TaskChatSummaries = z.infer<typeof TaskChatSummariesSchema>;
  // ChatReadEvent gains `all?: true`: the whole channel, threads included, is read.
  ```
- Server:
  - `taskChatSummaries(db: Db, userId: string, groupId: string): Promise<TaskChatSummaries>` — ONE SQL statement over `channels c` (`c.group_id = $g and c.kind = 'task'`) left-joined to the user's `read_states`: `count` = live messages of the channel (top-level and replies, `deleted_at is null`); `unread` = `exists` a live top-level message by someone else after the channel mark (`coalesce(rs.last_read_at, '-infinity')`) `or exists` a live reply by someone else after `t.last_read_at` in a `thread_read_states` row of the user for that channel with `last_reply_at > last_read_at` (the same rules as `unreadIn`). Tasks without a channel are absent.
  - `markAllRead(db: Db, userId: string, channelId: string): Promise<Date>` — `markRead(now)` plus `update thread_read_states set last_read_at = greatest(last_read_at, last_reply_at) where user_id and channel_id and last_reply_at > last_read_at`.
  - `GET /api/groups/:id/task-chats` → `TaskChatSummaries` (404 like `GET /groups/:id/chat`).
  - `POST /api/channels/:id/read-all` → 204; emits `chat:read` `{ groupId, channelId, taskId, lastReadAt, all: true }` to the user.
  - Group chat counts (`unreadByGroup`, `GET /groups/:id/chat`) stay `kind = 'group'` only.

- [ ] **Step 1: Write the failing tests** (`unread.test.ts`)

```ts
describe('taskChatSummaries', () => {
  it('counts live messages and flags unread per task', async () => {
    // task A: 2 messages by other, 1 by me, 1 deleted; task B: only my messages; task C: no channel
    expect(await taskChatSummaries(db, me.id, group.id)).toEqual({
      [a.id]: { count: 3, unread: true },
      [b.id]: { count: 1, unread: false },
    });
  });
  it('a reply by someone else in my thread makes the task unread; markAllRead clears it', async () => {
    // after markRead of the channel only: still unread (thread); after markAllRead: { unread: false }
  });
  it('never counts task chats in the group chat badge', async () => {
    expect(await unreadByGroup(db, me.id, group.id)).toEqual({});
  });
  it('is one statement', async () => {
    const spy = vi.spyOn(db, 'execute');
    await taskChatSummaries(db, me.id, group.id);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```
And in `routes.test.ts`: `POST /api/channels/:id/read-all` answers 204 and the user's socket receives `chat:read` with `all: true` and `taskId`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/server test -- src/modules/chat/unread.test.ts src/modules/chat/routes.test.ts`
Expected: FAIL (functions missing).

- [ ] **Step 3: Implement** the two functions, the two routes and the shared schemas.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @spolu/server test -- src/modules/chat`
Expected: PASS.

- [ ] **Step 5: Docs, commit**

```bash
git commit -am "feat(chat): unread task chats per board in one query"
```

---

### Task 4: Links between messages and tasks (server)

**Files:**
- Modify: `apps/server/src/modules/tasks/service.ts`, `task-service.ts` (`getTask`), `task-routes.ts`
- Modify: `apps/server/src/modules/chat/dto.ts`, `messages.ts`, `events.ts`
- Modify: `packages/shared/src/chat.ts`, `tasks.ts`
- Modify: web message fixtures in `apps/web/src/features/chat/*.test.ts(x)` and `message-rows.ts` (add `tasks: []`)
- Test: `apps/server/src/modules/chat/reads.test.ts`, `apps/server/src/modules/tasks/task-service.test.ts`, `task-routes.test.ts`
- Docs: `docs/architecture/overview.md` (module boundary rule: the chat DTO asks the tasks service for links; Chat API; Tasks API `sourceMessage`), `docs/architecture/realtime.md` (`chat:message_tasks`)

**Interfaces:**
- Shared:
  ```ts
  export const MessageTaskLinkSchema = z.object({ id: z.string(), title: z.string(), completed: z.boolean() });
  // MessageSchema gains: tasks: z.array(MessageTaskLinkSchema)
  // ChatEvents gains: messageTasks: 'chat:message_tasks'
  export interface ChatMessageTasksEvent {
    groupId: string; channelId: string; messageId: string; parentId: string | null;
    tasks: MessageTaskLink[];
  }
  // SourceMessageSchema gains: channelId: z.string(), taskId: z.string().nullable() (the task whose chat it is in)
  ```
- Server:
  - `listTasksForMessages(db: Db, messageIds: string[]): Promise<Map<string, MessageTaskLink[]>>` in `tasks/service.ts` — one `in (...)` query, ordered by `created_at, position`; `completed` = `completed_at is not null`.
  - `toMessageDtos` fills `tasks` for live messages (one extra query per page, none when the page has no live messages); deleted messages get `[]`.
  - `getSourceMessage(db: Db, messageId: string): Promise<SourceMessage | null>` in `chat/messages.ts` — author name, excerpt (`plainExcerpt`, 140), `channelId`, the channel's `taskId`; null when missing or deleted. `getTask` uses it (the comment "always null in this phase" goes).
  - `messageTasksEvent(db: Db, messageId: string): Promise<ChatMessageTasksEvent | null>` and `emitMessageTasks(io, event)` (group room).
  - In `task-routes.ts`, after a PATCH, a move that moved, and a DELETE of a task whose `sourceMessageId` is set: build and emit the event for that message.

- [ ] **Step 1: Write the failing tests**

```ts
// chat/reads.test.ts
it('a message page carries its tasks; a deleted task leaves the list, a completed one is marked', async () => {
  // set tasks.source_message_id of t1, t2 to m.id via db.update; move t2 to Completed; delete t1
  const page = await pageBefore(db, channel, me.id, null);
  expect(page.messages.find((x) => x.id === m.id)!.tasks).toEqual([
    { id: t2.id, title: 'Two', completed: true },
  ]);
});
// tasks/task-service.test.ts
it('getTask returns the source message with its channel', async () => {
  expect((await getTask(db, t.id))!.sourceMessage).toEqual({
    id: m.id, channelId: channel.id, taskId: null, authorName: 'Ana', excerpt: 'Do the report',
  });
});
// tasks/task-routes.test.ts
it('renaming or deleting a task made from a message pushes chat:message_tasks', async () => {
  // listen on a group-room socket; PATCH title → event.tasks has the new title; DELETE → event.tasks == []
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/server test -- src/modules/chat/reads.test.ts src/modules/tasks`
Expected: FAIL.

- [ ] **Step 3: Implement** the shared fields, the server functions and route hooks; add `tasks: []` to web fixtures and to any place in the web that builds a `MessageDto` (`message-rows.ts` pending rows, optimistic sends).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @spolu/server test && pnpm --filter @spolu/web typecheck && pnpm --filter @spolu/web test`
Expected: PASS.

- [ ] **Step 5: Docs, commit**

```bash
git commit -am "feat(tasks): messages list their tasks and tasks link back to their message"
```

---

### Task 5: Copy a file server-side

**Files:**
- Modify: `apps/server/src/infra/storage/storage.ts`, `disk-storage.ts`
- Modify: `apps/server/src/modules/files/service.ts`
- Test: `apps/server/src/infra/storage/storage.test.ts`, `apps/server/src/modules/files/service.test.ts`
- Docs: `docs/decisions/0003-disk-storage-behind-interface.md` is unchanged; describe `copy` and `copyFile` in `docs/architecture/overview.md` (Files API) and `data-model.md` (a copy is its own row)

**Interfaces:**
- `Storage.copy(fromKey: string, toKey: string): Promise<void>` — disk: validate both keys, `mkdir`, copy the sidecar first, then the data through the same temp-file-and-rename path as `put`; a missing source throws `StorageNotFoundError`.
- `copyFile(deps: FileDeps, input: { fileId: string; groupId: string; userId: string }): Promise<FileInfo>` — new id, `storageKey = files/<groupId>/<newId>`, preview (if any) to `files/<groupId>/<newId>-preview-<uuid>`; new row in the same group with `uploadedBy = userId`, `attachedAt = null`, same name, mime, size, width, height. If the insert fails, the copied objects are deleted. Throws `InvalidAttachmentError` for an unknown file or one in another group.

- [ ] **Step 1: Write the failing tests**

```ts
// storage.test.ts
it('copy duplicates data and content type; the copy outlives the source', async () => {
  await storage.put('a/x', Buffer.from('hi'), 'text/plain');
  await storage.copy('a/x', 'a/y');
  await storage.delete('a/x');
  const got = await storage.get('a/y');
  expect(got.contentType).toBe('text/plain');
  expect(await text(got.stream)).toBe('hi');
});
// files/service.test.ts
it('copyFile makes an unattached copy owned by the copier, with its own storage', async () => {
  const copy = await copyFile(deps, { fileId: original.id, groupId: group.id, userId: other.id });
  const row = (await getFile(db, copy.id))!;
  expect(row).toMatchObject({ groupId: group.id, uploadedBy: other.id, attachedAt: null, name: 'plan.pdf' });
  expect(row.storageKey).not.toBe(originalRow.storageKey);
  await deleteFiles(deps, [copy.id]);
  expect(await storage.exists(originalRow.storageKey)).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/server test -- src/infra/storage src/modules/files/service.test.ts`
Expected: FAIL (`copy` is not a function).

- [ ] **Step 3: Implement** `copy` and `copyFile`.

- [ ] **Step 4: Run to verify they pass** (same command). Expected: PASS.

- [ ] **Step 5: Docs, commit**

```bash
git commit -am "feat(files): copy a stored file into a new unattached file"
```

---

### Task 6: The AI provider and the task split endpoint

**Files:**
- Create: `apps/server/src/modules/ai/provider.ts`, `openai-provider.ts`, `fake-provider.ts`, `index.ts`, `split.ts`, `routes.ts`, and tests `openai-provider.test.ts`, `fake-provider.test.ts`, `split.test.ts`, `routes.test.ts`
- Create: `packages/shared/src/ai.ts`; modify `packages/shared/src/index.ts`, `users.ts` (`ErrorCodes`)
- Modify: `apps/server/src/infra/config/config.ts` (+ `config.test.ts`), `deps.ts`, `app.ts`, `test/test-app.ts`
- Modify: `apps/server/src/modules/chat/messages.ts` (`getMessageFiles`)
- Docs: `docs/architecture/overview.md` (the AI client, the endpoints), `docs/architecture/performance.md` (the in-request exception), `docs/runbooks/deploy.md` and `deploy/test.env.example` (`OPENAI_API_KEY`, `OPENAI_MODEL`, never `AI_PROVIDER=fake` on a server), `docs/product/ai-task-split.md` (status; the limit line becomes "no limit, owner 2026-10-15"; file names go to the AI)

**Interfaces:**
- Shared `ai.ts`:
  ```ts
  export const AI_MAX_TASKS = 10;
  export const AI_TITLE_MAX = 200;
  export const AI_DESCRIPTION_MAX = 5000;
  export const TaskProposalSchema = z.object({
    title: z.string(), description: z.string(), assigneeIds: z.array(z.string()),
    dueDate: z.string().nullable(), urgent: z.boolean(), messageFileIds: z.array(z.string()),
  });
  export const TaskProposalsSchema = z.object({ tasks: z.array(TaskProposalSchema) });
  export const AiStatusSchema = z.object({ taskSplit: z.boolean() });
  // ErrorCodes: aiUnavailable: 'ai_unavailable', aiFailed: 'ai_failed', aiNoTasks: 'ai_no_tasks'
  ```
- Config: env `AI_PROVIDER` (`openai` | `fake`, default `openai`), `OPENAI_API_KEY` (optional), `OPENAI_MODEL` (default `gpt-5-mini`). `Config.ai: { provider: 'openai'; apiKey: string; model: string } | { provider: 'fake' } | null` (null = openai without key). `testConfig` sets `ai: null`.
- `provider.ts`:
  ```ts
  export type SplitRequest = {
    text: string; quoted: string | null;
    files: { id: string; name: string }[]; people: { id: string; name: string }[];
    today: string; // YYYY-MM-DD, Europe/Bratislava
  };
  export type RawTask = { title: string; description: string; assigneeIds: string[];
    fileIds: string[]; deadline: string | null; urgent: boolean };
  export type SplitResult = { tasks: RawTask[]; usage: { promptTokens: number; completionTokens: number } | null };
  export interface TaskSplitProvider { split(request: SplitRequest, signal: AbortSignal): Promise<SplitResult> }
  export class AiFailedError extends Error {} // any provider failure, abort included
  ```
- `openai-provider.ts`: `createOpenAiProvider(options: { apiKey: string; model: string; fetch?: typeof fetch }): TaskSplitProvider` — `POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer`, body `{ model, messages: [system, user], response_format: { type: 'json_schema', json_schema: { name: 'task_split', strict: true, schema } } }` (no `temperature`). The schema is the spec's `{ tasks: [{ title, description, assigneeIds, fileIds, deadline: string|null, urgent }] }` with every property required and `additionalProperties: false`; length and count limits go in property descriptions and are enforced by `sanitizeProposals`. A non-2xx, a `refusal`, unparsable content or content that fails zod is `AiFailedError`. `usage.prompt_tokens`/`completion_tokens` map to `usage`.
- System prompt (exact text, the user message is the request rendered as labelled sections `Message:`, `Quoted message:`, `Files (id — name):`, `People (id — name):`, `Today:`):
  ```
  You turn one chat message into task cards for a project board. Write every title and description in the language of the message. Make one task per distinct job; do not split one job into steps. Set assigneeIds, deadline (YYYY-MM-DD) and urgent only when the message states them clearly; otherwise use [], null and false. Use only ids from the lists given. Give each file to the task or tasks it belongs to (fileIds); a file may belong to several tasks or to none. Titles are short (at most 200 characters); descriptions keep the details the message gives (at most 5000 characters). Return at most 10 tasks, or none if the message describes no job.
  ```
- `fake-provider.ts`: `createFakeProvider(): TaskSplitProvider` — one task per line of `text` that starts with `- `, `* `, `• `, or `N.`/`N)`; title = the line without the marker; description `''`; assignees = people whose name occurs in the line (case-insensitive); fileIds = files whose name occurs in the line; deadline = the first `YYYY-MM-DD` in the line; urgent = the line contains `urgent` or `súrne` (case-insensitive). No such line → no tasks. `usage: null`.
- `index.ts`: `createAiProvider(config: Config['ai']): TaskSplitProvider | null`. `AppDeps.ai: TaskSplitProvider | null`; `buildTestApp(overrides: { config?; ai?: TaskSplitProvider | null })` (default null).
- `split.ts`:
  - `export const AI_TIMEOUT_MS = 30_000;`
  - `buildSplitRequest(db: Db, found: { message: MessageRow; channel: ChannelRow }, now?: Date): Promise<SplitRequest>` — mention tokens become `@Name` (newlines kept; not `plainExcerpt`), `quoted` = the `replyToId` message's text (null if none or deleted), files from `getMessageFiles`, people from `listGroupPeople`.
  - `sanitizeProposals(raw: RawTask[], allowed: { peopleIds: Set<string>; fileIds: Set<string> }): TaskProposal[]` — trim and cut title to 200 and description to 5000; drop tasks with a blank title; dedupe and filter assignee ids (max 10) and file ids; deadline kept only if a real calendar date (else null); keep the first 10; `fileIds` → `messageFileIds`, `deadline` → `dueDate`.
  - `proposeTasks(deps: AppDeps, found, options?: { timeoutMs?: number }): Promise<{ tasks: TaskProposal[]; usage: SplitResult['usage']; durationMs: number }>` — throws `AiUnavailableError` (no provider), `AiFailedError` (provider error or `AbortSignal.timeout`), `AiNoTasksError` (nothing left after sanitizing).
- `routes.ts` (`aiRoutes`, registered under `/api`):
  - `GET /api/ai/status` (any user) → `{ taskSplit: deps.ai !== null }`.
  - `POST /api/messages/:id/task-split` (any user, no extra rate limit): 503 `ai_unavailable` when `deps.ai` is null; 404 when `findReadableMessage` is null or the message is deleted; 400 `validation_failed` when its text is blank; 502 `ai_failed`; 422 `ai_no_tasks`; 200 `TaskProposals`. Every call that reaches the provider logs `request.log.info({ ai: { userId, messageId, durationMs, outcome, usage } }, 'ai task split')` with `outcome` one of `ok | no_tasks | failed | timeout`.

- [ ] **Step 1: Write the failing tests**

```ts
// split.test.ts
describe('sanitizeProposals', () => {
  const allowed = { peopleIds: new Set(['u1']), fileIds: new Set(['f1']) };
  it('drops unknown ids, invalid dates and blank titles; caps at 10', () => {
    const raw = Array.from({ length: 14 }, (_, i) => ({
      title: i === 0 ? '   ' : `T${i} ${'x'.repeat(i === 1 ? 400 : 0)}`, description: '',
      assigneeIds: ['u1', 'u1', 'ghost'], fileIds: ['f1', 'nope'],
      deadline: i === 2 ? '2026-02-31' : '2026-11-01', urgent: false,
    }));
    const out = sanitizeProposals(raw, allowed);
    expect(out).toHaveLength(10);
    expect(out[0]!.title).toHaveLength(200);
    expect(out[0]).toMatchObject({ assigneeIds: ['u1'], messageFileIds: ['f1'] });
    expect(out[1]!.dueDate).toBeNull();
  });
});
describe('proposeTasks', () => {
  it('times out as AiFailedError', async () => {
    const hanging = { split: (_: unknown, signal: AbortSignal) =>
      new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new AiFailedError()))) };
    await expect(proposeTasks({ ...deps, ai: hanging }, found, { timeoutMs: 50 })).rejects.toBeInstanceOf(AiFailedError);
  });
  it('sends names, not mention tokens, and the files as id — name', async () => {
    // stub provider captures the request; message body 'Ask <@u1> about report.pdf'
    expect(captured.text).toBe('Ask @Ana about report.pdf');
    expect(captured.files).toEqual([{ id: file.id, name: 'report.pdf' }]);
  });
});
// routes.test.ts
it('503 without a provider, 404 for another group\'s client, 502 on failure, 422 on no tasks, 200 otherwise', async () => { /* buildTestApp({ ai: stub }) per case */ });
// openai-provider.test.ts: stubbed fetch — sends the strict json_schema and the model; maps a valid answer; refusal / 500 / bad JSON → AiFailedError
// fake-provider.test.ts: '- Write report by 2026-11-01 for Ana\n- Call bank urgent' → 2 tasks with deadline, assignee, urgent
// config.test.ts: OPENAI_MODEL defaults to gpt-5-mini; no key → ai null; AI_PROVIDER=fake → { provider: 'fake' }
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/server test -- src/modules/ai src/infra/config`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** shared `ai.ts` and error codes, config, providers, `split.ts`, routes, deps wiring.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @spolu/server test && pnpm --filter @spolu/shared test && pnpm --filter @spolu/server typecheck`
Expected: PASS.

- [ ] **Step 5: Docs, commit**

```bash
git commit -am "feat(ai): propose task cards for a chat message through OpenAI"
```

---

### Task 7: Create the approved cards from a message

**Files:**
- Modify: `packages/shared/src/tasks.ts`
- Modify: `apps/server/src/modules/tasks/positions.ts` (+ `positions.test.ts`), `task-service.ts`, `task-routes.ts`
- Test: `apps/server/src/modules/tasks/task-service.test.ts`, `task-routes.test.ts`
- Docs: `docs/architecture/overview.md` (Tasks API), `docs/product/task-board.md` (created from a message: top of To do)

**Interfaces:**
- Shared:
  ```ts
  export const TaskFromMessageDraftSchema = TaskDraftSchema.extend({
    messageFileIds: z.array(z.string()).max(20).default([]),
  }).refine((d) => d.fileIds.length + d.messageFileIds.length <= 20, { path: ['fileIds'] });
  export const TasksFromMessageSchema = z.object({
    messageId: z.string().regex(ID_RE),
    tasks: z.array(TaskFromMessageDraftSchema).min(1).max(AI_MAX_TASKS),
  });
  export type TasksFromMessage = z.output<typeof TasksFromMessageSchema>;
  export const TasksFromMessageResultSchema = z.object({ tasks: z.array(TaskDetailDtoSchema) });
  ```
- `keysBefore(next: string | null, n: number): string[]` — `generateNKeysBetween(null, next, n)`.
- `createTasksFromMessage(deps: TaskDeps, actor: SessionUser, groupId: string, input: TasksFromMessage, source: { id: string; fileIds: string[] }): Promise<TaskDetailDto[]>`:
  1. Every `messageFileIds` entry must be in `source.fileIds`, else `InvalidAttachmentError`.
  2. Copy each (card, message file) pair with `copyFile(deps, { fileId, groupId, userId: actor.id })` before the transaction.
  3. One transaction: `ensureBoard`; lock the To do bucket (`lockBuckets`); `keysBefore(first To do position, n)`; insert the tasks in input order with `sourceMessageId = source.id` and `createdAt = now + index ms`; assignees (`checkAssignees`); `attachFiles(tx, groupId, [...fileIds, ...copyIds], actor.id)` and `task_attachments`; `notifyAssigned` per task.
  4. If anything throws, `deleteFiles(deps, copyIds)` and rethrow (nothing created).
  5. Returns `getTask` of each, in input order.
- Route `POST /api/groups/:id/tasks/from-message` (`writeGuard`): body 400 (`invalidBody`); `canOpenGroup` 404; `findReadableMessage` must find a live message whose channel's `groupId` is `:id`, else 404; `source = { id, fileIds: (await getMessageFiles(db, id)).map((f) => f.id) }`; service errors through `writeError`; 201 `{ tasks }`; then `emitTask` per task in order and one `emitMessageTasks`.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates the cards at the top of To do, in order, linked to the message, with copied files', async () => {
  const [a, b] = await createTasksFromMessage(deps, admin, group.id, {
    messageId: m.id,
    tasks: [draft({ title: 'A', messageFileIds: [file.id] }), draft({ title: 'B', messageFileIds: [file.id] })],
  }, { id: m.id, fileIds: [file.id] });
  const todo = tasksIn(await getBoard(db, group.id), 'todo');
  expect(todo.slice(0, 2).map((t) => t.title)).toEqual(['A', 'B']);
  expect(a!.sourceMessageId).toBe(m.id);
  expect(a!.files[0]!.id).not.toBe(file.id);
  expect(a!.files[0]!.id).not.toBe(b!.files[0]!.id);
  await deleteTask(deps, a!.id);
  expect(await getFile(db, file.id)).not.toBeNull(); // the message keeps its file
});
it('is all or nothing: an invalid assignee on card 2 creates nothing and removes the copies', async () => {
  const before = await countFiles(group.id);
  await expect(createTasksFromMessage(deps, admin, group.id, {
    messageId: m.id, tasks: [draft({ messageFileIds: [file.id] }), draft({ assigneeIds: [stranger.id] })],
  }, { id: m.id, fileIds: [file.id] })).rejects.toBeInstanceOf(InvalidAssigneeError);
  expect(tasksIn(await getBoard(db, group.id), 'todo')).toHaveLength(0);
  expect(await countFiles(group.id)).toBe(before);
});
it('rejects a file that is not on the message', async () => { /* InvalidAttachmentError */ });
// task-routes.test.ts
it('POST from-message: 201, board:task per card and one chat:message_tasks', async () => {});
it('404 for a message of another group, a deleted message, or another group\'s client', async () => {});
it('400 invalid_attachment when the message lost the file since the proposal', async () => {});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/server test -- src/modules/tasks`
Expected: FAIL.

- [ ] **Step 3: Implement** the schema, `keysBefore`, the service and the route.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @spolu/server test`
Expected: PASS.

- [ ] **Step 5: Docs, commit**

```bash
git commit -am "feat(tasks): create reviewed task cards from a chat message"
```

---

### Task 8: Task panel tabs and the task chat

Invoke `frontend-design:frontend-design` first, on `docs/design/tokens.md`, for the tab pair under the title and the chat filling the panel.

**Files:**
- Create: `apps/web/src/features/chat/links.ts` (+ `links.test.ts`), `apps/web/src/features/tasks/task-chat.tsx`
- Modify: `apps/web/src/features/chat/api.ts`, `conversation.tsx`, `thread-panel.tsx`
- Modify: `apps/web/src/features/tasks/task-panel.tsx`, `panel-parts.tsx`, `source-message.tsx`
- Modify: `apps/web/src/locales/en.json`, `sk.json`
- Test: `apps/web/src/features/tasks/task-panel.test.tsx`, `apps/web/src/features/chat/conversation.test.tsx`
- Docs: `docs/design/tokens.md` (task panel tabs), `docs/product/task-board.md` (task chat), `docs/product/chat.md` (task chats, link form)

**Interfaces:**
- Consumes: `GET /api/tasks/:id/chat`, `POST /api/channels/:id/read-all` (Tasks 2, 3); `SourceMessage.channelId/taskId` (Task 4).
- Produces:
  - `chatMessageHref(groupId: string, m: { messageId: string; channelId: string; taskId: string | null }): string` — group chat: `/groups/<g>/chat?message=<id>&c=<channel>`; task chat: `/groups/<g>/tasks/<task>?tab=chat&message=<id>&c=<channel>` (all parts URI-encoded).
  - `taskChatQuery(taskId)` (key `['chat', 'task', taskId]`, `GroupChannelSchema`), `markAllRead(channelId: string): Promise<void>` in `chat/api.ts`.
  - `ConversationProps.threadMode?: 'side' | 'over'` (default `'side'`): `'over'` makes an open thread cover the list at every width (`ThreadPanel` gets `over`, which drops its `min-[1024px]:` side layout and always shows its back button).
  - `PanelTabs({ tab, chatCount, onChange }: { tab: 'details' | 'chat'; chatCount: number; onChange(tab): void })` in `panel-parts.tsx` — a `tablist` with "Details" and "Chat (N)" (`tasks.panel.tabs.details`, `tasks.panel.tabs.chat` with `{{count}}`), ≥ 44 px on phones.
  - `TaskChat({ groupId, taskId, messageActions?, renderMessageFooter? })` — loads `taskChatQuery`, renders `<Conversation threadMode="over">` filling the tab, calls `markAllRead` once the channel is loaded and the page is visible, then invalidates `taskChatsQuery(groupId)` (Task 9 adds it; until then nothing to invalidate) — load error shows `chat.loadError` + retry.
- Panel layout: header, notices, the title row (done circle + h2) stay as today but outside the scroll area; then `PanelTabs`; Details = the scroll area with source message, form, save bar and the created-by footer; Chat = `TaskChat` in a `flex-1 min-h-0` box. The tab is `?tab=chat` (read with `useLocation`, switched with `navigate({ to: '.', search: …, replace: true })`, other params kept, no route schema). The Details content stays mounted (`hidden`) while Chat shows, so the draft and the unsaved-changes blocker survive. The panel stays 560 px from 1024 px (it already is). `chatCount` is 0 until Task 9 provides the summary.
- `SourceMessage` links with `chatMessageHref(groupId, { messageId: id, channelId, taskId })`.

- [ ] **Step 1: Write the failing tests**

```tsx
// links.test.ts
expect(chatMessageHref('g', { messageId: 'm', channelId: 'c', taskId: null })).toBe('/groups/g/chat?message=m&c=c');
expect(chatMessageHref('g', { messageId: 'm', channelId: 'c', taskId: 't' })).toBe('/groups/g/tasks/t?tab=chat&message=m&c=c');
// task-panel.test.tsx
it('shows Details and Chat tabs; Chat mounts the conversation and marks the chat read', async () => {
  renderPanel('/groups/g1/tasks/t1');
  await user.click(await screen.findByRole('tab', { name: /Chat/ }));
  expect(await screen.findByTestId('conversation')).toBeInTheDocument(); // mocked Conversation
  expect(markAllRead).toHaveBeenCalledWith('ch1');
  expect(router.state.location.search).toMatchObject({ tab: 'chat' });
});
it('keeps unsaved Details edits across a tab switch and still asks on leaving', async () => {
  await user.type(titleInput(), ' more');
  await user.click(tab('Chat')); await user.click(tab('Details'));
  expect(titleInput()).toHaveValue('Task more');
  await user.click(screen.getByRole('button', { name: t('tasks.panel.close') }));
  expect(await screen.findByText(t('tasks.panel.unsaved'))).toBeInTheDocument();
});
it('opens on the Chat tab at a linked message', async () => {
  renderPanel('/groups/g1/tasks/t1?tab=chat&message=m9&c=ch1');
  expect(await screen.findByRole('tab', { name: /Chat/, selected: true })).toBeInTheDocument();
});
it('the source message links to its chat', async () => { /* href equals chatMessageHref(...) */ });
// conversation.test.tsx
it('threadMode over: an open thread covers the list at desktop width', async () => {});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/web test -- src/features/tasks/task-panel.test.tsx src/features/chat/conversation.test.tsx src/features/chat/links.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as above; add the copy to both locales.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @spolu/web test && pnpm --filter @spolu/web typecheck`
Expected: PASS.

- [ ] **Step 5: Docs, commit**

```bash
git commit -am "feat(tasks): every task has its own chat in the panel"
```

---

### Task 9: Unread tasks on the board and the Tasks tab

Invoke `frontend-design:frontend-design` first, for the chat icon with count and dot in the card's meta row, the bold unread title and the Tasks tab pill.

**Files:**
- Create: `apps/web/src/features/tasks/task-chats.ts` (+ `task-chats.test.tsx`), `apps/web/src/features/tasks/tasks-tab-badge.tsx`
- Modify: `apps/web/src/features/tasks/task-card.tsx`, `icons.tsx`, `bucket-column.tsx`, `board.tsx`, `task-panel.tsx` (real `chatCount`), `task-chat.tsx` (invalidate after read)
- Modify: `apps/web/src/features/chat/unread.tsx` (`UnreadPill` `label?: string`)
- Modify: `apps/web/src/features/groups/group-layout.tsx` (+ `group-layout.test.tsx` mock)
- Modify: locales
- Test: `apps/web/src/features/tasks/board.test.tsx`, `task-chats.test.tsx`, `apps/web/src/features/groups/group-layout.test.tsx`
- Docs: `docs/design/tokens.md` (task board: chat meta, unread title), `docs/product/task-board.md` (unread tasks), `docs/architecture/performance.md` (one query per board, eager size of the badge)

**Interfaces:**
- Consumes: `GET /api/groups/:id/task-chats`, `chat:message` / `chat:thread-reply` / `chat:read` with `taskId` (Tasks 2, 3).
- Produces:
  - `taskChatsQuery(groupId)` — key `['tasks', groupId, 'chats']`, `TaskChatSummariesSchema`. Imported eagerly by the group layout: this file imports only `@/lib/api`, `@/lib/socket`, shared types and the group-room hook.
  - `useTaskChatEvents(groupId: string, meId: string | undefined): void` — mounted once, inside `TasksTabBadge`. For events of this group with a non-null `taskId`: `chat:message` with `isNew` → `count + 1` (creating the entry), and `unread = true` when the author is not me and it is top-level; `chat:message` that is a delete (`!isNew && deletedAt`) → invalidate; `chat:thread-reply` → `unread = true`; `chat:read` → invalidate. Every rejoin after the first → invalidate.
  - `TasksTabBadge({ groupId })` — `UnreadPill` with the number of entries with `unread`, label `tasks.unreadTasks` (plural `_one/_few/_many/_other` in sk, `_one/_other` in en).
  - `TaskCardMeta({ assignees, dueDate, overdue, fileCount, chat })` extracted from `TaskCard` (reused by Task 11's summaries); `chat?: TaskChatSummary`. After the paperclip: a chat bubble icon with `count` when `count > 0`, with a filled dot when `unread`; sr-only text `tasks.card.messages` (plural, with ", unread" variant `tasks.card.messagesUnread`).
  - `TaskCard` gets `chat?: TaskChatSummary`; unread title `font-bold`, read titles `font-medium` (was `font-semibold`; frontend-design confirms the pair is visibly distinct on the tokens).
  - `Board` reads `taskChatsQuery(groupId)` once and passes each card its summary through `BucketColumn`.

- [ ] **Step 1: Write the failing tests**

```tsx
// board.test.tsx (the board test already mocks the socket)
it('marks an unread task: bold title, chat count with a dot', async () => {
  serve({ '/api/groups/g1/task-chats': { t1: { count: 3, unread: true }, t2: { count: 1, unread: false } } });
  renderBoard();
  const card = await screen.findByRole('link', { name: /First/ });
  expect(within(card).getByText('First')).toHaveClass('font-bold');
  expect(within(card).getByText(t('tasks.card.messagesUnread', { count: 3 }))).toBeInTheDocument();
  expect(within(screen.getByRole('link', { name: /Second/ })).getByText('Second')).toHaveClass('font-medium');
});
it('fetches the summaries once per board load', async () => {
  expect(fetchCalls('/api/groups/g1/task-chats')).toBe(1);
});
// task-chats.test.tsx (fake socket emitting events)
it('a new top-level message by someone else makes the task unread and counts it; chat:read refetches', async () => {});
it('ignores events of the group channel and of other groups', async () => {});
// group-layout.test.tsx
it('the Tasks tab shows the number of unread tasks', async () => {});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/web test -- src/features/tasks src/features/groups/group-layout.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**; wire `badges={{ chat: …, tasks: <TasksTabBadge groupId={group.id} /> }}`; the panel's `chatCount` reads the same query; `TaskChat` invalidates it after `markAllRead`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @spolu/web test && pnpm --filter @spolu/web build`
Expected: PASS; the build's initial JS (entry + chunks `index.html` loads) is still ≤ 200 kB gzip.

- [ ] **Step 5: Docs, commit**

```bash
git commit -am "feat(tasks): unread task chats on cards and the Tasks tab"
```

---

### Task 10: "Turned into tasks" under the message

Invoke `frontend-design:frontend-design` first, for the footer line under a message.

**Files:**
- Create: `apps/web/src/features/chat/message-tasks.tsx` (+ `message-tasks.test.tsx`)
- Modify: `apps/web/src/features/chat/use-channel-messages.ts`, `use-thread.ts` (apply `chat:message_tasks`)
- Modify: `apps/web/src/features/chat/chat-tab.tsx`, `apps/web/src/features/tasks/task-chat.tsx` (pass the footer)
- Modify: locales
- Test: `message-tasks.test.tsx`, `use-channel-messages.test.tsx`
- Docs: `docs/product/chat.md` (the footer), `docs/design/tokens.md` (chat rows: tasks footer)

**Interfaces:**
- Consumes: `MessageDto.tasks`, `ChatEvents.messageTasks` (Task 4).
- Produces:
  - `MessageTasks({ groupId, tasks }: { groupId: string; tasks: MessageTaskLink[] })` — nothing for `[]`; else "Turned into tasks:" (`chat.turnedIntoTasks`) then a `Link` per task to `/groups/$groupId/tasks/$taskId`, title struck through (`line-through text-muted-foreground`) when `completed`, the same struck title with sr-only `tasks.card.completed` text.
  - `renderMessageTasks(groupId: string): (message: MessageDto) => ReactNode` — the caller memoises it per `groupId` (`useMemo`), so `renderMessageFooter` is stable.
  - `useChannelMessages` handles `chat:message_tasks` for its channel: the message, if in the window, is re-put with the new `tasks` (the same path as `applyLocal`, not moving `lastSeq`); `use-thread.ts` patches the cached thread of `parentId ?? messageId`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('lists the tasks with links and strikes completed ones', () => {
  render(<MessageTasks groupId="g1" tasks={[{ id: 't1', title: 'Report', completed: false }, { id: 't2', title: 'Bank', completed: true }]} />);
  expect(screen.getByRole('link', { name: 'Report' })).toHaveAttribute('href', '/groups/g1/tasks/t1');
  expect(screen.getByText('Bank')).toHaveClass('line-through');
});
it('renders nothing without tasks', () => { /* container empty */ });
// use-channel-messages.test.tsx
it('chat:message_tasks updates the message in the window; other channels are ignored', async () => {});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/web test -- src/features/chat/message-tasks.test.tsx src/features/chat/use-channel-messages.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**; `ChatTab` and `TaskChat` pass `renderMessageFooter`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @spolu/web test`
Expected: PASS.

- [ ] **Step 5: Docs, commit**

```bash
git commit -am "feat(chat): messages show the tasks made from them"
```

---

### Task 11: Turn into tasks — the review dialog

Invoke `frontend-design:frontend-design` first, for the 720 px dialog / phone sheet, the three loading outlines, the compact summary cards, the expanded card, the rejected line and the toast.

**Files:**
- Create: `apps/web/src/features/task-split/api.ts`, `review-model.ts` (+ `review-model.test.ts`), `use-message-task-tools.tsx`, `review-dialog.tsx` (+ `review-dialog.test.tsx`), `review-card.tsx`
- Create: `apps/web/src/components/ui/toast.tsx`, `apps/web/src/lib/use-media-query.ts` (moved out of `conversation.tsx`, which imports it)
- Modify: `apps/web/src/features/chat/chat-tab.tsx`, `apps/web/src/features/tasks/task-chat.tsx`
- Modify: locales
- Docs: `docs/product/ai-task-split.md` (built behaviour), `docs/design/tokens.md` (review dialog), `docs/product/chat.md` (the action)

**Interfaces:**
- Consumes: `GET /api/ai/status`, `POST /api/messages/:id/task-split` (Task 6), `POST /api/groups/:id/tasks/from-message` (Task 7), `MessageAction.inMenu/isAvailable` (Task 1), `TaskForm`, `validateTaskDraft`, `TaskCardMeta` (Task 9), `FileChip`.
- `api.ts`: `aiStatusQuery` (key `['ai', 'status']`, `staleTime: Infinity`), `proposeTasks(messageId: string): Promise<TaskProposals>`, `createTasksFromMessage(groupId: string, input: TasksFromMessage): Promise<TaskDetailDto[]>`.
- `review-model.ts` (pure):
  ```ts
  export type ReviewCard = {
    key: string;
    draft: TaskDraft;          // fileIds = message files kept + files uploaded in the review
    files: FileInfo[];         // details of draft.fileIds, for TaskForm
    decision: 'pending' | 'approved' | 'rejected';
  };
  export function cardsFromProposals(p: TaskProposal[], messageFiles: FileInfo[]): ReviewCard[];
  export function cardByHand(message: MessageDto): ReviewCard; // empty title, description = message.body
  export function canSubmit(cards: ReviewCard[]): boolean;   // none pending and ≥ 1 approved
  export function isTouched(cards: ReviewCard[], initial: ReviewCard[]): boolean;
  export function toRequest(messageId: string, cards: ReviewCard[], messageFileIds: Set<string>): TasksFromMessage;
  // approved cards in shown order; ids in messageFileIds go to messageFileIds, the rest to fileIds
  ```
- `useMessageTaskTools(groupId: string): { messageActions: MessageAction[]; renderMessageFooter: (m: MessageDto) => ReactNode; element: ReactNode }` — `messageActions` is `[]` while `aiStatusQuery` is not `taskSplit: true`, else one action `{ id: 'turn-into-tasks', label: t('chat.actions.turnIntoTasks'), inMenu: true, isAvailable: (m) => m.body.trim() !== '', onSelect }`, memoised; `renderMessageFooter` is Task 10's; `element` is the lazy `ReviewDialog` (`React.lazy` + `Suspense`, rendered only while a message is chosen) and the `Toast`. Used by `ChatTab` and `TaskChat` (replaces their direct footer wiring).
- `ReviewDialog({ groupId, message, onClose, onCreated(tasks) })`:
  - `radix-ui` `Dialog`, `aria-labelledby` its heading (`taskSplit.title`); desktop a centred 720 px dialog; ≤ 640 px a full-screen sheet with a sticky footer.
  - The quoted message (author, excerpt) on top. Loading: three card outlines, `motion-safe:animate-pulse`, text "AI is reading the message…" (`taskSplit.loading`, `role="status"`).
  - Cards: `ReviewCard` summary, an `<article>` labelled by its title (title, two-line description `line-clamp-2`, `TaskCardMeta` without chat, urgent badge, `FileChip`s) with "Approve" / "Reject" (≥ 44 px, `aria-pressed`); "Approve all". A rejected card is one struck-through line with "Undo". Opening a summary: desktop (`useMediaQuery('(min-width: 641px)')`) expands it in place into `TaskForm` (one open at a time; opening another collapses the first and keeps its edits); phones open it as a full-screen layer over the list with "Done" (`taskSplit.done`). Approving runs `validateTaskDraft`; a card with errors opens with them instead of being approved.
  - Footer: "Create N tasks" (`taskSplit.create`, plural; disabled unless `canSubmit`, and while the request is on its way) and "Cancel". Backdrop click does nothing; Escape or Cancel with `isTouched` asks "Discard the proposed tasks?" (`taskSplit.discardConfirm`, buttons `taskSplit.discard` / `taskSplit.keep`) in the dialog; untouched they close at once.
  - Errors in the same dialog: `ai_failed` → "The AI did not answer. Try again." (`taskSplit.failed`) + "Try again"; `ai_no_tasks` → "The AI found no tasks in this message." (`taskSplit.noTasks`) + "Create one task by hand" (`taskSplit.byHand`, opens `cardByHand` expanded). A failed create keeps every card and shows `taskSplit.createFailed` (404 → `taskSplit.messageGone`, `invalid_attachment` → `taskSplit.filesChanged`).
  - On success: `onCreated(tasks)`; the hook closes the dialog and shows the toast "N tasks created" (`taskSplit.created`, plural) with a link "Open the board" (`taskSplit.openBoard`) to `/groups/$groupId/tasks`.
- `Toast({ children, onClose })` — fixed bottom-centre `role="status"` bar on `bg-popover`, closes after 6 s or on its close button; no animation.

- [ ] **Step 1: Write the failing tests**

```ts
// review-model.test.ts
it('canSubmit needs every card decided and one approved', () => {
  expect(canSubmit([card('pending'), card('approved')])).toBe(false);
  expect(canSubmit([card('rejected'), card('rejected')])).toBe(false);
  expect(canSubmit([card('rejected'), card('approved')])).toBe(true);
});
it('toRequest keeps shown order and splits message files from uploads', () => {
  expect(toRequest('m1', [approved({ fileIds: ['mf', 'up'] }), rejected()], new Set(['mf'])).tasks[0])
    .toMatchObject({ fileIds: ['up'], messageFileIds: ['mf'] });
});
```
```tsx
// review-dialog.test.tsx (api module mocked; matchMedia stubbed per case)
it('shows the loading outlines, then compact cards', async () => {});
it('desktop: opening a card expands it in place; opening another collapses the first and keeps its edits', async () => {});
it('phone: opening a card shows it full screen with Done, back to the list', async () => {});
it('approve, reject, undo; Create is enabled only when every card is decided', async () => {});
it('sends one request on a double click, and keeps the cards when it fails', async () => {
  createTasksFromMessage.mockRejectedValueOnce(new ApiError(400, 'invalid_attachment'));
  await user.dblClick(screen.getByRole('button', { name: /Create 2 tasks/ }));
  expect(createTasksFromMessage).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(t('taskSplit.filesChanged'))).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(2);
});
it('Escape after a decision asks before discarding; a backdrop click does nothing', async () => {});
it('no tasks: offers one card by hand prefilled with the message text', async () => {});
it('ai_failed: Try again calls the AI again', async () => {});
// use-message-task-tools: the action is absent while ai status is false; messageActions is the same array across renders
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @spolu/web test -- src/features/task-split`
Expected: FAIL.

- [ ] **Step 3: Implement**; add all copy to both locales.

- [ ] **Step 4: Run to verify they pass, and check the bundle**

Run: `pnpm --filter @spolu/web test && pnpm --filter @spolu/web build`
Expected: PASS; `review-dialog` is its own chunk; initial JS ≤ 200 kB gzip.

- [ ] **Step 5: Docs, commit**

```bash
git commit -am "feat(ai): review AI-proposed cards and create the approved tasks"
```

---

### Task 12: End to end, roadmap and the final docs sweep

**Files:**
- Create: `e2e/ai-tasks.spec.ts`
- Modify: `playwright.config.ts` (`AI_PROVIDER: 'fake'` in `webServer.env`)
- Modify: `docs/roadmap.md` (Phase 9 status), `docs/architecture/performance.md` (measured initial JS and the `review-dialog` / `tasks-tab` chunk sizes), `docs/architecture/overview.md` (cross-check every Phase 9 endpoint is described once)

**Interfaces:**
- Consumes: everything above. The fake provider turns each `- ` line into one card.

- [ ] **Step 1: Write the e2e test** (same setup style as `e2e/tasks.spec.ts`: a unique group through the API, the stored superadmin session)

```ts
test('a message with 5 jobs becomes 4 reviewed tasks with links both ways and working task chats', async ({ page }) => {
  // group chat: send "- Write the report\n- Call the bank\n- Fix the logo\n- Book the room\n- Send the invoice"
  // hover the message → More → "Turn into tasks"; expect 5 cards (role=article)
  // reject "Fix the logo"; open "Call the bank", change its title to "Call the bank today"; approve the rest
  // click "Create 4 tasks"; toast "4 tasks created"
  // message footer shows 4 links; follow "Call the bank today" → task panel; "Created from a message" link back works
  // on the board To do starts with the 4 titles in order
  // in a task: Chat tab → send a message → reply in its thread → both visible
});
```

- [ ] **Step 2: Run it**

Run: `docker compose -f docker-compose.dev.yml up -d --wait && pnpm test:e2e e2e/ai-tasks.spec.ts`
Expected: PASS. Then the whole suite: `pnpm test:e2e` — PASS.

- [ ] **Step 3: Full checks**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @spolu/web build && scripts/check-docs.sh`
Expected: all PASS; record the measured sizes in `performance.md`.

- [ ] **Step 4: Commit**

```bash
git add e2e/ai-tasks.spec.ts playwright.config.ts docs
git commit -m "test(e2e): message to tasks with the fake AI, and task chats"
```

---

## Self-review notes

- Spec coverage: task channel lazy + FKs + cascade (T2); permissions (T2); notifications with `taskId` (T2); unread rules, one query, Tasks tab count (T3, T9); panel tabs, `?tab=chat` links, thread over the chat (T8); AI call, schema, prompt, sanitizing, timeout, 503/502/422, logging, no limit (T6); `copyFile` (T5); `from-message` transaction, top of To do, events (T7); message footer with deleted/completed tasks (T4, T10); review dialog behaviour and errors (T11); action placement and hiding (T1, T11); error codes (T6); e2e with `AI_PROVIDER=fake` (T12); every doc in the spec's list is assigned to a task.
- Spec ambiguities resolved here: see the hand-off report.
