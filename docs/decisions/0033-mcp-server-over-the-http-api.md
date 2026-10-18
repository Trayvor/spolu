# 0033 An MCP server over our own HTTP API, with personal tokens and no SDK

Date: 2026-10-18
Status: accepted

## Context
The owner wants an AI to see and change everything in Spolu through MCP (Model Context Protocol), including finance (first only documents; on 2026-10-18 the owner changed it to full finance access for finance holders). Design: [spec](../superpowers/specs/2026-10-18-mcp-server-design.md). Three technical choices needed a decision: how a tool reaches the data without a second set of permission rules, which MCP implementation to use, and how an AI client authenticates.

## Decision
- **Tools call the HTTP API in process.** Each tool calls existing `/api` routes with Fastify's `inject`, as the token's user. The user travels in a header `x-spolu-internal-call` whose value is a random 256-bit id registered in memory (`modules/auth/internal-calls.ts`) only while that one call runs; `getSessionUser` resolves it before the session cookie. So every guard, zod schema, policy function, service, socket event, notification and rate limit is the route's own. The MCP layer holds a deny-by-default allowlist of the method + path patterns it may call (`modules/mcp/allowlist.ts`); its finance and time entries are refused before the route to anyone without the finance right.
- **Our own Streamable HTTP transport, no new dependency.** `POST /mcp`, stateless, JSON answers only (no SSE, no session id), methods `initialize`, `ping`, `tools/list`, `tools/call`; protocol versions 2025-11-25, 2025-06-18 and 2025-03-26. Tool input schemas are generated from the shared zod schemas with zod 4's `z.toJSONSchema`.
  - `@modelcontextprotocol/sdk` was checked: version 1.32.1, MIT, actively maintained by the MCP project, no install scripts. It was not taken because its 17 runtime dependencies (`express`, `hono`, `@hono/node-server`, `cors`, `ajv`, `ajv-formats`, `jose`, `eventsource`, `eventsource-parser`, `express-rate-limit`, `cross-spawn`, `pkce-challenge`, `raw-body`, `content-type`, `zod-to-json-schema`, `json-schema-typed`, `zod`) bring a second HTTP stack and a large supply-chain surface into the production image for what is about 200 lines of JSON-RPC on our Fastify.
- **Personal access tokens.** Admins make them on `/settings`: `spolu_mcp_` + 32 random bytes (base64url), shown once, stored as a SHA-256 hash; a name, a scope (`read` or `write`) and an expiry of at most 365 days. Revoked by the user, and all at once when the user is deactivated. Every request re-reads the user (disabled, role, finance right), as sessions do.
- **Admins only in v1** (`canUseMcp`).

## Consequences
- A new route is unreachable from MCP until a tool and an allowlist entry are added on purpose; a finance route is never reachable by someone without the finance right, whatever a tool does. Tests check the allowlist against the registered routes.
- MCP behaves exactly like the app for the same user, including `404` for what they may not read, and the HTTP routes stay the only writers.
- Each tool call costs one or two in-process requests (no network); fine for an AI's call rate.
- We own protocol conformance. The subset is small and covered by tests; a later protocol version may need small changes in `transport.ts`.
- **Future work:** OAuth 2.1 (authorization server metadata, dynamic client registration, consent, refresh), which Claude.ai custom connectors need; until then Claude Desktop connects through a local bridge such as `mcp-remote` with the token header ([docs/integrations/mcp.md](../integrations/mcp.md)). Also: MCP for clients, deletes, uploads, SSE notifications.
