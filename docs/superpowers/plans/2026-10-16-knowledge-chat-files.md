# Chat Files in the Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every file attached to a chat message appears in its group's knowledge base as a read-only "From chat" item that opens the chat at the message.

**Architecture:** Stored `knowledge_items` rows of type `chat_file`, written by a knowledge hook inside the chat's send transaction and tied to `message_attachments` by a cascading composite foreign key. The chat module only exposes hooks (`chat/file-hooks.ts`); the knowledge module registers them at start-up. Lists keep their single page query; a join adds the chat source.

**Tech Stack:** Fastify, Drizzle (PostgreSQL 17), Socket.IO, zod (`@spolu/shared`), React, TanStack Router/Query, Tailwind, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-16-knowledge-chat-files-design.md](../specs/2026-10-16-knowledge-chat-files-design.md)

## Global Constraints

- Type value `chat_file`; `?chats=all` adds task and ticket chats; default the group chat only.
- Chat files are `public` items of the chat's group, never in a folder, never editable (403) or creatable (400).
- Server tests run with `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_kcf`.
- Initial JS ≤ 200 kB gzip: `features/knowledge/search.ts` stays import-free; everything new is in the lazy knowledge chunks.
- UI strings in `locales/knowledge/{en,sk}.json`.

## Review Focus

- A client of another group, a ziadatel (also the ticket's own initiator) and a requester never reach a chat file: tab list, search, detail, socket event.
- A deleted message, file, task or ticket leaves no entry (the foreign key cascades).
- A ticket moved to another client moves its entries in the same transaction.
- The folder view never lists chat files; the top-level page uses its partial index.

---

### Task 1: Shared schemas

**Files:** Modify `packages/shared/src/knowledge.ts`; test `packages/shared/src/knowledge.test.ts`.

**Interfaces:** Produces `KnowledgeTypes` with `chat_file`, `KnowledgeCreatableTypes`, `KnowledgeChatSourceSchema`, `KnowledgeSummary.chat` (optional, nullable), `KnowledgeChatsFilter = 'group' | 'all'`.

- [ ] Failing tests: the type list accepts `chat_file`; the draft refuses `type: 'chat_file'`; a summary parses with `chat`.
- [ ] Implement; run `pnpm --filter @spolu/shared test`; commit.

### Task 2: Schema, migration and backfill

**Files:** Modify `apps/server/src/modules/knowledge/schema.ts`; create `apps/server/src/infra/db/migrations/0024_knowledge_chat_files.sql` (generated, then the backfill `insert … select` appended by hand).

- [ ] Columns, checks, the composite foreign key and the four indexes of the spec.
- [ ] `pnpm --filter @spolu/server db:generate --name knowledge_chat_files`; append the backfill; read the SQL.
- [ ] Test (`chat-files.test.ts`): the backfill statement run on a seeded attachment creates the entry. Commit.

### Task 3: Chat hooks

**Files:** Create `apps/server/src/modules/chat/file-hooks.ts`; modify `chat/messages.ts` (send: `attached` in the transaction), `chat/service.ts` (`moveTicketChannel`: `moved`), `chat/routes.ts` (`sent` after the send, `removing` before the delete).

- [ ] Hooks are no-ops when nothing is registered; existing chat tests stay green.

### Task 4: Knowledge chat files service (test-first)

**Files:** Create `apps/server/src/modules/knowledge/chat-files.ts` and `chat-files.test.ts`; modify `knowledge/service.ts` (page query join, `chats` filter, folder view excludes chat files, detail files), `knowledge/policy.ts` (`canEditItem` false for `chat_file`), `knowledge/routes.ts` (`chats` param), `app.ts` (register).

- [ ] Failing tests for the review focus, then the implementation. Commit.

### Task 5: Web

**Files:** Modify `features/knowledge/{search.ts,api.ts,knowledge-tab.tsx,knowledge-page.tsx,knowledge-row.tsx,knowledge-view.tsx,use-knowledge-events.ts,new-item-menu.tsx,icons.tsx}`, `features/chat/links.ts` (`parentId` → `thread`), `router.tsx` (`chats` param), locales.

- [ ] Tests first for the row, the tab (pill, checkbox only with the type, flat list), the page's type menu and checkbox, events.
- [ ] Implement with the `frontend-design` skill; commit.

### Task 6: e2e and docs

- [ ] `e2e/knowledge.spec.ts`: a file sent in the group chat appears under "From chat" and opens the chat at the message.
- [ ] `update-kb`: product knowledge-base and chat docs, data-model, permissions, realtime, roadmap. Lint, typecheck, tests, `check-docs.sh`. PR.
