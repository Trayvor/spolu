# 0029 — The admin group as a group row

Date: 2026-10-17 · Status: accepted · Phase 34 ([spec](../superpowers/specs/2026-10-17-phase-34-admin-group-design.md), decisions 1, 2 and 7)

## Context

The eGrant team wants its own internal group "eGrant tím": chat, tasks, knowledge, files, reminders, projects and finance like a client's, read by every admin and never by a client. Every per-group feature is keyed by `group_id`.

## Decision

- The admin group is **one row in `groups`** with a new column `kind` (`client` default, `admin`), exactly one (partial unique index `groups_one_admin`), inserted by migration 0037 and kept by `ensureAdminGroup` at server start (which also creates its board and chat, since migrations do not call services).
- `egrant_url` becomes nullable, only for that row (a check constraint); its invite token stays (the column is not null) but is never shown and opens nothing.
- **No membership rows:** `canReadGroup` already lets every admin read every group and admins have no `group_members` rows, so no client reads it. Routes that would add people (invite, members, managers, requesters) answer `409 admin_group`; tickets cannot live there (`400 invalid_group`).
- The kind is read in one place per rule (`isAdminGroup`, `canHoldTickets`, `isAdminGroupSql`, `withAdminGroup`), not spread through the modules.

## Alternatives

- **A new entity** (an "internal space") with its own key: every module (chat, tasks, knowledge, files, reminders, finance, projects, notifications, rooms) would need a second key and its own rules. Rejected.
- **A normal client group with a fake eGrant URL** and every admin as a member: clients could be invited into it by mistake, the intake could match it, and admins would need membership rows. Rejected.

## Consequences

- Every per-group feature works there at once; the few differences are branches on `kind` with tests in `modules/groups/admin-group.test.ts`.
- `GroupDto` and `GroupSummary` carry `kind`; client lists, pickers and counts filter on it (`isClientGroup`).
- Several admin groups (teams) would need the unique index dropped and a membership model for admins; out of scope.
