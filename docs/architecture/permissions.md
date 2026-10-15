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

Group policy lives in `modules/groups/policy.ts`: `canManageGroups` (any admin), `canReadGroup(actor, groupId, actorGroupId)` (any admin, or a client whose membership group is `groupId`; `actorGroupId` comes from `getMembershipGroupId`) and `canRemoveMember` (admin actor, client target). A group a caller may not read answers `404 not_found`, never 403, so group ids cannot be probed.

Who is calling comes from the session cookie, read in `modules/auth/session.ts`. Routes use the preHandlers `requireUser(app.auth)` (no valid session: `401 {"error":"unauthorized"}`) or `requireAdmin(app.auth)` (no session: 401; not `isAdmin`: `403 {"error":"forbidden"}`); both set `request.user` (`SessionUser`). A disabled user counts as logged out even if a session row still exists. Finer checks (which group, which admin) call the module's policy functions with `request.user` before the service. State-changing requests from another site are refused earlier by the CSRF guard (see [overview.md](overview.md), "CSRF guard").

Policy functions are written test-first. Confirmed in Phase 3: reading a resource you may not read answers 404, the same as a missing one.

See [realtime.md](realtime.md) for room joins and [overview.md](overview.md) for module boundaries.
