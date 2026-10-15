# Product overview

eHub is an internal platform for communicating with clients. It replaces Microsoft Teams for our team. Each client organization gets a group with a chat, a task board and a technical-support (ticket) section. Administrators (our staff) see everything and also manage contracts, which clients never see.

## Requirements

- eHub is an internal platform for communication with clients and replaces Teams.
- It is a web application (PWA) that can be installed on a phone and on a computer as an app.
- All changes (messages, tasks, tickets) appear without reloading the page (WebSocket).
- Minimum friction for the client: registration by link, only an email is needed.
- Files and images can be attached everywhere: in group chat messages, in direct messages, to tasks, and in a task's chat.
- Out of scope: calls and video calls are not implemented.
- Only two roles exist: Administrator and Client (see `roles-and-access.md`).
- A client is an organization. One group can have many users from the same client.
- Main areas, each described in its own file: auth, groups, chat, direct messages, task board, AI task split, tickets, contracts, notifications, profile, integrations.
- All open questions from the original specification are closed; there are none.

## Phase

Applies to all phases (1-16). See `docs/roadmap.md` for the phase list.
