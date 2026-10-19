# 0059 Admin substitution: derived manager rows with an origin marker

Date: 2026-10-19
Status: accepted

## Context
The owner asked for "Zastúpiť" on the Administrators page: while admin A is away, admin B is a manager of all of A's clients and gets every notification a manager gets; ending it must take B off exactly what the substitution added, and nothing B managed before or was given independently ([spec](../superpowers/specs/2026-10-19-admin-substitution-design.md)). Being a manager is a `group_managers` row. That row is read in many places: `managers.ts` (`isGroupManager`, `managedGroupIds`, `managedGroupsSql`, `managersOfGroups`, `hasActiveManagerSql`), `listGroupPeople` / `getGroupPeopleRoles` (pickable people, mentions, @all, reminder recipients), the ticket watch default, the weekly summary, the bulk email audience. A manager's notification mode is a stored `group_notification_settings` row (origin `manager`), read by `getEffectiveModes` and by several SQL fragments (`groupModeSql`, `groupModeJoinsSql`) of the dashboard and the unseen counts.

Two designs were weighed:
1. **Computed at read time**: leave `group_managers` alone and make every reader add "groups of admins I substitute". Every reader above, and every mode fragment, would need the extra union; the mode fragments would also need a new "derived manager → All messages" rule. Many places to keep in step, and a missed one silently breaks the promise "B gets what a manager gets".
2. **Derived rows with a marker**: a substitution writes real `group_managers` rows for B, marked with `substitution_id`; every reader stays unchanged.

## Decision
Design 2.
- `admin_substitutions` (`substituted_id`, `substitute_id`, `ends_on`, `created_by`, `ended_at`, `ended_by`; one active row per substituted admin by a partial unique index; migration 0065) and `group_managers.substitution_id` (nullable FK, cascade, partial index). Null = the admin's own row.
- One idempotent function, `syncSubstitute(tx, B)` in `modules/groups/substitutions.ts`, makes B's derived rows equal to "the own rows of every admin B substitutes now": it deletes unwanted derived rows, re-points a row to another active substitution (B covers two admins of one group), inserts missing ones and never touches a row B owns. It starts and stops the manager notification mode (`startManagerModes` / `stopManagerModes`, bulk forms of the existing rule), so B gets "All messages" unless B chose a mode, and loses it again on the end.
- It runs on start, on end (manual, the hourly job `groups.substitutions-expire`, the deactivation of A or B), and from `addManager` / `removeManager` of a substituted admin (a group A gains or loses while away). `addManager` of B on a group where B has a derived row clears the marker: the row becomes B's own and survives the end.
- Only A's own rows are copied (not transitive), and an admin who is substituted cannot be picked as a substitute (no chains).
- The end date is a Bratislava day, inclusive; the job runs hourly at :05 and is idempotent (`ended_at is null` guards every end).
- Start and end are audit rows of a new entity type `substitution` (`started`, `ended`), with the author; the job's author is the system (`admin-substitution.expire`).
- Finance is untouched: it is a per-person right, never tied to managing.

## Consequences
- No permission or notification code changed; new readers of `group_managers` get substitutions for free.
- The expiry is up to an hour late after midnight (the row is mutated by the job, not filtered at read time). Acceptable for whole-day end dates; a manual end is instant.
- Removing B by hand from a derived group while the substitution is active works, but a later sync (A gains or loses a group, another start or end) adds the row back while the substitution lasts. Ending the substitution is the way to stop it.
- `GroupPerson.substitutesFor` (A's name) comes from a join in `listGroupPeople`; clients see "zastupuje <A>".
