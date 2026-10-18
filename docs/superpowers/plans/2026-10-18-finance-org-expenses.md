# Phase 32 E — finance at organisation level: plan

Spec: [2026-10-18-finance-org-expenses-design.md](../specs/2026-10-18-finance-org-expenses-design.md) (decisions O1–O7 and E1–E22). One pull request, branch `feat/finance-org`. Test-first for every server rule (`superpowers:test-driven-development`); screen work starts with the `frontend-design` skill.

## Steps

1. **Shared schemas** (`packages/shared/src/finance/`): the `expense` type, `ExpenseKinds`, `ContractShareSchema`, `validateShares` (2–50 clients, distinct, each > 0, sum = amount), the org create body (`FinanceOrgItemBodySchema`), the patch's new fields, the multi-client fields of `ContractFieldsSchema`, `ExpenseFieldsSchema`, nullable `groupId` on items and ledger rows, `type` on the ledger query, `expenses` on the overview DTO, `proposedExpenseReminder`. Unit tests first (`shares.test.ts`).
2. **Migration 0044** (`db:generate`): nullable `group_id` on items, folders and reminder sets; the three item columns; the rewritten CHECKs; `finance_contract_shares`; the two indexes. `schema.test.ts` asserts every CHECK.
3. **Policy** (test-first, `policy.test.ts`): `canBePayee`, `canSeeExpenses`, `canManageOrgFinance`, `canEditContractIn` (the tab never edits a several-clients contract).
4. **Service** (`documents.ts`, `folders.ts`, `files.ts`): the `org` owner (lock key, folders, files), the item scope with shares (`itemScopeSql`), creating and editing several-clients contracts and expenses in one transaction, the trimmed detail for a client, the share batch for `/finance`. Files module: `createFile` and `attachFiles` accept a null group.
5. **Money** (`aggregates.ts`, `rankings.ts`): the per-client contract rows (own contracts plus shares) behind the overview money, the "all time" bounds and the paid ranking; the expenses sums for the `all` scope.
6. **Routes** (`documents-routes.ts`, `org-routes.ts`, `system-routes.ts`): the org routes, payees, `?group=`, the ledger's `type`; events per E22.
7. **Reminders and notifications**: nullable group in the reminder set and the upcoming list; the finance subject's link and title for organisation items and salaries; the push and the digest (nine server locales).
8. **Tests**: documents with shares and expenses, `org-leaks.test.ts` (clients, requesters, admins without the right; the tab's trim), overview and rankings with shares and expenses, `explain.test.ts` checks for the new queries (`test-volume.ts` seeds shares and expenses).
9. **Web** (`features/finance/`): the owner abstraction for the Documents card and the item sheet, the org view, the ledger's type filter and organisation rows, the create form's "Pre koho", shares editor, expense form and payee picker, the read-only shared contract in the tab, the overview's expenses line and bar; lazy namespace `financeOrg` in nine languages; component tests.
10. **E2E** `e2e/finance-org.spec.ts`: an expense with a reminder, a contract of two clients with shares, seen in each client's tab with its share only, the overview balance.
11. **Docs** (`update-kb`): `product/finance.md` (new section), `architecture/permissions.md`, `architecture/data-model.md` if it lists finance tables, `architecture/performance.md` (the new EXPLAIN checks), the roadmap.

## Done when

A finance admin records a salary and a server bill on `/finance` (one in the future with its reminder), creates a contract of two clients with a payer and shares that add up, sees each client's tab show only its share and the payer, sees the `/finance` balance drop by the expenses, and the paid ranking split the contract; no client, requester or admin without the right sees any of it.
