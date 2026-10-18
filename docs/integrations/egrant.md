# eGrant integration guide

The single entry point for the eGrant developers who connect an eGrant instance to Help by eGrant ("Help", code name Spolu). Help is the eGrant team's own app for talking to clients (group chat, task boards, support tickets, knowledge base). This page covers what is common to every call (addresses, key, limits, errors) and one section per webhook. Product rules win over this page if they ever disagree: [product/integrations.md](../product/integrations.md), [product/tickets.md](../product/tickets.md).

## Overview

eGrant calls Help; Help never calls eGrant back (no callbacks, no status API). All calls are server to server, JSON, with one shared key.

| webhook | call | status | what it does in Help |
|---|---|---|---|
| [Tickets](#tickets) | `POST /api/tickets/intake` | live | a support request from an eGrant user becomes a ticket with its own chat |
| [Projects](#projects) | `PUT /api/egrant/projects/<project id>` and `project_id` on tickets | available after release (Phase 33: built, live with the next release) | creates and updates a client's projects and their events |
| [Managers](#managers) | `PUT /api/egrant/managers` | pending: being changed (see the section) | adds or deactivates a client user in a client's group |

Every call identifies the client by `instance_url`: Help compares it with the eGrant address stored on each client (group) **by host only**. The scheme, a leading `www.`, the path and the case do not matter, so `https://WWW.Mesto-X.egrant.sk/app/login` matches `https://mesto-x.egrant.sk`.

## Base URL

| environment | base URL |
|---|---|
| test | `https://help.egrant.sk` |
| production | `https://help.egrant.sk` (the same address for now; the eGrant team says if a separate server appears) |

The old `https://spolu.egrant.sk` answers a permanent redirect (`301`). Many HTTP clients turn a redirected POST or PUT into a GET without the body, so use the new address.

## Authentication

Every call carries the same shared key:

```
Authorization: Bearer <key>
Content-Type: application/json
```

- **One key for all webhooks.** There is no second key, so there is one secret to rotate.
- **Who issues it:** the eGrant team (the Help admin). On the Help server it is the environment variable `TICKETS_API_KEY`, at least 16 characters. You receive the value out of band; keep it in your server's secret store and call only from your server, never from a browser.
- **Rotation:** the Help admin sets a new value and restarts Help; calls with the old key answer `401` from then on. Agree the switch time with the eGrant team and deploy the new key on your side at the same moment.
- **No key configured** on the Help server: every webhook is off and answers `503 intake_disabled`.

## Limits and common errors

| status | body | meaning | what to do |
|---|---|---|---|
| `400` | `{ "error": "validation_failed", "fields": ["email"] }` | a field is malformed (or the JSON is); the names are listed; nothing was stored | fix the data; do not retry unchanged |
| `401` | `{ "error": "unauthorized" }` | missing or wrong key | check the configuration; do not retry |
| `413` | `file_too_large` or no fixed body | the body or a file is over the limit | send less; do not retry unchanged |
| `429` | `{ "error": "rate_limited" }` | too many calls from one IP address in a minute | retry later |
| `503` | `{ "error": "intake_disabled" }` | no key configured on this Help server | retry later; tell the eGrant team if it lasts |
| other `5xx`, timeout, network error | | | retry with the same body |

| webhook | body limit | calls a minute per IP address |
|---|---|---|
| tickets | 28 MiB (files travel as base64 in the body) | 60 |
| projects | 1 MiB | 120 |
| managers | 16 KiB | 60 |

The checks run before the body is read. `503` always comes first. After it the tickets and projects calls check the key (`401`) and then the limit (`429`); the managers call checks the limit first, so a wrong key counts against it.

Retry on a timeout, a network error, `429` and any `5xx`; back off between attempts (for example 1 s, 5 s, 30 s, 2 min, 10 min, then give up and log it). Do not retry `400`, `401` or `413` unchanged. Every webhook is built so that a repeat is harmless; the details are in each section.

## Tickets

`POST /api/tickets/intake`. Call it once when a user of an eGrant instance submits a support request (the help or contact form, an error report). Everything after the first message happens in Help, in the ticket's chat. Do not call it for updates.

This section is the short form. The full field list, the file rules (types, sizes, base64) and every answer are in [egrant-ticket-intake.md](egrant-ticket-intake.md).

Send `instance_url` (which client) and `email` (who asked) every time, a new `request_id` for every request (reused for its retries), and at least one of `subject`, `body` or `area`.

```bash
curl -sS https://help.egrant.sk/api/tickets/intake \
  -H "Authorization: Bearer $SPOLU_TICKETS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "mesto-x-4711",
    "subject": "Cannot submit the application",
    "body": "Step 3 shows an error after I upload the budget.",
    "area": "Submission",
    "programme": "Culture 2026",
    "requester_name": "Jana Nová",
    "email": "jana.nova@example.sk",
    "instance_url": "https://mesto-x.egrant.sk"
  }'
```

Answer, `201` (created) or `200` (a ticket with this `request_id` exists already):

```json
{ "id": "3f0c9a52-1d7e-4f43-9a51-2b8c1e6d7a10", "number": 123 }
```

`number` is what people see (`#123`); store it if you want to show "Your ticket #123".

**Idempotency.** `request_id` (1 to 100 characters) is the key: Help keeps one ticket per id, for good, also when two attempts arrive at the same moment. A repeat answers `200` with the first ticket's id and number, creates, emails and notifies nothing, and ignores the rest of the body (files are not read again). Never reuse an id for a different request. Without `request_id` every request makes a new ticket, so a retry after a lost answer makes a duplicate.

**What Help does:**

1. Finds the client by `instance_url`. No match, or no `instance_url`: the ticket is saved without a client and only the eGrant team sees it until an admin assigns one.
2. For a ticket with a client, finds the requester by `email`; someone new gets a Help account with a narrow requester role (only their own tickets).
3. Sends the requester one "Ticket created" email with an **Open the ticket** button (login by a 6-digit code; no password). It goes once per ticket, and only when a client matched.
4. Tells the eGrant team (the people who watch the client's tickets). They answer in the ticket's chat and change its status; the requester follows it in Help.

## Projects

**Available after release.** This is Help's Phase 33 (design: [spec](../superpowers/specs/2026-10-17-phase-33-projects-design.md), §5). It is built, but until it is deployed `PUT /api/egrant/projects/...` answers `404` and `project_id` on tickets is ignored like any unknown field. The eGrant team says when it is live.

Help groups each client's tickets into **projects** and shows each project's **events** on a timeline. Projects reach Help by their own call; a ticket only names its project by id.

### The project call

`PUT /api/egrant/projects/<project id>`; `<project id>` is your stable id of the project, 1 to 100 characters, URL-encoded. Call it whenever you decide: a project is created, it or its events change, or periodically with the whole project.

| field | meaning | rules |
|---|---|---|
| `instance_url` | the eGrant instance the project belongs to | required |
| `sent_at` | when you produced this version | required, ISO 8601 with a time zone (`2026-10-20T09:15:00+02:00`) |
| `name` | the project's name | required, 1 to 200 characters |
| `description` | the project's description | plain text, up to 10 000 characters; may be empty |
| `events` | **all** of the project's events, every time | required array of up to 200; `[]` means no events |
| `events[].name` | the event's name | 1 to 200 characters |
| `events[].date` | the event's date | `dd.mm.yyyy`, for example `04.11.2026` |
| `events[].description` | the event's description | plain text, up to 10 000 characters; may be empty |

```bash
curl -sS -X PUT https://help.egrant.sk/api/egrant/projects/prj-208 \
  -H "Authorization: Bearer $SPOLU_TICKETS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instance_url": "https://mesto-x.egrant.sk",
    "sent_at": "2026-10-20T09:15:00+02:00",
    "name": "Kultúra 2026 – festivaly",
    "description": "Grant scheme for summer festivals.",
    "events": [
      { "name": "Vyhlásenie výzvy", "date": "01.09.2026", "description": "The call opens." },
      { "name": "Hodnotenie žiadostí", "date": "04.11.2026", "description": "Experts score the applications." }
    ]
  }'
```

| answer | body | meaning |
|---|---|---|
| `201` | `{ "project_id": "prj-208", "state": "created", "skipped": [] }` | Help did not know the project and created it with its events |
| `200` | `{ "project_id", "state", "pending", "skipped" }` | Help knew it. `state`: `unchanged`, or `pending` (differences wait for review; `pending` is how many). If your `sent_at` is older than a version Help already has, the body is just `{ "project_id", "state": "stale" }` |
| `202` | `{ "project_id", "state": "stored" }` | no client in Help has this instance yet; Help keeps the latest version for 180 days and uses it when the client is created |
| `400`, `401`, `413`, `429`, `503` | | as in [Limits and common errors](#limits-and-common-errors); `400` also names `project_id` when the id in the URL is invalid |

**Idempotency.** The body is the project's full state. The same body again answers `200 unchanged`; retry with the same body. `sent_at` makes a late retry harmless (`stale`).

**What Help does:**

- The first version creates the project. After that Help never changes what it shows silently: a different name, description, event name, date or description, a new event, or an event missing from the list becomes a "change from eGrant" that the eGrant team or the client accepts or dismisses field by field. An event is never deleted because it is missing. A dismissed value stays dismissed until you send a different one.
- **Skipped events.** An event whose `date` is not a real `dd.mm.yyyy` date (`31.02.2026`, `4.11.2026`, `2026-11-04`) or whose `name` is empty is skipped; the rest is processed. `skipped` names it (`["events[2].date"]`, `["events[3].name"]`); an event with the same name and date as an earlier one of the list is skipped too (`["events[4]"]`). Help logs where and why, never the text. Send it again corrected.
- **Events have no ids**, so Help recognises them by name and date. Same name and date: the same event. Same name, another date: a proposed date change. Same date, another name: a proposed rename. Renamed and moved in the same version, or two events with the same name or date: Help cannot tell and proposes a new event plus the removal of the old one. Change the name and the date in two separate versions when you can.
- **Merged projects.** When people in Help merge two projects, the merged project's id keeps working: its later calls and tickets go to the project it was merged into, and its calls only propose changes there.
- Open Help screens of the client update at once.

### Tickets: the project id

One new optional field on the ticket intake: `project_id` (1 to 100 characters, the id of the project call; empty or missing means no project).

```json
{
  "request_id": "mesto-x-4712",
  "instance_url": "https://mesto-x.egrant.sk",
  "email": "jana.nova@example.sk",
  "subject": "Cannot submit the application",
  "project_id": "prj-208"
}
```

The answer is the usual `201 { "id", "number" }` (or `200` for a repeated `request_id`). Every request stays a new ticket; many tickets can share a project. If the project is known for that client, the ticket is placed in it; if the project call has not arrived yet, Help keeps the id and places the ticket when it does; for a ticket without a client, when the eGrant team assigns one. Help never sets a ticket's event from eGrant, and nothing you send later moves the ticket.

## Managers

**Pending: being changed.** This webhook is being reworked (branch `fix/egrant-managers-clients`). Today it adds or removes an administrator as a client's manager (see [egrant-managers.md](egrant-managers.md)); the contract below is the target. Do not build against it until the eGrant team confirms it is deployed.

`PUT /api/egrant/managers` makes a person a **client user** of one client's group, or removes them from it. It is for the people of the client, not for the eGrant team's administrators.

| field | meaning | rules |
|---|---|---|
| `instance_url` | the eGrant instance whose client is meant | required; a URL or a bare host (`mesto-x.egrant.sk`), up to 2048 characters; matched by host |
| `email` | the person's email | required, a valid email up to 254 characters; case and spaces do not matter |
| `active` | `true`: the person is a user of that client's group; `false`: they are not | required boolean |
| `name` | the person's name, used when the account is created | optional |

```bash
curl -sS -X PUT https://help.egrant.sk/api/egrant/managers \
  -H "Authorization: Bearer $SPOLU_TICKETS_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "instance_url": "https://mesto-x.egrant.sk", "email": "jana.nova@example.sk", "active": true, "name": "Jana Nová" }'
```

Answer, `200`:

```json
{ "state": "created", "group_id": "0b7c…", "user_id": "c41e…" }
```

| status | body | meaning |
|---|---|---|
| `200` | `{ "state": "added" / "created" / "removed" / "unchanged", "group_id", "user_id" }` | `created`: a new account was made and added; `added`: an existing account was added to the group; `removed`: taken out of the group; `unchanged`: it was so already |
| `404` | `{ "error": "unknown_instance" }` | no client in Help has this instance; nothing is stored. Send it again after the client exists |
| `422` | `{ "error": "email_is_admin" }` | the email belongs to an eGrant administrator; nothing changed |
| `422` | `{ "error": "user_disabled" }` | the account is disabled; nothing changed |
| `400`, `401`, `413`, `429`, `503` | | as in [Limits and common errors](#limits-and-common-errors); body at most 16 KiB; 60 calls a minute per IP address |

**Idempotency.** Send the state you want. `active: true` for a person already in the group, and `active: false` for one who is not, answer `200 unchanged` and do nothing.

**What Help does:**

- `active: true`: creates the client user if missing, adds them to the client group and sends them an invitation email.
- `active: false`: removes them from that group only; the account and their other groups stay.
- Only the client matched by `instance_url` changes. Help never calls eGrant back.

## Related documents

- [egrant-ticket-intake.md](egrant-ticket-intake.md): the full ticket contract (every field, files, every answer).
- [egrant-managers.md](egrant-managers.md): the managers webhook as it behaves today (administrators), until the rework is deployed.
- [product/integrations.md](../product/integrations.md): the product reference for all external systems.
