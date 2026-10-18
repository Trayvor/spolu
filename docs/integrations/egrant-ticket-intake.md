# eGrant ticket intake: integration guide

For the eGrant developers who send support requests from an eGrant instance to Help by eGrant ("Help", code name Spolu, at https://help.egrant.sk). Help is the eGrant team's own app for talking to clients; every request you send becomes a **ticket** there, with its own chat between the eGrant team and the person who asked.

This page is the full ticket contract. The single entry point for all eGrant webhooks (base URL, key, limits, projects, managers) is [egrant.md](egrant.md).

The product rules behind this guide live in [product/tickets.md](../product/tickets.md) and [product/integrations.md](../product/integrations.md); if they ever disagree with this page, they win.

## What eGrant must send

Live today, on `POST /api/tickets/intake`:

- [ ] `Authorization: Bearer <key>` from your server, never from the browser.
- [ ] Optional, when the Help admin turns it on: `X-Spolu-Timestamp` and `X-Spolu-Signature` on every attempt ([request signing](egrant.md#request-signing-optional)).
- [ ] `instance_url` (which client) and `email` (who asked) on every request.
- [ ] A new `request_id` for every request, reused for its retries.
- [ ] At least one of `subject`, `body` or `area`; files as base64 in `files`.

Planned with Help's Phase 33 (projects; **not live yet**, details in [Projects (planned)](#projects-planned)):

- [ ] **Projects, by their own call** `PUT /api/egrant/projects/<project id>`, whenever you decide (a project is created or changes, or simply again): `instance_url`, `sent_at`, `name`, `description` and the **full** `events` list, each event with `name`, `date` as `dd.mm.yyyy` and `description`. No event ids.
- [ ] **On a ticket about a project:** `project_id`, the same id as in the project call. Nothing else is new on tickets: no project name, no event and no updates. Every request stays a new ticket.

A project:

```bash
curl -sS -X PUT https://help.egrant.sk/api/egrant/projects/prj-208 \
  -H "Authorization: Bearer $SPOLU_TICKETS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instance_url": "https://mesto-x.egrant.sk",
    "sent_at": "2026-10-20T09:15:00+02:00",
    "name": "Kultúra 2026 – festivaly",
    "description": "Grant scheme for summer festivals: call, evaluation, contracts and reports.",
    "events": [
      { "name": "Vyhlásenie výzvy", "date": "01.09.2026", "description": "The call opens." },
      { "name": "Hodnotenie žiadostí", "date": "04.11.2026", "description": "Experts score the applications." },
      { "name": "Podpis zmlúv", "date": "15.12.2026", "description": "" }
    ]
  }'
```

Answer (first time): `201 { "project_id": "prj-208", "state": "created", "skipped": [] }`; later `200`.

A ticket about that project (the fields of "The JSON body" below, plus):

```json
{
  "request_id": "mesto-x-4711",
  "instance_url": "https://mesto-x.egrant.sk",
  "email": "jana.nova@example.sk",
  "subject": "Cannot submit the application",
  "body": "Step 3 shows an error after I upload the budget.",
  "project_id": "prj-208"
}
```

Answer: `201 { "id": "…", "number": 123 }`.

## In short

- One endpoint: `POST https://help.egrant.sk/api/tickets/intake`, JSON body. Files go in the same body, as base64.
  The address was `https://spolu.egrant.sk/api/tickets/intake` until 2026-10-16. The old domain answers with a permanent redirect (`301`), and many HTTP clients turn a redirected POST into a GET without the body, so switch to the new address.
- One shared secret: `Authorization: Bearer <key>`.
- Send a `request_id` with every request and retry with the same id until you get a `2xx`.
- Help answers `201` (created) or `200` (already created for that `request_id`) with `{ "id", "number" }`. There are no callbacks.

## When to call

Call the endpoint once when a user of an eGrant instance submits a support request (the help or contact form, an error report). Call it from your server, never from the user's browser: the key must not reach the browser.

Do not call it for updates of the same request. Everything after the first message happens in Help: the eGrant team and the requester talk in the ticket's chat. (Planned with Phase 33: send projects by their own call, and the project's id on each ticket; see [Projects (planned)](#projects-planned).)

## Authentication

Every request carries the shared key:

```
Authorization: Bearer <key>
Content-Type: application/json
```

The eGrant team gives you the key; on the Help server it is the environment variable `TICKETS_API_KEY` (at least 16 characters). Keep it in your server's secret store. To rotate it, the Help admin sets a new value and restarts Help; requests with the old key then answer `401`. When Help has no key configured, the intake is switched off and answers `503`. Every request counts toward the rate limit before the key is checked, so wrong keys are limited too. The managers and project webhooks may have keys of their own (`EGRANT_MANAGERS_API_KEY`, `EGRANT_PROJECTS_API_KEY`); unset, they use this one.

When the Help admin sets `EGRANT_TICKETS_SIGNING_SECRET`, every intake call must also be signed: `X-Spolu-Timestamp` and `X-Spolu-Signature` over the exact body, a fresh signature for every attempt (a retry with the same `request_id` is signed anew). Otherwise it answers `401`. The scheme, PHP and curl samples are in [egrant.md, Request signing](egrant.md#request-signing-optional).

## The JSON body

Every field is optional, but a ticket needs at least one of `subject`, `body` or `area`. Strings are trimmed; an empty string counts as not given. Unknown fields are ignored. The whole body may be at most 28 MiB (other Help routes take 1 MiB; the intake takes more for the files).

| field | meaning | rules |
|---|---|---|
| `request_id` | your own id of this request, for safe retries | string, 1 to 100 characters; unique per request, for example a UUID or `<instance>-<form id>` |
| `subject` | subject (title) | up to 300 characters |
| `body` | the request text | up to 20 000 characters; plain text, line breaks kept |
| `area` | question area | up to 200 |
| `programme` | grant programme name | up to 200 |
| `requester_name` | the requester's name | up to 200 |
| `email` | the requester's email | a valid email, up to 254; case and spaces do not matter |
| `phone` | the requester's phone number | up to 50 |
| `due_date` | due date | `YYYY-MM-DD`, a real calendar date |
| `url` | the page the request is about | an `http` or `https` URL |
| `files` | files the requester attached (screenshots, documents) | an array of up to 10 file objects, see "Files" below |
| `instance_url` | the eGrant instance the request came from | any URL, up to 2048; see "Client matching" |

Always send `instance_url` and `email`: without them the ticket has no client and no requester account (see below).

`file_links` (links to files) was removed: Help ignores it like any unknown field. Send the files themselves in `files`.

## Files

Each item of `files` is one file, sent whole:

| field | meaning | rules |
|---|---|---|
| `name` | the file name shown in Help, with its extension | 1 to 200 characters; a path (`C:\scans\a.png`, `docs/a.png`) is cut to the last part, control characters and slashes are removed |
| `content_base64` | the file's bytes | standard base64 (`A–Z a–z 0–9 + /`) with `=` padding, on one line: no line breaks, spaces or `data:` prefix (PHP `base64_encode`, Node `buffer.toString('base64')`, Python `base64.b64encode`) |
| `content_type` | the type you think it is | optional, informational only: Help reads the type from the bytes |

Limits: at most **10 files**, each at most **10 MiB** (10 485 760 bytes) decoded, together at most **20 MiB** (20 971 520 bytes) decoded. Base64 is about a third larger, so the body may be up to 28 MiB.

Accepted types (decided from the bytes, the extension only tells Office containers apart):

- images: PNG, JPEG, WebP, GIF;
- PDF;
- Word, Excel, PowerPoint (`.docx`, `.xlsx`, `.pptx` and the old `.doc`, `.xls`, `.ppt`), OpenDocument (`.odt`, `.ods`, `.odp`), ZIP (`.zip`);
- RTF (`.rtf`);
- plain UTF-8 text named `.txt` or `.csv`.

Anything else (programs, scripts, HTML, SVG, a file whose bytes do not match one of the above) is refused with `400`, and so is the whole request: Help stores either all files with the ticket or nothing. Empty files are refused too.

Help stores the files in the client's files and shows them on the ticket: the eGrant team, the client's people and the requester download them there. For a ticket without a client only the eGrant team sees them until a client is assigned; then they move to that client.

## Example

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
    "phone": "+421 900 000 000",
    "due_date": "2026-11-01",
    "url": "https://mesto-x.egrant.sk/applications/4711",
    "instance_url": "https://mesto-x.egrant.sk",
    "files": [
      {
        "name": "chyba.png",
        "content_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
        "content_type": "image/png"
      }
    ]
  }'
```

Answer:

```json
{ "id": "3f0c9a52-1d7e-4f43-9a51-2b8c1e6d7a10", "number": 123 }
```

The file in the example is a real 1×1 pixel PNG; send real files the same way. In a shell, `base64 -w0 file.png` (Linux) or `base64 -i file.png` (macOS) prints the value.

`number` is what people see (`#123`); `id` is Help's internal id. Store them if you want to show the user "Your ticket #123".

## Answers

| status | body | what to do |
|---|---|---|
| `201` | `{ "id": "…", "number": 123 }` | created (also when no client matched) |
| `200` | `{ "id": "…", "number": 123 }` | a ticket with this `request_id` already exists; this is its id and number. Nothing new was created, emailed or notified, even if the rest of the body differs. Treat it like `201`. |
| `400` | `{ "error": "validation_failed", "fields": ["due_date"] }` | a field is malformed (the names are listed; `["body"]` when there is no subject, body or area). A file's field is named with its index: `files[3].content_base64` (not strict base64, empty, or a type Help does not take), `files[0].name`; more than 10 files is `["files"]`. Nothing was stored. Fix the data; do not retry unchanged. |
| `401` | `{ "error": "unauthorized" }` | missing or wrong key. Do not retry; check the configuration. |
| `409` | `{ "error": "group_inactive" }` | the instance's client group is deactivated in Help ([egrant.md, Groups](egrant.md#groups)); nothing was stored. Do not retry; tell the user support for this organisation is closed |
| `413` | `{ "error": "file_too_large", "fields": ["files[1].content_base64"] }` | a file is over 10 MiB decoded (that file is named), or the files are over 20 MiB together (`["files"]`). Nothing was stored. Send smaller files; do not retry unchanged. |
| `413` | (no fixed body) | the whole body is over 28 MiB. Do not retry unchanged. |
| `429` | `{ "error": "rate_limited" }` | more than 60 requests a minute from one IP address (every request counts, also one with a wrong key). Retry later. |
| `503` | `{ "error": "intake_disabled" }` | the intake is switched off on this Help server. Retry later; tell the eGrant team if it lasts. |
| other `5xx`, timeout, network error | | retry |

## Retries and `request_id`

A request can reach Help even when your side sees a timeout. To make retries safe, send a `request_id` and reuse it for every attempt of the same request:

- Retry on a timeout, a network error, `429` and any `5xx`. Do not retry on `400`, `401` or `413`.
- Back off between attempts, for example 1 s, 5 s, 30 s, 2 min, 10 min, then give up and log it.
- The same `request_id` always answers the first ticket (`200`), however often it arrives, also when two attempts arrive at the same moment: Help keeps one ticket per id, for good. So never reuse an id for a different request.
- A repeat with files is answered before they are read: Help never stores the same request's files twice. Send the same files in every attempt all the same.
- Without `request_id`, every request that reaches Help makes a new ticket, so a retry after a lost answer makes a duplicate (with its files).

## What happens in Help

1. **Client matching.** Help compares `instance_url` with the eGrant address stored on each client (group) by host only: the scheme, a leading `www.`, the path and the case do not matter, so `https://WWW.Mesto-X.egrant.sk/app/login` matches `https://mesto-x.egrant.sk`. No match, or no `instance_url`: the ticket is saved **without a client**; only the eGrant team sees it until an admin assigns a client by hand.
2. **The requester.** For a ticket with a client, Help finds the person by `email`. Someone new gets a Help account (named after `requester_name`) with a narrow requester role: they see only their own tickets, never the client's other chats, tasks or files. Without `email` nobody is linked.
3. **"Ticket created" email.** The requester gets one email (Slovak by default) with the number, the subject, the first lines of the text and an **Open the ticket** button. The button leads to Help's login: they enter their email, get a 6-digit code by email and land on the ticket. There is no password. The email goes once per ticket, and only when a client matched (for a ticket without a client, it goes when an admin assigns one).
4. **The eGrant team** hears about the new ticket (the people who watch the client's tickets, by default its managers and its clients, or every admin for a ticket without a client), answers in the ticket's chat, changes its status (New, In progress, Resolved) and may turn it into tasks. The requester follows all of it in Help and gets their own notifications by email.

## Projects (planned)

**Not live yet.** This section describes Help's Phase 33 ([design](../superpowers/specs/2026-10-17-phase-33-projects-design.md), §5). Until it is deployed, `PUT /api/egrant/projects/…` answers `404` and Help ignores `project_id` on tickets like any unknown field. The eGrant team will say when it is live.

Help groups each client's tickets into **projects**, and shows each project's **events** on a timeline. Projects reach Help by their own call, which creates and updates them; a ticket only names its project by id.

### The project call

`PUT https://help.egrant.sk/api/egrant/projects/<project id>`, JSON body, `Authorization: Bearer <key>`: the intake's key, or `EGRANT_PROJECTS_API_KEY` when the Help admin sets one for this webhook. Call it whenever you decide: when a project is created, when it or its events change, or periodically with the whole project. `<project id>` is your stable id of the project (1 to 100 characters, URL-encoded).

| field | meaning | rules |
|---|---|---|
| `instance_url` | the eGrant instance the project belongs to (Help finds the client by host, as for tickets) | required |
| `sent_at` | when you produced this version | required, ISO 8601 with a time zone (`2026-10-20T09:15:00+02:00`) |
| `name` | the project's name | required, 1 to 200 characters |
| `description` | the project's description | plain text, up to 10 000 characters; may be empty |
| `events` | **all** of the project's events, every time | required array of up to 200; `[]` means the project has no events |
| `events[].name` | the event's name | 1 to 200 characters |
| `events[].date` | the event's date | **`dd.mm.yyyy`**, for example `04.11.2026` |
| `events[].description` | the event's description | plain text, up to 10 000 characters; may be empty |

| answer | body | meaning |
|---|---|---|
| `201` | `{ "project_id", "state": "created", "skipped" }` | Help did not know the project: it created it with its events |
| `200` | `{ "project_id", "state", "pending", "skipped" }` | Help knew it. `state`: `unchanged` (nothing differs), `pending` (differences wait for the eGrant team's review, `pending` = how many), `stale` (your `sent_at` is older than a version Help already has) |
| `202` | `{ "project_id", "state": "stored" }` | no client in Help has this instance yet; Help keeps the latest version for 180 days and uses it when the client is created |
| `400` | `{ "error": "validation_failed", "fields": [...] }` | a malformed field; nothing was stored |
| `401`, `413`, `429`, `503` | | as for the intake; at most 120 project calls a minute from one IP address |

- **Idempotent.** The body is the project's full state. Sending the same body again answers `200 unchanged`; retry on timeouts, `429` and `5xx` with the same body. `sent_at` makes a late retry harmless.
- **Dates.** An event whose `date` is not a real `dd.mm.yyyy` date (`31.02.2026`, `4.11.2026`, `2026-11-04`), or whose `name` is empty, is **skipped**: Help logs it, names it in `skipped` (for example `["events[2].date"]`) and processes the rest. Send it again corrected.
- **Changes are reviewed, not applied.** The first version creates the project. After that, Help never changes what it shows silently: a different name, description, event name, date or description, a new event, or an event missing from the list becomes a "change from eGrant" that the eGrant team or the client accepts or dismisses field by field. An event is never deleted because it is missing. A value they dismissed stays dismissed until you send a different one.
- **Events have no ids, so Help recognises them by name and date.** Keep an event's name stable when its date moves, and its date stable when it is renamed:
  - same name and date: the same event;
  - same name, another date: Help proposes a date change of that event;
  - same date, another name: Help proposes a rename;
  - **renamed and moved in the same version, or two events with the same name or the same date:** Help cannot tell, and proposes a new event plus the removal of the old one. If you can, change the name and the date in two separate versions.

### Tickets: the project id

One new optional field on `POST /api/tickets/intake`:

| field | meaning | rules |
|---|---|---|
| `project_id` | your id of the project the request is about | 1 to 100 characters; the same id as in the project call; empty or missing means no project |

Every request is still a new ticket; many tickets can share one project. There are no ticket updates: send each request once (with retries, as above).

- **The project is known** to Help for that client: the ticket is placed in it.
- **Not known yet**, because the project call has not arrived: Help keeps the id, and the ticket joins the project as soon as the project call delivers it.
- **The ticket has no client**: Help keeps the id and places the ticket when the eGrant team assigns the client.
- Help never sets a ticket's **event** from eGrant: the eGrant team and the client choose it in Help.
- Once the ticket has a project, it belongs to the people in Help. Nothing you send later changes it.

The answers do not change (`201`, or `200` for a repeated `request_id`).

## What Help does not do

- **No callbacks or webhooks.** Help never calls eGrant back; status changes and replies stay in Help.
- **No status API.** There is no endpoint for eGrant to read a ticket later.
- **No separate file upload.** Files travel only in `files` of the one request; later files the requester attaches in the ticket's chat.
- **No links to files.** `file_links` is gone; Help never downloads anything from eGrant.
