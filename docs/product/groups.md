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
  - a new user who registers through it automatically lands in that group;
  - the link is permanent until an admin generates a new one; the old link then stops working (404, "no longer valid");
  - a client belongs to exactly one group: opening another group's link with an email that is already a client does nothing;
  - a person who entered an email on an invite but never signed in follows the latest invite they used (a link cannot reserve someone else's email into a group); once they have signed in, other links do nothing;
  - a removed client is blocked: the link sends them no code, and an admin can restore them.
- Group page: three tabs, Chat, Tasks and Members (Chat opens first). Chat and Tasks are placeholders for now.
- Members list (Members tab): the group shows its signed-in members (clients who have entered a code). Above them, "eGrant managers" lists the group's managers (avatar and name; "No eGrant manager yet." when there are none); admins also get the link "Change on the Groups page".
- An admin can remove a client from a group and restore them from the removed list; a removed client loses sessions and sockets and gets no new code.
- Global "All groups" section (admin only):
  - list of all groups and quick access to each;
  - create and edit a group (name, logo, client URL in eGrant);
  - copy the invite link of any group.

## Phase

Phase 3 (groups, invites, members list, removing a client).
