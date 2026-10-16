# Product overview

Spolu (shown to users as "Help by eGrant", see [naming](#naming)) is an internal platform for communicating with clients. It replaces Microsoft Teams for our team. Each client organization gets a group with a chat, a task board and a technical-support (ticket) section. Administrators (our staff) see everything and also manage contracts, which clients never see.

## Requirements

- It is a web application (PWA) that can be installed on a phone and on a computer as an app.
- All changes (messages, tasks, tickets) appear without reloading the page (WebSocket).
- Minimum friction for the client: registration by link, only an email is needed.
- Files and images can be attached everywhere: in group chat messages, in direct messages, to tasks, and in a task's chat.
- Out of scope: calls and video calls are not implemented.
- Only two roles exist: Administrator and Client (see `roles-and-access.md`).
- A client is an organization. One group can have many users from the same client.
- Main areas, each described in its own file: auth, groups, chat, direct messages, task board, AI task split, tickets, contracts, notifications, profile, integrations.

## Naming

- Users see the product as **Help**; the wordmark, page title, PWA name and email footers say **Help by eGrant** (owner decision 2026-10-16; before that "Spolu by eGrant"). The PWA's short name, the iOS home-screen title and the push fallback title are "Help".
- One pattern in both languages: running Slovak text says "aplikácia Help", declined ("v aplikácii Help", "do aplikácie Help", "z aplikácie Help"), never a bare "v Help"; running English text says "the Help app". Email subjects use "Help by eGrant" in English ("Your Help by eGrant login code") and "aplikácia Help" in Slovak ("Váš prihlasovací kód do aplikácie Help").
- Spolu stays the code name: code, `@spolu/*` packages, module names, databases, Docker, env variables, the repository and these docs.
- The public address is https://help.egrant.sk; old domains redirect to it ([runbooks/deploy.md](../runbooks/deploy.md), "Moving to a new domain").

## Phase

Applies to all phases (0-16). See `docs/roadmap.md` for the phase list.
