# 0032 — Finance items without a client, and client shares

Date: 2026-10-18 · Status: accepted · Phase 32 E ([spec](../superpowers/specs/2026-10-18-finance-org-expenses-design.md), decisions E1, E2, E7)

## Context

The owner wants finance at organisation level on `/finance`: expenses (an admin's salary, a server bill, a fine), documents, notes and folders that belong to no client, and contracts that one organisation pays for several clients at once, split into a share per client. Until now every finance item and folder had a required `group_id` ([ADR 0027](0027-sealed-finance-module.md) sealed them in their own tables).

## Decision

- **Same tables, nullable owner.** `finance_items.group_id` and `finance_folders.group_id` become nullable; null is the organisation. Expenses are `finance_items` rows of type `expense` (kind, payee, amount, and their date as a one-day period `starts_on = ends_on`). One CHECK per type keeps every column exact.
- **Shares in their own table.** A contract of several clients has no `group_id`, a `payer_name` and rows in `finance_contract_shares (item_id, group_id, amount_minor)`; the contract keeps its total. The shares add up to the total (checked on every write); a client's money, tab and paid ranking read its share.
- **Reminders and files follow.** `reminder_sets.group_id` becomes nullable (only for a finance item); an organisation's finance file has `files.group_id` null. Everything stays behind `requireFinance` and the finance-only file rule.

## Alternatives

- **A separate expenses table** (and a separate organisation documents table): the reminders, files, search, folders, sheet and ledger would each need a second path. Rejected.
- **One contract row per client** for a shared contract, linked by a group key: the contract's files, reminders and text would be copied per client and drift; the total would be a sum of rows. Rejected.
- **A pseudo-client "Organizácia"** (a group row like the admin group, [ADR 0029](0029-admin-group-as-a-group-row.md)): it would appear in every client list, filter and ranking and invite membership questions. Rejected.

## Consequences

- Every client scope (`group`, `groups`) keeps filtering on `group_id`, so organisation items never reach a client's tab; a client sees a shared contract only through its share row, with that share alone.
- Queries over every client read the small shares table whole; one client's read it by `finance_contract_shares_group_idx` (EXPLAIN checks in `modules/finance/explain.test.ts`).
- Converting a contract between one client and several is not built (the owner and the files would have to move).
