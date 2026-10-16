# Permissions

Product rules are in [roles-and-access](../product/roles-and-access.md). In the product there are two roles, administrator and client; the superadmin is an administrator who cannot be deleted or demoted. In the database `User.role` is `superadmin | admin | client`.

| capability | superadmin | admin | client |
|---|---|---|---|
| See all groups | yes | yes | no, only their own group |
| Create groups, copy invite links | yes | yes | no |
| Read and write chat, tasks, tickets in a group | all groups | all groups | own group only |
| Contracts module | yes | yes | no (not shown at all) |
| Global tickets list ("Technical support") | yes | yes | no |
| Create other admins | yes | yes | no |
| Remove an admin | yes | yes | no |
| Be removed or demoted | never | yes, by another admin (never by themselves) | yes (assumed, confirm in the phase design) |
| Remove a client from a group | yes | yes | no (confirmed in Phase 3) |
| Message users of other organizations | n/a | n/a | no |

## The rule

Permissions are enforced on the server, in one place per module. Each module exports policy functions such as `canReadGroup(user, groupId)`. The same functions are used by HTTP routes and by socket room joins, so there is one definition of "who may see what".

Client-side hiding of buttons and pages is cosmetic. The server never trusts the client.

User policy lives in `modules/users/policy.ts`: `isAdmin`, `canManageAdmins` (any admin) and `canDeactivate` (target is an admin, not the actor; the superadmin is never a target).

Group policy lives in `modules/groups/policy.ts`: `canManageGroups` (any admin), `canReadGroup(actor, groupId, actorGroupId)` (any admin, or a client whose membership group is `groupId`; `actorGroupId` comes from `getMembershipGroupId`) and `canRemoveMember` (admin actor, client target). A group a caller may not read answers `404 not_found`, never 403, so group ids cannot be probed. `GET /api/groups/:id/people` follows `canReadGroup`; who counts as a person of the group (mentionable, assignable) is decided in `listGroupPeople` / `isGroupPerson`, not by a policy function: named, verified, active clients of the group and all active admins. Chat and tasks use `isGroupPerson` to validate mentions and assignees. Knowledge excerpts, search text and the calendar body show a mentioned name only for a member of the item's group or an admin; anyone else renders as `@?`.

File policy lives in `modules/files/policy.ts`: `canReadFile(actor, file, actorGroupId)` follows the file's group (`canReadGroup`; an unreadable file answers `404 not_found`), except that a file with `admins_only` set (a file of an admins-only knowledge item, Phase 17) is readable by admins only, so the group's clients get `404 not_found` for it, and `canSetPreview` allows the uploader only. Files API: anyone who reads the group may upload to it; a file unreadable to the caller answers `404 not_found` on download and preview alike, and `403 forbidden` is used only for a preview PUT by a reader who is not the uploader.

Task policy lives in `modules/tasks/policy.ts`: `canUseBoard(actor, groupId, actorGroupId)` (= `canReadGroup`: read the board, create, edit and move tasks, including with the done circle, clients included), `canManageBuckets` (any admin: create, rename and delete custom buckets, reorder every bucket) and `canDeleteTask(actor, task)` (any admin, or the client who created the task). A group, task or bucket the caller may not read answers `404 not_found`; `403 forbidden` is only for a readable resource the caller may not change (bucket management by a client, deleting someone else's task). Renaming or deleting a fixed bucket answers `400 fixed_bucket`; moving one is allowed.

| Task capability | Admin | Client (own group) |
|---|---|---|
| Read the board, open a task | yes | yes |
| Create, edit and move tasks (any task of the group) | yes | yes |
| Delete a task | any task | only tasks they created |
| Create, rename, delete custom buckets; reorder any bucket | yes | no (403) |
| Another group's board, task or bucket | yes (all groups) | 404 |
Chat policy lives in `modules/chat/policy.ts`: `canReadChannel(actor, channel, actorGroupId)` is `canReadGroup` on the channel's group, and `canEditMessage` / `canDeleteMessage` allow the message's author only and never a deleted message, so not even a superadmin edits or deletes someone else's message. A channel or message the caller cannot read answers `404 not_found`; someone else's message on edit or delete answers `403 forbidden`. A task chat (Phase 9) is the task's group's chat for permissions: whoever can read the task's group reads and writes it, admins and clients alike, exactly like the group chat, and its mentions and @all reach the same people (the group people). `GET /api/tasks/:id/chat` checks `getTaskRef` and `canReadGroup` on the task's group before it creates the channel; a missing task, a malformed id and a task of another group answer `404 not_found`. Every later route (messages, threads, read marks) goes through `canReadChannel` like the group chat. The routes that start from a message id use `findReadableMessage` (`modules/chat/messages.ts`): the message and its channel, or null when either is missing or the channel is unreadable.

Knowledge policy lives in `modules/knowledge/policy.ts` (Phase 17):

- `canReadItem(actor, item, actorGroupId)`: `canReadGroup` on the item's group, and the item is `public` or the actor is an admin. Admins-only items are visible to every admin (not only managers). An unreadable item answers `404 not_found`, exactly like a missing one, in the detail, the edit, the delete and the reminder endpoints; the tab's list filters clients to `visibility = 'public'` in SQL, so search cannot reach a hidden item either.
- `canEditItem(actor, item, actorGroupId)` = `canDeleteItem`: a readable item, and the actor is an admin or its author. A readable item the actor may not change answers `403 forbidden`.
- `canSetVisibility(actor, item, visibility)`: `admins` needs an admin actor and an admin author (`item` is null on create, where the author is the actor). A client's own item always stays public: a client cannot create an admins-only item and an admin cannot make a client's item admins-only (`400 invalid_visibility`). An admin's item can switch either way, by any admin.
- Files follow the item: the knowledge service sets `files.admins_only` (`setFilesAdminsOnly`) on the item's files when they join an admins-only item and on all of them when the visibility changes, inside the item's transaction. Switching an item to admins-only also drops its non-admin reminder recipients (`pruneRecipientsForAdminsOnly`).
- The global list (`listAllItems`, `GET /api/knowledge`) and `GET /api/knowledge/scope` are for admins only: the service does no actor check there, so the routes use `requireAdmin` (a client gets `403 forbidden`). Without a `clients` filter the scope is `managedGroupIdsOf(admin)`; null or `[]` means every group.
- Realtime: an admins-only item's events go only to the group's admins room (`group:<id>:admins`), which only admin sockets join; a client socket never receives them (see [realtime.md](realtime.md)).

Reminders (`modules/reminders`, Phase 17) have no policy file of their own: each subject kind registers an adapter (`registerReminderSubject` in `subjects.ts`) whose `canRead(actor, actorGroupId)` and `canEdit(actor)` decide, so a reminder is exactly as visible as its knowledge item (Phase 19: its task). The service takes the actor and enforces it:

- **Reading** a set (`getReminderSet`) and the calendar file (`buildIcs`) need `canRead`; an unreadable subject answers like a missing one (null, so 404). `subscribe` and `unsubscribe` throw `NotReadableError` (404) for it, and `NoReminderSetError` (404 `no_reminder_set`) for a readable subject without reminders.
- **Editing** the times and the added recipients (`replaceReminderSet`) happens inside the owner's write, which has checked `canEdit` already (knowledge: the author and admins).
- **Recipients** are explicit: the subject's author (source `author`, always kept, cannot unsubscribe: `400 author_recipient`), people the author or an editor added (`added`) and people who subscribed themselves (`subscribed`). Added people must be people of the subject's group (`getGroupPeopleRoles`, the `isGroupPerson` condition for many ids in one query) and, for an admins-only subject, be admins; at most 50 (`400 invalid_recipient`). Anyone who can read the subject may subscribe, not only the picker's people. Unsubscribing deletes the caller's row whatever its source, so an added person can opt out. When a subject becomes admins-only, `pruneRecipientsForAdminsOnly` drops every non-admin row except the author's.
- **Delivery** reaches every recipient even when their group mode is Off, because each one chose this reminder (ruling of the Phase 17-20 brief); they leave it with "Remind me". `listUpcomingForUser` lists only sets the user is a recipient of, for a client only in their current group (filtered in SQL), and drops subjects they can no longer read.

Who is calling comes from the session cookie, read in `modules/auth/session.ts`. Routes use the preHandlers `requireUser(app.auth)` (no valid session: `401 {"error":"unauthorized"}`) or `requireAdmin(app.auth)` (no session: 401; not `isAdmin`: `403 {"error":"forbidden"}`); both set `request.user` (`SessionUser`). A disabled user counts as logged out even if a session row still exists. Finer checks (which group, which admin) call the module's policy functions with `request.user` before the service. State-changing requests from another site are refused earlier by the CSRF guard (see [overview.md](overview.md), "CSRF guard").

Notification settings (`modules/notifications/routes.ts`) are about the signed-in user only: every handler acts on `request.user`, and there is no route that names another user. Any signed-in user reads and changes their own preferences and push subscriptions (a `DELETE` of someone else's endpoint deletes nothing and still answers 204). A user sets a per-group mode only for a group `canReadGroup` allows, otherwise `404 not_found`. Only an admin sets the all-groups default mode (`PUT /api/notifications/modes/default`, a client gets `403 forbidden`); setting it also deletes that user's per-group overrides. The effective mode is the per-group override, then the user's default, then the role default (client `all`, admin `mentions`).

The profile routes (`modules/auth/routes.ts`) change only the signed-in user themselves: `PATCH /api/me` (name), `PUT /api/me/language`, `POST /api/me/email-change` and `POST /api/me/email-change/confirm` act on `request.user` and take no user id, so no one, not even a superadmin, changes another user's name, language or email there. An email-change request is stored under `email-change:<userId>` and holds the new address, so a code confirms only its own user's change to that one address; anyone else confirming it gets `400 invalid_code`. The superadmin cannot change their email and no one can take `SUPERADMIN_EMAIL` (`400 validation_failed`), because `ensureSuperadmin` keys the superadmin on that address; it also never promotes an existing admin or client row.

Policy functions are written test-first. Confirmed in Phase 3: reading a resource you may not read answers 404, the same as a missing one.

See [realtime.md](realtime.md) for room joins and [overview.md](overview.md) for module boundaries.
