# Groups and invites

A group is one client (organization). It has a name, a logo and the client's eGrant URL. Each group has a chat, a task board and a support (tickets) section. Admins create and edit groups, copy invite links, see the member list and can remove a client.

## Requirements

- **Group = one client (organization).**
- Group fields:
  - name;
  - logo;
  - **client URL in eGrant**: the link to the client's eGrant instance. It does not affect other functionality, but the server uses it to decide which group an incoming ticket belongs to (see `tickets.md`).
- Each group has these modules: chat (`chat.md`), task board (`task-board.md`), technical support / tickets (`tickets.md`). Contracts are admin-only (`contracts.md`).
- **Invite link:**
  - an administrator can **copy the invite link** for a specific group;
  - a new user who registers through it automatically lands in that group.
- Members list: the group shows its members.
- An admin can remove a client from a group.
- Global "All groups" section (admin only):
  - list of all groups and quick access to each;
  - create and edit a group (name, logo, client URL in eGrant);
  - copy the invite link of any group.

## Phase

Phase 3 (groups, invites, members list, removing a client).
