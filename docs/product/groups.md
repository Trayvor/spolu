# Groups and invites

A group is one client (organization). It has a name, a logo and the client's eGrant URL. Each group has a chat, a task board and a support (tickets) section. Admins create and edit groups, copy invite links, see the member list and can remove a client.

## Requirements

- **Group = one client (organization).**
- Group fields:
  - name;
  - logo;
  - **client URL in eGrant**: the link to the client's eGrant instance. It does not affect other functionality, but the server uses it to decide which group an incoming ticket belongs to (see `tickets.md`).
- Each group has these modules: chat (`chat.md`), task board (`task-board.md`), knowledge base (`knowledge-base.md`, Phase 17), technical support / tickets (`tickets.md`). Contracts are admin-only (`contracts.md`).
- **Invite link:**
  - an administrator can **copy the invite link** for a specific group;
  - a new user who registers through it automatically lands in that group;
  - the link is permanent until an admin generates a new one; the old link then stops working (404, "no longer valid");
  - entering an email on an invite link is limited to 10 per minute from one address (`JOIN_REQUESTS_PER_MINUTE`; the e2e server sets 200);
  - a client can belong to several groups (Phase 21): opening another group's link with the email of an existing client adds that group, but only after they sign in with the code sent to that email, so typing someone else's email never adds them anywhere;
  - a client who is already signed in sees "You are signed in as …" with **Join the group** instead of the email form, and joins at once (`POST /api/join/:token/accept`; an admin is sent to `/`; a membership an admin removed answers `403 removed`: "An eGrant admin removed you from this group.");
  - the invite is remembered until the person signs in, and the latest invite they used wins;
  - a person who is a requester (`ziadatel`, Phase 21) in the group becomes its client the same way;
  - a client removed from the group stays removed: the link does not bring them back, an admin restores them; a client whose every membership was removed is blocked and gets no code.
- Group page: tabs Chat, Tasks, Knowledge (Phase 17, sk "Znalosti") and Members, in that order (Chat opens first). Knowledge is described in `knowledge-base.md`.
- Members list (Members tab): the group shows its signed-in members (clients who have entered a code). Above them, "eGrant managers" lists the group's managers (avatar and name; "No eGrant manager yet." when there are none); admins add any active admin as a manager with "+ Add manager" (a menu of the admins who do not manage the group yet, by name, with a find field when there are more than 8; "Every administrator already manages this group." when none is left) and remove any manager with "Remove" on its row, without a confirmation. Clients only read the list.
- An admin can remove a client from a group and restore them from the removed list. The client loses only that group (its pages answer not found and its live events stop); when it was their last group they lose their sessions and sockets and get no new code.
- A client of several groups has "My groups" (`/my-groups`) in the header (in the user menu under 641 px): their groups with logo, name and unread count. `/` takes a client with one group straight into it and a client of several groups to "My groups".
- Global "All groups" section (admin only):
  - list of all groups and quick access to each;
  - create and edit a group (name, logo, client URL in eGrant);
  - copy the invite link of any group;
  - the Groups page (`/groups`, Phase 22a): the groups I manage come first, then the rest, by name inside each part. The title shows the count ("Groups 12"), or "Groups 3 of 12" while a filter is set. Each row's "Members: N" links to the group's Members tab. Hovering or focusing the manager avatars shows every manager's name in a small tooltip, including those behind "+N"; on touch a tap toggles it.
  - the manager filter, left of "All groups: …" on the same row (its own line above it on phones): Everyone, Me, No manager, then every other active admin by name. It lives in the URL as `?manager=me|none|<adminId>`; an id that is not an active admin (an old link) falls back to Everyone. With no match the page says "No groups for this filter." with "Clear filter".

## Phase

Phase 3 (groups, invites, members list, removing a client). Phase 22a: managers on the Members tab, the Groups page filter, order, count and member link.
