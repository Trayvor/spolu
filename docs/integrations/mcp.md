# MCP server: connect an AI assistant

Help by eGrant speaks the [Model Context Protocol](https://modelcontextprotocol.io) at `https://help.egrant.sk/mcp`, so Claude (Claude Code, Claude Desktop) or any MCP client can read and change Help **as you**: it sees and changes exactly what you may in the app, nothing more. Design: [spec](../superpowers/specs/2026-10-18-mcp-server-design.md), [ADR 0033](../decisions/0033-mcp-server-over-the-http-api.md).

## 1. Make a token

Admins only. Open **Settings → AI access (MCP)**, name the token (for example "Claude on my laptop"), choose the access and how long it is valid, and press **Create token**.

- **Read only**: the assistant reads groups, chats, tasks, tickets, knowledge, projects, bulk email and, if you hold the finance right, finance.
- **Read and change**: it can also create and edit tasks, tickets, chat messages, knowledge items, projects and events, and finance items (a client's, and the organisation's: contracts of several clients with their shares, expenses and salaries), folders, time and rates (finance holders). **No tool deletes anything.**
- Valid for 7, 30, 90 days or 1 year. At most 10 active tokens per person.

The token (`spolu_mcp_…`) is shown **once**: copy it then. Treat it like a password; anyone with it acts as you. Revoke it on the same card when a laptop is lost or the assistant is no longer needed; deactivating an admin revokes all their tokens. Every new token also sends you an email (its name and when it was made; never the token): if you did not make it, revoke it in Settings at once.

## 2. Connect

### Claude Code

The card shows the command with your token filled in:

```bash
claude mcp add --transport http help https://help.egrant.sk/mcp \
  --header "Authorization: Bearer spolu_mcp_…"
```

Then `/mcp` in Claude Code lists the server as connected.

The copied command contains the token, so it lands in your shell history and, once added, in `~/.claude.json`: keep both private, or clear the history line.

### Claude Desktop

Claude Desktop's own remote connectors need OAuth, which Help does not offer yet (future work in ADR 0033). Use the `mcp-remote` bridge (needs Node.js) in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "help": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.14.3",
        "https://help.egrant.sk/mcp",
        "--header",
        "Authorization:${HELP_TOKEN}"
      ],
      "env": { "HELP_TOKEN": "Bearer spolu_mcp_…" }
    }
  }
}
```

### Any other client

Streamable HTTP, stateless: `POST /mcp` with `Authorization: Bearer <token>` and one JSON-RPC message in the body (a batch array only in protocol `2025-03-26`, which is also assumed without an `MCP-Protocol-Version` header: at most 10 messages; `2025-06-18` and later removed batching, so with their header an array answers `400`, JSON-RPC `-32600`); answers are `application/json` (no SSE stream, no session id; `GET` and `DELETE` answer `405`). Protocol versions `2025-11-25`, `2025-06-18`, `2025-03-26`. A browser page cannot call it from another origin (`Origin` other than Help's: `403`).

## 3. What the assistant can do

Start with `whoami` and `list_groups`; the other tools take the ids they return. Lists are paged: pass the answer's `nextCursor` (or the named cursor) back.

| area | read | change |
|---|---|---|
| groups and people | `list_groups`, `get_group`, `list_group_people`, `list_group_members`, `list_admins` | |
| chat | `get_chat_channel`, `list_messages`, `get_thread`, `list_unread_chats` | `send_message`, `reply_to_ticket` |
| tasks | `get_board`, `list_completed_tasks`, `search_tasks`, `get_task`, `list_all_tasks`, `list_my_tasks`, `list_unseen_tasks` | `create_task`, `update_task`, `move_task` (into Completed completes it) |
| tickets | `list_tickets`, `get_ticket`, `list_ticket_assignee_candidates` | `create_ticket`, `update_ticket`, `set_ticket_assignee` |
| knowledge and meetings | `list_knowledge`, `list_knowledge_folders`, `get_knowledge_item`, `list_meetings` | `create_knowledge_item`, `update_knowledge_item` |
| projects | `list_projects`, `get_project`, `get_project_event` | `create_project`, `update_project`, `create_project_event`, `update_project_event` |
| home and bulk email | `get_home_counts`, `list_mentions`, `list_upcoming_reminders`, `list_bulk_campaigns`, `get_bulk_campaign`, `list_bulk_campaign_recipients` | |
| files | `read_file` (up to 2 MB: text, images, other files as base64) | |
| finance (finance holders only) | `list_finance_documents`, `list_finance_document_folders`, `get_finance_document`, `list_finance_payees`, `get_finance_overview`, `get_work_log`, `list_rates`, `list_contracts`, `get_paid_ranking`, `get_hours_ranking`, `get_task_time`, `get_ticket_time` | `create_finance_document`, `update_finance_document`, `create_organisation_finance_item`, `create_finance_folder`, `update_finance_folder`, `add_time_entry`, `update_time_entry`, `add_rate`, `set_my_task_time`, `set_my_ticket_time` |

A change made through MCP is the app's own request: everyone sees it live and is notified as if you had done it in the app. An edit tool takes an optional `updatedAt`; without it the current version is changed.

## 4. Limits and audit

- Per person (all your tokens together): 120 requests and 30 changes a minute; each message of a batch counts. The app's own limits per person apply on top. After 30 failed sign-ins a minute from one address, every request from it answers `429` for the rest of that minute.
- A tool answer longer than 100 000 characters is cut, with a note to narrow the query. The whole answer to one POST is at most 5 MB: in a batch, the request whose answer crosses it ran but answers a JSON-RPC error (`-32603`, "Answer too large"), and the ones after it are not run.
- Every change (also a refused one) is logged: who, which tool, on what, when and how it ended, never the content. You see your last 50 on the settings card. Entries older than 180 days are deleted daily (job `mcp.cleanup-audit`, 03:20).

## 5. Errors

- HTTP `401`: no, wrong, expired or revoked token, or your account is deactivated. `403`: the account is not an admin, or a foreign `Origin`. `429`: too many requests.
- A tool answer with `isError: true` carries the app's `{ status, error }`: `404 not_found` (unknown, or not yours to see), `403 forbidden` (not allowed, or a read-only token: `detail: "read-only token"`), `400 validation_failed` with `issues`, `409 …_changed` (someone edited it meanwhile).
