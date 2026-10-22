# 0034 OAuth for the MCP server: Help as its own authorization server, tokens in `mcp_tokens`

Date: 2026-10-18
Status: accepted (who may use it amended by [0071](0071-mcp-for-client-managers.md))

## Context
The owner wants to add Help to claude.ai and Claude Desktop as a **custom connector** with just the address `https://help.egrant.sk/mcp`. Those connectors authenticate with OAuth 2.1 as the MCP authorization specification (2025-06-18, 2025-11-25) requires: protected resource metadata (RFC 9728), authorization server metadata (RFC 8414), dynamic client registration (RFC 7591), the code flow with PKCE, resource indicators (RFC 8707) and refresh tokens. ADR 0033 gave the MCP server personal tokens only and listed OAuth as future work. Design: [spec](../superpowers/specs/2026-10-18-mcp-oauth-design.md).

## Decision
- **Help is its own authorization server**, issuer = `PUBLIC_URL`'s origin. Users approve on a consent page of the web app (`/oauth/authorize`) after the normal email-code login; admins only (`canUseMcp`), like tokens (since 2026-10-22 also client managers, [ADR 0071](0071-mcp-for-client-managers.md)).
- **Hand-written, no new dependency** (`modules/mcp/oauth.ts`, `oauth-routes.ts`). Better Auth's OIDC provider / MCP plugin was considered and not taken: it has its own tables, consent flow and token store, so OAuth tokens would bypass the one `/mcp` authentication and its scope, rate-limit and audit rules.
- **OAuth access tokens are `mcp_tokens` rows** (`oauth_grant_id` set; one row per connection whose hash and expiry rotate on refresh). `/mcp` treats them exactly like personal tokens.
- **Redirect addresses are limited to Claude's hosts and loopback**: `https://claude.ai`, `https://claude.com` (exact hosts) and `http://localhost|127.0.0.1|[::1]` (any port). Registration is otherwise open (RFC 7591) but rate limited per IP, capped at 500 clients, and unused clients expire.
- **PKCE S256 is required**; codes are hashed, single use, two minutes, and reuse revokes what they gave; access tokens last one hour; refresh tokens 30 days, rotating, with **reuse detection that revokes the connection**. Everything secret is stored as SHA-256 only.
- **Consent POST carries an HMAC consent token** bound to the login session and the exact parameters, on top of the `/api` Origin guard; `/oauth/*` pages may not be framed.
- Migration 0047.

## Consequences
- Adding the connector in Claude needs only the URL; Claude registers itself, the admin approves once, and Claude refreshes on its own. Personal tokens stay for Claude Code and scripts.
- A new client host (another vendor's connector) needs a code change to `ALLOWED_REDIRECT_HOSTS` and a note here. Browser-based clients would also need CORS, which we do not serve.
- A refresh ends the previous access token immediately; a client that keeps using an old one gets `401` and refreshes.
- We own the conformance of a security-sensitive protocol. It is covered by `oauth.test.ts` (PKCE, code reuse, redirect and resource binding, CSRF, rotation and reuse detection, scope, deactivated users, open redirects); a later MCP revision (for example client ID metadata documents) may need additions.
- **Not done:** OpenID Connect, client ID metadata documents, remembered consent, OAuth for clients (non-admins).
