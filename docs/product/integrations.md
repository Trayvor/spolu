# Integrations

Spolu talks to three external systems: eGrant (incoming error reports), Elastic Email (all outgoing email) and an LLM API (task splitting).

## Requirements

- Systems and their purpose:

  | System | Purpose |
  |---|---|
  | **eGrant** | Incoming support requests (JSON + one shared Bearer key) become tickets (see `tickets.md`); the managers webhook adds or removes a client's manager (below). |
  | **Elastic Email** | Emails: invites, login codes, "Ticket created", email notifications (transactional); bulk email (Phase 23) through the marketing endpoint `POST /v4/emails`, one call per person, no open or click tracking ([ADR 0016](../decisions/0016-bulk-email-through-elastic-v4-emails.md)). |
  | **AI (LLM API)** | Splitting a message into tasks (see `ai-task-split.md`). |
  | **claude.ai** (link out, no API) | "Vyriešiť s Claude": admins open a prefilled Claude chat with a ticket's or task's context and work through the eGrant MCP connector in their own Claude account (see `solve-with-claude.md`). Spolu sends nothing to Anthropic itself. |

## Ticket intake API (for the eGrant team)

The standalone guide for the eGrant developers (when to call, an example, retries, what happens in Spolu): [docs/integrations/egrant-ticket-intake.md](../integrations/egrant-ticket-intake.md). This section is the reference.

`POST https://<host>/api/tickets/intake` (production: `https://help.egrant.sk`) with the headers `Authorization: Bearer <key>` and `Content-Type: application/json`. The key is one shared secret, set on the server as `TICKETS_API_KEY` (at least 16 characters) and given to the eGrant team.

Body (JSON, at most 28 MiB; every other API route keeps 1 MiB); every field is optional, but at least one of `subject`, `body` or `area` is needed. Empty strings count as not given; unknown fields are ignored (so the removed `file_links` is ignored too).

| field | meaning | rules |
|---|---|---|
| `requester_name` | requester's name | up to 200 characters |
| `email` | requester's email | a valid email, up to 254; case and spaces do not matter |
| `phone` | requester's phone number | up to 50 |
| `area` | question area | up to 200 |
| `subject` | subject (title) | up to 300 |
| `programme` | grant programme name | up to 200 |
| `body` | text | up to 20 000 |
| `files` | files sent whole | an array of up to 10 objects `{ "name", "content_base64", "content_type"? }`: `name` 1 to 200 characters (any path is dropped, the name sanitized), `content_base64` strict standard base64 with padding and no whitespace, each file at most 10 MiB and all at most 20 MiB decoded; `content_type` is informational, the type is sniffed from the bytes. Taken: PNG, JPEG, WebP, GIF, PDF, Word/Excel/PowerPoint (`.doc(x)`, `.xls(x)`, `.ppt(x)`), OpenDocument (`.odt`, `.ods`, `.odp`), RTF, ZIP, UTF-8 `.txt`/`.csv`; anything else is refused. Stored in the client's files and attached to the ticket like files uploaded with the new-ticket form |
| `due_date` | due date | `YYYY-MM-DD` |
| `url` | a URL link | http(s) |
| `instance_url` | the client's eGrant instance | any URL; matched to a client by host (scheme, `www.` and path ignored) |
| `request_id` | eGrant's own id of this request, for safe retries | 1 to 100 characters; one ticket per id, kept forever |

Answers:

| status | body | when |
|---|---|---|
| `201` | `{ "id": "…", "number": 123 }` | saved (also when no client matched) |
| `200` | `{ "id": "…", "number": 123 }` | a ticket with this `request_id` exists: its id and number; nothing is created, no email, no notification (the rest of the body is ignored, also when it differs) |
| `400` | `{ "error": "validation_failed", "fields": ["due_date"] }` | a field is malformed, or no subject, body and area (`fields: ["body"]`); a file's field is named like `files[3].content_base64` (bad base64 or a refused type) or `files[0].name`, more than 10 files is `files` |
| `401` | `{ "error": "unauthorized" }` | missing or wrong key |
| `413` | `{ "error": "file_too_large", "fields": ["files[1].content_base64"] }` | a file over 10 MiB decoded (that file named), or the files over 20 MiB together (`fields: ["files"]`); the whole body over 28 MiB answers `413` without this body |
| `429` | `{ "error": "rate_limited" }` | more than 60 requests a minute from one address |
| `503` | `{ "error": "intake_disabled" }` | no key is configured on the server |

Retries: send a `request_id` and repeat the same request after a timeout, a network error, a `429` or a `5xx`; requests that arrive at the same moment with one id still make one ticket. A repeat is answered before its files are decoded or stored, so they are never stored twice. The files are stored before the ticket's transaction, which attaches them; if anything fails (or a concurrent request with the same id wins) the stored files are deleted, so no ticket is ever left half made. Without `request_id` every request makes a new ticket. The full guide for the eGrant developers: [eGrant ticket intake](../integrations/egrant-ticket-intake.md).

## Managers webhook (for the eGrant team)

The guide with the full contract: [docs/integrations/egrant-managers.md](../integrations/egrant-managers.md).

`PUT /api/egrant/managers` with the same Bearer key (`TICKETS_API_KEY`; no second key, so one secret to rotate) and `{ "instance_url", "email", "active" }`. The client is found by its eGrant host like the intake; an unknown instance answers `404 unknown_instance` and is not stored (unlike tickets and projects, a manager change has no meaning before the client exists; eGrant resends it). The email must be an existing active admin or the superadmin (exact address, case-insensitive), else `422 unknown_admin`: the webhook never creates an account, re-enables one or grants a role. It goes through the groups module's `addManager` / `removeManager`, so the socket event, the notification mode and the ticket watching are the same as the in-app button; it answers `200` with `state` `added`, `removed` or `unchanged`. A new manager gets one "You are now a manager of <client>" email; removing sends none and may leave a client with no manager (logged). Order of checks, before the body (16 KiB at most) is read: `503` no key configured, `429` over 60 calls a minute from one IP (wrong keys count too), `401` wrong key.

## Phase

Elastic Email: Phase 2 (login codes), later invites, notifications (Phase 6) and the "Ticket created" email (Phase 21); bulk email (Phase 23: the sender is built in part 23.1, sending in 23.5). eGrant ticket intake: Phase 21 (part 21.2; it supersedes Phases 12 and 13). AI: Phase 9 (OpenAI API).
