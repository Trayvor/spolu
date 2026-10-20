# 0065 Salaries are their own records; documents link to costs through one link table

Date: 2026-10-21
Status: accepted

## Context
Since Phase 32 E an admin's salary was an expense ("Výdavok" of kind `salary`, `finance_items.payee_id` set), dated to a day, with a title that could be empty. The owner decided (2026-10-21) that a salary ("Mzda") is a record of its own: the admin, the month it pays (year and month, no day), the amount paid, an optional note and files; visible and editable only by admins with the finance right, an admin without it not even seeing their own. Expenses stay, without the salary kind. Finance documents must be linkable to a salary and to an expense, while another branch adds links of documents to contracts.

## Decision
- **A table `finance_salaries`** (migration 0069): `payee_id` (FK `user`), `month` (a `date`, always the first day, CHECK), `amount_minor` (bigint ≥ 0), `currency` (`EUR`, `UAH`; forms enter the enabled ones), `note` (≤ 10 500 characters, so an old title and description fit together), `created_by`, `created_at`, `updated_at` (ms, the `409 finance_changed` check). Indexes `(month desc, id desc)` (the list, the totals, the money out) and `(payee_id, month desc, id desc)` (one admin). Files in `finance_salary_attachments` (the organisation's finance-only files, as its items use).
- **A month is stored as its first day** so the overview's money out and the month range filters use plain date ranges. A salary counts as paid out from the first day of its month (planned before), in the same `expenses` answer of the overview (`salaryPaidOut` keeps its meaning), so the web needs no new totals.
- **Data migration in SQL, same ids.** Each salary expense with an admin becomes a salary with the expense's id: the month of its date, amount and currency, the title and description joined as the note, its files, author and times; a `migrated` audit row on the salary and on the expense (`entity_type` `salary` and `finance_item`, actor `system` "migration 0069"); the expense goes (its reminders with it: a salary has none). A salary expense without an admin (the old CHECK allowed none) would stay an expense of kind `other`. Every step is idempotent (`on conflict do nothing`, `not exists`), and `salaries-migration.test.ts` migrates a seeded database from 0067, runs the data part twice, and compares the upgraded schema with a fresh one.
- **`finance_items` loses `payee_id`**; `expense_kind` keeps one value, `other` (room for kinds to come), and the title is 1..200 for every type.
- **One link table `finance_cost_documents`**: `document_id` (a finance item, cascade) and exactly one of `salary_id` and `expense_id` (cascade each; CHECK `num_nonnulls = 1`, unique per target and document). It is apart from the document–contract links of the other branch, so the two never touch each other's table; a new kind of cost adds a column. The service checks that the document is of type `document`.
- **Routes outside `requireFinance`**, with their own guard: 401 without a session and **404** for anyone without the finance right (not 403), so an admin without it does not learn that a salary of theirs exists. The routes: `/api/finance/salaries` (list with `admin`, `from`, `to`, `after` and totals on the first page; create; get; patch; delete) and `/api/finance/salaries/:id/documents`, `/api/finance/expenses/:id/documents` (link, unlink). MCP gets `list_salaries`, `get_salary`, `create_salary`, `update_salary` and `link_finance_document` (finance holders only, no deletes, no unlink).

## Consequences
- Old links and notifications to a migrated expense (`/finance?item=<id>`) open nothing; the salary keeps the id, so the audit log's rows of the expense and of the salary share it.
- The reminders of migrated salary expenses are gone; older notifications keep their "Salary: …" text (the push and digest still read the `salary` mark).
- Totals per currency never add currencies together, as everywhere in finance.
