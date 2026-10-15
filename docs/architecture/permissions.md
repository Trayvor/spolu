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
| Remove a client from a group | yes | yes | no (assumed, confirm in the phase design) |
| Message users of other organizations | n/a | n/a | no |

## The rule

Permissions are enforced on the server, in one place per module. Each module exports policy functions such as `canReadGroup(user, groupId)`. The same functions are used by HTTP routes and by socket room joins, so there is one definition of "who may see what".

Client-side hiding of buttons and pages is cosmetic. The server never trusts the client.

User policy lives in `modules/users/policy.ts`: `isAdmin`, `canManageAdmins` (any admin) and `canDeactivate` (target is an admin, not the actor; the superadmin is never a target).

Policy functions are written test-first. To confirm in the Phase 3 design: a forbidden access returns an error that does not reveal whether the resource exists.

See [realtime.md](realtime.md) for room joins and [overview.md](overview.md) for module boundaries.
