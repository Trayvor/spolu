# Audit log („História zmien“)

Built 2026-10-19 ([spec](../superpowers/specs/2026-10-19-audit-log-design.md), [plan](../superpowers/plans/2026-10-19-audit-log.md), [ADR 0054](../decisions/0054-audit-log-explicit-actor-same-transaction.md)). One general log for administrators: **who changed what and when**, across every kind of record Help keeps.

## Who sees it

- **Every admin and the superadmin** (owner decision 2026-10-19). **Finance rows** (finance items, salaries, folders, time entries, rates and the finance right) only for admins with the finance right and the superadmin; for anyone else they do not exist, through any filter or link.
- Clients and žiadatelia never: the page answers "not found" and `GET /api/audit` `403`.
- Read through MCP with `list_audit_log` (2026-10-21; the same route and filters, finance rows only for the finance right); nothing writes it.

## What is recorded

One row per changed record per write, in the same transaction as the change, with its author: a person (admin, client, žiadateľ), **a person through AI** („Jana Nováková cez AI“ with the token's or connection's name), **eGrant** (the webhooks, the ticket intake, the project feed and the ticket areas call, with the instance's address) or **Systém** (jobs: the series' calls, the AI summary, a Teams transcript, the 730-day cleanup, a backfill, an automatic assignee by area). What each module records is in its own product file: [groups](groups.md), [auth](auth.md) (admins, the finance right, passkeys), [MCP](../integrations/mcp.md) (tokens and connections), [task board](task-board.md), [tickets](tickets.md) (ratings and the automatic assignees by area too), [knowledge](knowledge-base.md), [projects](projects.md), [finance](finance.md), [bulk email](bulk-email.md), [weekly summaries](weekly-summary.md).

- **Changes, not snapshots**: the fields that changed, from and to (short values cut at 200 characters, dates, people, files, money, minutes). The text of descriptions, notes, bodies, transcripts, summaries, rating comments, messages and emails is **never** copied: only „zmenený“. Tokens and invite links are never recorded.
- An edit that changes nothing, and a repeat (adding a manager twice), records nothing.
- A consequence of a change (deactivating an admin revokes their finance right, tokens, connections and passkeys) has the same author and points to its cause („ako dôsledok: …“).
- Not recorded: reading, sign-ins, chat messages and reactions, personal settings (language, notifications, saved views and replies, watching), reminders, a task reorder inside one column, drafts of bulk emails and test sends.
- Admin substitutions (2026-10-19): `substitution.started` and `substitution.ended` (entity label: the substituted admin; fields `substituted`, `substitute`, `endsOn`), author the admin who acted, or the system (`admin-substitution.expire`) when the last day passed.
- Kept **2 years** (730 days), then deleted by the daily job `audit.cleanup` (03:40). The table refuses edits and earlier deletes (a database trigger). An erasure request replaces the person's name ([runbook](../runbooks/audit-log-erasure.md)).

## The page `/audit`

Reached from the Admins page („História zmien“), from „História“ in the „…“ menu of a task, a ticket, a knowledge item and a project (finance items: finance admins), and from „História skupiny“ on a group's Members tab.

- Rows newest first, grouped by day (Bratislava time): the time (the exact time on hover), the author, the sentence („Úprava úlohy „Pripraviť rozpočet““) with the record's name as a link while it exists (a deleted one says „(vymazané)“), the client, up to three change lines (old value struck through, then the new), „+ ďalšie zmeny (n)“ for the rest, and the consequence line. „Podrobnosti“ shows every change (a created record's starting values too) and „Len tento záznam“.
- **Filters** (they combine): kind of record, one client, the author (the admins, eGrant, Systém, AI with any token; clicking an author in a row filters by them, also a client or a token), from and to (days), and one record (a chip, set by „Len tento záznam“ or a „História“ link). They are in the address, so a link keeps them, and the last ones (not the record) are remembered for the next visit. „Zrušiť filtre“ clears them all.
- 50 rows at a time, „Načítať staršie“ for more. No live updates: „Obnoviť“ loads the newest again.
- On a phone the filters are behind „Filtre (n)“, in a sheet.
- Texts in nine languages (lazy namespace `audit`).

## Not in v1

No undo, no export, no alerts, no MCP write, no own rename of an admin by another admin (there is no such route), and reminders are not recorded (spec §13).
