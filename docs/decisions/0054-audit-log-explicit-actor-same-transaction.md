# 0054 Audit log: an explicit author, written in the change's transaction, append only

Date: 2026-10-19
Status: accepted

## Context
Nobody could say who moved a task's deadline, removed a client's member, changed a contract's amount or deactivated a group: the only trail was `mcp_audit_log` (the AI's write calls, per user, 180 days) and the server log (not searchable, no names). The owner asked for one general log for admins, filterable by kind of record, one record and author ([spec](../superpowers/specs/2026-10-19-audit-log-design.md)). The questions need the field and its values, the author (a person, a person through an MCP token, eGrant's webhooks, a job), and must not copy content (GDPR).

## Decision
- **One module, one table.** `modules/audit` owns `audit_log` (migration 0063): one row per changed record per write, with snapshot labels and a field-level diff limited to an allowlist (`AUDIT_FIELDS` in `packages/shared/src/audit.ts`); text fields are only `{ changed: true }`. Other modules call `recordAudit(tx, by, entries)` and never touch the table; the audit module reads other modules only through their exported functions and the live-record resolvers they register (`registerAuditResolver`). Finance registers its own; the audit module imports only `canSeeFinance`.
- **The author is passed explicitly** as `by: AuditActor` to every audited service function: `auditActorOf(request)` in routes (the session's person, or the person and the token for an in-process MCP call, through `runAsUser`'s `via`), `egrantActor(source, origin)` in the eGrant webhooks, `systemActor(job)` in jobs. Functions that already take the acting `SessionUser` default `by` to that person; the others take it as an optional last parameter, and **without it they write no row**: only tests and seeds call them that way. Every route, webhook and job passes it; each module's `audit.test.ts` drives its routes and asserts the rows, and `audit/coverage.test.ts` fails when a catalogue action has no such test.
- **Same transaction, always.** `recordAudit` takes the change's transaction; a function that ran one statement without one now opens one. A rolled-back change leaves no row, and a failed insert rolls the change back. A consequence (a deactivated admin's finance right, tokens, connections, passkeys; an absorbed project's deletion in a merge) is a row with the same author and `cause_id`.
- **No foreign keys** on `audit_log`: the log outlives its records and a delete never cascades into it or is blocked by it; labels are snapshots for that reason.
- **Append only:** the trigger `audit_log_append_only` refuses every UPDATE and a DELETE of a row younger than 730 days (SQLSTATE `SPA01`). The one sanctioned UPDATE is `anonymizeActor` (labels only, in a transaction with `spolu.audit_anonymize = 'on'`, the erasure runbook). The daily job `audit.cleanup` deletes older rows in batches of 5 000.
- **Read:** `GET /api/audit` only (`requireAdmin`, `canReadAudit` = every admin; finance rows only for `canSeeFinance`, filtered in SQL), keyset-paged by `(created_at, id)` on nine indexes, one of which serves each filter (EXPLAIN checks on a 2 000 000-row volume).

## Alternatives
- **`AsyncLocalStorage` holding the request's author**, read inside `recordAudit`: far less signature churn, but the author is invisible at the call sites, easy to lose across `setImmediate` and job hand-offs, and a service function called from a job would silently record the wrong author or none.
- **Database triggers per table**: they cannot know the person behind an app-pool connection, nor the MCP token, and would copy whole rows (content) into the log.
- **Extending `mcp_audit_log`**: it records tool calls (also refused ones), not changes, and only for the AI.
- **Full before/after snapshots**: they copy content (a GDPR risk) and make every row as big as the record.

## Consequences
- About fifty service functions take a `by` parameter; new shared-record write routes must pass `auditActorOf(request)` (the `new-module` skill and `permissions.md` say so). A forgotten `by` on a function with an optional one writes no row; the module tests and the coverage guard are the net.
- Every audited write costs one more insert (multi-row for batches) and a few label lookups in its transaction; human-paced writes make this negligible.
- The log holds people's names for two years (legitimate interest; the privacy notice is the owner's to update, spec Q5); erasure replaces them.
