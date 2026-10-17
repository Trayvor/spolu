# 0027 — A sealed finance module

Date: 2026-10-17 · Status: accepted · Phase 32 ([spec](../superpowers/specs/2026-10-17-finance-module-design.md), decisions 3 and 22)

## Context

Finance (contracts with amounts, the hours admins spent per client, hourly rates and costs) must be visible to finance admins only: never to clients, requesters or admins without the right. The knowledge base already has items, folders, files, reminders and search, and adding a `contract` type with a "finance" visibility would reuse most of it. But every knowledge query — the tab, the global list, search, card view, the chat picker and attached cards, chat files mirrored into knowledge, the meetings card, the events to `group:<id>:admins` — would then need a new filter, and one missed filter leaks amounts to every admin.

## Decision

- Finance is its own module, `modules/finance`, with **its own tables** (`finance_folders`, `finance_items`, `finance_attachments`, `finance_time_entries`, `finance_rates`). No other module queries them; other modules call its exported hooks (tasks and tickets, part A2) or its read functions (home).
- **One gate:** every finance route sits in one Fastify plugin behind `requireFinance` (`canSeeFinance`: the superadmin, or an admin the superadmin granted the right, `user.finance_access_at`).
- **Its own room:** finance events go to the `finance` room only, joined by finance admins' sockets; the grant routes move sockets.
- **Finance-only files:** a `files.finance_only` flag set at the finance upload. `canReadFile` checks it before any group or registered read rule; `attachFiles` and `copyFile` of every other module refuse such a file.
- **Its own notification group** (`finance`), shown only to finance admins and re-checked at delivery.
- Task and ticket DTOs carry no time; their time has its own routes answering only about the caller.
- Pure helpers of knowledge (search text, folder tree) move to `infra/` and are shared (part B), so the module stays small.

## Consequences

- Finance rows cannot appear in any existing list, search, chat or digest by construction; the leak tests check the remaining shared surfaces (files, notifications, sockets, DTOs).
- Some code is similar to knowledge's (items, folders); the shared helpers and the generic web components keep the duplication to the finance-specific parts (contract fields, money).
- Phases 14–15 (contracts for every admin) are merged into Phase 32: contracts exist only inside Finance, which narrows who sees them (spec decision 3).
