# MCP server — plan

Spec: [2026-10-18-mcp-server-design.md](../specs/2026-10-18-mcp-server-design.md). ADR: [0033](../../decisions/0033-mcp-server-over-the-http-api.md). One pull request, branch `feat/mcp-server`. Every step test-first (`test-driven-development`).

1. **Docs first.** Spec, plan, ADR, roadmap entry. Commit.
2. **Shared types** (`packages/shared/src/mcp.ts`): `McpScope`, `McpTokenCreateBodySchema` (`name` 1–60, `scope`, `expiresInDays` ∈ 7/30/90/365), `McpTokenSchema`, `McpTokenCreatedSchema`, `McpAuditEntrySchema`, `MCP_LIMITS`; error codes `mcp_token_limit`.
3. **Policy** `modules/mcp/policy.ts`: `canUseMcp(actor)` (admins), `canUseTool(scope, tool)`; tests per role.
4. **Tables and migration 0045** (`mcp_tokens`, `mcp_audit_log`; `db:generate`, renamed to 0045 since 0043/0044 are held by open PRs).
5. **Tokens** `modules/mcp/tokens.ts`: `createToken`, `listTokens`, `revokeToken`, `revokeAllTokens`, `authenticateToken` (hash lookup, expiry, revoked, user active, `toSessionUser`, throttled `last_used_at`). `deactivateUser` calls `revokeAllTokens`.
6. **Token routes** `modules/mcp/routes.ts` (`/api/me/mcp/tokens`, `/api/me/mcp/audit`), rate limits; route tests per role.
7. **Internal calls** `modules/auth/internal-calls.ts` and the `getSessionUser` hook; test that an unknown or expired id is no session.
8. **Allowlist and caller** `modules/mcp/allowlist.ts`, `modules/mcp/call.ts` (`callApi`: allowlist check, `inject` as the user, JSON or bytes back).
9. **Transport** `modules/mcp/transport.ts` (`POST/GET/DELETE /mcp`): auth, Origin, protocol version, JSON-RPC, rate limits, audit of write calls, output cap.
10. **Tools** `modules/mcp/tools/*.ts` per area (people and groups, chat, tasks, tickets, knowledge, projects, bulk email, home, files, finance documents) and `tools/index.ts`; behaviour tests.
11. **Leak and event tests** (`leaks.test.ts`, `events.test.ts`).
12. **Web**: `frontend-design` skill first; `features/mcp/McpTokensSection.tsx` lazy in the settings page for admins; API hooks; lazy namespace `mcp` in nine languages; component tests.
13. **Docs**: `docs/integrations/mcp.md` (connect Claude Code, Claude Desktop through `mcp-remote`, the tools, limits), `architecture/permissions.md`, `architecture/overview.md`, `architecture/data-model.md`, `architecture/performance.md`, `product/profile.md`, `runbooks/deploy.md` (no Caddy change), `docs/README.md`, glossary.
14. Prettier, lint, typecheck, server and web tests (own database `spolu_test_mcp`, `--maxWorkers 2`), build; push and open the PR.
