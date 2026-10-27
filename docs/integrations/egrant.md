# eGrant integration guide

The single entry point for the eGrant developers who connect an eGrant instance to Help by eGrant ("Help", code name Spolu). Help is the eGrant team's own app for talking to clients (group chat, task boards, support tickets, knowledge base). This page covers what is common to every call (addresses, key, limits, errors) and one section per webhook. Product rules win over this page if they ever disagree: [product/integrations.md](../product/integrations.md), [product/tickets.md](../product/tickets.md).

## Overview

eGrant calls Help; Help never calls eGrant back (no callbacks, no status API). All calls are server to server, JSON, with one shared key.

| webhook | call | status | what it does in Help |
|---|---|---|---|
| [Tickets](#tickets) | `POST /api/tickets/intake` | live | a support request from an eGrant user becomes a ticket with its own chat |
| [Projects](#projects) | `PUT /api/egrant/projects/<project id>` and `project_id` on tickets | live with the next release (Phase 33) | creates and updates a client's projects and their events |
| [Groups](#groups) | `PUT /api/egrant/groups` | live with the next release | creates a client's group, updates its name and logo, deactivates or reactivates it |
| [Managers](#managers) | `PUT /api/egrant/managers` | live | adds or deactivates a client user in a client's group |
| [Ticket areas](#ticket-areas) | `PUT /api/egrant/ticket-areas` | live with the next release | sets eGrant's rows of a client's table of question area → responsible admin; new tickets of that area get the admin as an assignee |

Every call identifies the client by `instance_url`: Help compares it with the eGrant address stored on each client (group) **by host only**. The scheme, a leading `www.`, the path and the case do not matter, so `https://WWW.Mesto-X.egrant.sk/app/login` matches `https://mesto-x.egrant.sk`.

## Base URL

| environment | base URL |
|---|---|
| test | `https://help.egrant.sk` |
| production | `https://help.egrant.sk` (the same address for now; the eGrant team says if a separate server appears) |

The old `https://spolu.egrant.sk` answers a permanent redirect (`301`). Many HTTP clients turn a redirected POST or PUT into a GET without the body, so use the new address.

## Authentication

Every call carries a Bearer key:

```
Authorization: Bearer <key>
Content-Type: application/json
```

- **One key for all webhooks** by default, so there is one secret to rotate. The groups, managers and projects calls may each get their own key: when the Help server sets `EGRANT_GROUPS_API_KEY` (`EGRANT_MANAGERS_API_KEY`, `EGRANT_PROJECTS_API_KEY`), only that key opens that call (the shared key then answers `401` there); unset, the shared key opens it like the others.
- **A separate `EGRANT_GROUPS_API_KEY` is strongly recommended in production.** Without it, the shared ticket-intake key (`TICKETS_API_KEY`) falls back to the groups call, and whoever holds it can **create any client group and deactivate any client group** in Help, not only send tickets. The fallback stays for compatibility (review V13, 2026-10-18); set the groups key on every server where the ticket key is held by more than the one eGrant server.
- **Who issues it:** the eGrant team (the Help admin). On the Help server it is the environment variable `TICKETS_API_KEY`, at least 16 characters (`EGRANT_GROUPS_API_KEY` likewise). You receive the value out of band; keep it in your server's secret store and call only from your server, never from a browser.
- **Rotation:** the Help admin sets a new value and restarts Help; calls with the old key answer `401` from then on. Agree the switch time with the eGrant team and deploy the new key on your side at the same moment.
- **No key configured** on the Help server: every webhook is off and answers `503 intake_disabled`.
- **Optionally, signed requests** on top of the key: see [Request signing](#request-signing-optional).

## Request signing (optional)

The Help admin can require that the calls of a webhook are signed, so that a request seen in a log or on the way cannot be changed or replayed ([ADR 0042](../decisions/0042-egrant-webhook-hmac-signing.md)). The Bearer key stays required; the signature is extra.

**Headers**, on every call to a signed webhook:

```
X-Spolu-Timestamp: 1792345678
X-Spolu-Signature: sha256=<64 hex digits>
```

- `X-Spolu-Timestamp`: the current time in unix seconds (an integer).
- `X-Spolu-Signature`: `sha256=` and the lowercase hex of HMAC-SHA256 with the webhook's signing secret over `"<timestamp>.<raw body>"`: the timestamp, a dot, then the **exact bytes** of the body you send. Serialise the JSON once, sign that string and send that same string; re-encoding it (other spacing, key order or escaping) breaks the signature.
- **The secret** is per webhook (on the Help server `EGRANT_TICKETS_SIGNING_SECRET`, `EGRANT_MANAGERS_SIGNING_SECRET`, `EGRANT_GROUPS_SIGNING_SECRET`, `EGRANT_PROJECTS_SIGNING_SECRET`), at least 32 characters, from the Help admin out of band. Keep it like the key: never in code, logs or URLs.

**Rules:**

- The timestamp must be within **±300 s** of Help's clock: keep the eGrant server's clock NTP-synced.
- **Sign every attempt anew**, retries included, with a fresh timestamp. Help remembers the signatures it took during the window, and the same signature again answers `401` (a replay).
- A webhook with a signing secret answers `401 unauthorized` for a missing, malformed, stale, wrong or repeated signature, after the key check and before the body is used. A webhook without one ignores the headers, so you can send them before the Help admin turns the check on.
- **Turning it on:** 1. the Help admin gives you the secret; 2. eGrant starts signing (nothing changes yet); 3. the Help admin sets the secret on Help and restarts it. **Rotation:** the same steps with a new secret; agree the moment of step 3.

**PHP** (eGrant):

```php
<?php
// $secret: the webhook's signing secret; $key: its Bearer key; $payload: the array to send.
$body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
$timestamp = (string) time();
$signature = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $secret);

$ch = curl_init('https://help.egrant.sk/api/egrant/managers');
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => 'PUT',
    CURLOPT_POSTFIELDS => $body, // exactly the signed bytes
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $key,
        'Content-Type: application/json',
        'X-Spolu-Timestamp: ' . $timestamp,
        'X-Spolu-Signature: ' . $signature,
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
]);
$answer = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
```

A retry calls this again from `time()` on: a new timestamp and a new signature.

**curl and openssl** (testing by hand):

```bash
BODY='{"instance_url":"https://mesto-x.egrant.sk","email":"jana@example.com","active":true}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SPOLU_MANAGERS_SIGNING_SECRET" | sed 's/^.*= //')
curl -sS -X PUT https://help.egrant.sk/api/egrant/managers \
  -H "Authorization: Bearer $SPOLU_TICKETS_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Spolu-Timestamp: $TS" \
  -H "X-Spolu-Signature: sha256=$SIG" \
  --data-binary "$BODY"
```

Use `--data-binary` (or `-d` with the same string) so curl sends exactly the bytes you signed; `printf '%s.%s'` adds no newline.

## Limits and common errors

| status | body | meaning | what to do |
|---|---|---|---|
| `400` | `{ "error": "validation_failed", "fields": ["email"] }` | a field is malformed (or the JSON is); the names are listed; nothing was stored | fix the data; do not retry unchanged |
| `401` | `{ "error": "unauthorized" }` | missing or wrong key; on a signed webhook also a missing, wrong, stale or repeated signature | check the configuration and the clock; do not retry unchanged (a retry must be signed anew) |
| `409` | `{ "error": "group_inactive" }` | the client's group is deactivated in Help (tickets, managers, projects) | do not retry; resend after it is reactivated |
| `413` | `file_too_large` or no fixed body | the body or a file is over the limit | send less; do not retry unchanged |
| `429` | `{ "error": "rate_limited" }` | too many calls from one IP address in a minute | retry later |
| `503` | `{ "error": "intake_disabled" }` | no key configured on this Help server | retry later; tell the eGrant team if it lasts |
| other `5xx`, timeout, network error | | | retry with the same body |

| webhook | body limit | calls a minute per IP address |
|---|---|---|
| tickets | 28 MiB (files travel as base64 in the body) | 60 |
| projects | 1 MiB | 120 |
| groups | 3 MiB (a logo of up to 2 MiB, an SVG up to 512 KiB, travels as base64) | 60 |
| managers | 16 KiB | 60 |

The checks run before the body is read, in the same order on every webhook: `503`, then the limit (`429`), then the key (`401`); a wrong key counts against the limit.

Retry on a timeout, a network error, `429` and any `5xx`; back off between attempts (for example 1 s, 5 s, 30 s, 2 min, 10 min, then give up and log it). Do not retry `400`, `401`, `409` or `413` unchanged (nor `404`, `415`, `422`). Every webhook is built so that a repeat is harmless; the details are in each section.

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

1. Finds the client by `instance_url`. No match, or no `instance_url`: the ticket is saved without a client and only the eGrant team sees it until an admin assigns one. A **deactivated** client (see [Groups](#groups)) answers `409 { "error": "group_inactive" }` and nothing is stored: tell the user that support for this organisation is closed; do not retry.
2. For a ticket with a client, finds the requester by `email`; someone new gets a Help account with a narrow requester role (only their own tickets).
3. Sends the requester one "Ticket created" email with an **Open the ticket** button (login by a 6-digit code; no password). It goes once per ticket, and only when a client matched.
4. Tells the eGrant team (the people who watch the client's tickets). They answer in the ticket's chat and change its status; the requester follows it in Help.

## Projects

**Live with the next release.** This is Help's Phase 33 (design: [spec](../superpowers/specs/2026-10-17-phase-33-projects-design.md), §5). On a Help server without it, `PUT /api/egrant/projects/...` answers `404` and `project_id` on tickets is ignored like any unknown field.

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
| `test` | a test project (for example a demo or a trial call) | optional `true`/`false`; Help sets it as sent at once, no review; left out, Help keeps what it has |

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
| `409` | `{ "error": "group_inactive" }` | the client's group is deactivated in Help; nothing was stored. Do not retry; send the project again after the group is reactivated |
| `400`, `401`, `413`, `429`, `503` | | as in [Limits and common errors](#limits-and-common-errors); `400` also names `project_id` when the id in the URL is invalid |

**Idempotency.** The body is the project's full state. The same body again answers `200 unchanged`; retry with the same body. `sent_at` makes a late retry harmless (`stale`).

**What Help does:**

- **`test`** marks a test project. Help shows it with a small "Test" label and leaves it off the client's timeline unless people ask for test projects. It is the one field Help takes over at once (on the first and every later version, never as a change to review); a version without it leaves the flag as it is, a `stale` one changes nothing. Nobody can change it in Help.
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

## Groups

`PUT /api/egrant/groups` creates the **client group** of an eGrant instance (one client organisation), keeps its name and logo in step with eGrant, and deactivates or reactivates it. Until now admins created every group by hand in Help; with this call eGrant does it. Call it:

- when an instance (client organisation) is created in eGrant;
- when its name or logo changes;
- with `active: false` only when an eGrant operator **explicitly** deactivates or closes the client's instance, and `active: true` when an operator restores it. Never derive `active` from contract dates or any other automatic rule: a contract that ends (in eGrant or in Help's finance) does not deactivate a group;
- before the managers call for that instance (a member needs the group: the managers call answers `404 unknown_instance` until it exists).

When the Help admin sets `EGRANT_GROUPS_SIGNING_SECRET`, every groups call must also be signed ([Request signing](#request-signing-optional)), or it answers `401`.

| field | meaning | rules |
|---|---|---|
| `instance_url` | the eGrant instance | required; a URL or a bare host (`mesto-x.egrant.sk`), up to 2048 characters; matched by host like every call |
| `name` | the client's name, shown in Help | required, 1 to 100 characters after trimming |
| `logo` | the client's logo | optional. Missing: the current logo stays. `null`: the logo is removed. An object `{ "content_type", "data_base64" }`: the new logo |
| `logo.content_type` | the image type | `image/png`, `image/jpeg`, `image/webp` or `image/svg+xml`; anything else, GIF included, is `415`. An SVG is converted to a PNG (below) |
| `logo.data_base64` | the image bytes | strict base64 (standard alphabet, padded, no line breaks), at most 2 MiB decoded (an SVG at most 512 KiB); the bytes must be a complete image of the declared type; a PNG, JPEG or WebP at most 4096 px on its longer side; an SVG at most 16384 units on its longer side, with no embedded images |
| `active` | the group's state | optional boolean. `false`: deactivate; `true`: reactivate. Missing: the state does not change (so a name sync never undoes a deactivation). A new group is always active |

Unknown fields are ignored. The body may be at most 3 MiB.

```bash
LOGO=$(base64 < logo.png | tr -d '\n')
curl -sS -X PUT https://help.egrant.sk/api/egrant/groups \
  -H "Authorization: Bearer $SPOLU_GROUPS_KEY" \
  -H "Content-Type: application/json" \
  -d "{ \"instance_url\": \"https://mesto-x.egrant.sk\", \"name\": \"Mesto X\",
        \"logo\": { \"content_type\": \"image/png\", \"data_base64\": \"$LOGO\" } }"
```

Answer, `201` for a new group, else `200`:

```json
{ "state": "created", "group_id": "0b7c9f2e-…" }
```

| status | body | meaning |
|---|---|---|
| `201` | `{ "state": "created", "group_id" }` | no group had this instance; Help created it (a client group with its own invite link, no members yet) |
| `200` | `{ "state": "updated" / "unchanged" / "deactivated" / "reactivated", "group_id" }` | `updated`: the name or the logo changed; `unchanged`: nothing to change; `deactivated` / `reactivated`: the state changed (a new name or logo sent with it is applied too) |
| `400` | `{ "error": "validation_failed", "fields": [...] }` | a field is malformed: `instance_url` (also for a non-http address), `name`, `logo.content_type`, `logo.data_base64` (not strict base64) |
| `404` | `{ "error": "unknown_instance" }` | `active: false` for an instance Help does not know; nothing is created |
| `409` | `{ "error": "ambiguous_instance" }` | two groups in Help share this host (an admin set the same address twice); nothing changes until the eGrant team fixes it |
| `413` | `{ "error": "file_too_large", "fields": ["logo.data_base64"] }` | the logo is over 2 MiB decoded, an SVG over 512 KiB (a body over 3 MiB answers `413` without this body) |
| `415` | `{ "error": "unsupported_type", "fields": ["logo.content_type"] }` | the declared type is not PNG, JPEG, WebP or SVG |
| `422` | `{ "error": "invalid_logo", "fields": ["logo.data_base64"] }` | the bytes are not a complete image of the declared type (text, an SVG declared as PNG, a JPEG declared as PNG, a cut-off file); a PNG, JPEG or WebP over 4096 px on a side (read from its header); an SVG that does not parse, has no size or is over 16384 units on a side; or an SVG with an image element (`<image>`, `<feImage>`), a `data:` URI anywhere, an entity declaration or an `href` other than a local `#id`; a gzipped SVG (SVGZ) |
| `401`, `429`, `503` | | as in [Limits and common errors](#limits-and-common-errors); 60 calls a minute per IP address |

Nothing is stored when the answer is `4xx`: a refused logo also leaves the name as it was.

**Idempotency.** The call sends the state you want and is keyed by the instance's host: the same body again answers `200 unchanged`, also with the same logo (Help compares the image after cleaning it, below). Two first calls at the same moment make one group (one answers `201`, the other `200`). Retry with the same body.

**What Help does:**

- Finds the group by host, as every call does. A group an admin created in Help earlier is found and updated; its stored address stays as the admin typed it.
- A new group gets the same defaults as one created in the app: a client group with a fresh invite link, no members and no managers.
- The logo is checked by its bytes, not by its declared type, and its metadata (EXIF with GPS and camera data, XMP, IPTC, text chunks, comments, anything after the image's end) is removed before it is stored; the pixels and the colour profile are kept. PNG, JPEG and WebP are not resized. **An SVG is converted to a PNG** whose longer side is 512 px (the ratio is kept) and only that PNG is stored and served, never the SVG ([ADR 0039](../decisions/0039-svg-logos-rendered-to-png-with-resvg-wasm.md)). The converter runs no scripts and loads nothing outside the file: `<script>`, event handlers and `<foreignObject>` draw nothing. An SVG with any image in it (an `<image>` or `<feImage>` element, a `data:` URI, a link other than a local `#id`) is refused with `422`, so draw the logo as vector shapes (2026-10-18: an embedded bitmap was decoded at full size and could stall the server). No fonts are loaded, so convert text in an SVG logo to paths, or it will be missing.
- It never deletes a group, and never adds, removes or changes members or managers (the [managers call](#managers) does members).
- **Deactivation** (`active: false`, the same action as "Deactivate" in the app): the group's clients and requesters lose access to it at once (their accounts stay), it disappears from Help's lists, nothing new can be added to it, its pending notifications stop. Nothing is deleted. While it is deactivated the [ticket intake](#tickets) and the [managers call](#managers) for its instance answer `409 group_inactive`. `active: true` brings everything back as it was.

## Managers

`PUT /api/egrant/managers` makes a person a **client user** of one client's group, or removes them from it. It is for the people of the client, not for the eGrant team's administrators.

| field | meaning | rules |
|---|---|---|
| `instance_url` | the eGrant instance whose client is meant | required; a URL or a bare host (`mesto-x.egrant.sk`), up to 2048 characters; matched by host |
| `email` | the person's email | required, a valid email up to 254 characters; case and spaces do not matter |
| `active` | `true`: the person is a user of that client's group; `false`: they are not | required boolean |
| `name` | the person's name, used when the account is created | optional, up to 100 characters; used only when the account is created or has no name yet |

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
| `200` | `{ "state": "added" / "created" / "removed" / "unchanged", "group_id", "user_id" }` | `created`: a new account was made and added; `added`: an existing account was added to the group; `removed`: taken out of the group; `unchanged`: it was so already; `user_id` is `null` for `active: false` with an email Help does not know |
| `404` | `{ "error": "unknown_instance" }` | no client in Help has this instance; nothing is stored. Send it again after the client exists |
| `422` | `{ "error": "email_is_admin" }` | the email belongs to an eGrant administrator; nothing changed |
| `409` | `{ "error": "group_inactive" }` | the client's group is deactivated (see [Groups](#groups)); nothing changed. Send the state again after it is reactivated |
| `422` | `{ "error": "user_disabled" }` | (`active: true` only) the account is disabled; nothing changed |
| `400`, `401`, `413`, `429`, `503` | | as in [Limits and common errors](#limits-and-common-errors); body at most 16 KiB; 60 calls a minute per IP address |

**Idempotency.** Send the state you want. `active: true` for a person already in the group, and `active: false` for one who is not, answer `200 unchanged` and do nothing.

**What Help does:**

- `active: true`: creates the client user if missing, adds them to the client group and sends them an invitation email.
- `active: false`: removes them from that group only; the account and their other groups stay.
- Only the client matched by `instance_url` changes. Help never calls eGrant back.

## Ticket areas

`PUT /api/egrant/ticket-areas` sends, for one instance, the **whole list of question areas and the eGrant team admin responsible for each** (2026-10-21, "Automatické priraďovanie riešiteľov"). Help keeps it as the client's table of area → admin; every new ticket of that client whose area matches a row gets that admin as an assignee (riešiteľ) automatically, with the same notification as a manual assignment ([product/tickets.md](../product/tickets.md#automatic-assignees-by-area-2026-10-21)).

- **Replaces eGrant's rows only** (2026-10-22, ADR 0069). The list you send becomes the client's **eGrant rows**: eGrant rows not in it are removed. Rows the client's people or admins added in Help are kept, and Help cannot change your rows (they show there read-only, "Z eGrantu"). An empty `areas` list empties your rows. When the same area and person are both in Help and in your list, they are assigned once.
- **Same key and signing as the [groups call](#groups):** `EGRANT_GROUPS_API_KEY` when set, else the shared key; when `EGRANT_GROUPS_SIGNING_SECRET` is set, the call must be signed ([Request signing](#request-signing-optional)) or it answers `401`.
- **Emails are matched to active Help admins**, case-insensitively. A row whose email is no active admin (unknown, a client, a deactivated admin) is skipped, returned in `unmatched` and logged on the Help server; Help never creates a user.
- **Matching of areas** (on both sides, the rows and the tickets' `area`): case, spaces at the ends, runs of whitespace and diacritics do not matter, and a leading lower-case `zend.` / `zend ` (or `zend` before a capital letter, `zendProjekty`) is ignored, so `zend.Projekty`, `zend Projekty` and ` projekty ` are the same area. One area may list several admins (several rows); the same area and email twice count once.

| field | meaning | rules |
|---|---|---|
| `instance_url` | the eGrant instance | required; a URL or a bare host, up to 2048 characters; matched by host like every call |
| `areas` | the full list | required array of at most 200 rows, in the order Help shows them |
| `areas[].area` | the question area, as eGrant names it (the same value as the ticket intake's `area`) | required, 1 to 200 characters after trimming, not only a `zend` prefix |
| `areas[].email` | the responsible admin's email in Help | required, a valid email up to 254 characters; case and spaces do not matter |

Body at most 256 KiB. Unknown fields are ignored.

```bash
curl -sS -X PUT https://help.egrant.sk/api/egrant/ticket-areas \
  -H "Authorization: Bearer $SPOLU_GROUPS_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "instance_url": "https://mesto-x.egrant.sk",
        "areas": [ { "area": "zend.Projekty", "email": "jana@egrant.sk" },
                   { "area": "Žiadosti o platbu", "email": "peter@egrant.sk" },
                   { "area": "Žiadosti o platbu", "email": "nobody@example.sk" } ] }'
```

Answer, `200`:

```json
{
  "state": "updated",
  "group_id": "0b7c9f2e-…",
  "rules": [
    { "area": "zend.Projekty", "email": "jana@egrant.sk" },
    { "area": "Žiadosti o platbu", "email": "peter@egrant.sk" }
  ],
  "unmatched": [ { "area": "Žiadosti o platbu", "email": "nobody@example.sk" } ]
}
```

| status | body | meaning |
|---|---|---|
| `200` | `{ "state": "updated" / "unchanged", "group_id", "rules", "unmatched" }` | `updated`: your rows changed; `unchanged`: they already were this list (a resend). `rules`: your (eGrant) rows Help now holds (area as sent, email in lower case); `unmatched`: the sent rows skipped because their email is no active admin |
| `400` | `{ "error": "validation_failed", "fields": [...] }` | a field is malformed (`instance_url`, `areas`, `areas[3].email`, `areas[0].area`), or more than 200 rows |
| `404` | `{ "error": "unknown_instance" }` | no client in Help has this instance; nothing is stored. Send it again after the [groups call](#groups) created it |
| `409` | `{ "error": "ambiguous_instance" }` | two groups in Help share this host |
| `401`, `413`, `429`, `503` | | as in [Limits and common errors](#limits-and-common-errors); 60 calls a minute per IP address |

A deactivated client's table is still stored (it takes no tickets meanwhile). **Idempotency:** the body is the full state; the same body again answers `200 unchanged` and records nothing. Send it when the list changes in eGrant, after the groups call of a new instance, and once in the backfill.

## Audit log

Every change the groups and managers webhooks, the ticket intake, the project feed and the ticket areas call make in Help is recorded in the audit log „História zmien“ ([product/audit-log.md](../product/audit-log.md)) with the author **eGrant** and the instance's origin (`https://firma.egrant.sk`) and source (`groups`, `managers`, `intake`, `projects`, `ticket_areas`); never a person, the key, the signature or the body. A call that changes nothing records nothing.

## Related documents

- [egrant-ticket-intake.md](egrant-ticket-intake.md): the full ticket contract (every field, files, every answer).
- [egrant-managers.md](egrant-managers.md): the full managers webhook contract (client members, every answer).
- [egrant-agent-tz.md](egrant-agent-tz.md): the implementation spec for the eGrant side (every call, when to send it, retries, backfill, acceptance tests).
- [product/integrations.md](../product/integrations.md): the product reference for all external systems.
