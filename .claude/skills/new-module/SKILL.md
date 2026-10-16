---
name: new-module
description: Use when adding a new feature area to Spolu — a server module under apps/server/src/modules/, a web feature under apps/web/src/features/, or new tables, routes or socket events that belong to no existing module (for example groups, chat, tasks, tickets, contracts).
---

# Add a module

## Overview

Spolu's server is organised as modules by feature. Each module owns its routes, service logic, permission policy, DB tables, socket events and tests. The architecture is in `docs/architecture/overview.md`; this skill is the hands-on template.

**Worked example: `apps/server/src/modules/users/` (server) and `apps/web/src/features/admins/` (web).** Copy their shape; read them before writing a new module. `apps/server/src/modules/groups/` (with `apps/web/src/features/groups/` and `features/join/`) is the second example: it adds the patterns in "Patterns from groups" below.

## Layout

```
apps/server/src/modules/<name>/
  schema.ts      Drizzle tables owned by this module
  policy.ts      permission checks, pure functions: canXxx(actor, target)
  service.ts     business logic on `db`; the only functions other modules may import
  routes.ts      export const <name>Routes: FastifyPluginAsync<{ deps: AppDeps }>
  emails.ts      (if it sends email) functions returning an EmailMessage (buildEmail + serverTexts)
  events.ts      (if it pushes) event names, payload types and emit helpers
  *.test.ts      Vitest next to the code: policy.test.ts, service.test.ts, routes.test.ts
packages/shared/src/<name>.ts      zod schemas, types, error codes shared by server and web
apps/web/src/features/<name>/      api.ts (queries + writes), <name>-page.tsx, tests
```

`<name>` is lower-case and matches across all three places.

## Steps

1. Read the module's product doc (`docs/product/README.md`), `docs/architecture/permissions.md` and `docs/architecture/realtime.md`.
2. **Policy first, tests first.** Write failing `policy.test.ts` (table-driven with `it.each`) for every role (`superadmin`, `admin`, `client`), the `ziadatel` membership (sees only their own tickets) and the "other group" case, then implement `policy.ts` (see `modules/users/policy.ts`). REQUIRED SUB-SKILL: `test-driven-development`.
3. **Tables.** Define them in `schema.ts` (drizzle-kit finds every `src/**/schema.ts`), add an index for each column you filter or sort by, then run `pnpm --filter @spolu/server db:generate` and commit the SQL in `src/infra/db/migrations/` with its `meta/` snapshot and journal entry. Migrations run at boot and in tests' global setup. Numbers are sequential: if `origin/main` gains a migration with your number before you merge, delete yours (SQL, snapshot, journal entry), rebase and generate it again.
4. **Shared schemas.** Request bodies, response shapes and error codes as zod in `packages/shared/src/<name>.ts`; add `export * from './<name>.js';` to `packages/shared/src/index.ts`. Add new error codes to `ErrorCodes` (`users.ts`). Server routes and web forms both use these schemas.
5. **Service**, test-first (`service.test.ts` against the test database). Export plain functions taking `db` first: `addAdmin(db, input)`. Throw a small error class for expected failures (`EmailTakenError`) and let the route map it to a status. Other modules call these exports; they never import your `schema.ts`.
6. **Routes**, test-first. Export `FastifyPluginAsync<{ deps: AppDeps }>` and destructure what you need from `deps` (`config`, `db`, `email`, `storage`, `jobs`). Register it in `apps/server/src/app.ts`: `await app.register(<name>Routes, { prefix: '/api', deps })`. Rules for each route:
   - guard with a preHandler from `modules/auth/session.ts`: `requireUser(app.auth)` or `requireAdmin(app.auth)`; both set `request.user` (`SessionUser`);
   - validate the body with the shared zod schema (`safeParse`, 400 `validation_failed`);
   - call the policy function with `request.user` before the service (403 `forbidden`);
   - errors are always `reply.code(n).send({ error: ErrorCodes.xxx })`; unknown ids are 404 `not_found`.
7. **Email.** Never send inside the request. Build the message in `emails.ts` with `buildEmail` (`infra/email/layout.ts`: one design for every system email, ADR 0019) and texts from `serverTexts(lang)` (`infra/i18n/`: one `<code>.ts` per language, all nine of type `ServerTexts`, so a missing text is a type error); see `modules/auth/emails.ts` (`adminAddedEmail`). The language is the recipient's stored language, else `pickLanguage(request.headers['accept-language'])` (`modules/auth/language.ts`). Queue it with `sendEmailLater(jobs, message)` (`infra/email/`); the `email.send` job handler is already registered in `createDeps`. A new kind of background work: write a `<name>JobHandlers(...)` function returning a handlers object (`Record<jobName, (data) => Promise<void>>`), and compose it with `emailJobHandlers(email)` by spreading both into the one object passed to `startJobs` in `createDeps` (`deps.ts`) and to `createInlineJobs` in `buildTestApp` (`test/test-app.ts`). If the write is already committed, catch a queue failure and log it instead of failing the request (see `POST /api/admins`).
8. **Realtime.** Sockets only push. After the DB write commits, emit from the route: `app.io.to(userRoom(id)).emit(EVENT, payload)` (`userRoom` and `disconnectUser(io, userId)` are in `infra/realtime/rooms.ts`; call `disconnectUser` when a user is removed). Event names and payload schemas go in `packages/shared`. New room kinds join in `infra/realtime/socket.ts` after the same policy check as HTTP. Never accept writes over a socket.
9. **Web feature** in `apps/web/src/features/<name>/`. **Any UI: invoke `frontend-design` first.**
   - `api.ts`: a `queryOptions(...)` using `apiGet(path, Schema)` for reads, and functions using `apiSend('POST' | 'DELETE', path, body, Schema)` for writes (`lib/api.ts`; errors are `ApiError` with `.code`).
   - Page component with `useQuery` / `useMutation`; invalidate the query on success. Use `useSession()` (`features/auth/use-session.ts`) and `isAdmin` (`features/auth/roles.ts`) only for cosmetic hiding.
   - Route in `apps/web/src/router.tsx`: `createRoute({ getParentRoute: () => authedRoute, path: '/<name>', component: lazyRouteComponent(withNamespaces(['<name>'], () => import('@/features/<name>/<name>-page')), 'NamePage') })`, added to `authedRoute.addChildren([...])`. The `authed` layout redirects anonymous visitors to `/login`; admin-only pages add a `beforeLoad` that throws `notFound()` for a client (see `adminsRoute`). Link it from the header menu if it is a main screen.
   - All text through i18n, nothing hardcoded. A feature's texts go in a lazy namespace: `src/locales/<name>/<code>.json`, one file for each of the nine languages (`sk`, `en`, `cs`, `sl`, `bg`, `et`, `it`, `hr`, `uk`; keys without the `<name>` wrapper; `t('<name>.title')` reads them), and its route loads it: `lazyRouteComponent(withNamespaces(['<name>'], () => import(...)), 'NamePage')` (`@/i18n/namespaces`). Add the name to `NAMESPACES` in `src/i18n/locales.test.ts`, and a case for the route in `src/router-i18n.test.tsx` (no raw key may render). A component rendered outside its route calls `useNamespaces(['<name>'])` under a `<Suspense>`. Only texts of the eager shell (header, menus, errors) go in the main files `src/locales/<code>.json`; the initial JS budget is nearly full (`docs/architecture/performance.md`), so prefer a namespace. Tests fail when the key sets of a language differ from English.
   - Lists that grow are paginated; no decorative effects (`docs/design/README.md`, "Keep it light").
10. **Tests.**
    - Server: `buildTestApp()` (`apps/server/test/test-app.ts`) gives `{ app, deps, close }` on the test database with inline jobs and SMTP to Mailpit. The database is shared between test files, so every email is unique (`${randomUUID()}@example.com`) and tests never assume an empty table. `loginAs(app, email)` (`test/login.ts`) logs in through the real code flow and returns a Cookie header; `latestEmail(to)` and `latestLoginCode(to)` (`test/mailpit.ts`) read what was sent. Create users with the service (`addAdmin`) before logging them in. Call `close()` in `afterAll`. Needs `docker compose -f docker-compose.dev.yml up -d --wait`; the database is `TEST_DATABASE_URL` (default `spolu_test`; parallel agents each use their own, see `CLAUDE.md`).
    - Web: Vitest + Testing Library; mock `fetch` and `@/lib/socket` (see `admins-page.test.tsx`).
    - e2e (`e2e/`, own database `spolu_e2e`, port 3000): one happy-path spec per module; the setup project logs the superadmin in once (`e2e/auth.setup.ts`). Only one e2e run at a time on a machine.
11. Finish with the `update-kb` skill (product doc, data-model status, permissions, realtime, overview, glossary).

## Patterns from groups

- **Public route:** no preHandler when a secret in the URL is the credential (`modules/groups/join-routes.ts`). Check the token first (unknown: 404), then the body, and answer the same for every email so nothing leaks. Rate-limit it with `createRateLimiter` (`infra/http/rate-limit.ts`, in-memory fixed window per key; fine for one process, ADR 0005).
- **Route-scoped body parser:** a non-JSON body (the logo upload, `modules/groups/logo.ts`) is its own plugin with `addContentTypeParser` and a small `bodyLimit`, so the parser does not leak to other routes. Sniff the type from the bytes, never trust the header alone. Web side: `apiSendRaw`.
- **404, not 403, for unreadable resources:** if a caller may not read a resource, answer `404 not_found`, the same as a missing id (`canReadGroup`). 403 is only for known-readable resources the caller may not change.
- **`Me` vs `SessionUser`:** `request.user` is a `SessionUser` (no group). A client may belong to several groups: pass `await clientGroupIds(db, actor.id)` (`modules/groups/memberships.ts`; `[]` for admins) to the policy, or `getMembership(db, userId, groupId)` when the role in one group matters (`client` or `ziadatel`). Only `/api/me` returns `Me` (SessionUser + `groups`).
- **Cached files:** serve with `Cache-Control: private`; an `ETag` for files that can change, or `max-age=31536000, immutable` for files that never change under their URL (the files module sends no ETag); when the file can change under the same URL, expose `updatedAt` in the shared schema and have the web append `?v=<updatedAt>`.
- **One-statement races:** prefer one upsert (`onConflictDoUpdate`) or a unique-violation catch over check-then-write (`joinWithEmail`).

## Patterns from files

Second example module: `apps/server/src/modules/files/` with `apps/web/src/features/files/`.

- **Streaming raw-body upload scope:** a large non-JSON body (`POST /api/groups/:id/files`) is its own plugin with a catch-all `addContentTypeParser('*', (_req, payload, done) => done(null, payload))` (passes the stream through, no `parseAs`), so the body is never buffered and the parser does not leak to other routes. Check the cheap things first (policy, rate limit, `content-length`), then stream into storage; on any failure remove what was stored. Small bodies (the 300 KB preview) use a second scope with `parseAs: 'buffer'` and a small `bodyLimit`. Web side: `XMLHttpRequest` for upload progress, `apiSendRaw` (with extra headers) for small PUTs.
- **Service called inside the caller's transaction:** a module that owns a row referencing files (a message, a task) calls `attachFiles(tx, groupId, fileIds, userId)` in its own transaction; it throws `InvalidAttachmentError` and the transaction rolls back. After commit it calls `deleteFiles` when rows were removed. Same shape for `recordNotifications(tx, ...)`.
- **`emitToGroup` after commit:** the HTTP route emits with `emitToGroup(io, groupId, event, payload)` only after the transaction has committed; sockets stay push-only. Web consumers listen with `getSocket().on(...)` and refetch when `useGroupRoomJoins()` changes.
- **One conditional UPDATE for races:** "set once" fields (`setFilePreview`) are decided by `UPDATE ... where <still unset>` and its row count, not by a read before.

## Rules

| Rule | Wrong | Right |
|---|---|---|
| No cross-module table access | `chat/service.ts` imports `groups/schema.ts` to query members | `chat` calls an exported function from `groups/service.ts`. Exception: a schema may import the `files` table for a foreign key only (`references(() => files.id)`), never to query it |
| Permissions only via policy | `if (user.role === 'admin')` inside a route | `await canEditGroup(user, groupId)` from `policy.ts` |
| One write path | socket handler `on('message:send')` writes to DB | `POST /api/...` writes, then the route emits after commit |
| Client is never trusted | hiding a button is the only check | the server policy rejects; the UI also hides |
| Errors as codes | `reply.send('not allowed')` | `reply.code(403).send({ error: ErrorCodes.forbidden })` |
| Design via skill | restyling a component by hand | `frontend-design` invoked first |
