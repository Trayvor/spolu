# Admin substitution ("Zastúpiť") — design

Status: approved by the owner (decisions final, 2026-10-19), built on `feat/admin-substitution`. Plan: [2026-10-19-admin-substitution.md](../plans/2026-10-19-admin-substitution.md). Decision record: [ADR 0059](../../decisions/0059-admin-substitution-derived-manager-rows.md).

## Goal

While admin **A** is away, another admin **B** looks after A's clients. On the Administrators page any admin sets "B substitutes A" (optionally until a date) and ends it with one click. While it is active B is, for every purpose, a **manager** of each client group A manages; when it ends B stops being a manager of exactly those groups again.

## Rules (owner decisions)

1. **What B gets.** B becomes a manager of every client group where A is a manager (A's own manager rows), including groups A starts managing while the substitution is active. Being a manager gives B everything a manager gets: the group's notification mode "All messages" (unless B chose a mode for that group), new tickets of the client (watch default), pickable in mentions, @all, assignees and reminder recipients, the admin home's and boards' "my clients" scope, the weekly summary of the client, the workload card. Nothing is copied that is not tied to being a manager.
2. **Finance is not transferred.** Finance stays the per-person right (`user.finance_access_at`); B sees finance only if B already holds it.
3. **Clients see it.** On the group's Members tab, B is listed among the managers with "zastupuje <A>" (all nine languages).
4. **Who.** Any admin (superadmin included) sets or ends a substitution for themselves or a colleague. Every start and end is written to the audit log (`substitution.started`, `substitution.ended`) with the author; an automatic end has the system as author (`admin-substitution.expire`).
5. **Activation** is manual, at once. **End date** is optional (a day, inclusive, Bratislava time): on the next day the hourly job ends it. "Ukončiť zastupovanie" ends it at once.
6. **Clean end.** B stops being a manager only of the groups the substitution made B a manager of. A group B managed before, or that someone made B a manager of during the substitution, stays.
7. **Constraints.**
   - A cannot substitute themselves (`400 invalid_substitute`).
   - B must be an active admin (`400 invalid_substitute`); A must be an active admin (else `404`).
   - At most one active substitution per substituted admin (`409 already_substituted`); end it first. B may substitute several admins at once.
   - **No chains:** B must not be substituted themselves at that moment (`409 substitute_away`). A may be substituted while A substitutes someone else (C): B then covers only A's own groups, never the groups A covers for C (substitution is not transitive).
   - An end date in the past is `400 validation_failed`.
   - Deactivating an admin ends every active substitution where they are A or B (author: the admin who deactivated).

## Data model

- `admin_substitutions`: `id`, `substituted_id` (A), `substitute_id` (B), `ends_on` (date, nullable), `created_by`, `created_at`, `ended_at`, `ended_by`. Partial unique index on `substituted_id where ended_at is null` (one active per A), index on `substitute_id where ended_at is null`, check `substituted_id <> substitute_id`.
- `group_managers.substitution_id` (nullable, FK, `on delete cascade`): the marker of a **derived** manager row. Null = the admin's own row.

## How it works

A single idempotent function `syncSubstitute(tx, B)` makes B's derived rows equal to "A's own rows for every active substitution where B is the substitute": it deletes derived rows no longer wanted, re-points rows to another active substitution when B covers two admins of the same group, and inserts missing ones (never touching a row B already has). Inserted rows start the manager notification mode exactly like `addManager`; deleted ones stop it like `removeManager`. It runs:

- on start and on end (manual, expiry job, deactivation);
- after `addManager` / `removeManager` of an admin who is currently substituted (new or dropped groups of A);
- `addManager` of B on a group where B has a derived row turns it into B's own row (clears the marker), so the end keeps it.

All readers of `group_managers` (`managers.ts`, `listGroupPeople`, the ticket watch, the weekly summary, …) see derived rows like own rows, so no permission or notification code changes.

## API

- `PUT /api/admins/:id/substitution` `{ substituteId, endsOn: 'YYYY-MM-DD' | null }` → `201` the substitution. Admins only (`canManageSubstitutions`); `404` unknown or inactive admin, `400 invalid_substitute`, `400 validation_failed`, `409 already_substituted`, `409 substitute_away`.
- `DELETE /api/admins/:id/substitution` → `204`; idempotent (`204` when none is active). Admins only.
- `GET /api/admins` gains `substitution: { id, substituteId, substituteName, endsOn } | null` per admin.
- Socket: `group:managers` for every group whose managers changed (from the routes; the hourly job does not emit, the next load shows it).
- `GroupPerson.substitutesFor` (A's name) on a derived manager in `GET /api/groups/:id/people`.

## UI (Administrators page)

- Each row has a ghost button "Zastúpiť". It opens a small dialog (the app's `SheetDialog`): select "Kto zastupuje" (active admins except A and admins who are themselves substituted), optional date "Do (vrátane)", "Uložiť" / "Zrušiť".
- A row with an active substitution shows the badge "Zastupuje: B (do dd.mm.)" (without the date when open-ended) and the ghost button "Ukončiť zastupovanie" instead of "Zastúpiť"; it ends at once, then a toast confirms.
- Members tab: B's manager row shows "zastupuje A" in muted text under the name.

## Tests

Server (test-first): policy; service (gains managers of A's groups, keeps prior and independent memberships, covers new groups of A, drops removed groups, two substitutions of the same group, chains rejected, end/expiry/deactivation, notification mode and ticket watch, no finance); routes (codes, audit rows); expiry job (idempotent). Web: the dialog and the badge. E2E: happy path (set, see the label as a client, end).

## Out of scope

MCP tools (not needed), notifying B by email about the substitution, a history list of past substitutions (the audit log has it).
