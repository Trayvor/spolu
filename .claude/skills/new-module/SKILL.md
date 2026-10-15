---
name: new-module
description: Use when adding a new feature area to eHub — a server module under apps/server/src/modules/, a web feature under apps/web/src/features/, or new tables, routes or socket events that belong to no existing module (for example groups, chat, tasks, tickets, contracts).
---

# Add a module

## Overview

eHub's server is organised as modules by feature. Each module owns its routes, service logic, permission policy, DB tables, socket events and tests. The architecture is in `docs/architecture/overview.md`; this skill is the hands-on template.

**The folder layout below is authoritative from Phase 1; adjust this skill if Phase 1 changes it.**

## Layout

```
apps/server/src/modules/<name>/
  routes.ts      Fastify routes; validate input with the shared zod schemas; call policy, then service
  service.ts     business logic; the only functions other modules may import
  policy.ts      permission checks, e.g. canReadGroup(user, groupId)
  schema.ts      Drizzle tables owned by this module
  events.ts      Socket.IO event names, payload types, emit helpers
  *.test.ts      Vitest unit and API tests next to the code they test
packages/shared/src/<name>.ts      zod schemas and types shared by server and web
apps/web/src/features/<name>/      routes, components, queries for this feature
```

`<name>` is lower-case and matches across all three places.

## Steps

1. Read the module's product doc (`docs/product/README.md` lists them), `docs/architecture/permissions.md` and `docs/architecture/realtime.md`.
2. **Policy first, tests first.** Write failing tests for `policy.ts` covering every role (`superadmin`, `admin`, `client`) and the "other group" case, then implement. REQUIRED SUB-SKILL: `superpowers:test-driven-development`.
3. Tables in `schema.ts`; generate and commit the drizzle-kit migration. Add an index for every column the module filters or sorts by.
4. zod schemas in `packages/shared/src/<name>.ts`; use them in `routes.ts` and in web forms.
5. Service and routes, test-first. Every route calls the policy before the service.
6. Realtime: a write goes through the HTTP route (validate, check policy, DB transaction); **after** it commits, emit the event from `events.ts` to the room. Room joins use the same policy functions. Sockets never accept writes.
7. Web feature in `apps/web/src/features/<name>/`. **Any UI: invoke `frontend-design:frontend-design` first**, before drawing or styling anything; the UI replicates https://egrant.sk using the theme tokens in `docs/design/`. All visible text goes through i18n (SK and EN). Lazy-load the feature's routes; paginate lists that grow; no decorative effects (see `docs/design/README.md`, "Keep it light").
8. Finish with the `update-kb` skill (product doc, data-model status, permissions, realtime, glossary).

## Rules

| Rule | Wrong | Right |
|---|---|---|
| No cross-module table access | `chat/service.ts` imports `groups/schema.ts` to query members | `chat` calls an exported function from `groups/service.ts` |
| Permissions only via policy | `if (user.role === 'admin')` inside a route | `await canEditGroup(user, groupId)` from `policy.ts` |
| One write path | socket handler `on('message:send')` writes to DB | `POST /api/...` writes, then `events.ts` emits |
| Client is never trusted | hiding a button is the only check | the server policy rejects; the UI also hides |
| Design via skill | restyling a component by hand | `frontend-design:frontend-design` invoked first |
