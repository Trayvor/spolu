# Groups and invites

A group is one client (organization). It has a name, a logo and the client's eGrant URL. Each group has a chat, a task board and a support (tickets) section. Admins create and edit groups, copy invite links, add members by email, see the member list and can remove a client.

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
- Group page: tabs Overview (Phase 33, sk "Prehľad"), Chat, Tasks, Tickets (Phase 21, sk "Tikety"), Knowledge (Phase 17, sk "Znalosti") and Members, in that order (Chat still opens first; a finance admin also has Financie, last). Overview is described in `projects.md`, knowledge in `knowledge-base.md`, tickets in `tickets.md`.
- Members list (Members tab): the group shows its signed-in members (clients who have entered a code). Above them, "eGrant managers" lists the group's managers (avatar and name; "No eGrant manager yet." when there are none); admins add any active admin as a manager with "+ Add manager" (a menu of the admins who do not manage the group yet, by name, with a find field when there are more than 8; "Every administrator already manages this group." when none is left) and remove any manager with "Remove" on its row, without a confirmation: a toast "Removed from managers: <name>." offers **Undo** (sk "Vrátiť späť") for 5 s, which adds the manager back (the server then restores the notification mode that becoming manager wrote). Clients only read the list.
- **Adding members by email** (Phase 22b, Members tab, admins only): "+ Add member" opens a form under the heading with Email and "Name (optional)". The email is normalized; the name only fills an empty name, an invite never renames anyone. The answers:
  - nobody has the email: a new client account and a membership; the person gets an invitation email ("Invitation to Help by eGrant – <group>", sk "Pozvánka do aplikácie Help – <group>") with a login link that fills in their email (`/login?email=…`) and shows as **"Invited"** (sk "Pozvaný") until their first sign-in; toast "Invitation sent to …";
  - a person who never signed in (from a link, a ticket or another admin's invite), or a requester of this group who never signed in: the same, "Invited";
  - an invited person again: nothing changes, the invitation goes again (toast "We sent the invitation to … again.");
  - a signed-in client of other groups, or a signed-in requester of this group: a member at once, emailed "You were added to <group>" (toast "… is now a member of the group. We emailed them."); a client blocked because their last group removed them is unblocked too;
  - an active member: "This person is already a member."; an administrator: "This email belongs to an administrator. Add them as a manager.";
  - a member removed from this group is not added back: "This person was removed from the group." with **Restore** (no email).
  - Invited rows sit above the members in the same card, with the name (or the email), the email, the "Invited" badge, **Resend** and **Remove** (inline confirmation "Cancel the invitation for …?"). Remove cancels the invitation: no entry in the removed members and no email; a person who had started a ticket of this group stays its requester. After the first sign-in the row is an ordinary member. 30 adds a minute per admin. The emails follow the admin's language.
- **From eGrant** (the managers webhook, `PUT /api/egrant/managers`, [guide](../integrations/egrant-managers.md); owner correction 2026-10-18). In eGrant a "manager" of an organisation is the client's own person, so eGrant adds and removes **client members** of the instance's group, never admins or Help's managers:
  - adding (`active: true`) is the same `inviteMember` as "+ Add member" above, with eGrant as the inviter ("eGrant invited you…" / "eGrant added you…", in the person's language, sk for a new account): a new client account (with eGrant's name, if sent) shown as "Invited", or an existing client, never-signed-in person or requester becoming a member. A client may be in several groups, so a client of another group just gains this one. Unlike the button, a member removed from this group is restored (eGrant is the source of truth for its organisation's people), an already invited person gets no second invitation, an administrator's email is refused (`422 email_is_admin`) and a disabled account is refused and stays disabled (`422 user_disabled`; the button would unblock it). The email goes only when a membership was actually added;
  - removing (`active: false`) marks the client membership of that group removed (it appears under the removed members, an admin can restore it). Unlike an admin's remove, the account is **never disabled**, even when it was the last group: the person can still sign in but sees only the tickets they reported (the requester view), until some group adds them again. A requester membership is left alone. No email.
- Below the members, **Requesters** (Phase 21, sk "Žiadatelia"): the people who reported tickets for this client without being its clients (`ziadatel` members, also before their first login). Clients see the list; admins remove a requester (at once) and restore them from "Removed requesters (n)"; each of the two shows a toast with **Undo** (5 s) that does the opposite; an undo shows no new toast, so it never offers to undo the undo. The section is hidden while there are none. A restored requester still only sees their own tickets.
- An admin can remove a client from a group and restore them from the removed list. The client loses only that group (its pages answer not found and its live events stop); when it was their last group they lose their sessions and sockets and get no new code.
- A client of several groups has "My groups" (`/my-groups`) in the header (on phones in the section menu when they also report tickets, else a link): their groups with logo, name and unread count. `/` takes a client with one group straight into it and a client of several groups to "My groups".
- Global "All groups" section (admin only):
  - list of all groups and quick access to each;
  - create and edit a group (name, logo, client URL in eGrant);
  - copy the invite link of any group;
  - the Groups page (`/groups`, Phase 22a): the groups I manage come first, then the rest, by name inside each part. The title shows the count ("Groups 12"), or "Groups 3 of 12" while a filter is set. Each row's "Members: N" links to the group's Members tab. Hovering or focusing the manager avatars shows every manager's name in a small tooltip, including those behind "+N"; on touch a tap toggles it.
  - the manager filter, left of "All groups: …" on the same row (its own line above it on phones): Everyone, Me, No manager, then every other active admin by name. It lives in the URL as `?manager=me|none|<adminId>`; an id that is not an active admin (an old link) falls back to Everyone. With no match the page says "No groups for this filter." with "Clear filter".
  - "Find a group" (2026-10-18), beside the filter: narrows the list by name, ignoring case and diacritics ("luky" finds "Obec Lúky"); it is not remembered, and with no match the page says "No group matches.". The count shows "3 of 12" while it is set.
  - the list draws 50 rows at a time (eGrant has about 3 000 clients); "Show more (N left)" adds 50, and changing the filter or the search starts again at 50. The count, the filter and the search always cover every group. A row's bell is a plain button until its first click, which mounts the real menu, open.

## The admin group "eGrant tím" (Phase 34, P34-B)

- One internal group whose members are all admins: **eGrant tím** (EN "eGrant team"). It is a group like a client's, with chat, tasks, knowledge, files, reminders and (for finance admins) Financie, but **no Tickets and no Members tab**, no eGrant link and no invite box. The router shows the not-found page for `/groups/<it>/tickets` and `/members`.
- Every admin reads it; no client or requester ever does. Admins can rename it and change its logo (the edit form has name and logo only); without a logo it shows the egrant mark.
- In its task form, mentions and reminders every active admin can be picked.
- On `/groups` it is a pinned row above the client list (logo, name, unread count, bell; no managers, no Manage toggle, no members link). It is not counted as a client in the title.
- It is left out of the ticket client pickers, the ticket list's client filter and bulk email audiences. In the global board's and knowledge list's client filter it is the top option, "Internal", included in the default scope.

## Phase

Phase 3 (groups, invites, members list, removing a client). Phase 22a: managers on the Members tab, the Groups page filter, order, count and member link. Phase 22b: adding members by email, the invited state, resend and cancel. After Phase 34: the eGrant managers webhook adds and removes client members (`modules/groups/egrant-managers-routes.ts` and `egrant-clients.ts`, tests in `egrant-managers.test.ts`); it first shipped wrongly as making admins Help managers (#123) and was reworked the same day.
