# Phase 4 — Shared foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build once what chat (Phase 5) and the task board (Phase 8) both need — group-scoped stored files, recorded notification events, the list of a group's people with avatars, group socket rooms for admins and the group page tabs — so the two parallel branches never edit the same files.

**Architecture:** Two new server modules following the `new-module` skill: `files` (table `files`, raw-body streaming upload, browser-made previews, daily cleanup of unattached files) and `notifications` (table `notification_events`, written only through `recordNotifications` inside the caller's transaction, purged after 30 days). The groups module gains `GET /api/groups/:id/people` and `isGroupPerson`; the socket layer gains `group:join` / `group:leave` and `emitToGroup`. On the web, `/groups/$groupId` becomes a layout with Chat / Tasks / Members tab routes, plus shared `features/files`, `<Avatar>`, `useGroupPeople` and `useGroupRoom`.

**Tech Stack:** existing only (Fastify 5, Drizzle, pg-boss 12, Socket.IO 4, React 19, TanStack Router/Query, Tailwind 4, zod 4, Vitest, Playwright). No new dependency (no multipart plugin, no `sharp` on the server).

**Spec:** `docs/superpowers/specs/2026-10-15-phase-4-shared-foundation-design.md`.

## Global Constraints

- Work on branch `phase-4`; do not create branches.
- English everywhere (code, comments, docs, commits). Every UI string is an i18n key in **both** `apps/web/src/locales/en.json` and `sk.json`; only add keys, do not reformat the files.
- Readable code and performance first: indexed queries, no N+1, no fancy visual effects.
- Any UI task starts by invoking `frontend-design:frontend-design`; reuse tokens and `components/ui/*`.
- Initial web JS budget **200 kB gzip** (today ~193 kB): every new screen and component is reached through `lazyRouteComponent`; nothing new is imported eagerly by `router.tsx` except route definitions and existing `features/groups/api`. Check `pnpm --filter @spolu/web build` output in every web task.
- Permissions only via policy functions; an unreadable group or file answers **404 `not_found`**, never 403. 403 `forbidden` only for a readable resource the caller may not change.
- API errors are `{ error: '<code>' }`. New codes: `file_too_large` (413), `invalid_attachment` (service error, mapped by Phases 5/8), `invalid_preview` (400). Rate limit: `rate_limited` 429.
- Limits: file 25 MB (`25 * 1024 * 1024`), preview ≤ 300 KB (`300 * 1024`), preview ≤ 640 px WebP, uploads 60/min per user, unattached files deleted after 24 h by `files.cleanup-unattached` at `30 3 * * *`, notification events deleted after 30 days by `notifications.purge-old` at `45 3 * * *`.
- Files never change: served with `cache-control: private, max-age=31536000, immutable` and always `x-content-type-options: nosniff`.
- Sockets only push; `group:join`/`group:leave` change no data. Writes go through HTTP.
- Server tests share the `spolu_test` DB in parallel: unique emails (`${randomUUID()}@example.com`) and eGrant URLs per test, never truncate, never assume an empty table. Use `buildTestApp`, `loginAs`. Needs `docker compose -f docker-compose.dev.yml up -d --wait`.
- Commands: `pnpm --filter @spolu/server test`, `pnpm --filter @spolu/web test`, `pnpm --filter @spolu/shared test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @spolu/server db:generate`. Prettier is checked with `rtk proxy pnpm exec prettier --check <changed files>` (the plain wrapper fakes success).
- Each commit updates the docs it affects. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Interfaces for Phases 5 and 8

Stable names the parallel branches consume. Do not rename them without updating this section.

**Shared (`@spolu/shared`)**
```ts
// files.ts
export const FileInfoSchema: z.ZodObject<{ id; name; mime; size; width: number|null; height: number|null; hasPreview: boolean }>;
export type FileInfo = { id: string; name: string; mime: string; size: number; width: number | null; height: number | null; hasPreview: boolean };
// notifications.ts — all kinds Phases 5 and 8 need are declared now, so neither branch edits this file
export const NotificationKinds = ['chat.message', 'chat.mention', 'chat.thread_reply', 'task.moved', 'task.assigned'] as const;
export type NotificationKind = (typeof NotificationKinds)[number];
// groups.ts
export const GroupPersonSchema = z.object({ id: z.string(), name: z.string(), isAdmin: z.boolean() });
export type GroupPerson = z.infer<typeof GroupPersonSchema>;
export const GroupPersonListSchema = z.array(GroupPersonSchema);
// socket.ts
export const SocketEvents = { ping: 'system:ping', groupJoin: 'group:join', groupLeave: 'group:leave' } as const;
export type GroupRoomPayload = { groupId: string };
export type GroupJoinAck = { ok: true } | { ok: false; error: 'not_found' };
// users.ts ErrorCodes gains
fileTooLarge: 'file_too_large', invalidAttachment: 'invalid_attachment', invalidPreview: 'invalid_preview'
```

**Server**
```ts
// modules/files/service.ts
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export type FileDeps = { db: Db; storage: Storage };
export class FileTooLargeError extends Error {}
export class InvalidAttachmentError extends Error {}
export function createFile(deps: FileDeps, input: { groupId: string; uploadedBy: string; name: string; declaredType: string | undefined; body: Readable }): Promise<FileInfo>;
/** Call inside the caller's transaction; throws InvalidAttachmentError (the transaction rolls back). */
export function attachFiles(tx: Db, groupId: string, fileIds: string[], userId: string): Promise<void>;
/** In the order of `ids`; ids that are unknown or in another group are skipped. */
export function getFilesForGroup(db: Db, groupId: string, ids: string[]): Promise<FileInfo[]>;
/** Rows first, then storage objects (storage errors ignored). Call after the owner's transaction commits. */
export function deleteFiles(deps: FileDeps, ids: string[]): Promise<void>;
// modules/notifications/service.ts
export function recordNotifications(tx: Db, input: { kind: NotificationKind; groupId: string | null; recipients: string[]; payload: Record<string, unknown> }): Promise<void>;
// modules/groups/service.ts
export function listGroupPeople(db: Db, groupId: string): Promise<GroupPerson[]>;
export function isGroupPerson(db: Db, groupId: string, userId: string): Promise<boolean>;
// infra/realtime/rooms.ts — call after the transaction commits
export function emitToGroup(io: SocketIOServer, groupId: string, event: string, payload: unknown): void;
```
HTTP: `POST /api/groups/:id/files`, `PUT /api/files/:id/preview`, `GET /api/files/:id`, `GET /api/files/:id/preview`, `GET /api/groups/:id/people`.

**Web**
```ts
// features/files/upload.ts
export function uploadFile(groupId: string, file: File, onProgress?: (fraction: number) => void): Promise<FileInfo>;
// features/files/urls.ts
export const fileUrl = (id: string) => `/api/files/${encodeURIComponent(id)}`;
export const previewUrl = (id: string) => `/api/files/${encodeURIComponent(id)}/preview`;
// features/files/file-chip.tsx, features/files/image-preview.tsx
export function FileChip(props: { file: FileInfo }): JSX.Element;
export function ImagePreview(props: { file: FileInfo; maxWidth?: number /* default 320 */ }): JSX.Element;
// features/files/format-size.ts
export function formatFileSize(bytes: number, language: string): string;
// lib/resize-image.ts (moved from features/groups/)
export function resizeImage(file: File, max?: number): Promise<Blob>;
export function resizeImageWithSize(file: File, max: number): Promise<{ blob: Blob; width: number; height: number }>;
// components/avatar.tsx
export function Avatar(props: { userId: string; name: string; size?: number /* px, default 32 */; className?: string }): JSX.Element;
export function avatarColor(userId: string): string; // a bg-* class
// features/groups/api.ts + features/groups/use-group-people.ts
export const groupPeopleQuery: (groupId: string) => /* queryOptions, key ['groups', groupId, 'people'] */;
export function useGroupPeople(groupId: string): UseQueryResult<GroupPerson[]>;
// features/groups/use-group-room.ts
/** Joins the group room; returns a counter that grows after every acknowledged join (first join and every rejoin after a reconnect). Consumers run their catch-up / refetch when it changes, so nothing written between `connect` and the join is missed. */
export function useGroupRoom(groupId: string): number;
/** The join counter of the group layout's room, from a React context the layout provides (`GroupRoomProvider`); 0 outside a group layout. Chat and board use this, they never call useGroupRoom themselves. */
export function useGroupRoomJoins(): number;
// features/chat/chat-tab.tsx, features/tasks/tasks-tab.tsx — placeholders the phases replace
export function ChatTab(): JSX.Element;   // reads groupId with useParams({ strict: false })
export function TasksTab(): JSX.Element;
```
Routes: `/groups/$groupId` (layout `GroupLayout`, calls `useGroupRoom`), children `/groups/$groupId/chat`, `/tasks`, `/members`; `/groups/$groupId` redirects to `/chat`. Live events: listen with `getSocket().on(event, …)` from `@/lib/socket`; the layout already keeps the socket in `group:<id>`.

## Review Focus

- A body over 25 MB sent **without** `content-length` (chunked): the stream is aborted, 413 `file_too_large`, and neither the row nor the data file nor its `.meta.json` sidecar remains (Task 1 service test, Task 2 route test).
- Hostile or broken `x-file-name`: `..%2F..%2Fetc%2Fpasswd`, `a\b`, invalid percent-encoding `%E0%A4%A`, control characters, 300 chars, empty or missing header → a safe display name (no `/` or `\`, ≤ 255 chars, `file` when empty); the storage key never uses the name (Task 1 test).
- An HTML or SVG file declared as `text/html` / `image/svg+xml` is served as `attachment` with `nosniff`, never inline, and gets no preview; a PNG declared as `application/pdf` is sniffed as `image/png` and served inline (Task 2 test).
- `attachFiles` with the same id twice, or racing a second message that attaches the same file, attaches each file once: the loser gets `InvalidAttachmentError` and its transaction rolls back; the cleanup job never deletes a file attached between its read and delete (one conditional `DELETE`) (Task 1 test).
- An admin's socket reconnects (server restart, network drop) while the group page is open: `useGroupRoom` joins `group:<id>` again on `connect`; moving to another group leaves the first room; the returned join counter grows after each acknowledged join (Task 7 test).

---

### Task 1: Files data, policy and service

**Files:**
- Create: `apps/server/src/modules/files/{schema.ts,policy.ts,policy.test.ts,service.ts,service.test.ts,sniff.ts,sniff.test.ts,file-name.ts,file-name.test.ts}`, `packages/shared/src/files.ts` (+ `files.test.ts`), generated migration in `apps/server/src/infra/db/migrations/`
- Modify: `apps/server/src/modules/groups/logo.ts` (import `sniffImageType`, `ImageType` from `../files/sniff.js`; delete its copies), `apps/server/src/modules/groups/logo.test.ts` (sniff cases move to `sniff.test.ts`), `packages/shared/src/index.ts`, `packages/shared/src/users.ts` (`ErrorCodes`), `docs/architecture/data-model.md` (File built), `docs/architecture/permissions.md` (files)

**Interfaces:**
- Consumes: `canReadGroup` (`modules/groups/policy.ts`), `Storage` (`infra/storage`), `Db`.
- Produces (besides the "Interfaces for Phases 5 and 8" server block):
  - Table `files` exactly per the spec columns (`id` text PK = `randomUUID()`, `group_id` → `groups.id` on delete cascade, `uploaded_by` → `user.id`, `name`, `mime`, `size` integer, `storage_key`, `preview_key` nullable, `width`/`height` nullable integer, `attached_at` nullable timestamptz, `created_at`). Indexes: `files_group_id_idx (group_id)`, partial `files_unattached_idx (created_at) where attached_at is null`.
  - `sniff.ts`: `export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp'`; `export const IMAGE_TYPES: readonly ImageType[]`; `sniffImageType(buf: Buffer): ImageType | null` (moved unchanged).
  - `file-name.ts`: `sanitizeFileName(name: string): string` — removes `/`, `\` and control chars (`\u0000-\u001f\u007f`), trims, truncates to 255 code points (trim again), `'file'` when empty. `decodeFileNameHeader(header: string | undefined): string` — `decodeURIComponent`, the raw header on `URIError`, `''` when missing.
  - `policy.ts`: `canReadFile(actor: SessionUser, file: { groupId: string }, actorGroupId: string | null): boolean` (delegates to `canReadGroup`); `canSetPreview(actor: SessionUser, file: { uploadedBy: string }): boolean` (uploader only).
  - `service.ts` also: `type FileRow = typeof files.$inferSelect`; `getFile(db, id): Promise<FileRow | null>`; `toFileInfo(row: FileRow): FileInfo` (`hasPreview = previewKey !== null`); `setFilePreview(deps: FileDeps, row: FileRow, input: { body: Buffer; width: number; height: number }): Promise<void>` (key `files/<groupId>/<id>-preview`, `image/webp`; overwrites); `deleteUnattachedFiles(deps: FileDeps, olderThan: Date): Promise<number>`.
  - `createFile`: id first, key `files/<groupId>/<id>`; pipes `body` through a byte-counting `Transform` that keeps the first 12 bytes and errors with `FileTooLargeError` past `MAX_FILE_BYTES`, into `storage.put(key, stream, …)`; then inserts the row. `mime` = `sniffImageType(head)` ?? the declared type lower-cased without parameters when it matches `/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/` ?? `'application/octet-stream'`. On **any** error (too large, storage, insert) it calls `storage.delete(key)` (removes data and sidecar; errors ignored) and rethrows.
  - `attachFiles`: dedupe ids; empty → return; one `UPDATE files SET attached_at = now() WHERE id IN (…) AND group_id = $g AND uploaded_by = $u AND attached_at IS NULL RETURNING id`; fewer rows than unique ids → throw `InvalidAttachmentError`.
  - `deleteFiles` / `deleteUnattachedFiles`: one `DELETE … RETURNING storage_key, preview_key` (the latter `WHERE attached_at IS NULL AND created_at < $cutoff`), then delete each key from storage ignoring errors; empty ids → no query.

- [ ] **Step 1: Failing tests**
  - `policy.test.ts` (`it.each`): `canReadFile` for superadmin, admin, client-own-group → true; client-other-group, client-no-group → false. `canSetPreview`: uploader true, another admin false.
  - `file-name.test.ts`: `'..%2F..%2Fetc%2Fpasswd'` decoded and sanitized → `'....etcpasswd'`; `'a\\b.pdf'` → `'ab.pdf'`; `decodeFileNameHeader('%E0%A4%A')` → `'%E0%A4%A'`; `'  report.pdf  '` → `'report.pdf'`; 300 × `'é'` → length 255; `''`, `'\u0000'` → `'file'`; `decodeFileNameHeader(undefined)` → `''`.
  - `sniff.test.ts`: PNG, JPEG, WebP magic → type; PDF bytes and empty buffer → null.
  - `service.test.ts` (real DB + `createDiskStorage` in a temp dir; groups and users created through their services with unique values):
    - `createFile stores the bytes and returns FileInfo` — `{ name: 'notes.txt', mime: 'text/plain', size: 5, width: null, height: null, hasPreview: false }`; `storage.get('files/<g>/<id>')` streams the same bytes.
    - `createFile sniffs a PNG declared as application/pdf` → `mime: 'image/png'`; `declared 'image/svg+xml' with SVG bytes` → `mime: 'image/svg+xml'`; `declared 'not a type'` → `'application/octet-stream'`.
    - `createFile over 25 MB rejects with FileTooLargeError and keeps nothing` — a `Readable` of 26 × 1 MiB chunks; no row for the group; `storage.exists(key)` false and no `.meta.json` left (list the temp dir `files/<g>`).
    - `createFile leaves no row when storage.put fails` (stub `put` to reject).
    - `attachFiles attaches own unattached files of the group`; `rejects another group's file`, `another user's file`, `an already attached file`, `an unknown id` with `InvalidAttachmentError`; `duplicate ids count once`; `inside a transaction that throws later, attached_at stays null`.
    - `getFilesForGroup returns files in the order of ids and skips other groups' files`; `[]` for empty ids.
    - `deleteFiles removes rows and storage objects (data and preview)`.
    - `deleteUnattachedFiles deletes only unattached files older than the cutoff` (set `created_at` back 25 h with a direct update in the test; attached-old and unattached-new stay).
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test` and `pnpm --filter @spolu/shared test` — FAIL (modules missing).
- [ ] **Step 3: Implement** shared `files.ts` + error codes, then `schema.ts`, `pnpm --filter @spolu/server db:generate` (check the SQL has both indexes and the cascade), `sniff.ts` (update `logo.ts` imports), `file-name.ts`, `policy.ts`, `service.ts` per Interfaces.
- [ ] **Step 4: Run** server and shared tests, `pnpm typecheck`, `pnpm lint`, prettier check — PASS.
- [ ] **Step 5: Docs + commit** (data-model: File built with columns and lifecycle; permissions: files follow the group, preview by the uploader) `feat(server): files data and service`.

### Task 2: Files HTTP API

**Files:**
- Create: `apps/server/src/modules/files/routes.ts`, `routes.test.ts`
- Modify: `apps/server/src/app.ts` (`await app.register(filesRoutes, { prefix: '/api', deps })`), `docs/architecture/overview.md` (files module), `docs/architecture/permissions.md`

**Interfaces:**
- Consumes: Task 1; `getGroup`, `getMembershipGroupId` (groups service); `createRateLimiter` (`infra/http/rate-limit.ts`); `requireUser`.
- Produces: `filesRoutes: FastifyPluginAsync<{ deps: AppDeps }>` with the four endpoints of the spec table.
  - Upload scope (own `app.register`): `removeAllContentTypeParsers()`, then `addContentTypeParser('*', (_req, payload, done) => done(null, payload))` — the handler gets the raw stream; nothing is buffered. Order in the handler: group readable (`canReadGroup` + `getGroup`, else 404) → limiter `createRateLimiter({ windowMs: 60_000, max: 60 })` keyed by user id (429 `rate_limited`) → `content-length` header > `MAX_FILE_BYTES` → 413 `file_too_large` → `createFile` with `decodeFileNameHeader(x-file-name)` and the `content-type` header; `FileTooLargeError` → 413 `file_too_large` with `connection: close`. 201 `FileInfo`.
  - Preview scope: buffer parser for every type with `bodyLimit: 300 * 1024` (Fastify's 413 above it), like `logo.ts`. File unreadable → 404; not `canSetPreview` → 403 `forbidden`; `attachedAt !== null`, `mime` not in `IMAGE_TYPES`, body not sniffed as `image/webp`, or `x-image-width`/`x-image-height` not integers in 1..20000 → 400 `invalid_preview`; else `setFilePreview`, 204.
  - `GET /files/:id`: unreadable/unknown → 404; headers `content-type: <mime>`, `content-length`, `x-content-type-options: nosniff`, `cache-control: private, max-age=31536000, immutable`, `content-disposition`: `inline` when `mime` ∈ `IMAGE_TYPES`, else `attachment; filename*=UTF-8''<encodeURIComponent(name) with ' ( ) * also percent-encoded>`. A missing storage object (`StorageNotFoundError`) → 404.
  - `GET /files/:id/preview`: same checks and caching, `content-type: image/webp`, inline; 404 when `previewKey` is null.

- [ ] **Step 1: Failing tests** (`routes.test.ts`, one group per test with unique URL; a client joined via `joinWithEmail` + verified login, an admin via `addAdmin`):
  - `a client uploads to their group and downloads the same bytes` — POST with `content-type: application/pdf`, `x-file-name: ${encodeURIComponent('Zmluva č. 1.pdf')}` → 201 `{ name: 'Zmluva č. 1.pdf', mime: 'application/pdf' }`; GET → 200, body equal, `content-disposition` = `attachment; filename*=UTF-8''Zmluva%20%C4%8D.%201.pdf`, `nosniff`, `cache-control` exact.
  - `an admin uploads to any group`; `a client of another group gets 404 on upload, download and preview`; `unknown group/file → 404`; `anonymous → 401`.
  - `an HTML file is served as attachment`; `a PNG declared as application/pdf is served inline as image/png`.
  - `content-length over 25 MB → 413 file_too_large`; `a chunked body over 25 MB → 413 and no row for the group` (inject with a `Readable` payload, no content-length).
  - `missing content-type stores application/octet-stream`; `missing x-file-name stores 'file'`.
  - `61st upload in a minute → 429 rate_limited` (fresh user; small bodies).
  - `storage failure → 500 and no row` (`vi.spyOn(deps.storage, 'put').mockRejectedValueOnce(...)`).
  - Preview: `the uploader sets a preview → 204; FileInfo hasPreview/width/height via getFilesForGroup; GET preview streams it`; `another member of the group → 403`; `on a PDF file → 400 invalid_preview`; `non-WebP body → 400 invalid_preview`; `width 0 or 'abc' → 400 invalid_preview`; `after attachFiles → 400 invalid_preview`; `> 300 KB → 413`; `GET preview without one → 404`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test` — FAIL.
- [ ] **Step 3: Implement** `routes.ts` per Interfaces; register in `app.ts`.
- [ ] **Step 4: Run** server tests, typecheck, lint, prettier check — PASS.
- [ ] **Step 5: Docs + commit** (overview: files module and its endpoints; permissions: file read = group read, 404 rule) `feat(server): files API`.

### Task 3: Notification events and daily cleanup jobs

**Files:**
- Create: `apps/server/src/modules/notifications/{schema.ts,service.ts,service.test.ts,jobs.ts}`, `apps/server/src/modules/files/jobs.ts`, `apps/server/src/modules/files/jobs.test.ts`, `packages/shared/src/notifications.ts`, generated migration
- Modify: `packages/shared/src/index.ts`, `apps/server/src/deps.ts`, `apps/server/test/test-app.ts`, `docs/architecture/data-model.md` (NotificationEvent added), `docs/architecture/overview.md` (notifications module, jobs), `docs/glossary.md` (notification event)

**Interfaces:**
- Consumes: Task 1 `deleteUnattachedFiles`, `FileDeps`; `JobHandlers` (`infra/jobs/jobs.ts`).
- Produces:
  - Table `notification_events`: `id` text PK (`randomUUID()`), `user_id` → `user.id` on delete cascade, `group_id` nullable → `groups.id` on delete cascade, `kind` text not null, `payload` jsonb not null, `created_at` timestamptz default now, `delivered_at` timestamptz nullable. Indexes `notification_events_user_delivered_idx (user_id, delivered_at)`, `notification_events_created_at_idx (created_at)`.
  - `recordNotifications` (see Interfaces for Phases 5 and 8): unique recipients, empty → no query, one multi-row insert; the caller decides who is a recipient (it does not drop the actor).
  - `deleteOldNotificationEvents(db: Db, olderThan: Date): Promise<number>`.
  - `NOTIFICATIONS_PURGE_JOB = 'notifications.purge-old'`, `notificationsJobHandlers(db: Db): JobHandlers` (cutoff now − 30 days).
  - `FILES_CLEANUP_JOB = 'files.cleanup-unattached'`, `filesJobHandlers(deps: FileDeps): JobHandlers` (cutoff now − 24 h).
  - `createDeps` spreads both handler sets into `startJobs` with schedules `{ name: FILES_CLEANUP_JOB, cron: '30 3 * * *' }`, `{ name: NOTIFICATIONS_PURGE_JOB, cron: '45 3 * * *' }`; `buildTestApp` spreads both into `createInlineJobs` (storage must be created before `jobs` there).

- [ ] **Step 1: Failing tests**
  - `recordNotifications inserts one row per unique recipient` — recipients `[a, b, a]` → 2 rows for this `kind`/`groupId` with the payload.
  - `recordNotifications rolls back with the caller's transaction` — inside `db.transaction`, record then throw; no rows for those recipients.
  - `recordNotifications with no recipients does nothing`.
  - `deleteOldNotificationEvents deletes only rows older than the cutoff` (age one row by a direct update).
  - `jobs.test.ts`: `the files cleanup job deletes an unattached 25 h old file and keeps a fresh one` — run via `deps.jobs.send(FILES_CLEANUP_JOB, {})` on `buildTestApp`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test` — FAIL.
- [ ] **Step 3: Implement** shared kinds, schema, `db:generate`, service, both `jobs.ts`, wire `deps.ts` and `test-app.ts`.
- [ ] **Step 4: Run** server and shared tests, typecheck, lint, prettier check — PASS.
- [ ] **Step 5: Docs + commit** `feat(server): notification events and daily cleanup jobs`.

### Task 4: Group people

**Files:**
- Modify: `apps/server/src/modules/groups/{service.ts,service.test.ts,routes.ts,routes.test.ts}`, `packages/shared/src/groups.ts`, `docs/architecture/permissions.md`, `docs/architecture/overview.md`

**Interfaces:**
- Consumes: groups policy and service (Phase 3).
- Produces: `GroupPersonSchema`, `GroupPersonListSchema`; `listGroupPeople(db, groupId)` — one query (`unionAll`): clients in `group_members` for the group with `email_verified = true`, `disabled_at is null`, `trim(name) <> ''`; plus users with role `admin`/`superadmin` and `disabled_at is null`; `isAdmin` set accordingly; ordered by `name`, `id`. `isGroupPerson(db, groupId, userId)` — the same condition for one user, `limit 1`. Route `GET /groups/:id/people`: `canReadGroup` else 404, unknown group 404, 200 `GroupPerson[]`.

- [ ] **Step 1: Failing tests**
  - Service: `listGroupPeople lists the group's named active clients and active admins` — includes a named client (`isAdmin: false`) and a fresh admin (`isAdmin: true`); excludes a removed client, an unnamed (unverified) client, a client of another group, a deactivated admin; result sorted by name.
  - `isGroupPerson`: true for the named client and an admin; false for a removed client, an unnamed client, another group's client, an unknown id.
  - Routes: `a client reads their group's people`; `an admin reads any group's people`; `a client of another group → 404`; `unknown group → 404`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test` — FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** server and shared tests, typecheck, lint, prettier check — PASS.
- [ ] **Step 5: Docs + commit** `feat(server): group people for mentions and assignees`.

### Task 5: Group rooms for admins

**Files:**
- Modify: `packages/shared/src/socket.ts`, `apps/server/src/infra/realtime/{socket.ts,rooms.ts,socket.test.ts}`, `docs/architecture/realtime.md`

**Interfaces:**
- Consumes: `canReadGroup`, `getGroup` (groups).
- Produces: `SocketEvents.groupJoin`/`groupLeave`, `GroupRoomPayload`, `GroupJoinAck` (shared); `emitToGroup` (rooms.ts). In `io.on('connection')`:
  - `group:join`: payload must be an object with a string `groupId` of 1..100 chars, else ack `{ ok: false, error: 'not_found' }`; `canReadGroup(socket.data.user, groupId, socket.data.groupId ?? null)` and `getGroup` exists → `socket.join(groupRoom(groupId))`, ack `{ ok: true }`; otherwise `not_found`. A missing ack function is tolerated (`ack?.(…)`).
  - `group:leave`: leaves `groupRoom(groupId)` unless it equals `socket.data.groupId`; ack `{ ok: true }` when given.

- [ ] **Step 1: Failing tests** (`socket.test.ts`, existing helpers):
  - `an admin joins any group room and receives emitToGroup events` — `emitWithAck('group:join', { groupId })` → `{ ok: true }`; `emitToGroup(test.app.io, groupId, 'test:event', { n: 1 })` arrives.
  - `an admin joining an unknown group gets not_found`; `a malformed payload gets not_found`.
  - `a client joining another group gets not_found and receives none of its events`.
  - `a client joining their own group gets ok`; `group:leave of their own group keeps them in it`.
  - `an admin leaves a group room and stops receiving its events`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test` — FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** server tests, typecheck, lint, prettier check — PASS.
- [ ] **Step 5: Docs + commit** (realtime: `group:<id>` joined by clients on connect and by admins through `group:join`; the two client → server events; `emitToGroup` after commit; drop the "per group channel/board" guesses in favour of the one group room) `feat(realtime): group rooms for admins`.

### Task 6: Web — shared file upload and display

**Files:**
- Create: `apps/web/src/features/files/{upload.ts,upload.test.ts,urls.ts,format-size.ts,format-size.test.ts,file-chip.tsx,image-preview.tsx,file-display.test.tsx}`
- Move: `apps/web/src/features/groups/resize-image.ts` → `apps/web/src/lib/resize-image.ts` (and its test); update `features/groups/group-form.tsx` (+ test mocks) imports
- Modify: locales, `docs/design/tokens.md` (file chip, image preview)

**Interfaces:**
- Consumes: Task 2 endpoints; `FileInfoSchema`; `ApiError` (`lib/api.ts`); `i18n`.
- Produces: everything in the Web block for files above.
  - `resizeImageWithSize(file, max)` — the current `resizeImage` body, also returning the original bitmap `width`/`height`; `resizeImage(file, max = 256)` becomes `(await resizeImageWithSize(file, max)).blob`.
  - `uploadFile`: `XMLHttpRequest` `POST /api/groups/<id>/files`, `withCredentials`, headers `Accept: application/json`, `Accept-Language: i18n.language`, `Content-Type: file.type || 'application/octet-stream'`, `X-File-Name: encodeURIComponent(file.name)`; `upload.onprogress` → `onProgress(loaded / total)`; non-2xx → `ApiError` with the parsed JSON body; network error → `ApiError` status 0; 2xx parsed with `FileInfoSchema`. Then, when `info.mime` is png/jpeg/webp: `resizeImageWithSize(file, 640)`; only if the blob type is `image/webp`, `fetch` `PUT /api/files/<id>/preview` with `x-image-width`/`x-image-height`; on success resolve `{ ...info, hasPreview: true, width, height }`. Any preview failure is swallowed (resolve `info`): the upload itself succeeded.
  - `formatFileSize`: `Intl.NumberFormat(language, { style: 'unit', unit: 'byte' | 'kilobyte' | 'megabyte', maximumFractionDigits: 1 })` with 1024 steps.
  - `<FileChip>`: one row — small inline SVG document icon (no icon library), name (truncated, full name in `title`), size; the whole chip is `<a href={fileUrl(id)} download aria-label={t('files.download', { name })}>`.
  - `<ImagePreview>`: when `hasPreview && width && height`, `<a href={fileUrl(id)} target="_blank" rel="noopener noreferrer" aria-label={t('files.openImage', { name })}>` around `<img src={previewUrl(id)} alt="" loading="lazy" decoding="async">` in a box with `aspect-ratio: width / height` and `max-width: min(100%, maxWidth px)` so the layout never jumps; otherwise renders `<FileChip>`.
- i18n (EN / SK): `files.download` "Download {{name}}" / "Stiahnuť {{name}}"; `files.openImage` "Open {{name}}" / "Otvoriť {{name}}".

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the file chip and image preview (egrant.sk tokens, no effects).
- [ ] **Step 1: Failing tests**
  - `upload.test.ts` (fake `XMLHttpRequest` class on `globalThis`, mocked `fetch`, `vi.mock('@/lib/resize-image')`): `sends the file with encoded name and type and resolves FileInfo`; `reports progress fractions`; `413 rejects with ApiError code file_too_large`; `an image gets a 640 px WebP preview PUT with width/height headers and resolves hasPreview true`; `a failed preview still resolves the uploaded FileInfo with hasPreview false`; `a PDF sends no preview`.
  - `format-size.test.ts`: `512` → `'512 byte'`-style per `Intl` for `en` (assert with the same `Intl` call, not a literal), `1536` → 1.5 kB, `26_214_400` → 25 MB.
  - `file-display.test.tsx`: `FileChip links to /api/files/<id> with download and shows name and size`; `ImagePreview renders the preview with the aspect ratio and opens the full file in a new tab`; `ImagePreview without a preview falls back to FileChip`.
  - Moved `resize-image.test.ts` passes; `resizeImageWithSize returns the original size`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test` — FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** web tests, typecheck, lint, prettier check, `pnpm --filter @spolu/web build` (initial JS unchanged: nothing here is eagerly imported) — PASS.
- [ ] **Step 5: Docs + commit** `feat(web): shared file upload, file chip and image preview`.

### Task 7: Web — avatar, group people and the group room hook

**Files:**
- Create: `apps/web/src/components/{avatar.tsx,avatar.test.tsx}`, `apps/web/src/features/groups/{use-group-people.ts,use-group-room.ts,use-group-room.test.tsx}`
- Modify: `apps/web/src/features/groups/api.ts` (`groupPeopleQuery`), `docs/design/tokens.md` (avatar), `docs/architecture/realtime.md` (web hook)

**Interfaces:**
- Consumes: Task 4 endpoint and `GroupPersonListSchema`; Task 5 events; `getSocket` (`lib/socket.ts`).
- Produces: `Avatar`, `avatarColor`, `groupPeopleQuery`, `useGroupPeople`, `useGroupRoom` (Web block above).
  - `avatarColor(userId)`: 32-bit FNV-1a hash of the id, index `hash % 5` into `['bg-brand-purple', 'bg-brand-pink', 'bg-brand-blue', 'bg-brand-coral', 'bg-success']`.
  - `<Avatar>`: round, `size` px square, white text weight 600, initials = first letter of the first and the last word of `name`, upper-cased (one word → one letter, empty → `?`); `aria-hidden` (the name is always shown next to it); font size ≈ `size * 0.4`.
  - `groupPeopleQuery(groupId)`: key `['groups', groupId, 'people']` so the existing `['groups']` invalidations after member changes refetch it.
  - `useGroupRoom(groupId)`: in `useEffect([groupId])`: `const join = () => socket.emit('group:join', { groupId }, (ack) => { if (ack?.ok) setJoins((n) => n + 1) })` (state `joins`, returned by the hook); if `socket.connected` join now; `socket.on('connect', join)`; cleanup: `socket.off('connect', join)` and, if connected, `socket.emit('group:leave', { groupId })`.

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the avatar (sizes 24/32/40, colors from the brand accents).
- [ ] **Step 1: Failing tests**
  - `avatar.test.tsx`: `the same id always gets the same color`; `the color is one of the five classes`; `ids spread over more than one color` (20 ids → ≥ 3 distinct); `initials 'Jana Nováková' → 'JN', 'eva' → 'E', '' → '?'`; `size sets width and height`.
  - `use-group-room.test.tsx` (mock `@/lib/socket` with a fake emitter: `on`, `off`, `emit`, `connected`): `joins on mount when connected`; `joins again on every connect event`; `leaves on unmount`; `switching groupId leaves the old room and joins the new one`; `does not emit while disconnected and joins on connect`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test` — FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** web tests, typecheck, lint, prettier check — PASS.
- [ ] **Step 5: Docs + commit** `feat(web): avatar, group people and group room hook`.

### Task 8: Web — group page tabs

**Files:**
- Create: `apps/web/src/features/groups/{group-layout.tsx,group-header.tsx,group-tabs.tsx,members-tab.tsx}`, `apps/web/src/features/chat/chat-tab.tsx`, `apps/web/src/features/tasks/tasks-tab.tsx`, `apps/web/src/features/groups/group-layout.test.tsx`
- Modify / remove: `apps/web/src/features/groups/group-page.tsx` (split into the files above, then delete it), `group-page.test.tsx` (its tests move to `group-layout.test.tsx`; the socket mock gains `emit`), `apps/web/src/router.tsx`, locales, `docs/design/tokens.md` (group tabs), `docs/product/groups.md` if it describes the group page

**Interfaces:**
- Consumes: Task 7 `useGroupRoom`; existing `GroupForm`, `GroupLogo`, `InviteBox`, `MembersList`, `groupQuery`.
- Produces:
  - Router: `groupRoute` (`/groups/$groupId`, existing 404 loader) gets `component: lazyRouteComponent(() => import('@/features/groups/group-layout'), 'GroupLayout')` and children: `groupIndexRoute` (`path: '/'`, `beforeLoad` → `redirect({ to: '/groups/$groupId/chat', params })`), `groupChatRoute` (`'chat'`, lazy `@/features/chat/chat-tab` `ChatTab`), `groupTasksRoute` (`'tasks'`, lazy `@/features/tasks/tasks-tab` `TasksTab`), `groupMembersRoute` (`'members'`, lazy `@/features/groups/members-tab` `MembersTab`). `homeRoute` sends a client to `/groups/$groupId/chat`.
  - `GroupLayout` puts the counter returned by `useGroupRoom` into `GroupRoomContext` (exported hook `useGroupRoomJoins()` in `features/groups/use-group-room.ts`).
- `GroupLayout`: reads `groupId` (`useParams({ strict: false })`), calls `useGroupRoom(groupId)`, renders `<GroupHeader>`, `<GroupTabs>`, `<Outlet />`; full content width.
  - `GroupHeader`: one line — `GroupLogo` at `size={40}`, name (`h1`, truncated), eGrant link, admin "Edit" button; editing shows `GroupForm` in its place (as today).
  - `GroupTabs`: `<nav aria-label={t('group.tabs.label')}>` with three TanStack `<Link>`s; the active link is the filled ink pill (`bg-primary text-primary-foreground`), the others the `secondary` pill, `h-8 px-4 text-tiny rounded-full`; one row at 390 px; `activeOptions` so only the current tab is active; `aria-current="page"` from the router.
  - `MembersTab`: `max-w-[720px]` column with `InviteBox` (admins) and `MembersList` — today's content unchanged.
  - `ChatTab` / `TasksTab`: muted centred empty-state text, no other logic.
- i18n (EN / SK): `group.tabs.label` "Group sections" / "Časti skupiny"; `group.tabs.chat` "Chat" / "Chat"; `group.tabs.tasks` "Tasks" / "Úlohy"; `group.tabs.members` "Members" / "Členovia"; `chat.placeholder` "The chat arrives in the next update." / "Chat pribudne v ďalšej aktualizácii."; `tasks.placeholder` "The task board arrives in the next update." / "Nástenka úloh pribudne v ďalšej aktualizácii." (top-level `chat.*` and `tasks.*` blocks are where Phases 5 and 8 add their keys).

- [ ] **Step 0: Invoke `frontend-design:frontend-design`** for the compact header and the tab pills (egrant.sk filter pills, 390 px and desktop).
- [ ] **Step 1: Failing tests** (`group-layout.test.tsx`, harness from today's `group-page.test.tsx`):
  - `/groups/g1 redirects to /groups/g1/chat and shows the chat placeholder`.
  - `the three tabs link to chat, tasks, members; the current one has aria-current="page"`; clicking Tasks shows the tasks placeholder, Members shows the members list.
  - `/ sends a client to /groups/<groupId>/chat`.
  - `the header shows the 40 px logo, name and eGrant link; Edit (admins only) opens the form in place`.
  - `the layout joins the group room` (socket mock `emit` called with `'group:join', { groupId: 'g1' }` when `connected: true`).
  - Every existing group-page test (invite box, members, remove/restore, client sees no admin controls, API 404 → not-found page) passes on `/groups/g1/members`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test` — FAIL.
- [ ] **Step 3: Implement** per Interfaces; delete `group-page.tsx` once nothing imports it.
- [ ] **Step 4: Run** web tests, typecheck, lint, prettier check, `pnpm --filter @spolu/web build` — PASS; initial JS still ≤ 200 kB gzip (update the figure in `docs/architecture/performance.md` if it moved).
- [ ] **Step 5: Docs + commit** `feat(web): group page tabs (chat, tasks, members)`.

### Task 9: End-to-end

**Files:**
- Modify: `e2e/groups.spec.ts`

**Interfaces:**
- Consumes: the whole stack (production build). Keep the single serial flow: production allows only a few code requests per minute; do not add a second client login.

- [ ] **Step 1: Update the flow:** after the admin opens the group, expect the URL to end with `/chat` and the chat placeholder (SK copy) visible; click "Úlohy" → `/tasks` and its placeholder; click "Členovia" → `/members`, read the invite field there. After the client's name step, expect the client URL `/groups/<id>/chat`, switch the same three tabs. The admin's removal step navigates to the group's `/members` URL.
- [ ] **Step 2: Run** `pnpm test:e2e` — PASS.
- [ ] **Step 3: Commit** `test(e2e): group page tabs for admin and client`.

### Task 10: Docs sweep and full CI

**Files:** as listed in the spec "Documentation updates in this phase" (`architecture/data-model.md`, `realtime.md`, `overview.md`, `permissions.md`, `docs/design/tokens.md`, `docs/glossary.md`), plus `.claude/skills/new-module/SKILL.md` ("Patterns from files": streaming raw-body upload scope, service called inside the caller's transaction, `emitToGroup` after commit) and `docs/roadmap.md` (link this plan; do not mark Phase 4 done).

- [ ] **Step 1:** Run the `update-kb` skill over `git diff phase-3...HEAD`; fix every stale statement (e.g. "admins join no group rooms yet", "File … planned").
- [ ] **Step 2:** `bash scripts/check-docs.sh phase-3` and `bash scripts/ci.sh` — PASS.
- [ ] **Step 3: Commit** `docs: phase 4 knowledge base sweep`.
