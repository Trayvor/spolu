# Phase 22 — Members tab and Groups page Implementation Plan (22a built, 22b planned for 21.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Parts

Phase 22 is split in two:

| part | branch | content | status |
|---|---|---|---|
| 22a | `phase-22a-managers-groups-page` | Task 1; the managers half of Task 4; Tasks 5 and 6; Task 7's managers and Groups page e2e and docs | built |
| 22b | `phase-22b-member-invites` | invites by email: [Part 22b](#part-22b--invites-by-email-redesigned-for-211-2026-10-16), Tasks B1–B5 (replace Tasks 2 and 3, the members half of Task 4 and Task 7's invite e2e) | planned; decisions marked "Decision (proposed)" await the owner |

**22a as built (2026-10-16, branch `phase-22a-managers-groups-page`, stacked on `phase-21-3-ticket-chat`).** Differences from the tasks below:
- Server: `/managers/me` and `/managers/:userId` share one handler (`applyManagerChange` in `groups/routes.ts`), one rate limit per acting admin, and build their answer before the `group:managers` event goes out. `/:userId` answers `GroupManagersResponse = { managers }`; a client, disabled or unknown target is `403` (`NotAnAdminError`). No policy or service change beyond `canSetManager`.
- Members tab: "+ Add manager" is a `DropdownMenu` (`add-manager-menu.tsx`) of the group's people with `isAdmin && !isManager`; the find field appears from 9 candidates. Success invalidates `['groups']`; no toast. The 21.1 membership model needs nothing here: managers are admins, never memberships.
- Groups page: `filterByManager(groups, manager, adminIds: Set | null)` takes the active admins' ids (from `GET /admins`) instead of `meId` (`me` uses `managedByMe`); an id not among them, or any id while they load, gives every group, and the page then drops the param (`replace`). `isKnownManager` is exported for that. The count sits beside the `h1` (`data-group-count`), not inside it, so the heading's name stays "Groups".
- Tooltip: Radix `Tooltip`, controlled, `disableHoverableContent`; a press on the trigger is not a press outside, a touch pointer leaving does not close it. The bubble's list is `aria-hidden`; Radix's hidden description gets the names as one comma-separated line (`aria-label` on the content).
- Client filter: the chips are the `order-last basis-full` row themselves (no wrapper); the reset is a sibling link button with `order-1`.
- e2e written, not run in this part's session: `managers.spec.ts` (add and remove B on the Members tab, tooltip on the Groups page) and `groups.spec.ts` (filter "Ja", count "n z m", the member link).

**22b — redesigned for 21.1 (2026-10-16).** Tasks 2, 3 and the member half of Task 4 below were written before Phase 21.1 and are superseded by [Part 22b](#part-22b--invites-by-email-redesigned-for-211-2026-10-16) at the end of this plan. In short: an admin's invite is a client membership created directly (not a `pending_invites` row); "Pozvaný" is an active client membership of a user who has not signed in yet; a client of another group is added at once. No migration.

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
- **Invites by email (22b).** See Part 22b: an admin's invite is an active `client` membership; "Pozvaný" is that membership while the user is unverified; cancelling deletes the membership, not the user.
- **Managers set by others.** Managers chosen by another admin reuse `addManager` and `removeManager` with a target user id.
- **Groups page.** Filter, sort and count are client-side over `GET /groups`, which already returns `managers` and `managedByMe`.

**Tech Stack:**
- Server: Fastify, Drizzle, zod in `@spolu/shared`.
- Web: React, TanStack Query and Router, Radix (`radix-ui`, already a dependency).
- Tests: Vitest; Playwright with Mailpit.

**Spec:** the owner's decisions of 2026-10-16, given in chat and recorded here under "Decisions". This plan is the spec. Requirements to update: [groups](../../product/groups.md), [client-managers](../../product/client-managers.md), [knowledge-base](../../product/knowledge-base.md), [admin-home](../../product/admin-home.md).

This plan was numbered 21 at first; it became 22 because the tickets phase already used 21. Phase 21.1 (clients in several groups, membership roles, `pending_invites`) is merged; Part 22b is written against it.

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
- The answers when adding an email were redesigned for 21.1. See "What adding an email does" in Part 22b; the changed ones are marked "Decision (proposed)" there.

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

- **Removing as manager an admin who is also the viewer.** Expected: the viewer's own mode is reset exactly as with `DELETE /managers/me` (`stopManagerMode`). Tested in Task 1.
- **Filtering by an admin who was then deactivated, from an old link.** Expected: the filter falls back to "Všetci"; the page does not show an empty, unexplained list. Tested in Task 6.
- **Invites (22b):** see "Review Focus (22b)" in Part 22b.

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

### Task 2: Server — invite a member by email (superseded)

Written before Phase 21.1; replaced by Tasks B1 and B2 in Part 22b.

### Task 3: Web — login page takes `?email=` (moved)

Moved to Task B3 in Part 22b.

### Task 4: Web — Members tab: managers editable (22a, built), add member, invited rows (superseded)

> The members half of this task (`invitedMembersQuery`, `inviteMember`, `cancelInvite`, `add-member-form.tsx`, invited rows, the empty text, the add-member and invited-row tests) is superseded by Task B4 in Part 22b. Only the managers half applies here, and it is built.

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

### Task 7: End-to-end, docs, roadmap (managers and Groups page: 22a, built; invites: see Task B5)

> The invite e2e below (`groups.spec.ts` steps 1–3) and the add-by-email docs are superseded by Task B5 in Part 22b.

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

---

## Part 22b — Invites by email (redesigned for 21.1, 2026-10-16)

Branch `phase-22b-member-invites`, cut from the latest `main`. This part replaces Tasks 2 and 3, the member half of Task 4 and the invite e2e of Task 7, which were written before Phase 21.1.

**Goal:** on a group's Members tab, an admin adds a person by email (name optional). A new or never-signed-in person gets an invitation email with a login link and shows as **"Pozvaný"** until their first sign-in; an existing client of another group is added at once and told by email.

**Architecture:** No migration, no new dependency.
- **An admin's invite is a membership, not a `pending_invites` row.** `pending_invites` exists because typing an email on a public link must not add an account anywhere until the code proves the email. An admin is trusted and decides who belongs, so `POST /api/groups/:id/members` calls `addMembership(db, userId, groupId, 'client')` directly. `pending_invites` also holds one row per user (the latest wins), so an admin's invite stored there could be overwritten by any later link the person opens.
- **"Pozvaný" = an active `client` membership whose user has `email_verified = false`.** Nothing new is stored: the existing lists (`listMembers`, `listGroupPeople`, `listGroups`' member count) already count verified users only, so an invited person is in none of them until they sign in. The better-auth email-code sign-in sets `email_verified = true`; from then on they are an ordinary member. No change in `auth.ts` is needed: the membership exists already, and `applyPendingInvite` still handles a link the person may also have opened.
- **Resend** is the same `POST` with the same email; it answers `resent` and sends the invitation again.
- **Cancel** ("Odobrať" on a "Pozvaný" row) deletes that membership row, but only while the user is unverified. It also deletes the person's pending link invite for this group, if any. The unverified account stays, like an account from a link email nobody confirmed. The account is harmless: with no membership it reaches nothing.
- Unverified client memberships left from before 21.1 (the old invite link added them before sign-in) show as "Pozvaný" too, which is what they are.

**Tech Stack:** as above (Fastify, Drizzle, zod in `@spolu/shared`; React, TanStack Query; Vitest, Playwright with Mailpit).

### What adding an email does

The email is normalized (`normalizeEmail`). Adding an email changes the account only through the users service. The answers:

| the email belongs to | result | HTTP | email sent |
|---|---|---|---|
| nobody | a new unverified client with the given name, and a client membership here: "Pozvaný" | 201 `invited` | invitation |
| an unverified client with no membership here (from a link, a ticket or another admin's invite) | a client membership here: "Pozvaný" | 201 `invited` | invitation |
| an unverified client already "Pozvaný" here | nothing changes | 200 `resent` | invitation again |
| a verified client of other groups only | a client membership here, an ordinary member at once | 201 `added` | "added to the group" |
| a ziadatel of this group, verified | promoted to client (`addMembership` → `promoted`), an ordinary member at once | 201 `added` | "added to the group" |
| a ziadatel of this group, unverified | promoted to client: "Pozvaný" | 201 `invited` | invitation |
| a client whose account is disabled because an admin removed their last membership elsewhere, with no membership here | a client membership here, and the account active again (`reactivateUser`, as Restore does) | 201 `invited` or `added`, by `email_verified` | as the row above |
| an active client member of this group, verified | nothing | 409 `already_member` | none |
| a removed member of this group (`removed_at` set) | nothing; the form offers "Obnoviť" (the existing restore route) | 409 `removed` with `userId` | none |
| an admin or superadmin, active or not | nothing | 409 `email_taken_admin` | none |

- **The name** is used only when the account's name is empty. An invite never renames someone.
- **Rate limit:** 30 adds a minute per acting admin.
- **The language:** the emails go out in the acting admin's request language (`pickLanguage(accept-language)`), as `POST /admins` does.
- **Socket and session:** a verified client added here joins the group's room at once (`joinGroupRoom`, as `accept` and Restore do). They see the group in "My groups" on their next `/api/me` load. No new socket event: removal and restore send none either.

### Decision (proposed): needs the owner's confirmation

These follow from 21.1 and are the simplest consistent rules. Each one is a single line to change if the owner decides otherwise.

1. **A client of another group** is added here directly and emailed "You were added to the group {group}". They do not get the "Pozvaný" state, because they have already signed in. The old plan answered "belongs to a client of another group"; that is no longer an error.
2. **A ziadatel (requester) of this group** becomes a full client of the group, the same as when they open the invite link.
3. **A person removed from this group** is not added back by email. The form says they were removed and offers "Obnoviť" (restore, no email). Restoring stays a deliberate step.
4. **A client blocked because their last group removed them** is added and unblocked when an admin of another group adds them.
5. **Cancel** removes the invited person from the group completely: no entry in "Odobraní", no email. If they were a ziadatel of this group before the invite, they lose that too. Their tickets keep their name and email, and their next ticket links them again.
6. **An administrator's email** is refused: "This email belongs to an administrator. Add them as a manager."

### Review Focus (22b)

- **Two admins add the same new email at once.** Expected: one user row and one membership; one answer is `invited`, the other `resent`, and both send an email. This uses the `joinWithEmail` unique-violation path. Tested in Task B1.
- **Cancel just after the person signed in.** Expected: 404, and nothing is deleted. The delete is one statement, conditional on `email_verified = false`. Tested in Task B1.
- **Cancel must not touch a verified member or a removed one.** Expected: 404. Removal stays `DELETE /members/:userId`. Tested in Task B2.
- **The answers are an account oracle.** Expected: admins only; clients get 403 on every route. Tested in Task B2.
- **A removed membership is never revived by an add.** `addMembership` returns `removed`, and the answer is 409, also under a race. Tested in Task B1.

### Task B1: Server — `inviteMember` and the invited list

**Files:**
- Modify: `apps/server/src/modules/users/service.ts`:
  - `createUnverifiedClient(db, email, name = '')`; the existing callers are unchanged;
  - new `setNameIfEmpty(db, id, name): Promise<void>` (`update … set name where id = $1 and trim(name) = ''`).
- Modify: `apps/server/src/modules/groups/memberships.ts`: new `cancelInvitedMembership`.
- Modify: `apps/server/src/modules/groups/service.ts`: new `inviteMember`, `listInvitedMembers`, `AlreadyMemberError` and `MemberRemovedError`.
- Modify: `packages/shared/src/groups.ts`, `packages/shared/src/users.ts` (`ErrorCodes.alreadyMember`).
- Test: `apps/server/src/modules/groups/service.test.ts`, `apps/server/src/modules/groups/memberships.test.ts`.

**Interfaces:**
- **Shared** (`groups.ts`):
  - `InviteMemberBodySchema = z.object({ email: JoinBodySchema.shape.email, name: z.string().trim().max(100).optional() })`;
  - `InviteOutcome = 'invited' | 'resent' | 'added'`;
  - `InviteMemberResponseSchema = z.object({ member: MemberSchema, outcome: z.enum(['invited', 'resent', 'added']) })`.
- **Shared** (`users.ts`): `ErrorCodes.alreadyMember = 'already_member'`. Reuse `removedMember` (`'removed'`) and `emailTakenAdmin`.
- **Service** (`groups/service.ts`):
  - `inviteMember(db, groupId, { email, name }): Promise<{ member: Member; outcome: InviteOutcome; verified: boolean }>`;
  - it throws `AlreadyMemberError`, `MemberRemovedError` (with `readonly userId`) and `EmailTakenError('admin')` (from users);
  - `listInvitedMembers(db, groupId): Promise<Member[]>`: active `client` memberships of unverified users, by email.
- **Memberships** (`memberships.ts`):
  - `cancelInvitedMembership(db, groupId, userId): Promise<boolean>`;
  - in one transaction: `delete from group_members gm using "user" u where gm.user_id = u.id and gm.group_id = $g and gm.user_id = $u and gm.role = 'client' and gm.removed_at is null and u.email_verified = false returning gm.user_id`;
  - when a row was deleted, also `delete from pending_invites where user_id = $u and group_id = $g`;
  - true when a membership was deleted.

- [ ] **Step 1: Write the failing tests.**
  - `service.test.ts`, `describe('inviteMember')`, one test per row of the answers table:
    - `a new email creates an unverified client named as given, invited`;
    - `an unverified client with no membership here is invited`;
    - `an invited person again gives resent, and the name is unchanged`;
    - `a verified client of another group is added and reads both groups` (`clientGroupIds` has both);
    - `a verified ziadatel here is promoted and added`;
    - `an unverified ziadatel here is promoted and invited`;
    - `a disabled client with no membership here is reactivated and added`;
    - `an active verified member throws AlreadyMemberError`;
    - `a removed member throws MemberRemovedError with their id, and stays removed`;
    - `an admin, a disabled admin and the superadmin throw EmailTakenError('admin')`;
    - `the name fills only an empty name`;
    - `two concurrent calls give one user, one membership, outcomes invited and resent` (`Promise.all`).
  - `service.test.ts`: `listInvitedMembers lists only unverified active clients of the group`. A verified member, a removed one, a ziadatel and a member of another group are absent.
  - `memberships.test.ts`:
    - `cancelInvitedMembership deletes an unverified client membership and this group's pending invite`;
    - `returns false and deletes nothing for a verified member, a removed one or a ziadatel`;
    - `keeps a pending invite of another group`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server exec vitest run src/modules/groups/service.test.ts src/modules/groups/memberships.test.ts`. Expect FAIL: the functions are missing.
- [ ] **Step 3: Implement.**
  - `inviteMember`:
    1. Call `findUserByEmail`. An admin role means `EmailTakenError('admin')`.
    2. With no user: in a transaction, call `createUnverifiedClient(tx, email, name ?? '')`, then `addMembership(tx, …, 'client')`. On `isUniqueViolation`, re-read the user and continue with the existing-user branch.
    3. Existing user: call `getMembership`.
       - A removed membership means `MemberRemovedError`.
       - An active `client` membership with a verified user means `AlreadyMemberError`.
       - An active `client` membership with an unverified user means `resent`.
       - Otherwise call `addMembership`. Its `removed` result means `MemberRemovedError`. Its `unchanged` result means a concurrent add won: answer as for an existing active membership (`resent` or `AlreadyMemberError`).
    4. When `disabledAt` is set, call `reactivateUser`.
    5. When a name is given, call `setNameIfEmpty`.
    6. The outcome: `invited` when unverified, else `added`.
- [ ] **Step 4: Run** the same tests and expect PASS. Run `pnpm --filter @spolu/server typecheck`.
- [ ] **Step 5: Commit** `feat(groups): admins add members by email`.

### Task B2: Server — routes and the two emails

**Files:**
- Modify: `apps/server/src/modules/groups/routes.ts`.
- Modify: `apps/server/src/modules/auth/emails.ts`.
- Test: `apps/server/src/modules/groups/routes.test.ts`, in a new `describe('member invites')`, and `apps/server/src/modules/auth/emails.test.ts`.

**Interfaces:**
- **Routes** (admins only, via `canManageGroups`; 404 for an unknown group):
  - `POST /api/groups/:id/members`, body `InviteMemberBody`:
    - answers `InviteMemberResponse`: 201 for `invited` and `added`, 200 for `resent`;
    - 409 `{ error: 'already_member' }`, `{ error: 'removed', userId }` or `{ error: 'email_taken_admin' }`;
    - 400 for an invalid body; 429 over the limit (`createRateLimiter({ windowMs: 60_000, max: 30 })`, keyed by actor id);
    - for `added`, call `joinGroupRoom(app.io, member.id, groupId)`.
  - `GET /api/groups/:id/members/invited` → `Member[]`.
  - `DELETE /api/groups/:id/members/invited/:userId` → 204, or 404 when `cancelInvitedMembership` returns false.
- **Emails** (`auth/emails.ts`):
  - `memberInvitedEmail(to, p: { groupName: string; invitedBy: string; loginUrl: string }, lang)`:
    - `loginUrl = \`${config.publicUrl}/login?email=${encodeURIComponent(to)}\``;
    - SK: subject "Pozvánka do Spolu – {groupName}", text "{invitedBy} vás pozval(a) do skupiny {groupName} v Spolu by eGrant. Prihláste sa svojím e-mailom {to}: {loginUrl}";
    - EN: subject "Invitation to Spolu – {groupName}", text "{invitedBy} invited you to the group {groupName} in Spolu by eGrant. Log in with your email {to}: {loginUrl}".
  - `memberAddedEmail(to, p: { groupName: string; addedBy: string; groupUrl: string }, lang)`:
    - `groupUrl = \`${config.publicUrl}/groups/${groupId}\``;
    - SK: subject "Pridali vás do skupiny {groupName}", text "{addedBy} vás pridal(a) do skupiny {groupName} v Spolu by eGrant: {groupUrl}";
    - EN: subject "You were added to {groupName}", text "{addedBy} added you to the group {groupName} in Spolu by eGrant: {groupUrl}".
  - Both are queued with `sendEmailLater` after the write. A failure is logged and never fails the request, as `POST /admins` does.

- [ ] **Step 1: Write the failing tests.**
  - `routes.test.ts`:
    - `a client gets 403 on POST, GET invited and DELETE invited`;
    - `POST a new email: 201 invited, one invitation queued` (`vi.spyOn(test.deps.jobs, 'send')`; the payload's subject has the group name and the text has `/login?email=`);
    - `POST again: 200 resent, one more invitation`;
    - `POST a verified client of another group: 201 added, the added email, and GET /groups/:id answers 200 for that client`;
    - `409 already_member, 409 removed with userId, 409 email_taken_admin, and no email for any of them`;
    - `400 for an invalid email`;
    - `GET invited lists the invited person and GET members does not`;
    - `DELETE invited: 204, then neither list has them`;
    - `DELETE invited of a verified member: 404, and they are still a member`;
    - `after the invited person signs in with a code they leave invited and appear in members` (use the existing `loginAs`).
  - `emails.test.ts`: for both emails in both languages, the subject has the group name and the text has the URL.
- [ ] **Step 2: Run** `pnpm --filter @spolu/server exec vitest run src/modules/groups/routes.test.ts src/modules/auth/emails.test.ts` and expect FAIL.
- [ ] **Step 3: Implement** the routes and the emails. The group name comes from `getGroup`; the language comes from `pickLanguage(request.headers['accept-language'])`.
- [ ] **Step 4: Run** `pnpm --filter @spolu/server test` and `typecheck`, and expect PASS.
- [ ] **Step 5: Commit** `feat(groups): invite, resend and cancel routes with emails`.

### Task B3: Web — the login page takes `?email=`

Unchanged from the old Task 3, with exact names:

**Files:**
- Modify: `apps/web/src/router.tsx`. `loginRoute.validateSearch` returns `{ redirect?: string; email?: string }`. It keeps `email` only when it is a string of at most 254 characters that contains `@`.
- Modify: `apps/web/src/features/auth/login-page.tsx`. `LoginRoute` passes `initialEmail`, and `LoginPage({ redirectTo, initialEmail = '' })` starts `useState(initialEmail)`. The step stays "email"; the person presses Continue.
- Test: `apps/web/src/features/auth/login-page.test.tsx`.

- [ ] **Step 1: Write the failing tests.**
  - `prefills the email from the link`: `?email=anna%40firma.sk` gives the input `anna@firma.sk`.
  - `ignores an email of over 254 characters`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web exec vitest run src/features/auth/login-page.test.tsx` and expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test and expect PASS.
- [ ] **Step 5: Commit** `feat(web): the login link can carry the email`.

### Task B4: Web — add-member form and invited rows

**Files:**
- Modify: `apps/web/src/features/groups/api.ts`:
  - `invitedMembersQuery(id)` with key `['groups', id, 'invited']`;
  - `inviteMember(groupId, body: InviteMemberBody): Promise<InviteMemberResponse>`;
  - `cancelInvite(groupId, userId)`.
- Create: `apps/web/src/features/groups/add-member-form.tsx`.
- Create: `apps/web/src/features/groups/invited-members.tsx`.
- Modify: `apps/web/src/features/groups/members-list.tsx`: the "+ Pridať člena" button for admins opens the form under the heading; `InvitedMembers` sits in the same card, above the members.
- Modify: `apps/web/src/locales/group/{sk,en}.json`.
- Test: new `add-member-form.test.tsx` and `invited-members.test.tsx`; `group-layout.test.tsx` (a client sees neither).

**UI details** (SK / EN, keys under `group.members.*`):
- **The form.**
  - Fields: Email (required) and "Meno (nepovinné)" / "Name (optional)".
  - Buttons: "Pridať" / "Add" and "Zrušiť" / "Cancel".
  - On success, invalidate `['groups']` and close the form.
- **Success toasts** (the existing `Toast`):
  - `invited`: "Pozvánka odoslaná na {{email}}." / "Invitation sent to {{email}}.";
  - `added`: "{{email}} je teraz členom skupiny. Poslali sme mu e-mail." / "{{email}} is now a member of the group. We emailed them.";
  - `resent`: "Pozvánku sme poslali znova na {{email}}." / "We sent the invitation to {{email}} again."
- **Errors**, inline under the email field, by `ApiError.code`:
  - `already_member`: "Tento človek už je členom." / "This person is already a member.";
  - `email_taken_admin`: "Tento e-mail patrí administrátorovi. Pridajte ho ako manažéra." / "This email belongs to an administrator. Add them as a manager.";
  - `removed`: "Tento človek bol zo skupiny odobraný." / "This person was removed from the group.", with an "Obnoviť" / "Restore" button. The button calls `restoreMember(groupId, body.userId)`, closes the form and invalidates `['groups']`;
  - anything else: `errors.generic`.
- **An invited row.**
  - It shows the name if set, else the email, then the email.
  - `Badge` "Pozvaný" / "Invited".
  - "Poslať znova" / "Resend" posts the same email; its toast is the `resent` one.
  - "Odobrať" / "Remove" opens the same inline confirmation as removing a member, with "Zrušiť pozvánku pre {{email}}?" / "Cancel the invitation for {{email}}?", and calls `cancelInvite`.
  - Phones: the row stacks, as `ROW` in `members-list.tsx` does.
- **The empty text.** `group.members.empty` becomes "Zatiaľ žiadni členovia. Pridajte ich e-mailom alebo im pošlite odkaz s pozvánkou." / "No members yet. Add them by email or send them the invite link."

- [ ] **Step 1: Write the failing tests.**
  - `add-member-form.test.tsx`:
    - `posts { email, name }`;
    - `shows each success toast by outcome`;
    - `shows the already_member and email_taken_admin texts`;
    - `removed shows Obnoviť, which posts /members/u3/restore`.
  - `invited-members.test.tsx`:
    - `an invited row shows Pozvaný, Poslať znova and Odobrať`;
    - `Poslať znova posts the email again`;
    - `Odobrať confirms, then sends DELETE /groups/g1/members/invited/u3`.
  - `group-layout.test.tsx`: `a client sees no "+ Pridať člena" and no invited rows`.
- [ ] **Step 2: Run** `pnpm --filter @spolu/web exec vitest run src/features/groups` and expect FAIL.
- [ ] **Step 3: Implement.** Invoke `frontend-design:frontend-design` first: this is a new form on a screen.
- [ ] **Step 4: Run** `pnpm --filter @spolu/web test`, `typecheck` and `lint`, and expect PASS.
- [ ] **Step 5: Commit** `feat(web): add members by email on the Members tab`.

### Task B5: e2e, docs, roadmap

**Files:**
- Create: `e2e/member-invites.spec.ts`. Reuse `createGroup` and the login helpers the way `e2e/memberships.spec.ts` does.
- Modify the docs:
  - `docs/product/groups.md`: adding by email, the answers, "Pozvaný", resend and cancel;
  - `docs/product/auth.md`: `/login?email=`;
  - `docs/architecture/permissions.md`: the invite routes are admin-only, and an admin's invite is a membership, not a pending invite;
  - `docs/architecture/data-model.md`: "invited" is an unverified user with an active client membership; no new column;
  - `docs/roadmap.md`: Phase 22's status.

- [ ] **Step 1: Write the e2e tests.**
  - `a new person is invited, signs in and becomes a member`:
    1. The admin adds `new-<rand>@example.com` on the Members tab, and the row shows "Pozvaný".
    2. `subjectsFor` has "Pozvánka do Spolu – <group>".
    3. Opening `/login?email=…` shows the email filled in.
    4. They log in with the code (`latestLoginCode`).
    5. Back as the admin, after a reload, the person is a plain member and "Pozvaný" is gone.
  - `a client of another group is added at once`:
    1. A client of group A is added by email on group B.
    2. The row is a plain member.
    3. The client's "My groups" lists both groups after a reload.
  - `cancel removes an invited row`.
- [ ] **Step 2: Run** `pnpm test:e2e -- member-invites` and expect PASS.
- [ ] **Step 3: Update the docs** listed above with `update-kb`. Run `bash scripts/check-docs.sh origin/main`.
- [ ] **Step 4: Run** `bash scripts/ci.sh` and expect it all green.
- [ ] **Step 5: Commit** `docs: phase 22b member invites`. Push and open the PR.
