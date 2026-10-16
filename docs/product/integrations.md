# Integrations

Spolu talks to three external systems: eGrant (incoming error reports), Elastic Email (all outgoing email) and an LLM API (task splitting).

## Requirements

- Systems and their purpose:

  | System | Purpose |
  |---|---|
  | **eGrant** | Incoming support requests (JSON + one shared Bearer key) become tickets (see `tickets.md`). |
  | **Elastic Email** | Emails: invites, login codes, "Ticket created", email notifications. |
  | **AI (LLM API)** | Splitting a message into tasks (see `ai-task-split.md`). |

## Ticket intake API (for the eGrant team)

`POST https://<spolu host>/api/tickets/intake` with the headers `Authorization: Bearer <key>` and `Content-Type: application/json`. The key is one shared secret, set on the Spolu server as `TICKETS_API_KEY` (at least 16 characters) and given to the eGrant team.

Body (JSON); every field is optional, but at least one of `subject`, `body` or `area` is needed. Empty strings count as not given; unknown fields are ignored.

| field | meaning | rules |
|---|---|---|
| `requester_name` | requester's name | up to 200 characters |
| `email` | requester's email | a valid email, up to 254; case and spaces do not matter |
| `phone` | requester's phone number | up to 50 |
| `area` | question area | up to 200 |
| `subject` | subject (title) | up to 300 |
| `programme` | grant programme name | up to 200 |
| `body` | text | up to 20 000 |
| `file_links` | links to files | an array of up to 20 http(s) URLs; Spolu shows them as links and never downloads them |
| `due_date` | due date | `YYYY-MM-DD` |
| `url` | a URL link | http(s) |
| `instance_url` | the client's eGrant instance | any URL; matched to a client by host (scheme, `www.` and path ignored) |
| `request_id` | eGrant's own id of this request, for safe retries | 1 to 100 characters; one ticket per id, kept forever |

Answers:

| status | body | when |
|---|---|---|
| `201` | `{ "id": "…", "number": 123 }` | saved (also when no client matched) |
| `200` | `{ "id": "…", "number": 123 }` | a ticket with this `request_id` exists: its id and number; nothing is created, no email, no notification (the rest of the body is ignored, also when it differs) |
| `400` | `{ "error": "validation_failed", "fields": ["due_date"] }` | a field is malformed, or no subject, body and area (`fields: ["body"]`) |
| `401` | `{ "error": "unauthorized" }` | missing or wrong key |
| `429` | `{ "error": "rate_limited" }` | more than 60 requests a minute from one address |
| `503` | `{ "error": "intake_disabled" }` | no key is configured on the server |

Retries: send a `request_id` and repeat the same request after a timeout, a network error, a `429` or a `5xx`; requests that arrive at the same moment with one id still make one ticket. Without `request_id` every request makes a new ticket. The full guide for the eGrant developers: [eGrant ticket intake](../integrations/egrant-ticket-intake.md).

## Phase

Elastic Email: Phase 2 (login codes), later invites, notifications (Phase 6) and the "Ticket created" email (Phase 21). eGrant ticket intake: Phase 21 (part 21.2; it supersedes Phases 12 and 13). AI: Phase 9 (OpenAI API).
