# MCP server — design

Date: 2026-10-18. Status: decided by the implementing agent (the owner could not be asked); every decision is in the table in §2 and in [ADR 0033](../../decisions/0033-mcp-server-over-the-http-api.md). Plan: [2026-10-18-mcp-server.md](../plans/2026-10-18-mcp-server.md).

## 1. The request

The owner (translated): "add an MCP server so the AI can see EVERYTHING, but from the finance information only documents. Also give the ability to change and create entities. In short, cover the system fully with MCP."

**Change of 2026-10-18 (the owner, relayed by the orchestrator):** the MCP server gets **full finance access**, not only documents: every finance entity, read and write, mirroring the HTTP API, strictly through the finance policy functions; only users with the finance right see or change anything; read-only tokens still cannot write. Decisions #5 and #6 below are the revised ones.

An AI client (Claude Code, Claude Desktop, any MCP client) connects to `https://help.egrant.sk/mcp` with a personal token and reads and changes Spolu **as the person who made the token**, with exactly that person's permissions.

## 2. Decisions

| # | question | decision | why |
|---|---|---|---|
| 1 | Whose identity? | The token's user. Every tool call is that user's request; nothing bypasses permissions. | The brief. |
| 2 | How do tools reach the data? | **Through the HTTP API, in process.** Each tool calls one or two existing `/api` routes with Fastify's `inject`, as the token's user. The route runs its own guards, zod validation, policy functions, service, socket events, notifications and rate limits. | One definition of every rule. Calling the services directly would mean copying the policy checks that live in the route handlers (`canReadGroup`, `canEditTicket`, …) into a second place, and the copies would drift. The project rule "writes go through the HTTP API" holds literally. |
| 3 | How does an injected request carry the user? | `modules/auth/internal-calls.ts`: `runAsUser(user, fn)` registers a random 256-bit call id for the duration of one `inject`; `getSessionUser` (used by `requireUser`, `requireAdmin`, `requireFinance`) resolves the header `x-spolu-internal-call` through that registry before it looks at the session cookie. An unknown id answers as no session. | The id lives only in memory and only while the call runs, so a header sent from outside never matches. No route changes. |
| 4 | Who may use MCP in v1? | **Admins only** (`canUseMcp`: `isAdmin`; the superadmin included). Clients and žiadatelia cannot create tokens (`403`), and a token whose user is no longer an active admin answers `401` (a disabled user) or `403`. | The owner's goal is the eGrant team's own AI. Tools act through the user's permissions anyway, so opening MCP to clients later is a policy change, not a security change; recorded as future work. **Amended 2026-10-22 by [ADR 0071](../../decisions/0071-mcp-for-client-managers.md): client managers too, the admin tools hidden.** |
| 5 | Finance | **Changed by the owner on 2026-10-18** (see §1): **full finance access**, read and write, mirroring the HTTP API: a client's documents, contracts, notes and folders, the organisation's items and folders on `/finance` (contracts of several clients with their shares, expenses including salaries, documents and notes without a client) and the salary payees, the overviews and work logs (per client and across clients), time entries, hourly rates, the contracts table and both rankings, and the task and ticket time. Only for finance holders (`canSeeFinance`); everyone else gets the same `403`/`404` as over HTTP and sees no finance tool. Not exposed: deletes (§2 #14), finance uploads and granting the finance right. Every finance tool is finance-only, also the task and ticket time tools that a non-finance admin assignee may use over HTTP for their own time (stricter than the app, never looser). | The owner's revised decision; the first version (documents only, amounts removed) was replaced the same day. |
| 6 | How is finance enforced? | Twice, deny by default: (a) `ALLOWED_ROUTES` (`modules/mcp/allowlist.ts`) is the only list of method + path patterns the MCP layer may inject, and every finance and `/time` entry in it is marked `finance`: `isAllowedRoute` refuses it before the route for a user without the finance right, whatever tool asks; (b) every finance tool is marked `finance` (`canCallTool`), and the route checks `requireFinance` and its own policy once more. Leak tests: a non-finance admin, a client and a žiadateľ get no finance data, and a client's finance answers hold no other client's data. | One policy (`canSeeFinance`), as in the app. A new finance route is invisible to MCP until someone adds it on purpose (the organisation level of PR #115 was added this way: `/api/finance/org/items`, `/api/finance/org/folders`, `/api/finance/payees`). |
| 7 | Transport | **Streamable HTTP** (MCP spec 2025-06-18 and 2025-11-25, 2025-03-26 accepted) at `POST /mcp`, **stateless**: no `Mcp-Session-Id`, every answer is `application/json`, no SSE stream (`GET` and `DELETE /mcp` answer `405`). JSON-RPC methods: `initialize`, `ping`, `tools/list`, `tools/call`; notifications answer `202`. | The tools are short request/response calls; a stateless server needs no session store and fits one Node process (ADR 0005). |
| 8 | SDK or own code? | **Own code, no new dependency.** `@modelcontextprotocol/sdk` 1.32 (MIT, maintained) pulls 17 runtime dependencies, among them `express`, `hono`, `cors`, `ajv`, `jose` and `eventsource`, for an HTTP stack we already have. The part we need (JSON-RPC over one POST, four methods) is about 200 lines; tool input schemas come from zod 4's built-in `z.toJSONSchema`. | Supply-chain care (see ADR 0033). |
| 9 | Auth | **Personal access tokens** (`Authorization: Bearer spolu_mcp_…`), made and revoked by the user on `/settings`. 32 random bytes, base64url, shown once; only the SHA-256 hash is stored. Each has a name, a **scope** (`read` or `write`, chosen at creation) and an **expiry** (7, 30, 90 or 365 days; 90 by default; never unlimited). | OAuth 2.1 (the spec's recommendation for remote servers) needs an authorization server, dynamic client registration, consent screens and token refresh: far more than this request. Future work in ADR 0033. |
| 10 | Token limits | 10 active tokens per user (`409 mcp_token_limit`), 20 creations an hour per user (`429`). Deactivating a user revokes all their tokens (`revokeAllTokens`, called from `deactivateUser`). | A re-enabled admin must make new tokens. |
| 11 | Rate limits | Per user (all their tokens together; changed from per token after the security review): 120 MCP requests a minute (each message of a batch counts) and 30 write tool calls a minute. Per IP: 30 failed authentications a minute (`429`), checked before the token lookup. The routes' own limits apply on top, per user, exactly as in the app. | |
| 12 | Audit log | Every **write** tool call (also a refused one) writes `mcp_audit_log`: user, token, tool, target id, HTTP status, ok, time. Never the arguments or the content. The user sees their own last 50 on `/settings`. Rows older than 180 days are deleted daily. | The brief. Reads are not logged: they change nothing and would be most of the rows. |
| 13 | Read-only token and writes | `tools/list` lists only the tools the token may call (write tools only for `write`, finance tools only for finance holders). Calling a write tool with a `read` token is a tool error `forbidden: read-only token`, audited, and changes nothing. | |
| 14 | Deletes | **None in v1.** No tool deletes a task, ticket, message, knowledge item, project or event. | A wrong delete by an AI loses data (a task's chat, a project's links); the cost of a missing delete is a click in the app. |
| 15 | Files | `read_file` returns a file the user may download (`GET /api/files/:id`, so `canReadFile`, finance-only files only for finance holders), up to 2 MB: text as text, images as image content, anything else as an embedded resource (base64). No upload tool in v1. | |
| 16 | Output size | Lists are the routes' own pages (cursor in, `nextCursor` out). A tool result over 100 000 characters is cut and says so, asking for a narrower query. | Performance rule: paginated, bounded. |
| 17 | `updatedAt` on edits | The update tools take `updatedAt` optionally. Given, it is passed on and a stale one answers `409 …_changed`; omitted, the tool reads the current version first and uses its `updatedAt`. | The AI rarely holds the version; a PATCH changes only the fields it names. |
| 18 | Where it lives | `apps/server/src/modules/mcp/`: tokens and audit (`schema.ts`, `tokens.ts`, `audit.ts`), the token routes (`routes.ts`, `/api/me/mcp/*`), the transport (`transport.ts`, `/mcp`), the tools (`tools/*.ts`), the allowlist and the policy. Web: `apps/web/src/features/mcp/`, lazy namespace `mcp`. | The module pattern. |

## 3. Tokens and the settings screen

### 3.1 Tables (migration 0046)

- `mcp_tokens`: `id`, `user_id` (FK `user`, cascade), `name` (1–60), `token_hash` (hex SHA-256, unique), `prefix` (the first 14 characters, for display), `scope` (`read` | `write`, CHECK), `created_at`, `expires_at`, `last_used_at` (updated at most once a minute), `revoked_at`. Index `(user_id)`.
- `mcp_audit_log`: `id`, `user_id` (FK, cascade), `token_id` (FK `mcp_tokens`, set null), `tool`, `target_id` (nullable), `status` (int), `ok` (bool), `created_at`. Index `(user_id, created_at desc)`.

### 3.2 Routes (`modules/mcp/routes.ts`, all `requireAdmin` then `canUseMcp`)

| route | what |
|---|---|
| `GET /api/me/mcp/tokens` | the caller's tokens, newest first, revoked ones left out: `{ id, name, prefix, scope, createdAt, expiresAt, lastUsedAt, expired }` |
| `POST /api/me/mcp/tokens` `{ name, scope, expiresInDays }` | `201 { token, item }`; `token` is the secret, shown once |
| `DELETE /api/me/mcp/tokens/:id` | revoke one of the caller's own tokens; `204`; another user's or an unknown id `404` |
| `GET /api/me/mcp/audit` | the caller's last 50 write calls `{ id, tool, targetId, ok, status, createdAt, tokenName }` |

None of them is in the MCP allowlist: a token can never make or list tokens.

### 3.3 The settings section

On `/settings`, for admins only, a card **AI access (MCP)** after Notifications (lazy chunk and lazy namespace `mcp`, so the initial bundle does not grow):

- One line on what it is (the guide, `docs/integrations/mcp.md`, is not served by the app, so the card carries the Claude Code command itself).
- The token list: name, scope (Read only / Read and write), created, expires (or "Expired"), last used, **Revoke** (with a confirm).
- **New token**: name, scope (radio, Read only by default), validity (7 / 30 / 90 / 365 days, 90 by default), **Create**. The new token is shown once in a read-only field with **Copy**, plus the Claude Code command with the token filled in, and a warning that it will not be shown again.
- **Recent changes by AI**: the last 50 write calls (tool, target, time, ok or refused).

## 4. The MCP endpoint

- `POST /mcp`: `Authorization: Bearer <token>` (missing or wrong: `401` with `WWW-Authenticate: Bearer realm="spolu"`; the user disabled: `401`; not an admin: `403`). An `Origin` header other than `PUBLIC_URL`'s origin answers `403` (DNS rebinding, as the spec requires). An `MCP-Protocol-Version` header with an unsupported version answers `400`.
- The body is one JSON-RPC message; an array of at most 10 only in protocol 2025-03-26 (also assumed without the header; 2025-06-18 and later removed batching and answer `400`). The answer to one POST is at most 5 MB. A request gets `200 application/json` with its response; only notifications or responses get `202`.
- `initialize` answers the client's protocol version when supported (else the newest), `capabilities: { tools: { listChanged: false } }`, `serverInfo: { name: "spolu", title: "Help by eGrant", version }` and short `instructions` (who you act as, ids, pagination, no deletes).
- `tools/list` (no pagination), `tools/call` (unknown tool: JSON-RPC `-32602`; bad arguments, a refused or failed route: a result with `isError: true` and `{ status, error }` so the model can correct itself).
- Outside `/api`, so the CSRF guard (which skips requests without `Origin`) is not involved; Caddy proxies every path to the app already.

## 5. Tools

Each tool names the route(s) it calls. Ids are the app's ids. Lists take the route's cursor (`after`, `before`) and return its `nextCursor`.

### 5.1 Read (any token)

| tool | route |
|---|---|
| `whoami` | none: the user the token resolved to, and its scope |
| `list_groups` | `GET /api/groups` (every client group and the admin group; the route has no paging, so the tool answers compact rows, filters by `q` and `mine` and pages by `offset`, 200 a page) |
| `get_group` | `GET /api/groups/:id` |
| `list_group_people` | `GET /api/groups/:id/people` |
| `list_group_members` (`which`: members, requesters, invited, removed) | `GET /api/groups/:id/members`, `…/requesters`, `…/members/invited`, `…/members/removed` |
| `list_admins` | `GET /api/admins` (the route has no paging, so the tool filters by a name or email fragment `q` and pages by `offset`, 200 a page) |
| `get_chat_channel` (`groupId` or `taskId` or `ticketId`) | `GET /api/groups/:id/chat`, `/api/tasks/:id/chat`, `/api/tickets/:id/chat` |
| `list_messages` | `GET /api/channels/:id/messages` (`before`/`after`, `limit` ≤ 50) |
| `get_thread` | `GET /api/messages/:id/thread` |
| `list_unread_chats` | `GET /api/chat/unread` |
| `get_board` | `GET /api/groups/:id/board` |
| `list_completed_tasks` | `GET /api/groups/:id/board/done` |
| `search_tasks` | `GET /api/groups/:id/tasks/search` |
| `get_task` | `GET /api/tasks/:id` |
| `list_all_tasks` | `GET /api/tasks/global` |
| `list_my_tasks` | `GET /api/me/home/tasks` |
| `list_unseen_tasks` | `GET /api/groups/:id/board/unseen` |
| `list_tickets` (`groupId` optional) | `GET /api/groups/:id/tickets` or `GET /api/tickets/global` |
| `get_ticket` | `GET /api/tickets/:id` |
| `list_ticket_assignee_candidates` | `GET /api/tickets/:id/assignee-candidates` |
| `list_knowledge` (`groupId` optional) | `GET /api/groups/:id/knowledge` or `GET /api/knowledge` |
| `list_knowledge_folders` | `GET /api/groups/:id/knowledge/folders` |
| `get_knowledge_item` (notes, links, files, reminders, meetings) | `GET /api/knowledge/:id` |
| `list_meetings` | `GET /api/me/home/meetings` |
| `list_projects` | `GET /api/groups/:id/projects` |
| `get_project` | `GET /api/projects/:id` |
| `get_project_event` | `GET /api/project-events/:id` |
| `list_bulk_campaigns`, `get_bulk_campaign`, `list_bulk_campaign_recipients` | `GET /api/bulk-email/campaigns`, `…/:id`, `…/:id/recipients` |
| `get_home_counts` | `GET /api/me/home/counts` |
| `list_mentions` | `GET /api/me/home/mentions` |
| `list_upcoming_reminders` | `GET /api/me/home/reminders` |
| `read_file` | `GET /api/files/:id` |
| `list_finance_documents` (`groupId` optional) | `GET /api/groups/:id/finance/items` (a client's items, a shared contract with only its own share) or `GET /api/finance/org/items` (the organisation's: contracts of several clients with every share, expenses, items without a client) |
| `list_finance_document_folders` (`groupId` optional) | `GET /api/groups/:id/finance/folders` or `GET /api/finance/org/folders` |
| `get_finance_document` (`groupId` optional) | `GET /api/finance/items/:id` (with `?group=` the client's view: only that client's share) |
| `list_finance_payees` | `GET /api/finance/payees` |
| `get_finance_overview` (`groupId` optional) | `GET /api/groups/:id/finance/overview` or `GET /api/finance/overview` |
| `get_work_log` (`groupId` optional) | `GET /api/groups/:id/finance/work-log` or `GET /api/finance/work-log` |
| `list_rates` | `GET /api/finance/rates` |
| `list_contracts` | `GET /api/finance/contracts` |
| `get_paid_ranking`, `get_hours_ranking` | `GET /api/finance/rankings/paid`, `…/hours` |
| `get_task_time`, `get_ticket_time` | `GET /api/tasks/:id/time`, `GET /api/tickets/:id/time` |

Every tool from `list_finance_documents` down is for finance holders only.

### 5.2 Write (`write` tokens only, audited)

| tool | route | input |
|---|---|---|
| `create_task` | `POST /api/groups/:id/tasks` | `groupId`, `task`: `TaskCreateSchema` |
| `update_task` | `PATCH /api/tasks/:id` | `taskId`, `changes`: `TaskPatchSchema` (`updatedAt` optional, §2 #17): title, description, assignees, due date, urgent, link, project, event, knowledge |
| `move_task` | `POST /api/tasks/:id/move` | `taskId`, `bucketId`, `afterTaskId` (moving into the Completed bucket completes the task) |
| `create_ticket` | `POST /api/tickets` | `ticket`: `TicketCreateBodySchema` |
| `update_ticket` | `PATCH /api/tickets/:id` | `ticketId`, `changes`: `TicketPatchBodySchema` (status, fields) |
| `set_ticket_assignee` | `PUT` / `DELETE /api/tickets/:id/assignees/:userId` | `ticketId`, `userId`, `assigned` |
| `send_message` | `POST /api/channels/:id/messages` | `channelId`, `body` (Markdown, mentions as `<@userId>`), `parentId`, `replyToId`, `knowledgeIds`, `taskIds`, `ticketIds`; `clientId` generated |
| `reply_to_ticket` | `GET /api/tickets/:id/chat`, then `POST /api/channels/:id/messages` | `ticketId`, `body`, `parentId` |
| `create_knowledge_item` | `POST /api/groups/:id/knowledge` | `groupId`, `item`: `KnowledgeDraftSchema` |
| `update_knowledge_item` | `PATCH /api/knowledge/:id` | `itemId`, `changes`: `KnowledgePatchSchema` |
| `create_project`, `update_project` | `POST /api/groups/:id/projects`, `PATCH /api/projects/:id` | the shared project schemas |
| `create_project_event`, `update_project_event` | `POST /api/projects/:id/events`, `PATCH /api/project-events/:id` | the shared event schemas |
| `create_finance_document`, `update_finance_document` (finance) | `POST /api/groups/:id/finance/items`, `PATCH /api/finance/items/:id` | `FinanceItemBodySchema`, `FinanceItemPatchSchema` |
| `create_organisation_finance_item` (finance) | `POST /api/finance/org/items` | `FinanceOrgItemBodySchema` (a contract of several clients with 2–50 shares adding up to its amount, an expense, a document or note without a client) |
| `create_finance_folder`, `update_finance_folder` (finance) | `POST /api/groups/:id/finance/folders` or, without `groupId`, `POST /api/finance/org/folders`; `PATCH /api/finance/folders/:id` | the shared folder schemas |
| `add_time_entry`, `update_time_entry` (finance) | `POST /api/finance/time-entries`, `PATCH /api/finance/time-entries/:id` | `SystemManualEntryBodySchema` (`groupId` null: without a client), `TimeEntryPatchSchema` |
| `add_rate` (finance) | `POST /api/finance/rates` | `AddRateBodySchema` |
| `set_my_task_time`, `set_my_ticket_time` (finance) | `PUT /api/tasks/:id/time/me`, `PUT /api/tickets/:id/time/me` | the shared time bodies |

The tool checks the arguments against the same shared zod schema first (a friendly error), then sends the arguments as given to the route, which validates them again. `askTime` is dropped from the task and ticket answers and the "Fill in your time" requests from `list_my_tasks`: time has its own finance tools, so the general tools carry none for anyone.

### 5.3 Same events

Because a write is the route itself, it emits the same socket events (`task:created`, `message:new`, `ticket:updated`, …), the same notifications and the same unseen-change marks as in the app, with the user as the author.

## 6. Tests (test-first)

- `policy.test.ts`: `canUseMcp` per role.
- `tokens.test.ts`: create, hash only, prefix, expiry, revoke, limit, `revokeAllTokens`, `last_used_at` throttle.
- `routes.test.ts`: the token routes per role (admin, finance admin, client, žiadateľ, none), one's own tokens only.
- `transport.test.ts`: the JSON-RPC handshake, `405`, `202`, Origin, protocol header, `401` for none, wrong, revoked, expired and disabled-user tokens, `403` for a client's token, rate limit.
- `leaks.test.ts`: the allowlist is a subset of the registered routes; every finance and `/time` entry is marked `finance` and refused by `callApi` to a non-finance admin and a client; no token, auth, grant, upload or delete route; a finance admin reads and writes every finance entity; a read-only finance token cannot write; a non-finance admin sees no finance tool, gets `403` from each and no money or time from any other tool; a client's and a žiadateľ's token is refused; a client's finance answers hold no other client's contract, amount or time; a contract of several clients read in one client's view (`get_finance_document` with `groupId`, `list_finance_documents` with `groupId`) holds only that client's share, never another client's id, name or share, while the organisation view holds every share, and organisation items, expenses and payees are `403` for a non-finance admin; losing the right acts on the next call; the internal call header from outside is ignored.
- `tools.test.ts`: reads per entity; a client group's admins-only knowledge stays as the routes decide; writes create and change through the routes, a `read` token is refused and audited, the audit row has no content.
- `events.test.ts`: `create_task` and `send_message` through MCP reach a socket in the group room with the same event as the HTTP route.

## 7. Out of scope (future work)

OAuth 2.1 with dynamic client registration (Claude.ai custom connectors), MCP for clients, deletes, file upload, resources and prompts, SSE streams and server notifications, an admin page over every user's audit log, audit retention (the table grows by write calls only).
