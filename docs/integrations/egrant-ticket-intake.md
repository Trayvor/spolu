# eGrant ticket intake: integration guide

For the eGrant developers who send support requests from an eGrant instance to Spolu. Spolu is the eGrant team's own app for talking to clients; every request you send becomes a **ticket** there, with its own chat between the eGrant team and the person who asked.

The product rules behind this guide live in [product/tickets.md](../product/tickets.md) and [product/integrations.md](../product/integrations.md); if they ever disagree with this page, they win.

## In short

- One endpoint: `POST https://<spolu host>/api/tickets/intake`, JSON body.
- One shared secret: `Authorization: Bearer <key>`.
- Send a `request_id` with every request and retry with the same id until you get a `2xx`.
- Spolu answers `201` (created) or `200` (already created for that `request_id`) with `{ "id", "number" }`. There are no callbacks.

## When to call

Call the endpoint once when a user of an eGrant instance submits a support request (the help or contact form, an error report). Call it from your server, never from the user's browser: the key must not reach the browser.

Do not call it for updates of the same request. Everything after the first message happens in Spolu: the eGrant team and the requester talk in the ticket's chat.

## Authentication

Every request carries the shared key:

```
Authorization: Bearer <key>
Content-Type: application/json
```

The eGrant team gives you the key; on the Spolu server it is the environment variable `TICKETS_API_KEY` (at least 16 characters). Keep it in your server's secret store. To rotate it, the Spolu admin sets a new value and restarts Spolu; requests with the old key then answer `401`. When Spolu has no key configured, the intake is switched off and answers `503`.

## The JSON body

Every field is optional, but a ticket needs at least one of `subject`, `body` or `area`. Strings are trimmed; an empty string counts as not given. Unknown fields are ignored. The whole body may be at most 1 MiB.

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
| `file_links` | links to files (screenshots, documents) | an array of up to 20 `http`/`https` URLs; Spolu shows them as links and never downloads them, so they must stay reachable for the eGrant team |
| `instance_url` | the eGrant instance the request came from | any URL, up to 2048; see "Client matching" |

Always send `instance_url` and `email`: without them the ticket has no client and no requester account (see below).

## Example

```bash
curl -sS https://spolu.example.sk/api/tickets/intake \
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
    "file_links": ["https://mesto-x.egrant.sk/files/screenshot-4711.png"],
    "instance_url": "https://mesto-x.egrant.sk"
  }'
```

Answer:

```json
{ "id": "3f0c9a52-1d7e-4f43-9a51-2b8c1e6d7a10", "number": 123 }
```

`number` is what people see (`#123`); `id` is Spolu's internal id. Store them if you want to show the user "Your ticket #123".

## Answers

| status | body | what to do |
|---|---|---|
| `201` | `{ "id": "…", "number": 123 }` | created (also when no client matched) |
| `200` | `{ "id": "…", "number": 123 }` | a ticket with this `request_id` already exists; this is its id and number. Nothing new was created, emailed or notified, even if the rest of the body differs. Treat it like `201`. |
| `400` | `{ "error": "validation_failed", "fields": ["due_date"] }` | a field is malformed (the names are listed; `["body"]` when there is no subject, body or area). Fix the data; do not retry unchanged. |
| `401` | `{ "error": "unauthorized" }` | missing or wrong key. Do not retry; check the configuration. |
| `413` | | the body is over 1 MiB. Shorten it; do not retry unchanged. |
| `429` | `{ "error": "rate_limited" }` | more than 60 requests a minute from one IP address. Retry later. |
| `503` | `{ "error": "intake_disabled" }` | the intake is switched off on this Spolu server. Retry later; tell the eGrant team if it lasts. |
| other `5xx`, timeout, network error | | retry |

## Retries and `request_id`

A request can reach Spolu even when your side sees a timeout. To make retries safe, send a `request_id` and reuse it for every attempt of the same request:

- Retry on a timeout, a network error, `429` and any `5xx`. Do not retry on `400`, `401` or `413`.
- Back off between attempts, for example 1 s, 5 s, 30 s, 2 min, 10 min, then give up and log it.
- The same `request_id` always answers the first ticket (`200`), however often it arrives, also when two attempts arrive at the same moment: Spolu keeps one ticket per id, for good. So never reuse an id for a different request.
- Without `request_id`, every request that reaches Spolu makes a new ticket, so a retry after a lost answer makes a duplicate.

## What happens in Spolu

1. **Client matching.** Spolu compares `instance_url` with the eGrant address stored on each client (group) by host only: the scheme, a leading `www.`, the path and the case do not matter, so `https://WWW.Mesto-X.egrant.sk/app/login` matches `https://mesto-x.egrant.sk`. No match, or no `instance_url`: the ticket is saved **without a client**; only the eGrant team sees it until an admin assigns a client by hand.
2. **The requester.** For a ticket with a client, Spolu finds the person by `email`. Someone new gets a Spolu account (named after `requester_name`) with a narrow requester role: they see only their own tickets, never the client's other chats, tasks or files. Without `email` nobody is linked.
3. **"Ticket created" email.** The requester gets one email (Slovak by default) with the number, the subject, the first lines of the text and an **Open the ticket** button. The button leads to Spolu's login: they enter their email, get a 6-digit code by email and land on the ticket. There is no password. The email goes once per ticket, and only when a client matched (for a ticket without a client, it goes when an admin assigns one).
4. **The eGrant team** hears about the new ticket (the client's managers, or every admin for a ticket without a client), answers in the ticket's chat, changes its status (New, In progress, Resolved) and may turn it into tasks. The requester follows all of it in Spolu and gets their own notifications by email.

## What Spolu does not do

- **No callbacks or webhooks.** Spolu never calls eGrant back; status changes and replies stay in Spolu.
- **No status API.** There is no endpoint for eGrant to read a ticket later.
- **No file uploads through the intake.** Send links in `file_links`; the requester can attach files in the ticket's chat.
