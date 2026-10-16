# Roles and access

There are exactly two roles: Administrator and Client. Administrators see the whole system; clients see only their own group. The superadmin is an administrator with extra protection (see `auth.md`).

## Requirements

- Roles:

  | Role | What they see and can do |
  |---|---|
  | **Administrator** | Sees the **whole system**: all groups, the global "Contracts" and "Technical support" sections. Creates groups, generates invite links. |
  | **Client** | Sees **only their own group**: chat, task board, tickets. **The "Contracts" module is unavailable to a client and is not shown at all.** |

- No other roles exist.
- A client is an organization. One group can contain many users from one client, and one person can be a client of several groups (Phase 21).
- A person's role is per group (Phase 21): `client` sees the whole group; `ziadatel` (requester) sees only their own tickets of that group, never its chat, tasks, knowledge or members. A person with only requester memberships has a narrow app: `/` opens **My tickets** (`/tickets`), the header shows only Tickets and the user menu, and every group address answers not found. The same person can be a client of one group and a requester in another.
- A client sees only their own group; an administrator sees all groups.
- A client cannot see users of other organizations and cannot write to them (see `direct-messages.md`).
- The superadmin is an administrator who cannot be deleted or demoted (see `auth.md`).

## Phase

Phase 2 (users and the superadmin) and Phase 3 (a client sees only their own group; an admin sees all). Contract hiding applies in Phase 14.

A group manager is not a third role: it is a per-group flag on an administrator (an eGrant account manager for that client). A group has several managers and an admin can manage several groups. Every admin still reads every group; being a manager only makes the admin a pickable person (assignable) in that group, beside its clients.
