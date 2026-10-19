# Admin substitution — plan

Spec: [2026-10-19-admin-substitution-design.md](../specs/2026-10-19-admin-substitution-design.md). Status: done on `feat/admin-substitution`.

1. **Shared** (`packages/shared`): `SubstitutionSchema`, `SetSubstitutionBodySchema`, `Admin.substitution`, `GroupPerson.substitutesFor`, error codes `invalid_substitute`, `already_substituted`, `substitute_away`, audit type `substitution` (`started`, `ended`; fields `substituted`, `substitute`, `endsOn`).
2. **Schema and migration** (`modules/groups/schema.ts`): `admin_substitutions`, `group_managers.substitution_id`; `db:generate` (migration 0065).
3. **Policy** (`modules/groups/policy.ts`): `canManageSubstitutions` — tests first.
4. **Service** (`modules/groups/substitutions.ts`): `startSubstitution`, `endSubstitution`, `endSubstitutionsOf`, `expireSubstitutions`, `activeSubstitutions`, `syncSubstitute`; hooks in `addManager` / `removeManager` — tests first (`substitutions.test.ts`).
5. **People** (`listGroupPeople`): `substitutesFor`.
6. **Routes** (`modules/groups/substitution-routes.ts`) and `GET /api/admins` merge; deactivation ends substitutions — route tests with audit rows.
7. **Job** (`modules/groups/jobs.ts`): `groups.substitutions-expire`, hourly at :05 Bratislava; registered in `deps.ts` and `test/test-app.ts`.
8. **Web**: `features/admins` dialog, badge and end button; members tab label; texts in the lazy `admins`, `groups` and `audit` namespaces in nine languages; unit tests.
9. **E2E**: `e2e/admin-substitution.spec.ts`.
10. **Docs**: permissions, client-managers, notifications, audit-log, data model, glossary, roadmap, ADR 0059.
