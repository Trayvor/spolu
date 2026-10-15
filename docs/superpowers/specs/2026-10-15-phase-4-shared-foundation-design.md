# Spolu — Phase 4: Shared foundation (design)

Date: 2026-10-15 · Status: approved by the owner in brainstorming, written spec awaiting review

Requirements: [chat](../../product/chat.md), [task-board](../../product/task-board.md), [notifications](../../product/notifications.md). Roadmap entry: [Phase 4](../../roadmap.md#phase-4--shared-foundation). Builds on [Phase 3](2026-10-15-phase-3-groups-and-invites-design.md).

Built on branch `phase-4`, cut from `phase-3`. Phases 5 (chat) and 8 (task board) are then built in parallel, each on its own branch cut from `phase-4` (see the roadmap "Order of Phases 4–9").

## Goal

Build once what both the chat and the task board need, so the two parallel branches never edit the same files: stored files with group permissions, a table of notification events, the list of a group's people with avatars, group socket rooms for admins and the group page tabs.

## Owner decisions (brainstorming, 2026-10-15)

| question | decision |
|---|---|
| Order | Phase 4 first, then chat (5) and task board (8) in parallel, then Phase 9 joins them, then notifications (6). |
| Notifications | Phases 5, 8 and 9 only record events; Phase 6 delivers them (push, email, modes). |
| Reuse | One component per idea: one chat component for group and task chat, one task form for the board and the AI review, one file upload for messages and tasks. |

Controller rulings (technical, owner informed):

- Files are uploaded as the raw request body (no multipart dependency), the same way as group logos.
- Image previews are made in the browser (like logos) and uploaded as a second request. No `sharp`.
- Group events go to the existing `group:<id>` room; chat and board both use it (no per-channel rooms). Admins join it explicitly for the group they have open.

## User experience

All copy is the English source; Slovak goes in `sk.json`.

### Group page tabs

`/groups/:id` gets three tabs under the group header: **Chat** (`/groups/:id/chat`), **Tasks** (`/groups/:id/tasks`), **Members** (`/groups/:id/members`). `/groups/:id` redirects to `/groups/:id/chat`; a client's `/` keeps redirecting to their group (now landing on Chat).

- The header (logo, name, eGrant link, admin "Edit") stays above the tabs and becomes compact (logo 40 px, one line) so the chat and board get the height.
- Tabs are links (TanStack Router), styled as the egrant.sk filter pills: the active tab is the filled ink pill, the others `secondary`. Keyboard: normal link focus.
- Members tab: today's invite box (admins) and members list, unchanged.
- Chat and Tasks tabs: an empty state ("The chat arrives in the next update." / "The task board arrives in the next update.") until Phases 5 and 8 replace them. Each tab's page lives in its own feature folder (`features/chat/chat-tab.tsx`, `features/tasks/tasks-tab.tsx`) so the parallel branches only touch their own folder.
- Under 641 px the tabs stay in one row (three short words fit at 390 px).
- The page uses the full content width for Chat and Tasks (no 720 px cap); Members keeps the 720 px cap.

## Architecture

### Files module (`modules/files`)

Table `files`:

| column | type | notes |
|---|---|---|
| `id` | text PK | random id (same generator as other tables) |
| `group_id` | text, FK `groups.id` on delete cascade, indexed | every file belongs to one group |
| `uploaded_by` | text, FK `user.id` | |
| `name` | text | original file name, trimmed, max 255 chars, path separators removed |
| `mime` | text | type sniffed for images, otherwise the declared type (default `application/octet-stream`) |
| `size` | integer | bytes |
| `storage_key` | text | `files/<groupId>/<id>` |
| `preview_key` | text, nullable | browser-made WebP preview of an image |
| `width`, `height` | integer, nullable | of the image (sent with the preview) |
| `attached_at` | timestamptz, nullable | set by the module that uses the file; null = not used yet |
| `created_at` | timestamptz | |

Service (`modules/files/service.ts`), the only way other modules touch files:

- `createFile(deps, { groupId, uploadedBy, name, declaredType, body: Readable })` streams to storage, enforcing the 25 MB limit while streaming (a larger body is aborted and nothing is kept), sniffs image types with the existing `sniffImageType` (moved to `modules/files/sniff.ts`, groups import it from there).
- `attachFiles(tx, groupId, fileIds, userId)` — sets `attached_at`; throws `invalid_attachment` unless every file exists, belongs to `groupId`, was uploaded by `userId` and is not attached yet. Used by chat (Phase 5) and tasks (Phase 8) inside their own transaction.
- `getFilesForGroup(db, groupId, ids)` — the public shape `FileInfo { id, name, mime, size, width, height, hasPreview }` (in `packages/shared`).
- `deleteFiles(deps, ids)` — removes rows and storage objects (used when a task or message is deleted).

Endpoints (all `requireUser`, all group checks through `canReadGroup`, an unreadable group or file answers 404):

| method | path | what |
|---|---|---|
| POST | `/api/groups/:id/files` | raw body = the file; headers `content-type` and `x-file-name` (URI-encoded). 201 `FileInfo`. Over 25 MB: 413 `file_too_large`. Rate limit 60/min per user. |
| PUT | `/api/files/:id/preview` | raw WebP body ≤ 300 KB, headers `x-image-width`, `x-image-height`; only the uploader, only while `attached_at` is null and the file is an image. 204. |
| GET | `/api/files/:id` | streams the file. Images: `content-disposition: inline`; everything else: `attachment; filename*=UTF-8''…`. Always `x-content-type-options: nosniff` and `cache-control: private, max-age=31536000, immutable` (files never change). |
| GET | `/api/files/:id/preview` | the preview, same caching; 404 when there is none. |

`DELETE` is not exposed; files are deleted through the module that owns their use.

Cleanup: pg-boss cron job `files.cleanup-unattached` daily at 03:30 deletes files with `attached_at IS NULL` older than 24 hours (row and storage objects).

Web: `features/files/` with `uploadFile(groupId, file, onProgress)` (XHR for upload progress; images are resized with the existing `resize-image.ts`, moved to `lib/`, to a ≤ 640 px WebP preview and sent with `PUT …/preview` after the upload), `<FileChip>` (icon, name, size, download link) and `<ImagePreview>` (preview with fixed aspect ratio from `width`/`height` so the layout never jumps; click opens the full image in a new tab). Phase 5 and Phase 8 use these, not their own.

### Notification events (`modules/notifications`)

Table `notification_events`: `id`, `user_id` (recipient, FK on delete cascade, indexed with `delivered_at`), `group_id` (nullable FK), `kind` (text), `payload` (jsonb), `created_at`, `delivered_at` (nullable; Phase 6 sets it).

`recordNotifications(tx, { kind, groupId, recipients: string[], payload })` inserts one row per recipient, skipping duplicates within the call. `kind` is a string union exported from `packages/shared` (`NotificationKind`), extended by each phase: Phase 5 adds `chat.message`, `chat.mention`, `chat.thread_reply`; Phase 8 adds `task.moved`, `task.assigned`. Nothing reads the table until Phase 6. A daily job deletes rows older than 30 days.

### Group people and avatars

Both the chat (mentions) and the board (assignee) list the same people, so they are built once here:

- `GET /api/groups/:id/people` (groups module, `canReadGroup`): the group's clients who are not removed and have a name, and all active admins, `{ id, name, isAdmin }[]`, ordered by name. `isGroupPerson(db, groupId, userId)` in the groups service is what chat and tasks use to validate a mention or an assignee.
- Web: `useGroupPeople(groupId)` (TanStack Query, cached per group, refetched when members change) and `components/avatar.tsx` `<Avatar userId name size />`: initials on a background chosen from the brand accents (`brand-purple`, `brand-pink`, `brand-blue`, `brand-coral`, `success`) by a stable hash of the user id, text white, weight 600.

### Group rooms for admins

Two socket events (client → server, with an ack; the only socket messages a client sends besides `system:ping`, and they change no data):

- `group:join` `{ groupId }` → ack `{ ok: true }` or `{ ok: false, error: 'not_found' }`. The server checks `canReadGroup` and joins `group:<id>`. A client may only join their own group (already joined on connect, ack `ok`).
- `group:leave` `{ groupId }` → leaves the room (no-op for a client's own group).

Web: `useGroupRoom(groupId)` in `features/groups/` joins on mount and after every reconnect, and leaves on unmount. The group layout (the tabs page) calls it, so chat and board both get live events.

Server helper: `emitToGroup(io, groupId, event, payload)` in `infra/realtime/rooms.ts`; modules call it after their transaction commits.

## Error handling

New error codes in `packages/shared` `ErrorCodes`: `file_too_large`, `invalid_attachment`, `invalid_preview`. A storage failure during upload answers 500 and leaves no row. Unreadable group/file: 404 `not_found`.

## Testing

- Files: upload and download by a member; another group's client gets 404; 25 MB limit (stream aborted, no row, no storage object); name sanitising; preview only by the uploader and only for images; `attachFiles` refuses another group's file, another user's file and an attached file; cleanup job deletes only old unattached files.
- Notifications: `recordNotifications` inserts one row per unique recipient in the caller's transaction (rolled back with it).
- People: clients of the group and active admins, not removed or nameless clients, not other groups' clients; 404 for an unreadable group. Avatar: same user always gets the same color.
- Rooms: an admin joins any group room; a client joining another group gets `not_found`; rejoin after reconnect (web hook test).
- Web: tabs route and redirect; a client lands on their group's Chat tab; Members tab shows today's content.
- E2E: an admin opens a group, switches the three tabs; a client does the same.

## Done when

On the group page an admin and a client switch between Chat, Tasks and Members; a file uploaded to a group can be downloaded by its members only (API test); notification events can be recorded (test).

## Documentation updates in this phase

`architecture/data-model.md` (File built, NotificationEvent added), `architecture/realtime.md` (group join/leave, `emitToGroup`), `architecture/overview.md` (files and notifications modules), `architecture/permissions.md` (files), `docs/design/tokens.md` (group tabs), glossary (notification event).

## Out of scope

Chat (Phase 5), task board (Phase 8), delivery of notifications (Phase 6), virus scanning of uploads, storage quotas.
