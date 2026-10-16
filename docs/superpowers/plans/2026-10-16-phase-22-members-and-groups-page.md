# Phase 22 — Members tab and Groups page Implementation Plan (22a built, 22b planned)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Parts

Phase 22 is split in two:

| part | branch | content | status |
|---|---|---|---|
| 22a | `phase-22a-managers-groups-page` | Task 1; the managers half of Task 4; Tasks 5 and 6; Task 7's managers and Groups page e2e and docs | built |
| 22b | not cut | invites by email: Tasks 2 and 3, the members half of Task 4 (add-member form, invited rows), Task 7's invite e2e | planned, needs a redesign first |

**22a as built (2026-10-16, branch `phase-22a-managers-groups-page`, stacked on `phase-21-3-ticket-chat`).** Differences from the tasks below:
- Server: `/managers/me` and `/managers/:userId` share one handler (`applyManagerChange` in `groups/routes.ts`), one rate limit per acting admin, and build their answer before the `group:managers` event goes out. `/:userId` answers `GroupManagersResponse = { managers }`; a client, disabled or unknown target is `403` (`NotAnAdminError`). No policy or service change beyond `canSetManager`.
- Members tab: "+ Add manager" is a `DropdownMenu` (`add-manager-menu.tsx`) of the group's people with `isAdmin && !isManager`; the find field appears from 9 candidates. Success invalidates `['groups']`; no toast. The 21.1 membership model needs nothing here: managers are admins, never memberships.
- Groups page: `filterByManager(groups, manager, adminIds: Set | null)` takes the active admins' ids (from `GET /admins`) instead of `meId` (`me` uses `managedByMe`); an id not among them, or any id while they load, gives every group, and the page then drops the param (`replace`). `isKnownManager` is exported for that. The count sits beside the `h1` (`data-group-count`), not inside it, so the heading's name stays "Groups".
- Tooltip: Radix `Tooltip`, controlled, `disableHoverableContent`; a press on the trigger is not a press outside, a touch pointer leaving does not close it. The bubble's list is `aria-hidden`; Radix's hidden description gets the names as one comma-separated line (`aria-label` on the content).
- Client filter: the chips are the `order-last basis-full` row themselves (no wrapper); the reset is a sibling link button with `order-1`.
- e2e written, not run in this part's session: `managers.spec.ts` (add and remove B on the Members tab, tooltip on the Groups page) and `groups.spec.ts` (filter "Ja", count "n z m", the member link).

**22b — redesign before building.** Tasks 2, 3 and the member half of Task 4 were written before Phase 21.1. Since then clients can be in several groups, `group_members` has `role` (`client | ziadatel`) and `removed_at`, removal is per membership (the account is disabled only with the last one), and an invite typed before signing in is stored in `pending_invites` and applied on sign-in (`moveUnverified` is gone). "An invited member is an unverified active client in `group_members`" no longer holds, and the "verified client of another group" answer is wrong now that such a client can simply be added. Redesign the invite model (likely a `pending_invites`-style row per group and email, shown as "Pozvaný" until applied), the answers table and the cancel rule against that model, then rewrite Tasks 2 to 4 before cutting the branch.

**Goal:**
- On a group's Members tab (Členovia), admins manage the group's eGrant managers and invite members by email.
- The Groups page (Skupiny) gets:
  - a member-count link;
  - manager-name tooltips;
  - a manager filter;
  - "my groups first" sorting;
  - a group count.
- The client filter's "Predvolené" moves into the filter row.

**Architecture:** No migration.
- **Invites by email.** An invited member is the same row the invite link creates today: an unverified, active `client` in `group_members`. The invite list is "unverified members". Cancelling deletes that never-used user.
- **Managers set by others.** Managers chosen by another admin reuse `addManager` and `removeManager` with a target user id.
- **Groups page.** Filter, sort and count are client-side over `GET /groups`, which already returns `managers` and `managedByMe`.

**Tech Stack:**
- Server: Fastify, Drizzle, zod in `@spolu/shared`.
- Web: React, TanStack Query and Router, Radix (`radix-ui`, already a dependency).
- Tests: Vitest; Playwright with Mailpit.

**Spec:** the owner's decisions of 2026-10-16, given in chat and recorded here under "Decisions". This plan is the spec. Requirements to update: [groups](../../product/groups.md), [client-managers](../../product/client-managers.md), [knowledge-base](../../product/knowledge-base.md), [admin-home](../../product/admin-home.md).

**Before starting, reconcile with Phase 21.1** (tickets and the ziadatel role, PR #4). That part changes the membership model this plan relies on:
- clients can be in several groups;
- `group_members` gets a `role` (`client | ziadatel`) and `removed_at`;
- invites typed before signing in go to `pending_invites`.

Re-check the "Invites by email" architecture and the member list against the merged code first. This plan was numbered 21 at first; it became 22 because the tickets phase already used 21.

## Decisions (owner, 2026-10-16)

### Members tab
- Remove the link "Zmeniť na stránke Skupiny".
- Any admin adds and removes any active admin as a manager of the group, here.
- The self-service toggle on the Groups page stays.

### Adding members
- Admins add members by email; the name is optional.
- The person gets an email saying they were invited to Spolu, with a login link.
- Invited people who have not signed in appear in the list with the badge **"Pozvaný"**.
  - **Poslať znova** resends the email.
  - **Odobrať** cancels the invite.
  - After the first sign-in they are ordinary members.
- The invite link stays as it is.
- Answers when adding an email:
  - **already an active member here:** "already a member";
  - **an admin:** "belongs to an administrator";
  - **a verified client of another group:** "belongs to a client of another group";
  - **a removed client of this group:** offer "Obnoviť";
  - **already invited here:** resend;
  - **an unverified client of another group:** move here, the same rule as the invite link.

### Groups page
- "Členovia: N" links to `/groups/<id>/members`.
- Hovering the manager avatars shows a small tooltip with all the managers' names, including those hidden behind "+N". On touch, a tap toggles it.
- Manager filter, on the row of "Všetky skupiny: …", to its left. On phones it goes on its own line above that.
  - Options: Všetci, Ja, Bez správcu, then each active admin.
  - It lives in the URL: `?manager=me|none|<adminId>`.
  - Empty result: "Žiadne skupiny pre tento filter." with "Zrušiť filter".
- Sort order: groups I manage first, then the rest; by name inside each part.
- The title row shows a muted count: "Skupiny 12", or with a filter "Skupiny 3 z 12".

### Client filter (Úlohy, Znalosti)
- "Predvolené" sits in the filter row, after the other controls.
- Chips of chosen clients stay on their own row below.

## Global Constraints

- **English and i18n.** English in code, comments and docs. Every UI string is an i18n key in both `sk.json` and `en.json` of its namespace (`apps/web/src/locales/<ns>/`).
- **Server-side checks.** Permissions are checked on the server through policy functions in `modules/groups/policy.ts`. The client is never trusted.
- **Writes and sockets.** Writes go through HTTP; sockets only push after the write, via `emitManagers`.
- **Module boundaries.** Writes to `user` go through `modules/users/service.ts`.
- **No new dependencies and no migration.**
- **Phone layouts.** Phones are under 641 px (`min-[641px]:` breakpoints). Every new control must work there.
- **Tests and docs.** Test-first for server logic and policies. Docs are updated in the same commit as the code (`update-kb`).

## Review Focus

- **Two admins invite the same email at once.** Expected: one user row; the second request resends the email. This matches the `joinWithEmail` unique-violation path. Tested in Task 2.
- **Cancelling an invite after the person has just signed in.** Expected: nothing is deleted, 404. The delete is conditional on `email_verified = false`. Tested in Task 2.
- **Removing as manager an admin who is also the viewer.** Expected: the viewer's own mode is reset exactly as with `DELETE /managers/me` (`stopManagerMode`). Tested in Task 1.
- **Filtering by an admin who was then deactivated, from an old link.** Expected: the filter falls back to "Všetci"; the page does not show an empty, unexplained list. Tested in Task 6.
- **Email-taken answers are a membership oracle.** Expected: they reach admins only; the route is admin-only, so 403 for clients. Tested in Task 2.

---

### Task 1: Server — admins set any admin as a group's manager (22a, built)

**Files:**
- Modify: `apps/server/src/modules/groups/routes.ts` (next to the `/managers/me` routes)
- Modify: `apps/server/src/modules/groups/policy.ts`
- Modify: `packages/shared/src/groups.ts`
- Test: `apps/server/src/modules/groups/routes.test.ts`, `apps/server/src/modules/groups/policy.test.ts`

**Interfaces:**
- Produces:
  - `PUT /api/groups/:id/managers/:userId` and `DELETE /api/groups/:id/managers/:userId`, both answering `GroupManagersResponse = { managers: GroupManager[] }`;
  - `GroupManagersResponseSchema` in shared;
  - `canSetManager(actor: SessionUser): boolean` in policy.
- Consumes: `addManager` and `removeManager(db, groupId, userId)`, `emitManagers`, the existing `allowManagerChange` limiter (the same per-actor budget).

- [ ] **Step 1: Write the failing tests** in `routes.test.ts`, in a new `describe('PUT/DELETE /groups/:id/managers/:userId')`:
  - `an admin makes another admin a manager`: 200, `managers` contains the target, and a `group:managers` event is emitted.
  - `an admin removes another admin`: 200, the target is gone, and the target's group mode returns to their default (assert through `getEffectiveGroupMode`, as the `/me` tests do).
  - `a client gets 403`.
  - `the target is a client or disabled`: 403, from `NotAnAdminError`.
  - `unknown group`: 404.
  - `adding twice`: 200 with no second event, because the call is idempotent.
  - `the /me routes still answer with mode`: a regression guard.
  - In `policy.test.ts`: `canSetManager` is true for admin and superadmin, false for client.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test -- groups/routes groups/policy` and expect FAIL (404 or route missing).
- [ ] **Step 3: Implement.**
  - Add `canSetManager` to the policy.
  - Generalize `changeManager` to take the target from `request.params.userId ?? actor.id`. For `/:userId` answer `{ managers }`; `/me` keeps `{ managers, managedByMe, mode }`.
  - Register `/managers/me` before `/managers/:userId`, so `me` is never read as an id.
  - Replace the comment "Managers are self-service" with one that states both routes.
- [ ] **Step 4: Run the tests** and expect PASS. Then run `pnpm --filter @spolu/server typecheck`.
- [ ] **Step 5: Commit** `feat(server): admins set any admin as a group's manager`.

### Task 2: Server — invite a member by email; list, resend, cancel (22b, redesign first)

**Files:**
- Modify: `apps/server/src/modules/users/service.ts`:
  - `createUnverifiedClient(db, email, name = '')`;
  - new `deleteUnverifiedClient(db, id): Promise<boolean>`.
- Modify: `apps/server/src/modules/groups/service.ts`:
  - new `inviteMember`;
  - `listMembers` option `{ removed } | { invited: true }`.
- Modify: `apps/server/src/modules/groups/routes.ts`, `apps/server/src/modules/auth/emails.ts`.
- Modify: `packages/shared/src/groups.ts`, `packages/shared/src/users.ts` (ErrorCodes).
- Test: `apps/server/src/modules/groups/service.test.ts`, `apps/server/src/modules/groups/routes.test.ts`, `apps/server/src/modules/auth/emails.test.ts`.

**Interfaces:**
- **Shared.**
  - `InviteMemberBodySchema = z.object({ email: <same as JoinBodySchema>, name: z.string().trim().max(100).optional() })`.
  - `InviteMemberResponseSchema = z.object({ member: MemberSchema, resent: z.boolean() })`.
  - `ErrorCodes.alreadyMember = 'already_member'` and `ErrorCodes.memberRemoved = 'member_removed'`. Reuse `emailTakenAdmin` and `emailTakenClient`.
- **Service.**
  - `inviteMember(db, groupId, { email, name }): Promise<{ member: Member; resent: boolean }>`.
  - It throws `AlreadyMemberError`, `MemberRemovedError` (carrying `userId`) and `EmailTakenError('admin' | 'client')`, imported from users.
- **Routes** (admins only, via `canManageGroups`; 30 per minute per admin through `createRateLimiter`):
  - `GET /api/groups/:id/members/invited` → `Member[]`, by email.
  - `POST /api/groups/:id/members` (body `InviteMemberBody`):
    - 201 for a new invite, 200 for a resend;
    - 409 `{ error, userId? }` for the codes above (`userId` only with `member_removed`).
  - `DELETE /api/groups/:id/members/invited/:userId` → 204, or 404 when the person is not an unverified member of this group.
- **Email.**
  - `memberInvitedEmail(to, { groupName: string; invitedBy: string; loginUrl: string }, lang): EmailMessage`.
  - `loginUrl = \`${config.publicUrl}/login?email=${encodeURIComponent(email)}\``.
  - Copy:
    - SK: subject "Pozvánka do Spolu – {groupName}", text "{invitedBy} vás pozval(a) do skupiny {groupName} v Spolu by eGrant. Prihláste sa svojím e-mailom {to}: {loginUrl}";
    - EN: subject "Invitation to Spolu – {groupName}", text "{invitedBy} invited you to the group {groupName} in Spolu by eGrant. Log in with your email {to}: {loginUrl}".
  - Queue it with `sendEmailLater`. A failure is logged and never fails the request, as `POST /admins` does.

- [ ] **Step 1: Write the failing service tests** (`service.test.ts`, `describe('inviteMember')`), one case each:
  - an unknown email creates an unverified client in the group with the given name (`resent: false`);
  - an unverified member of this group gives `resent: true`, with the name unchanged;
  - an unverified client of another group is moved here (`resent: false`);
  - a verified active member here throws `AlreadyMemberError`;
  - a disabled member here throws `MemberRemovedError` with their id;
  - a verified client of another group throws `EmailTakenError('client')`;
  - an admin email throws `EmailTakenError('admin')`;
  - two concurrent calls with one email give one user row (`Promise.all`; both resolve).

  Also `listMembers(db, g, { invited: true })` returns only unverified, active members. Also `deleteUnverifiedClient`: true for an unverified client; false and no delete for a verified one.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server test -- groups/service` and expect FAIL.
- [ ] **Step 3: Implement** `inviteMember` in `groups/service.ts`. Read `findUserByEmail` and branch as in the Decisions. For the new-user path and the unique-violation fallback, reuse the `joinWithEmail` transaction shape and `moveUnverified`. Implement `deleteUnverifiedClient` as `delete … where id = $1 and role = 'client' and email_verified = false returning id`.
- [ ] **Step 4: Run the service tests** and expect PASS.
- [ ] **Step 5: Write the failing route and email tests.**
  - Routes:
    - a client gets 403 on all three routes;
    - POST 201 queues one email (assert through the jobs fake used by the `/admins` tests);
    - POST resend gives 200 and one more email;
    - each 409 code, with `userId` on `member_removed`;
    - an invalid email gives 400;
    - GET invited lists the person;
    - DELETE invited gives 204, after which the user is gone;
    - DELETE of a verified member gives 404 and the user is still there;
    - after the invited person verifies, they leave `/invited` and appear in `/members`.
  - `emails.test.ts`: the SK and EN subjects contain the group name, and the text contains `loginUrl`.
- [ ] **Step 6: Implement** the routes and `memberInvitedEmail`. The group name comes from `getGroup`. The language comes from `pickLanguage(request.headers['accept-language'])`.
- [ ] **Step 7: Run** `pnpm --filter @spolu/server test` and `typecheck`, and expect PASS.
- [ ] **Step 8: Commit** `feat(server): invite group members by email`.

### Task 3: Web — login page takes `?email=` (22b)

**Files:**
- Modify: `apps/web/src/router.tsx`: the login route's `validateSearch` keeps `email?: string` next to `redirect`.
- Modify: `apps/web/src/features/auth/login-page.tsx`.
- Test: `apps/web/src/features/auth/login-page.test.tsx`.

**Interfaces:**
- Produces: `/login?email=a@b.sk` opens with the email field filled in; the step is still "email", and the user presses Continue.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test** `prefills the email from the link`: render with `?email=anna%40firma.sk` and expect the input's value to be `anna@firma.sk`. Also: an email of over 254 characters is ignored.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test -- login-page` and expect FAIL.
- [ ] **Step 3: Implement.** The initial `useState(email)` comes from the validated search.
- [ ] **Step 4: Run the tests** and expect PASS.
- [ ] **Step 5: Commit** `feat(web): the login link can carry the email`.

### Task 4: Web — Members tab: managers editable (22a, built), add member, invited rows (22b, redesign first)

**Files:**
- Modify: `apps/web/src/features/groups/api.ts`:
  - `setManager(groupId, userId)` and `unsetManager(groupId, userId)`, both returning `GroupManagersResponse`;
  - `invitedMembersQuery(id)` with key `['groups', id, 'invited']`;
  - `inviteMember(groupId, body)` returning `InviteMemberResponse`;
  - `cancelInvite(groupId, userId)`.
- Modify: `apps/web/src/features/groups/managers-section.tsx`.
- Create: `apps/web/src/features/groups/add-manager-menu.tsx`.
- Create: `apps/web/src/features/groups/add-member-form.tsx`.
- Modify: `apps/web/src/features/groups/members-list.tsx`: invited rows go above the members, inside the same card.
- Modify: `apps/web/src/locales/{groups,group}/{sk,en}.json`.
- Test: `managers-section.test.tsx`, new `add-member-form.test.tsx`, new `members-list.test.tsx`.

**Interfaces:**
- Consumes: Task 1 and Task 2 endpoints; `useGroupPeople(groupId)`. It already returns every active admin with `isManager`, so the picker needs no new request.
- Produces: nothing used later.

**UI details:**
- **Managers header.** "+ Pridať manažéra" (`groups.managers.add`), a secondary button for admins only. It opens a `DropdownMenu` of the active admins with `isManager === false`, by name, with a search input at the top when there are more than 8. Picking one calls `setManager`. Empty state: "Všetci administrátori už spravujú túto skupinu." (`groups.managers.allAdded`).
- **Each manager row (admins).**
  - A ghost "Odobrať" with no confirmation, `aria-label` "Odobrať {{name}}".
  - On success, invalidate `['groups']`.
  - On error, show the inline `groups.managers.error`.
- **Members header.** "+ Pridať člena" (`group.members.add`) for admins opens an inline form under the header:
  - fields: Email (required) and Meno (optional, `group.members.nameOptional`);
  - buttons "Pozvať" and "Zrušiť".
- **Form answers:**
  - 201: toast "Pozvánka odoslaná na {{email}}.", the form closes, invalidate `['groups']`;
  - 200: toast "Pozvánku sme poslali znova na {{email}}.";
  - `already_member`: "Tento človek už je členom.";
  - `email_taken_admin`: "Tento e-mail patrí administrátorovi. Pridajte ho ako manažéra.";
  - `email_taken_client`: "Tento e-mail patrí klientovi inej skupiny.";
  - `member_removed`: "Tento človek bol odobraný." with an inline "Obnoviť" button, which calls `restoreMember(groupId, userId)`, closes the form and shows a toast.
- **Invited row:**
  - email (and name if set);
  - `Badge` "Pozvaný" (`group.members.invited`);
  - actions "Poslať znova", which re-posts the email, and "Odobrať", which uses the same confirm pattern as removal with the text "Zrušiť pozvánku pre {{email}}?" and calls `cancelInvite`.
- **Removed link.** Remove `groups.managers.changeLink` and its `Link`.
- **Empty text.** Update `group.members.empty` to "Zatiaľ žiadni členovia. Pridajte ich e-mailom alebo im pošlite odkaz s pozvánkou."

- [ ] **Step 1: Write the failing tests.**
  - Managers section:
    - an admin sees "+ Pridať manažéra" listing only non-managers;
    - picking one calls `PUT /groups/g1/managers/u2`;
    - "Odobrať" calls `DELETE …/u2`;
    - a client sees neither control;
    - the "Zmeniť na stránke Skupiny" link is gone.
  - Add member form:
    - posts `{ email, name }`;
    - shows each of the 4 error texts for each 409 code;
    - `member_removed` shows "Obnoviť", which posts `…/restore`.
  - Members list: an invited row shows "Pozvaný" and both actions; cancel confirms, then sends `DELETE …/members/invited/u3`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test -- groups/` and expect FAIL.
- [ ] **Step 3: Implement** following the UI details. Use the existing `Toast` (`components/ui/toast.tsx`) and `DropdownMenu`.
- [ ] **Step 4: Run the tests** and expect PASS. Run `pnpm --filter @spolu/web typecheck` and `lint`.
- [ ] **Step 5: Commit** `feat(web): manage managers and invite members on the Members tab`.

### Task 5: Web — client filter: "Predvolené" in the filter row (22a, built)

**Files:**
- Modify: `apps/web/src/components/client-filter.tsx` (the block around `order-last basis-full`).
- Test: `apps/web/src/components/client-filter.test.tsx`.

**Interfaces:**
- Produces: the same props. The reset is now a sibling in the parent's flex row with class `order-1`; the chips row keeps `order-last basis-full`. Default controls are order 0, so the reset lands after them and before the chips.
- Consumes: nothing. Both parents (`global-board/board-filters.tsx` and `knowledge/knowledge-page.tsx`) already render `ClientFilter` inside a `flex flex-wrap` row; check that and leave them unchanged.

- [ ] **Step 1: Write the failing test.** With `value = 'all'` and no chips, the reset button is not inside the element with `basis-full`, and no `basis-full` element is rendered. With chips, the chips row exists and the reset is outside it.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test -- client-filter` and expect FAIL.
- [ ] **Step 3: Implement.** Render the chips row only when `chips.length > 0`. Render the reset button separately when `value !== null`.
- [ ] **Step 4: Run** the web tests and expect PASS. Look at both pages at 1280 px and 375 px in `pnpm dev`.
- [ ] **Step 5: Commit** `fix(web): the client filter's reset sits in the filter row`.

### Task 6: Web — Groups page: link, tooltip, manager filter, sort, count (22a, built)

**Files:**
- Modify: `apps/web/src/router.tsx`: `groupsRoute.validateSearch` gives `{ manager?: string }`, a non-empty string of at most 64 characters.
- Modify: `apps/web/src/features/groups/groups-page.tsx`.
- Create: `apps/web/src/features/groups/group-list.ts`, the pure helpers.
- Create: `apps/web/src/features/groups/manager-filter.tsx`.
- Modify: `apps/web/src/features/groups/manager-avatars.tsx`: the tooltip.
- Modify: `apps/web/src/locales/groups/{sk,en}.json`.
- Test: new `group-list.test.ts`, `groups-page.test.tsx`, new `manager-avatars.test.tsx`.

**Interfaces:**
- **Produces** (in `group-list.ts`):
  - `sortMineFirst(groups: GroupSummary[]): GroupSummary[]`: `managedByMe` first, otherwise keeping the server's name order;
  - `filterByManager(groups, manager: string | undefined, meId: string): GroupSummary[]`. For `undefined` or an unknown admin id it returns all groups; `'me'` gives `managedByMe`; `'none'` gives `managers.length === 0`; an id gives `managers.some(m => m.id === id)`.
- **Consumes:**
  - `adminsQuery` from `features/admins/api.ts` (`GET /admins`) for the filter options;
  - `useSession()` for `meId`.

**UI details:**
- **Filter pill.** "Správca: {{name}}" (`groups.filter.label`), with names "Všetci", "Ja" and "Bez správcu", in the style of the global board's filter pills. A menu holds the three fixed options, a separator, then the admins by name without me.
- **Placement.** The row is `flex items-center justify-between gap-2`: the pill on the left, `AllGroupsMode` on the right. Under 641 px it becomes `flex-col items-start`.
- **Unknown id.** When `manager` is an id that is not among the active admins once loaded, `navigate({ search: {} , replace: true })`.
- **Empty filtered list.** "Žiadne skupiny pre tento filter." (`groups.filter.empty`) with a "Zrušiť filter" button (`groups.filter.clear`).
- **Count.** Beside the `h1` goes `<span className="text-muted-foreground font-normal">`:
  - `{{shown}}` without a filter;
  - `groups.count.filtered` "{{shown}} z {{total}}" with one.
- **Member count.** "Členovia: N" becomes `<Link to="/groups/$groupId/members">`, with the same text style and an underline on hover.
- **Tooltip.**
  - Wrap the avatars in a `Tooltip` from `radix-ui`, open state controlled:
    - opens on pointer enter and on focus;
    - toggled by click, for touch;
    - closed by Escape.
  - The trigger is a `button` with `aria-label` = `groups.managers.listLabel`.
  - The content lists every manager's name, one per line: a small dark bubble, `text-micro`, no animation.
  - Keep the existing visually hidden list for screen readers. Then the button label is enough, and the tooltip content is `aria-hidden`.

- [ ] **Step 1: Write the failing tests.**
  - `group-list.test.ts`:
    - the sort puts managed groups first and keeps name order inside each part;
    - the filter covers `me`, `none`, an id, an unknown id (all groups) and `undefined`.
  - `groups-page.test.tsx`:
    - the count reads "2" without a filter and "1 z 2" with `?manager=me`;
    - "Členovia: 4" has `href` `/groups/g2/members`;
    - the empty filtered state shows "Zrušiť filter", which clears the search.
  - `manager-avatars.test.tsx`: hovering, or clicking the trigger, shows all names, including those behind "+N".
- [ ] **Step 2: Run** `pnpm --filter @spolu/web test -- groups/` and expect FAIL.
- [ ] **Step 3: Implement** following the UI details.
- [ ] **Step 4: Run the tests** and expect PASS. Run `pnpm --filter @spolu/web typecheck` and `lint`.
- [ ] **Step 5: Commit** `feat(web): Groups page filter by manager, my groups first, counts and links`.

### Task 7: End-to-end, docs, roadmap (managers and Groups page: 22a, built; invites: 22b)

**Files:**
- Modify: `e2e/managers.spec.ts`.
- Modify: `e2e/groups.spec.ts`.
- Modify the docs:
  - `docs/product/groups.md`: add-by-email, the invited state, the Groups page filter, sort, count and link;
  - `docs/product/client-managers.md`: the "Becoming and stopping" rule now covers any admin, from the Members tab;
  - `docs/product/knowledge-base.md`: the line about "Predvolené" on the client filter;
  - `docs/product/admin-home.md`, if it describes the client filter's reset row;
  - `docs/roadmap.md`: set Phase 22 to its new status.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the e2e tests.**
  - `managers.spec.ts`: admin A, on group G's Members tab, adds admin B as a manager. B shows on the Groups page avatars of G. A removes B, and B disappears.
  - `groups.spec.ts`:
    1. The admin adds `new-<rand>@example.com` on the Members tab and the row shows "Pozvaný".
    2. Mailpit has the invite with the group name in the subject (`subjectsFor`). Its login link opens `/login?email=…` with the field filled in.
    3. The person logs in with the code. Back as the admin, the row is a plain member without "Pozvaný".
  - `groups.spec.ts`, filter: the admin filters the Groups page "Ja" and sees only managed groups and the count "n z m".
- [ ] **Step 2: Run** `pnpm test:e2e -- managers groups` and expect PASS. Fix and re-run if needed.
- [ ] **Step 3: Update the docs** listed above. Run `bash scripts/check-docs.sh origin/main`.
- [ ] **Step 4: Run** `bash scripts/ci.sh` and expect it all green.
- [ ] **Step 5: Commit** `docs: phase 22 members tab and groups page`.
