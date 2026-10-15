# Spolu — Phase 3: Groups & invites (design)

Date: 2026-10-15 · Status: approved by the owner in brainstorming, written spec awaiting review

Requirements: [groups](../../product/groups.md), [auth](../../product/auth.md), [roles-and-access](../../product/roles-and-access.md). Roadmap entry: [Phase 3](../../roadmap.md#phase-3--groups--invites). Builds on [Phase 2](2026-10-15-phase-2-login-and-users-design.md).

Built on branch `phase-3`, cut from `phase-2`. Phase 2 is complete in code and awaits the owner's walkthrough; server deployment is deferred (roadmap "Server deployment (deferred)").

## Goal

An admin creates a group (one client organization) with a name, a logo and the client's eGrant URL, and copies its invite link. A client opens the link, confirms their email with a code, enters their name and lands in their group, seeing only that group. An admin can remove a client and restore them.

## Owner decisions (brainstorming, 2026-10-15)

| question | decision |
|---|---|
| Invite link | One permanent link per group. An admin can generate a new one; the old one stops working at once. |
| Client's name | Asked once, right after the code: one field "How should we call you?". |
| Removed client | Blocked: cannot log in or rejoin through the invite. An admin can restore them from the group's "Removed members" list. |
| Logo handling | Resized in the browser to at most 256×256 WebP before upload; the server validates type (by content) and size and stores it. No new dependency. Rejected: server-side `sharp` (heavy native dependency), logos in the database (bloats DB and backups). |

Controller rulings (technical, owner informed):

- One client belongs to exactly one group. A client of group A who opens group B's invite simply logs in and lands in group A (no move between groups).
- Access to a group the user may not read answers **404 `not_found`**, the same as a missing group, so existence is never revealed (resolves the open point in `permissions.md`).
- Admins are not group members; they see every group.
- The members list shows clients of the group (admins are not listed). Clients who entered an email but never confirmed a code are not shown.

## User experience

All copy below is the English source; Slovak goes in `sk.json`. Every string is an i18n key.

### Admin: "Groups" (`/groups`)

- New header link "Groups" (admins only; under 641 px it moves into the user menu like "Admins").
- List of all groups ordered by name: logo (40 px, rounded; a neutral placeholder with the first letter when there is none), name, number of members. Primary button "Create group". Each row opens the group page.
- Empty state: "No groups yet. Create the first one for a client."

### Create / edit group

Inline form on the list page ("Create group") and on the group page ("Edit"), no modal: "Name" (required, 1–100), "Client's eGrant URL" (required, a valid http(s) URL; stored normalized), "Logo" (optional file input with a preview; PNG, JPEG or WebP). Buttons "Save" / "Cancel". Errors: "Enter a name.", "Enter a valid URL.", "Another group already uses this eGrant URL.", "The logo must be a PNG, JPEG or WebP image up to 512 KB." (after resizing this only fails for broken files).

### Group page (`/groups/:id`)

- Header: logo, name, eGrant URL (link, opens in a new tab). Admins see "Edit".
- **Invite** (admins only): the full invite URL in a read-only field, "Copy" (status "Link copied."), "Generate new link" with an inline confirmation "The old link will stop working. Generate a new one?" → "Generate" / "Cancel".
- **Members**: name, email; "You" badge for the client themselves. Admins see "Remove" per row with an inline confirmation "Remove {name}? They lose access at once." → "Remove" / "Cancel". Empty: "No members yet. Send the invite link to the client."
- **Removed members** (admins only, collapsed `<details>` with a count): name, email, "Restore".
- Chat, tasks and support arrive in later phases; nothing is shown for them yet.

### Client

- After login a client goes straight to their group page (`/` redirects there). They see no "Groups" or "Admins" links. Opening another group's URL shows the not-found page.

### Join (`/join/:token`, public)

1. The page shows the group's logo and name: "Join {group}" and "Enter your work email. We will send you a login code." Field "Email", button "Send code". A logged-in user who opens the link is sent to `/` (their own group, or the groups list for an admin).
2. Code step: the same component and behaviour as `/login` (6 digits, resend after 30 s, change email, same errors).
3. If the user has no name yet: "How should we call you?" — field "Your name", button "Continue". This step also appears for any logged-in user with an empty name before any other page.
4. The user lands on their group page.

An unknown or replaced token: "This link is no longer valid. Ask eGrant for a new one." with no form.

## Architecture

### Groups module (`modules/groups`)

Follows the `new-module` skill.

- `schema.ts`:
  - `groups`: `id` text PK (uuid), `name` text not null, `logo_key` text null, `egrant_url` text not null unique (normalized origin), `invite_token` text not null unique, `created_at`, `updated_at` timestamptz.
  - `group_members`: `user_id` text PK → `user.id` on delete cascade (one group per client), `group_id` text not null → `groups.id` on delete cascade (indexed), `created_at` timestamptz.
- `policy.ts` (test-first): `canManageGroups(actor)` = admin; `canReadGroup(actor, groupId, membership)` = admin, or a client whose membership group is `groupId`; `canRemoveMember(actor, target)` = admin actor and client target.
- `service.ts`: `listGroups(db)` (with member counts, one query), `getGroup(db, id)`, `createGroup`, `updateGroup`, `regenerateInvite`, `getGroupByInviteToken`, `getMembershipGroupId(db, userId)`, `listMembers(db, groupId, { removed })` (verified clients only), `addMember(db, groupId, userId)`, `setLogo(db, id, key)`. Unique-violation on `egrant_url` maps to `EgrantUrlTakenError`.
- `normalizeEgrantUrl(url)`: lower-case scheme and host, drop default port, path, query, fragment and trailing slash (origin only). Shared with Phase 12 ticket matching.
- Invite tokens: 32 characters from `crypto.randomBytes` (base64url).

### Endpoints

| method | path | who | result |
|---|---|---|---|
| GET | `/api/groups` | admin | `GroupSummary[]` (`id, name, hasLogo, memberCount`) |
| POST | `/api/groups` | admin | 201 `Group`; 400 `validation_failed`; 409 `egrant_url_taken` |
| GET | `/api/groups/:id` | reader | `Group` (`id, name, egrantUrl, hasLogo, updatedAt`; `inviteUrl` for admins only); 404 otherwise |
| PATCH | `/api/groups/:id` | admin | `Group`; 400; 404; 409 |
| PUT | `/api/groups/:id/logo` | admin | raw body (`image/png`, `image/jpeg`, `image/webp`), ≤ 512 KB, type sniffed from magic bytes; 204; 400 `invalid_logo`; 413 |
| DELETE | `/api/groups/:id/logo` | admin | 204 |
| GET | `/api/groups/:id/logo` | reader | the image, `Cache-Control: private, max-age=86400`, ETag from the key; the web adds `?v=<updatedAt>` to bust caches |
| POST | `/api/groups/:id/invite` | admin | new `inviteUrl` |
| GET | `/api/groups/:id/members` | reader | `Member[]` (`id, name, email`) |
| GET | `/api/groups/:id/members/removed` | admin | `Member[]` |
| DELETE | `/api/groups/:id/members/:userId` | admin | 204: deactivate, revoke sessions, disconnect sockets; 403 for a non-client target; 404 when not a member of this group |
| POST | `/api/groups/:id/members/:userId/restore` | admin | 204: clear `disabled_at` |
| GET | `/api/join/:token` | public | `{ name, hasLogo, logoUrl }` or 404 |
| GET | `/api/join/:token/logo` | public | the logo |
| POST | `/api/join/:token` | public | `{ email }` → always 200 `{ ok: true }` for a valid token (404 for an invalid one); rate-limited 10 per minute per IP |
| PATCH | `/api/me` | user | `{ name }` → updated `SessionUser` (own name only) |
| GET | `/api/me` | user | `SessionUser` plus `groupId` (null for admins) |

`POST /api/join/:token` behaviour: normalize the email; if no user has it, create a client (`role client`, empty name, `email_verified false`) and add the membership in one transaction; any existing user (admin, client of any group, disabled) is left unchanged. The response is identical in every case. The web then requests a code through the normal better-auth endpoint. better-auth's `disableSignUp` stays on.

Verified: better-auth sets `email_verified = true` on a successful code sign-in, so "unverified" means "never confirmed a code". The members list filters on it.

### Removing and restoring a client

Reuses Phase 2's building blocks through the users and auth services: `deactivateUser` + `revokeAllSessions` + `disconnectUser`. Restore = `reactivateUser(db, id)` (new users service function). Membership rows stay, so a restored client returns to the same group. Disabled users already get no code and no session (Phase 2).

### Logo storage

Key `groups/<groupId>/logo-<random>.<ext>`; replacing deletes the old file after the DB update commits. Served through the app (`GET /api/groups/:id/logo` with the policy check, `/api/join/:token/logo` public) — no signed URLs needed in this phase. The browser resizes with a `<canvas>` to fit 256×256 and encodes WebP (quality 0.85); an SVG is not accepted.

### Realtime

A socket joins `group:<id>` on connect: a client joins their membership group; admins join no group rooms yet (Phase 4 adds explicit joins per open group). Helper `groupRoom(id)` in `infra/realtime/rooms.ts`. No group events are emitted in this phase.

### Web

- `features/groups/`: groups list, group form (shared by create and edit), group page, members list, removed members, invite box, logo resize helper (`resizeImage(file): Promise<Blob>`).
- `features/join/`: join page (reuses the login code step component).
- `features/auth/`: name step (`/welcome`), guard: a session with an empty name is redirected to `/welcome?redirect=…`; `/` redirects a client to `/groups/<groupId>` and an admin to `/groups`.
- Routes `/groups`, `/groups/$groupId`, `/join/$token`, `/welcome` are lazy chunks. Initial JS stays within 200 kB gzip.

### Carried over from Phase 2

- Socket: on `server_error`, reconnect with backoff (1 s, 2 s, 4 s … max 30 s); on sign-out the server disconnects that session's sockets (store the session id in `socket.data`); after `join` re-check `disabled_at` to close the remove-during-handshake race.
- Daily pg-boss cron job deleting expired `verification` rows.
- DB CHECK constraints: `user.role in ('superadmin','admin','client')`, `user.email = lower(user.email)`.
- E2E: one stored state per role (superadmin from setup; the client logs in once in a setup step) to stay within the per-IP code limit.

### Storage hardening (roadmap)

Strict signature format (64 lower-case hex) in `verifySignature`; atomic writes (temp file + rename for data and sidecar); `/files` added to the service worker `navigateFallbackDenylist`; the signature query parameter is not logged; the `files` volume is included in the nightly backup (tar alongside `pg_dump`, same retention).

## Error handling

- Our routes answer `{ error: '<code>' }`: `validation_failed` 400, `invalid_logo` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, `egrant_url_taken` 409, 413 for a too-large body, 429 for the join rate limit.
- Reading a group you may not read is 404, never 403.
- The web maps codes to translated messages; unknown → `errors.generic`.

## Testing

Test-first for policies and server logic.

- Policy table: actor superadmin/admin/client(own group)/client(other group)/client(no group) × read group, manage groups, remove member (client target, admin target, self).
- Server (real DB, Mailpit): create/edit; duplicate eGrant URL (also differing only in case or trailing slash) → 409; regenerate invite invalidates the old token; join with a new email creates an unverified client + membership and a code arrives; join with an existing admin / client of another group / disabled client changes nothing and returns the same body; unverified clients are not listed; a client reading another group → 404; client cannot list groups (403) or edit (403); remove → `/api/me` 401 and socket disconnected; restore → can log in again; removing an admin through the members route → 403; `PATCH /api/me` changes only the caller's name; logo: wrong type by content, > 512 KB, valid PNG stored and served with cache headers, replacing deletes the old file; join rate limit 429.
- Carried-over items and storage hardening each get a focused test (backoff timer, sign-out disconnects sockets, cron deletes only expired rows, CHECK rejects an upper-case email, malformed signature rejected, atomic write leaves no partial file).
- Web: group form validation and errors; logo resize helper (mocked canvas); invite copy and regenerate confirmation; members remove/restore; join flow incl. invalid token; name step; client sees no Groups link and `/` goes to their group.
- E2E: admin creates a group with a logo and copies the invite; a second context joins with a new email (code from Mailpit, name step) and sees only its group; the admin removes the client and the client's next navigation lands on `/login`.

## Done when

Walked by hand with the owner on the local production-like stack (later again on the test server):

1. The owner creates a group with a logo and copies the invite link.
2. Opening the link in another browser window with another email, entering the code and a name, the client sees only their group.
3. The owner removes the client; the client loses access at once.

## Documentation updates in this phase

`product/groups.md` and `product/auth.md` (decisions above), `architecture/permissions.md` (group rules, 404 rule, client removal confirmed), `architecture/data-model.md` (Group, GroupMember built), `architecture/realtime.md` (group rooms, reconnect backoff, sign-out disconnect), `architecture/overview.md` (groups module, join flow, logo storage), `design/tokens.md` (screens as built), runbooks (files volume backup and restore), `glossary.md` (invite link, removed member).

## Out of scope

Deleting or archiving a group; moving a client between groups; several groups per client; chat, tasks and tickets inside the group; group events over sockets; signed file URLs for attachments (Phase 5).
