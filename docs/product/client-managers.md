# Client managers

An administrator can be a **manager** of a client group: one of the eGrant people responsible for that client. A group can have several managers, and an administrator can manage several groups. Being a manager is a per-group flag on an administrator, not a new role: every administrator still reads and writes every group.

## Requirements

- **Becoming and stopping.** An administrator becomes a manager of a client, or stops being one, with a button in the list of all clients (the Groups page). Each administrator does this only for themselves.
- **Many managers.** A group can have any number of managers; an administrator can manage any number of groups.
- **Who can be mentioned and assigned.** In a group's chat and task chats, the mention picker lists only the group's clients and its managers. The task assignee picker lists the same people. Administrators who are not managers of that group are not listed.
- **@all** reaches the group's clients and its managers. Administrators who are not managers are not reached by @all.
- **Access is unchanged.** An administrator who is not a manager still reads and writes the chat, the tasks and everything else of the group.
- **Notifications.**
  - The default for every administrator on every group is "Mentions and replies".
  - Becoming a manager switches that administrator's mode for the group to "All messages", unless they had already chosen a mode for that group themselves.
  - Changing the mode with the bell afterwards is the administrator's own choice and is kept.
  - Stopping being a manager returns the administrator to their default, unless they had chosen a mode themselves.
  - Choosing a mode under "All groups" on the Groups page resets every per-group choice, including the All messages a manager got by becoming one. The administrator stays a manager; becoming a manager of a group again later sets All messages again.
- **Existing assignments.** A task assigned to an administrator who is not (or no longer) a manager keeps the assignment. The task form shows that person with the note "not a manager"; they can be removed, but not added again.
- **Visibility.** The Groups page shows each group's managers; the group's Members tab lists its managers.
- Managers are used by later features: the default client filter of the global knowledge list and the global task board ("the clients I manage"), and the admin home's client list.

## Phase

Phase 18 ([spec](../superpowers/specs/2026-10-16-phase-18-client-managers-design.md)). Used by Phases 17 and 20.
