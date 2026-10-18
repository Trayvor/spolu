# MCP server: OAuth for Claude custom connectors — design

Date: 2026-10-18. Status: decided by the implementing agent (the owner could not be asked); every decision is in §2 and in [ADR 0034](../../decisions/0034-mcp-oauth-authorization-server.md). Builds on the [MCP server spec](2026-10-18-mcp-server-design.md) and [ADR 0033](../../decisions/0033-mcp-server-over-the-http-api.md), which listed OAuth as future work.

## 1. The request

The owner wants to add Help to Claude (claude.ai, Claude Desktop) with **Add custom connector** and just the address `https://help.egrant.sk/mcp`. Claude's custom connectors authenticate with OAuth 2.1 as the MCP specification (Authorization, 2025-06-18 and 2025-11-25) describes: protected resource metadata, authorization server metadata, dynamic client registration, the authorization code flow with PKCE, the `resource` parameter, and refresh tokens. Personal tokens (ADR 0033) stay for Claude Code and other clients.

## 2. Decisions

| # | question | decision | why |
|---|---|---|---|
| 1 | Who is the authorization server? | **Help itself** (issuer `https://help.egrant.sk`). The consent screen is a page of the web app; the user signs in with the normal email-code login first. | No second identity system; the MCP spec allows the resource server to be its own authorization server. |
| 2 | Library or own code? | **Own code, no new dependency** (about 600 lines in `modules/mcp/oauth.ts` and `oauth-routes.ts`). Better Auth's OIDC/MCP plugin was not taken: it brings its own tables, its own consent flow and session model, and would issue tokens outside `mcp_tokens`, so OAuth tokens would bypass the one `/mcp` authentication. | Same reasoning as ADR 0033: small surface, every rule in one place. |
| 3 | Where do access tokens live? | **In `mcp_tokens`**, a row per connection with `oauth_grant_id` set; its hash and expiry change on every refresh. So an OAuth access token goes through `authenticateToken`, `canUseMcp`, the scope check, the rate limits and the audit exactly like a personal token (the audit names the client). | One `/mcp` auth path; bounded rows (one per connection, not one per hour). Cost: a refresh ends the previous access token at once (clients refresh near expiry, so this is harmless). |
| 4 | Which redirect addresses may a client register? | **Only** `https://claude.ai/…`, `https://claude.com/…` (exactly these hosts, default port, no subdomain) and `http://localhost`, `http://127.0.0.1`, `http://[::1]` (any port, RFC 8252). No user info, no fragment, no custom scheme. Anything else: `400 invalid_redirect_uri`. A new host is a code change (`ALLOWED_REDIRECT_HOSTS`). | Registration is open to anyone (RFC 7591), and the client name is self-declared. With this list a code can only reach Claude or the user's own machine, so a phishing client calling itself "Claude" gains nothing. Claude.ai and Claude Desktop connectors use `https://claude.ai/api/mcp/auth_callback`; Claude Code and other desktop clients use loopback. |
| 5 | Registration abuse | 30 registrations an hour per IP (`429`); at most 5 redirect addresses; at most 500 clients in all (`503 temporarily_unavailable`); before each registration, clients without an active connection are deleted: never used after a day, otherwise 30 days after the last use. | Bounded table, no job needed. |
| 6 | Client authentication | Public clients (`none`, PKCE only) and confidential ones (`client_secret_post` or `client_secret_basic`; the secret is 32 random bytes, shown once, stored as SHA-256). RFC 7591's default (`client_secret_basic`) applies when a client names none. | Claude may register either way. |
| 7 | Authorization request | `response_type=code`; **PKCE S256 required** (`code_challenge` of 43 base64url characters, `code_challenge_method=S256`; `plain` or none refused); `resource`, when given, must be `https://<domain>/mcp` (RFC 8707, else `invalid_target`); `scope` of `read` and/or `write` (none means both may be offered); `state` returned unchanged; `iss` added to the answer (RFC 9207). An unknown client or an unregistered redirect address is shown as an error page and never redirected to (no open redirect); any other error goes back to the client's registered address. | MCP authorization spec; OAuth 2.1. |
| 8 | Consent | `/oauth/authorize` (the web app, outside the app shell; without a session to `/login` and back with the query unchanged). Admins only (`canUseMcp`, like tokens); a client or a žiadateľ sees "Only admins can connect…" (`403`). It shows the client's name, the host the browser returns to, and the access: **Read only** or **Read and change** (only Read only when the client asked for `read`), preselected as asked. **Allow access** or **Deny**. | The brief. The host is what the user can verify; the name is not. |
| 9 | CSRF and clickjacking of the consent | The approval is `POST /api/oauth/authorize` (JSON, under the `/api` Origin/Sec-Fetch-Site guard, SameSite=Lax cookie) and must carry a **consent token**: an HMAC (`APP_SECRET`) over the login session id, the exact parameters and an expiry of 15 minutes, which only the consent page's own `GET` returns. Another site cannot read it; another session, another login of the same user or changed parameters are refused (`403`). Every `/oauth/*` answer carries `X-Frame-Options: DENY` and `frame-ancestors 'none'`. | Defence in depth beyond the existing guard. |
| 10 | Code | 32 random bytes, stored hashed, **two minutes**, **single use**: the first exchange claims it atomically, also a failed one. A second use revokes the connection the first one created (OAuth 2.1 §4.1.3). Bound to client, redirect address (must be sent again and equal), PKCE challenge, scope and resource. | |
| 11 | Tokens | Access `spolu_mcp_…` (same format as personal tokens), **one hour**. Refresh `spolu_mcr_…`, **30 days**, **rotating**: each refresh uses it up and issues a new pair. A used refresh token presented again (or two refreshes at once) **revokes the whole connection**. Refresh may narrow but never widen the scope (`invalid_scope`). Everything stored as SHA-256 only. Answers `Cache-Control: no-store`. | OAuth 2.1 §4.3.1 for public clients. A connection lasts as long as it is used at least once in 30 days. |
| 12 | Users | Every exchange and refresh re-reads the user: disabled or no longer an admin → `invalid_grant`. Deactivation revokes every connection (`revokeAllTokens`). At most **10 active connections** per user (`409 mcp_connection_limit` at approval, shown on the consent screen). | As for sessions and tokens. |
| 13 | Revocation | RFC 7009 `POST /oauth/revoke`: a refresh or access token of the calling client ends its connection; anything else changes nothing, always `200`. On the settings card **Connected assistants** lists the connections (client, access, host, since, last used) with **Disconnect**. | |
| 14 | Discovery | `GET /.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource` (RFC 9728), `GET /.well-known/oauth-authorization-server` (RFC 8414). `401` from `/mcp` carries `WWW-Authenticate: Bearer realm="spolu", resource_metadata="https://<domain>/.well-known/oauth-protected-resource/mcp"` (plus `error="invalid_token"` for a wrong one). No OpenID Connect discovery (Help issues no ID tokens), no client ID metadata documents (DCR is enough for Claude). No CORS: Claude exchanges tokens from its servers. | |
| 15 | Caddy | No change: the single `reverse_proxy app:3000` passes `/.well-known/*` and `/oauth/*` to the app. | Checked in `deploy/Caddyfile`. |
| 16 | Email | When an admin approves a connection, they get the same "new access to your account" email as for a new personal token (from PR #121's security fixes). | A stolen session cannot connect an AI silently. |
| 17 | Migration | **0047** (`0047_mcp_oauth.sql`). On the orchestrator's plan PR #124 takes 0045 and #121 (MCP tokens) becomes 0046 at merge, so this is 0047 already; until #121 is renumbered the journal skips the file number 0046 (the journal order is what counts). | |

## 3. Data (migration 0047)

- `mcp_oauth_clients`: `id` (the `client_id`, `mcpc_` + 16 random bytes), `secret_hash` (nullable), `auth_method`, `name` (≤ 100, control characters removed; "MCP client" when empty), `redirect_uris` (text[]), `created_at`, `last_used_at`.
- `mcp_oauth_grants` (a connection): `client_id` (cascade, indexed), `user_id` (cascade, indexed), `scope` (`read` | `write`, CHECK), `redirect_uri`, `created_at`, `expires_at` (follows the newest refresh token), `revoked_at`.
- `mcp_oauth_codes`: `code_hash` (unique), `client_id`, `user_id`, `redirect_uri`, `code_challenge`, `scope`, `resource`, `expires_at` (indexed), `used_at`, `grant_id` (set null). Codes are deleted an hour after expiry, when a new one is made.
- `mcp_oauth_refresh_tokens`: `grant_id` (cascade, indexed), `token_hash` (unique), `expires_at`, `used_at`. Expired ones are deleted at the next refresh of their connection.
- `mcp_tokens.oauth_grant_id` (unique, cascade): the connection's access token. Personal-token lists, the 10-token limit and token revocation ignore these rows.

## 4. Endpoints

| route | what |
|---|---|
| `GET /.well-known/oauth-protected-resource[/mcp]` | `{ resource, authorization_servers, scopes_supported: [read, write], bearer_methods_supported: [header] }` |
| `GET /.well-known/oauth-authorization-server` | issuer, the four endpoints, `code`, `authorization_code` + `refresh_token`, `S256`, the auth methods |
| `POST /oauth/register` | RFC 7591; `201` with `client_id` (and `client_secret`) |
| `GET /oauth/authorize` | the web app's consent page |
| `GET /api/oauth/authorize?…` | session, admins: `{ kind: consent, clientName, redirectHost, requestedScope, consentToken, limitReached }`, or `{ kind: redirect, redirectTo }` (an error for the client), or `400 { error: invalid_client | invalid_redirect_uri }` |
| `POST /api/oauth/authorize` `{ params, consentToken, approve, scope }` | `{ redirectTo }` with `code`, `state`, `iss`, or `error=access_denied` |
| `POST /oauth/token` | form or JSON; `authorization_code` and `refresh_token` |
| `POST /oauth/revoke` | RFC 7009 |
| `GET /api/me/mcp/connections`, `DELETE /api/me/mcp/connections/:id` | the settings card |

None of the `/api` routes is in the MCP allowlist. The token endpoint counts failed requests per IP (60 a minute, `429`).

## 5. Tests (test-first)

`modules/mcp/oauth.test.ts`: the metadata and the `401` header; registration (allowed and refused redirect addresses: foreign, look-alike and sub-domain hosts, user info, plain http, fragment, custom scheme; grant types; the per-IP limit); consent (shown data, needs a session, non-admin refused at GET and POST, no redirect to an unknown client or unregistered address, client errors back to the registered address with `state`, deny, CSRF: foreign Origin, cross-site, no consent token, another session's, changed parameters; no scope beyond the request); the token endpoint (PKCE required and verified, single-use code whose reuse revokes, a failed exchange uses the code up, wrong redirect address, client and resource, expired code, client secrets via post and Basic, unknown grant type and client); refresh rotation and reuse detection, another client's refresh token, no widening; a read-only connection cannot write; a deactivated admin's code, refresh and access token refused; expired access token; the settings list and revoke (own only, not among personal tokens); the connection limit; RFC 7009. Web: `consent-page.test.tsx` (parameters kept as sent, approve with the chosen scope, read-only offer, deny, non-admin and invalid link never leave the site, the limit) and the connections in `mcp-section.test.tsx`.

## 6. Out of scope

OpenID Connect, client ID metadata documents (2025-11-25 alternative to DCR), CORS for browser-based clients, consent remembered per client, an admin view of every user's connections, OAuth for clients (not admins).
