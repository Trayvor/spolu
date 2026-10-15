---
name: new-module
description: Use when adding a new feature area to Spolu — a server module under apps/server/src/modules/, a web feature under apps/web/src/features/, or new tables, routes or socket events that belong to no existing module (for example groups, chat, tasks, tickets, contracts).
---

# Add a module

## Overview

Spolu's server is organised as modules by feature. Each module owns its routes, service logic, permission policy, DB tables, socket events and tests. The architecture is in `docs/architecture/overview.md`; this skill is the hands-on template.

**Worked example: `apps/server/src/modules/users/` (server) and `apps/web/src/features/admins/` (web).** Copy their shape; read them before writing a new module.

## Layout

```
apps/server/src/modules/<name>/
  schema.ts      Drizzle tables owned by this module
  policy.ts      permission checks, pure functions: canXxx(actor, target)
  service.ts     business logic on `db`; the only functions other modules may import
  routes.ts      export const <name>Routes: FastifyPluginAsync<{ deps: AppDeps }>
  emails.ts      (if it sends email) functions returning an EmailMessage, SK and EN
  events.ts      (if it pushes) event names, payload types and emit helpers
  *.test.ts      Vitest next to the code: policy.test.ts, service.test.ts, routes.test.ts
packages/shared/src/<name>.ts      zod schemas, types, error codes shared by server and web
apps/web/src/features/<name>/      api.ts (queries + writes), <name>-page.tsx, tests
```

`<name>` is lower-case and matches across all three places.

## Steps

1. Read the module's product doc (`docs/product/README.md`), `docs/architecture/permissions.md` and `docs/architecture/realtime.md`.
2. **Policy first, tests first.** Write failing `policy.test.ts` (table-driven with `it.each`) for every role (`superadmin`, `admin`, `client`) and the "other group" case, then implement `policy.ts` (see `modules/users/policy.ts`). REQUIRED SUB-SKILL: `superpowers:test-driven-development`.
3. **Tables.** Define them in `schema.ts` (drizzle-kit finds every `src/**/schema.ts`), add an index for each column you filter or sort by, then run `pnpm --filter @spolu/server db:generate` and commit the SQL in `src/infra/db/migrations/`. Migrations run at boot and in tests' global setup.
4. **Shared schemas.** Request bodies, response shapes and error codes as zod in `packages/shared/src/<name>.ts`; add `export * from './<name>.js';` to `packages/shared/src/index.ts`. Add new error codes to `ErrorCodes` (`users.ts`). Server routes and web forms both use these schemas.
5. **Service**, test-first (`service.test.ts` against the test database). Export plain functions taking `db` first: `addAdmin(db, input)`. Throw a small error class for expected failures (`EmailTakenError`) and let the route map it to a status. Other modules call these exports; they never import your `schema.ts`.
6. **Routes**, test-first. Export `FastifyPluginAsync<{ deps: AppDeps }>` and destructure what you need from `deps` (`config`, `db`, `email`, `storage`, `jobs`). Register it in `apps/server/src/app.ts`: `await app.register(<name>Routes, { prefix: '/api', deps })`. Rules for each route:
   - guard with a preHandler from `modules/auth/session.ts`: `requireUser(app.auth)` or `requireAdmin(app.auth)`; both set `request.user` (`SessionUser`);
   - validate the body with the shared zod schema (`safeParse`, 400 `validation_failed`);
   - call the policy function with `request.user` before the service (403 `forbidden`);
   - errors are always `reply.code(n).send({ error: ErrorCodes.xxx })`; unknown ids are 404 `not_found`.
7. **Email.** Never send inside the request. Build the message in `emails.ts` (`adminAddedEmail`, language from `pickLanguage(request.headers['accept-language'])`) and queue it with `sendEmailLater(jobs, message)` (`infra/email/`); the `email.send` job handler is already registered in `createDeps`. A new kind of background work: write a `<name>JobHandlers(...)` function returning a handlers object (`Record<jobName, (data) => Promise<void>>`), and compose it with `emailJobHandlers(email)` by spreading both into the one object passed to `startJobs` in `createDeps` (`deps.ts`) and to `createInlineJobs` in `buildTestApp` (`test/test-app.ts`). If the write is already committed, catch a queue failure and log it instead of failing the request (see `POST /api/admins`).
8. **Realtime.** Sockets only push. After the DB write commits, emit from the route: `app.io.to(userRoom(id)).emit(EVENT, payload)` (`userRoom` and `disconnectUser(io, userId)` are in `infra/realtime/rooms.ts`; call `disconnectUser` when a user is removed). Event names and payload schemas go in `packages/shared`. New room kinds join in `infra/realtime/socket.ts` after the same policy check as HTTP. Never accept writes over a socket.
9. **Web feature** in `apps/web/src/features/<name>/`. **Any UI: invoke `frontend-design:frontend-design` first.**
   - `api.ts`: a `queryOptions(...)` using `apiGet(path, Schema)` for reads, and functions using `apiSend('POST' | 'DELETE', path, body, Schema)` for writes (`lib/api.ts`; errors are `ApiError` with `.code`).
   - Page component with `useQuery` / `useMutation`; invalidate the query on success. Use `useSession()` (`features/auth/use-session.ts`) and `isAdmin` (`features/auth/roles.ts`) only for cosmetic hiding.
   - Route in `apps/web/src/router.tsx`: `createRoute({ getParentRoute: () => authedRoute, path: '/<name>', component: lazyRouteComponent(() => import('@/features/<name>/<name>-page'), 'NamePage') })`, added to `authedRoute.addChildren([...])`. The `authed` layout redirects anonymous visitors to `/login`; admin-only pages add a `beforeLoad` that throws `notFound()` for a client (see `adminsRoute`). Link it from the header menu if it is a main screen.
   - All text through i18n: add keys to **both** `src/locales/en.json` and `sk.json` (a test fails when the key sets differ). Nothing hardcoded.
   - Lists that grow are paginated; no decorative effects (`docs/design/README.md`, "Keep it light").
10. **Tests.**
    - Server: `buildTestApp()` (`apps/server/test/test-app.ts`) gives `{ app, deps, close }` on the test database with inline jobs and SMTP to Mailpit. The database is shared between test files, so every email is unique (`${randomUUID()}@example.com`) and tests never assume an empty table. `loginAs(app, email)` (`test/login.ts`) logs in through the real code flow and returns a Cookie header; `latestEmail(to)` and `latestLoginCode(to)` (`test/mailpit.ts`) read what was sent. Create users with the service (`addAdmin`) before logging them in. Call `close()` in `afterAll`. Needs `docker compose -f docker-compose.dev.yml up -d --wait`.
    - Web: Vitest + Testing Library; mock `fetch` and `@/lib/socket` (see `admins-page.test.tsx`).
    - e2e (`e2e/`, own database `spolu_e2e`): one happy-path spec per module; the setup project logs the superadmin in once (`e2e/auth.setup.ts`).
11. Finish with the `update-kb` skill (product doc, data-model status, permissions, realtime, overview, glossary).

## Rules

| Rule | Wrong | Right |
|---|---|---|
| No cross-module table access | `chat/service.ts` imports `groups/schema.ts` to query members | `chat` calls an exported function from `groups/service.ts` |
| Permissions only via policy | `if (user.role === 'admin')` inside a route | `await canEditGroup(user, groupId)` from `policy.ts` |
| One write path | socket handler `on('message:send')` writes to DB | `POST /api/...` writes, then the route emits after commit |
| Client is never trusted | hiding a button is the only check | the server policy rejects; the UI also hides |
| Errors as codes | `reply.send('not allowed')` | `reply.code(403).send({ error: ErrorCodes.forbidden })` |
| Design via skill | restyling a component by hand | `frontend-design:frontend-design` invoked first |
