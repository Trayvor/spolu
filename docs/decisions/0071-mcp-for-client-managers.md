# 0071: MCP for client managers, with the admin tools hidden

- Status: accepted
- Date: 2026-10-22
- Amends: [0033](0033-mcp-server-over-the-http-api.md) ("Admins only in v1") and [0034](0034-mcp-oauth-authorization-server.md) (who may approve a connection)

## Context

MCP was for admins only. The owner asked (2026-10-22) that a client's managers (shown as
"Manažér"; a user with role `client` and an active `client` membership of a live group) can
connect Claude too, and see only their own clients. Every MCP tool already calls the HTTP API
as the token's user, so the routes' policies scope the data; what was missing was who may get
in, and a `tools/list` without tools whose routes refuse clients anyway.

## Decision

- **Who**: `canUseMcp(actor, clientGroups)` is true for an admin or the superadmin, and for a
  client with at least one active `client` membership of a live group (`clientGroupIds`). A
  pure žiadateľ never. `mayUseMcp(db, actor)` (`modules/mcp/access.ts`) reads the memberships
  fresh, on the token routes, the consent and connections routes (now `requireUser` then this),
  every `/mcp` request and every OAuth code exchange and refresh. Same limits as admins (10
  tokens, 10 connections, the emails on a new token or connection).
- **When it ends**: removing a manager's last membership disables the account, which already
  revokes every token and connection (`deactivateUser`). Removing their last `client`
  membership while a `ziadatel` one stays revokes them too (the groups route calls
  `revokeAllTokens`). A client whose groups were all deactivated is refused at once (`403`)
  but keeps their tokens, as reactivating a group restores its memberships.
- **Which tools**: a tool definition may be `admin: true`; `canCallTool` refuses it to a
  non-admin, so a manager's `tools/list` leaves it out and a direct call answers `403`. The
  flag is not a guess: `modules/mcp/client-tools.test.ts` runs every tool straight through its
  routes as a manager, on their own client, and requires an `admin` tool to be refused by the
  routes themselves (`403`/`404`) and every other tool to succeed. The routes stay the only
  real check.
- **Their clients**: `list_groups` reads a client's own memberships from the new
  `GET /api/me/groups` (any session; `/api/me` reads the cookie itself, so MCP cannot call it),
  as `{ id, name, kind: 'client', role }`.

## Consequences

- A new tool needs its arguments in `client-tools.test.ts` and an explicit `admin` or not; the
  same test proves no tool reads or changes another client (every tool pointed at a foreign
  client's ids is refused, and no other answer holds that client's ids or names).
- The settings card "AI access (MCP)" and the consent page are shown to managers too.
- Finance stays as it was: a client never holds the finance right, so no finance tool is
  listed or callable.
