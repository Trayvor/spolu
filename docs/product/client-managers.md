# Client managers

An administrator can be a **manager** of a client group: one of the eGrant people responsible for that client. A group can have several managers, and an administrator can manage several groups. Being a manager is a per-group flag on an administrator, not a new role: every administrator still reads and writes every group.

## Requirements

- **Becoming and stopping.** An administrator becomes a manager of a client, or stops being one, with a button in the list of all clients (the Groups page); that button acts only for themselves. On a group's Members tab, any administrator adds any active administrator as a manager of that group, or removes any manager (Phase 22a). Whoever acts, the notification rules below apply to the administrator who became or stopped being a manager.
- **Not from eGrant.** Managers are set only in Help. eGrant's "managers webhook" (`PUT /api/egrant/managers`) is named after eGrant's own term, where a manager of an organisation is the client's own person: it adds and removes **client members** of the group (see `groups.md`, "From eGrant") and never touches admins or `group_managers` (owner correction 2026-10-18).
- **Many managers.** A group can have any number of managers; an administrator can manage any number of groups.
- **Who can be mentioned and assigned.** In a group's chat and task chats, the mention picker lists only the group's clients and its managers. The task assignee picker lists the same people for a client. For an administrator it also lists every other active administrator, after the clients and managers under "Other admins", each marked "not a manager" (owner request 2026-10-18; see `task-board.md`). Administrators who are not managers are not offered in mentions or reminders.
- **@all** reaches the group's clients and its managers. Administrators who are not managers are not reached by @all.
- **Access is unchanged.** An administrator who is not a manager still reads and writes the chat, the tasks and everything else of the group.
- **Notifications.**
  - The default for every administrator on every group is "Mentions and replies".
  - Becoming a manager switches that administrator's mode for the group to "All messages", unless they had already chosen a mode for that group themselves.
  - Changing the mode with the bell afterwards is the administrator's own choice and is kept.
  - Stopping being a manager returns the administrator to their default, unless they had chosen a mode themselves.
  - Choosing a mode under "All groups" on the Groups page resets every per-group choice, including the All messages a manager got by becoming one. The administrator stays a manager; becoming a manager of a group again later sets All messages again.
- **Existing assignments.** A task assigned to an administrator who is not (or no longer) a manager keeps the assignment. The task form shows that person with the note "not a manager"; they can be removed, and only an administrator can add them again.
- **Substitution** (2026-10-19, [ADR 0059](../decisions/0059-admin-substitution-derived-manager-rows.md)). On the Administrators page any administrator sets "B substitutes A" ("Zastúpiť": pick B, an optional last day) for themselves or a colleague, and ends it with "Ukončiť zastupovanie". While it lasts B is a manager of every client group A manages, also of a group A starts managing meanwhile, with everything above (All messages unless B chose a mode, new tickets, mentions, @all, assignees, the "my clients" scopes, the weekly summary). Clients see B among the managers with "zastupuje <A>". Finance is not passed on. The end (by hand, the day after the last day by the hourly job, or when A or B is deactivated) takes B off only the groups the substitution added: a group B managed before, or was made a manager of during the substitution, stays. One active substitution per administrator; an administrator who is substituted cannot be picked as a substitute; it is not transitive (B covers only A's own groups). Every start and end is in the audit log.
- **Visibility.** The Groups page shows each group's managers; the group's Members tab lists its managers.
- **Watch tickets.** A manager watches the group's tickets by default (they hear about each new ticket) while they manage it, unless they unticked "New tickets of this client: notify me" (the Tickets tab, or the client table on `/settings/notifications`); their own choice stays when they stop or start managing. Managers no longer follow a ticket by themselves (see `tickets.md`).
- Managers are used by later features: the default client filter of the global knowledge list and the global task board ("the clients I manage"), and the admin home's client list. The admin group "eGrant tím" (Phase 34) has no managers: every admin is effectively one, so it joins that default scope whenever the admin manages a client.

## Status

Built in Phase 18. The migration seeds managers: each active admin becomes a manager of the groups where they are assigned to an open task or wrote in a chat in the last 60 days. Their notification modes are not touched by the seed. An end-to-end test (`e2e/managers.spec.ts`) covers two admins and a client. Phase 22a added setting any admin as a manager from the group's Members tab (`PUT`/`DELETE /api/groups/:id/managers/:userId`), covered by a second test in the same file. The eGrant managers webhook first set Help managers (#123); it was reworked the same day to add client members instead (`groups.md`), and nothing outside Help sets managers now.

## Phase

Phase 18 ([spec](../superpowers/specs/2026-10-16-phase-18-client-managers-design.md)). Used by Phases 17 and 20.
