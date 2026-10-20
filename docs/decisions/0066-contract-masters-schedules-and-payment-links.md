# 0066: Contract masters, computed payment schedules and payment links of documents

- Status: accepted
- Date: 2026-10-21

## Context

The owner asked (2026-10-21) for four things on the client-level contract ("Zmluva", a finance
item of type `contract`, [finance.md](../product/finance.md)): a master contract ("Rámcová
zmluva") one level deep; amounts of 0; a recurring payment schedule shown as expected payments
("očakávané") with, per past period, whether it is paid; and finance documents linked to a
contract. Nothing may be created automatically from a schedule. Another change of the same day
([ADR 0065](0065-salaries-own-records-and-cost-document-links.md)) links documents to salaries and
expenses; the two link structures are to stay apart.

## Decision

1. **Master: a column, one level, checked under one lock.** `finance_items.parent_id` (a self
   foreign key, `on delete set null`, CHECK: only a contract, never itself). The rules — the master
   is a contract with no master of its own, a contract that is a master gets none, so no cycle can
   form — are checked by the service. Every write that can change the tree (a master set, a
   contract's shares changed) takes one advisory lock (`finance:contract-tree`) after its client's
   lock and the row, so two concurrent writes cannot each pass and together make two levels.
2. **Client scope (decision C3): the master covers its contracts.** A contract's clients are its
   client, or its shares' clients; every client of a contract under a master must be a client of
   the master. A client's tab that shows a contract can therefore always show its master; the
   master lists only the contracts the view may show. A change of the master's shares that would
   drop such a client is refused.
3. **Schedule: a row, computed periods.** `finance_contract_schedules` (one row per contract,
   primary key the contract): `frequency` (`monthly`, `quarterly`, `semiannual`, `yearly`,
   `everyMonths` with `every_months`, or `dates` with a `date[]`), the amount per payment (the
   contract's currency, 0 allowed), the first day and an optional end (none: the contract's end).
   The due days are computed on every read by one pure function in `@spolu/shared`
   (`scheduleDueDays`): anchored on the first day's day of the month, clamped to a shorter month
   (31 January → 28/29 February → 31 March), at most 600; a schedule with no payment is refused.
   No rows are created ahead (unlike recurring calls, [ADR 0049](0049-recurring-calls-rule-and-materialised-occurrences.md)):
   nothing acts on a due day, so there is nothing to materialise.
4. **Paid detection from document payments.** `finance_contract_documents` (`document_id`
   primary key, `contract_id`, optional `amount_minor` and `paid_on`, both or neither) links a
   document of type `document` to one contract of its client (or a contract of several clients
   that it, an organisation's document or one of those clients', belongs to). A period runs from
   its due day up to the next one (the last stays open, so a late payment still counts); it is
   **paid** when the payments dated in it add up to the amount, **partly paid** with less, **unpaid**
   when due with none, **expected** before its day. In a client's tab a contract of several clients
   counts the client's part of the schedule and of the payments (`share / total`, whole cents,
   half up). The overview adds the expected payments due in each month and the payments received,
   per currency, apart from the contracts' money (which still counts the whole amount on the start
   day), and a line per scheduled contract.
5. **Separate link tables.** Contract links are not ADR 0065's cost links (`finance_cost_documents`):
   a document has at most one contract and may record a payment, a cost link has neither.
6. **Zero everywhere.** Contract amounts already allowed 0; shares of a contract of several
   clients now may be 0 too (CHECK `>= 0`), so a contract of 0 can have shares.
7. **Audit.** A contract's `parent`, `schedule` (one line), `children` and `documents`, a
   document's `contract`, `payment` and `paidOn` are fields of the finance item's rows; a change
   records a row on both sides (the master and its contract, the contract and its document).

## Consequences

- Reads compute the schedule each time; the work is bounded by the number of scheduled contracts
  of the scope (indexed reads: the client's contracts or shares, the schedule by primary key, the
  payments by `(contract_id, paid_on)`; EXPLAIN checks in `finance/explain.test.ts`).
- A schedule changed later changes the past periods too (they are computed); the audit keeps the
  old schedule's line.
- Payments before the first due day count for no period.
- Migration 0070.
