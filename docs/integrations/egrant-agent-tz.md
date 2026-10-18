# eGrant → Help integration: implementation spec for the eGrant side

**Audience:** an AI coding agent (or a developer) working in the **eGrant** codebase. The stack is not assumed (PHP or any server-side language); the examples are `curl` and pseudo-code. **Goal:** implement, end to end, every call eGrant makes to **Help by eGrant** ("Help", code name Spolu, `https://help.egrant.sk`), the eGrant team's app for talking to its clients.

This file is standalone: it holds everything needed to build and test the eGrant side. It is written from Help's code as of 2026-10-18. The human-readable guides are `docs/integrations/egrant.md` (all calls), `egrant-ticket-intake.md` (tickets, full) and `egrant-managers.md` (members, full) in the Help repository; if this file and those guides ever disagree, they win, and tell the Help team.

## 0. Summary of the work

Build one small **Help client module** in eGrant and call it from four places:

| # | Help call | eGrant trigger | status in Help |
|---|---|---|---|
| 1 | `PUT /api/egrant/groups` | an instance (client organisation) is created; its name or logo changes; an operator explicitly deactivates/closes or restores it | live with the next Help release |
| 2 | `PUT /api/egrant/managers` | a manager (the client's own person) of an organisation is added, reactivated, deactivated or removed | live |
| 3 | `POST /api/tickets/intake` | a user submits a support request (help or contact form, error report) | live |
| 4 | `PUT /api/egrant/projects/<project id>` | a project or its events change | **after Help releases it** (answers `404` until then) |

Plus: a **backfill** command (section 7), **configuration** (section 1), a shared **HTTP + retry** layer (section 2), **logging** rules (section 8) and **acceptance tests** (section 9).

Help never calls eGrant back: no callbacks, no status API. Every call is server to server, JSON, idempotent when sent as described.

## 1. Configuration and secrets

| setting | value | where |
|---|---|---|
| `HELP_BASE_URL` | `https://help.egrant.sk` (test and production share it for now) | config |
| `HELP_API_KEY` | the shared Bearer key (Help's `TICKETS_API_KEY`), at least 16 characters | secret store / env |
| `HELP_GROUPS_API_KEY` | optional: the groups call's own key (Help's `EGRANT_GROUPS_API_KEY`); when empty, use `HELP_API_KEY` | secret store / env |
| `HELP_ENABLED` | on/off switch for all calls (off: queue nothing, log once) | config |

Rules:

- The keys come from the Help admin (the eGrant team) out of band. Never commit them, never put them in code, logs, error messages, URLs, browser JavaScript or queue payloads that are logged. Call Help only from the eGrant server.
- Every request carries `Authorization: Bearer <key>` and `Content-Type: application/json`, body UTF-8 JSON.
- Use `https://help.egrant.sk`, never `https://spolu.egrant.sk`: the old domain answers `301`, and many HTTP clients turn a redirected `POST`/`PUT` into a `GET` without the body. Do not follow redirects; treat a `3xx` as a configuration error.
- **Key rotation:** the Help admin sets a new value and restarts Help; the old key then answers `401`. Deploy the new key at the agreed moment. If Help sets `EGRANT_GROUPS_API_KEY`, only that key opens the groups call (the shared key answers `401` there).

## 2. The shared HTTP layer

### 2.1 Timeouts

| call | connect timeout | total timeout |
|---|---|---|
| groups (body up to 3 MiB) | 10 s | 60 s |
| managers | 10 s | 20 s |
| tickets (body up to 28 MiB) | 10 s | 120 s |
| projects (body up to 1 MiB) | 10 s | 30 s |

### 2.2 Delivery: a queue, not the user's request

Send every call from a background job (a DB-backed queue table or the framework's queue), never inline in the user's web request: the user's action must not fail or wait because Help is slow. The job stores the method, path, JSON body (or the ids needed to rebuild it), attempt count and next attempt time. **Do not log or persist the key with the job.**

### 2.3 Retries

| answer | action |
|---|---|
| `2xx` | done |
| timeout, connection error, DNS error, TLS error | retry |
| `429` | retry (rate limit) |
| `500`–`599` (including `503 intake_disabled`) | retry |
| `3xx` | do not retry; alert (wrong base URL) |
| `400`, `401`, `403`, `404`, `409`, `413`, `415`, `422` and any other `4xx` | **do not retry** unchanged; log the status and Help's `error` / `fields` (they contain no personal data), alert for `401` |

Backoff: 1 s, 5 s, 30 s, 2 min, 10 min, 30 min, then every hour up to 24 h; add ±20 % jitter. After the last attempt mark the job failed and alert. Exceptions to "no retry on 4xx" are listed per call (the managers call's `404 unknown_instance` is retried later, section 4.4).

### 2.4 Ordering

Per instance, deliver in this order: **group first, then its managers, then tickets/projects**. Simplest: one queue lane per instance (jobs of one instance run one at a time, in creation order). A managers job whose group call has not succeeded yet waits for it (section 4.4).

### 2.5 Rate limits

Help allows **60 calls a minute per source IP for each of groups, managers and tickets** (counted separately) and 120 for projects. A wrong key counts against the groups and managers limits too. Keep each endpoint under about 1 call per second from one server (the backfill too, section 7); a `429` is retried with backoff.

### 2.6 `instance_url`

Every call names the client by `instance_url`: the instance's public URL, e.g. `https://mesto-x.egrant.sk`. Help matches **by host only**: scheme, a leading `www.`, path, query and case do not matter. Groups and managers also take a bare host (`mesto-x.egrant.sk`); the ticket intake needs a full URL (`https://…`). Always send the canonical `https://<host>` of the instance: the same value in every call of that instance.

## 3. Groups: `PUT /api/egrant/groups`

### 3.1 When to call

| eGrant event | body |
|---|---|
| an instance (client organisation) is created | `name`, `logo` (if it has one) |
| its display name changes | `name` (omit `logo` to keep it) |
| its logo is set or replaced | `name`, `logo` |
| its logo is removed | `name`, `"logo": null` |
| an operator **explicitly** deactivates or closes the instance | `name`, `"active": false` |
| an operator restores (reopens) it | `name`, `"active": true` |

**Never derive `active` from contract dates**, licence expiry, payment state, inactivity or any other automatic rule. Help's owner decided (2026-10-18) that groups are deactivated only explicitly: by an admin in Help, or by an eGrant operator's explicit action sent as `active: false`. A contract that ends, in eGrant or in Help's finance, never deactivates a group.

### 3.2 Request

```http
PUT /api/egrant/groups
Authorization: Bearer <HELP_GROUPS_API_KEY or HELP_API_KEY>
Content-Type: application/json
```

| field | type | rules |
|---|---|---|
| `instance_url` | string | required; URL or bare host, 1–2048 characters after trimming; must be http(s) (`ftp://…` is `400`) |
| `name` | string | required; 1–100 characters after trimming |
| `logo` | object or `null` | optional. **Omitted:** the current logo stays. **`null`:** the logo is removed. **Object:** replaces it |
| `logo.content_type` | string | `image/png`, `image/jpeg`, `image/webp` or `image/svg+xml` (case-insensitive; parameters after `;` ignored). Anything else, including `image/gif`, is `415`. Send an SVG logo as it is: Help converts it to PNG (below). Convert GIF to PNG in eGrant before sending |
| `logo.data_base64` | string | the file bytes, **strict base64**: standard alphabet `A–Z a–z 0–9 + /`, `=` padding, no line breaks, no spaces, no `data:` prefix (PHP `base64_encode($bytes)`). At most **2 MiB decoded** (2 097 152 bytes). The bytes must be a complete image of `content_type` |
| `active` | boolean | optional. `false`: deactivate; `true`: reactivate. **Omitted: the state does not change** (send it only on the explicit operator action). A new group is always created active |

Unknown fields are ignored. The whole body may be at most 3 MiB.

Help removes the image's metadata (EXIF/GPS, XMP, IPTC, comments, text chunks, trailing bytes) and does not resize a PNG, JPEG or WebP; sending a reasonably small logo (for example up to 512×512 px) is kind to every client's browser. An **SVG** (`image/svg+xml`) is converted on Help's side to a PNG whose longer side is 512 px (the ratio is kept); only the PNG is stored, never the SVG. Scripts, event handlers, links to other files or URLs and `<foreignObject>` are ignored (they draw nothing); images embedded as `data:` URIs are drawn. Help loads no fonts, so text in the SVG must be converted to paths (outlines) or it will be missing. The SVG must parse and have a size (`width`/`height` or a `viewBox`), else `422`.

### 3.3 Responses

| status | body | meaning | eGrant action |
|---|---|---|---|
| `201` | `{ "state": "created", "group_id": "<uuid>" }` | a new client group (active, own invite link, no members) | store `group_id` on the instance (optional, for support) |
| `200` | `{ "state": "updated", "group_id" }` | name or logo changed | done |
| `200` | `{ "state": "unchanged", "group_id" }` | nothing to change (same name, same image) | done |
| `200` | `{ "state": "deactivated", "group_id" }` | was active, now deactivated (a new name/logo in the same call is applied too) | done |
| `200` | `{ "state": "reactivated", "group_id" }` | was deactivated, now active | done |
| `400` | `{ "error": "validation_failed", "fields": ["instance_url" / "name" / "logo.content_type" / "logo.data_base64"] }` | malformed field | fix; no retry |
| `401` | `{ "error": "unauthorized" }` | missing/wrong key | alert; no retry |
| `404` | `{ "error": "unknown_instance" }` | `active: false` for an instance Help does not know; nothing created | nothing to do |
| `409` | `{ "error": "ambiguous_instance" }` | two Help groups share the host (a Help admin's double entry) | alert the Help team; no retry |
| `409` | `{ "error": "egrant_url_taken" }` | very unlikely race on the stored address | retry once later, then alert |
| `413` | `{ "error": "file_too_large", "fields": ["logo.data_base64"] }` | logo over 2 MiB decoded (a body over 3 MiB: `413` without this body) | shrink the logo; no retry unchanged |
| `415` | `{ "error": "unsupported_type", "fields": ["logo.content_type"] }` | not PNG/JPEG/WebP/SVG | convert; no retry unchanged |
| `422` | `{ "error": "invalid_logo", "fields": ["logo.data_base64"] }` | bytes are not a complete image of that type (text, an SVG declared as PNG, a JPEG declared as PNG, a truncated file), or an SVG that does not parse or has no size | fix the type or the file; no retry |
| `429` | `{ "error": "rate_limited" }` | over 60 calls a minute from this IP | retry with backoff |
| `503` | `{ "error": "intake_disabled" }` | no key configured in Help | retry with backoff; alert if it lasts |

Any `4xx` stores nothing: a refused logo also leaves the name unchanged. Check order before the body is read: `503`, then `429`, then `401`.

### 3.4 Idempotency

Keyed by the instance's host. Sending the same body again answers `200 unchanged` (the same logo is recognised after cleaning). Two first calls at the same moment create one group (one `201`, one `200`). So: retry freely with the same body; on any doubt, resend the full current state (name + logo).

### 3.5 Effects in Help (for understanding)

- An existing group (also one a Help admin created by hand before) is found and updated; Help keeps its stored address.
- Never deletes a group; never adds/removes members or managers.
- **Deactivated** (by `active: false` or in Help): its clients and requesters lose access (accounts stay), it is hidden from Help's lists, nothing new can be added, its notifications stop, nothing is deleted. While deactivated, the managers call and the ticket intake for that instance answer `409 group_inactive`. `active: true` restores everything.

### 3.6 Example

```bash
LOGO=$(base64 < logo.png | tr -d '\n')
curl -sS -X PUT https://help.egrant.sk/api/egrant/groups \
  -H "Authorization: Bearer $HELP_GROUPS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"instance_url\":\"https://mesto-x.egrant.sk\",\"name\":\"Mesto X\",\"logo\":{\"content_type\":\"image/png\",\"data_base64\":\"$LOGO\"}}"
# {"state":"created","group_id":"0b7c…"}
```

Pseudo-code (PHP-like):

```php
function syncGroup(Instance $i, ?bool $active = null, bool $withLogo = true): void {
    $body = ['instance_url' => $i->canonicalUrl(), 'name' => mb_substr(trim($i->name), 0, 100)];
    if ($withLogo) {
        $body['logo'] = $i->logo === null ? null : [
            'content_type' => $i->logo->mimeType(),          // image/png|jpeg|webp only
            'data_base64'  => base64_encode($i->logo->bytes()),
        ];
    }
    if ($active !== null) $body['active'] = $active;            // only on an explicit operator action
    HelpQueue::push($i->id, 'PUT', '/api/egrant/groups', $body, key: 'groups');
}
```

## 4. Managers (client members): `PUT /api/egrant/managers`

In eGrant a **manager** of an organisation is the client's own person (for example the town's grant officer). In Help that person becomes a **client member** of the instance's group (reads and writes its chat, tasks, tickets, knowledge). This call never makes anyone a Help administrator.

### 4.1 When to call

| eGrant event | body |
|---|---|
| a manager is added to an organisation, or reactivated | `active: true`, `email`, `name` |
| a manager is deactivated or removed from the organisation | `active: false`, `email` |
| a manager's email changes | `active: false` with the old email, then `active: true` with the new one |

Send it **after** the group call of that instance has succeeded (section 2.4).

### 4.2 Request

| field | type | rules |
|---|---|---|
| `instance_url` | string | required; URL or bare host, up to 2048 characters |
| `email` | string | required; valid email up to 254 characters; case and surrounding spaces do not matter |
| `active` | boolean | required. `true`: is a member of this client; `false`: is not |
| `name` | string or null | optional, up to 100 characters; used only when Help creates the account or the account has no name |

Body at most 16 KiB. Check order before the body: `503`, `429`, `401`.

### 4.3 Responses

| status | body | meaning |
|---|---|---|
| `200` | `{ "state": "created", "group_id", "user_id" }` | a new client account was created and added; Help emailed an invitation |
| `200` | `{ "state": "added", "group_id", "user_id" }` | an existing account was added (or a removed membership restored); Help emailed them |
| `200` | `{ "state": "removed", "group_id", "user_id" }` | removed from this client's group (the account stays) |
| `200` | `{ "state": "unchanged", "group_id", "user_id" }` | already so; `user_id` is `null` for `active: false` with an unknown email |
| `404` | `{ "error": "unknown_instance" }` | no group for this instance yet; nothing stored |
| `409` | `{ "error": "group_inactive" }` | the group is deactivated; nothing changed |
| `422` | `{ "error": "email_is_admin" }` | the email belongs to an eGrant team administrator; nothing changed |
| `422` | `{ "error": "user_disabled" }` | (`active: true`) the Help account is disabled; nothing changed |
| `400`, `401`, `413`, `429`, `503` | as in section 2.3 | |

### 4.4 Special handling

- `404 unknown_instance`: the group does not exist yet. Make sure the group call is queued; retry this job after it succeeds (or with the normal backoff for up to 24 h).
- `409 group_inactive`: do not retry; when the instance is reactivated (section 3.1), resend the current state of all its managers.
- `422`: do not retry; log `error` (no email in the log) for a human to look at.

### 4.5 Idempotency

Send the state you want; a repeat answers `200 unchanged` and sends no second email. Safe to resend at any time.

```bash
curl -sS -X PUT https://help.egrant.sk/api/egrant/managers \
  -H "Authorization: Bearer $HELP_API_KEY" -H "Content-Type: application/json" \
  -d '{"instance_url":"https://mesto-x.egrant.sk","email":"jana.kovacova@mesto-x.sk","name":"Jana Kováčová","active":true}'
# {"state":"created","group_id":"0b7c…","user_id":"c41e…"}
```

## 5. Tickets: `POST /api/tickets/intake`

Full contract: `docs/integrations/egrant-ticket-intake.md` in the Help repository. The essentials:

### 5.1 When to call

Once, when a user of an instance submits a support request (help or contact form, error report). Not for later updates: everything after the first message happens in Help's ticket chat.

### 5.2 Request

At least one of `subject`, `body`, `area`. Always send `instance_url` (full URL) and `email`, and a new `request_id` per request (reused for its retries).

| field | rules |
|---|---|
| `request_id` | 1–100 characters, unique per request (e.g. a UUID stored with the request) |
| `subject` | up to 300 |
| `body` | up to 20 000, plain text |
| `area`, `programme`, `requester_name` | up to 200 each |
| `email` | valid email up to 254 |
| `phone` | up to 50 |
| `due_date` | `YYYY-MM-DD` |
| `url` | http(s) URL of the page concerned |
| `instance_url` | the instance's full URL |
| `files` | up to 10 `{ "name", "content_base64", "content_type"? }`; each ≤ 10 MiB decoded, together ≤ 20 MiB; PNG, JPEG, WebP, GIF, PDF, Office/OpenDocument, ZIP, RTF, UTF-8 `.txt`/`.csv` (by bytes); anything else makes the whole request `400` |
| `project_id` | (after Help releases projects) the id used in the projects call |

Body at most 28 MiB. Check order: `503`, `401`, then `429`.

### 5.3 Responses

| status | body | action |
|---|---|---|
| `201` | `{ "id", "number" }` | created; you may show "Your ticket #<number>" |
| `200` | `{ "id", "number" }` | this `request_id` exists already; treat as success |
| `400` | `{ "error": "validation_failed", "fields": [...] }` | fix; no retry |
| `401` | `unauthorized` | alert; no retry |
| `409` | `{ "error": "group_inactive" }` | the organisation's group is deactivated; nothing stored. Tell the user support for this organisation is closed; no retry |
| `413` | `file_too_large` (or no fixed body over 28 MiB) | send smaller files; no retry unchanged |
| `429`, `503`, `5xx`, network | | retry with the same `request_id` |

### 5.4 Idempotency

`request_id` is the key, kept by Help for good: a repeat answers `200` with the first ticket and stores nothing again. Without it, a retry after a lost answer makes a duplicate. Never reuse an id for another request.

```bash
curl -sS https://help.egrant.sk/api/tickets/intake \
  -H "Authorization: Bearer $HELP_API_KEY" -H "Content-Type: application/json" \
  -d '{"request_id":"mesto-x-4711","subject":"Cannot submit the application","body":"Step 3 shows an error.","email":"jana.nova@example.sk","requester_name":"Jana Nová","instance_url":"https://mesto-x.egrant.sk"}'
# {"id":"3f0c…","number":123}
```

## 6. Projects: `PUT /api/egrant/projects/<project id>` (after Help releases it)

**Do not enable before the Help team says it is live**; until then it answers `404` (treat `404` as "not released": no retry, keep the feature switched off). Implement it behind a config switch `HELP_PROJECTS_ENABLED`.

- `<project id>`: your stable project id, 1–100 characters, URL-encoded.
- Body: `instance_url` (required), `sent_at` (ISO 8601 with time zone, when this version was produced), `name` (1–200), `description` (≤ 10 000, may be empty), `events` (required array of up to 200, **always the full list**; each `{ "name" (1–200), "date" ("dd.mm.yyyy"), "description" (≤ 10 000) }`; no event ids).
- When: a project is created, it or its events change, or periodically with the whole project.
- Answers: `201 { "project_id", "state": "created", "skipped": [] }`; `200 { "project_id", "state": "unchanged" | "pending", "pending", "skipped" }`; `200 { "project_id", "state": "stale" }` (older `sent_at` than Help has); `202 { "project_id", "state": "stored" }` (no group for the instance yet; Help keeps it 180 days and applies it when the group is created); `400`, `401`, `413`, `429`, `503` as usual. Body at most 1 MiB; 120 calls a minute per IP.
- `skipped` names events Help ignored (bad date, empty name, duplicate name+date); fix and resend.
- Idempotent: the body is the full state; same body → `200 unchanged`; `sent_at` makes late retries harmless.
- Tickets about a project carry `project_id` (section 5.2).

## 7. Backfill (one-off)

A command (e.g. `php artisan help:backfill` / `bin/console help:backfill`) that sends the current state of every existing instance. Requirements:

1. Options: `--dry-run` (print counts only), `--instance=<host>` (one instance), `--since-id=<id>` (resume), `--only=groups|managers` .
2. For each instance that is **not closed**, ordered by id:
   1. group call with `name` and `logo` (no `active` field);
   2. after it succeeds, a managers call `active: true` for each of its active managers.
3. Instances an operator closed: send the group call with `"active": false` only if Help already knows them (a `404 unknown_instance` is fine and expected); do not create them.
4. Pace: at most 1 call per second per endpoint (Help's limit is 60/min per IP each for groups and managers); on `429` back off and continue.
5. Use the same queue/retry code as live calls, or run synchronously with the same retry policy; record progress so a crash resumes at `--since-id`.
6. Output: counts per state (`created`, `updated`, `unchanged`, `deactivated`, `added`, `removed`…) and per error code; no emails, names or keys in the output.
7. Safe to run again: every call is idempotent. Note that the first managers backfill sends invitation emails to every new person (that is Help's normal behaviour for `created`/`added`); agree the date with the Help team.

Tickets and projects need no backfill (projects: optional, after release, the same pacing).

## 8. Logging

Log per call: method, path, instance host, HTTP status, Help's `state` or `error` code and `fields`, `group_id`/`user_id`/ticket `number` from the answer, attempt number, duration.

Never log: the Authorization header or any key, request bodies, base64 data, emails, names, phone numbers, ticket text. Redact the `Authorization` header in any HTTP client debug logging. Help's error bodies contain only codes and field names, so they may be logged as they are.

## 9. Acceptance tests

Run against `https://help.egrant.sk` (the test environment) with a **test instance host agreed with the Help team** (below `acceptance-test-1.egrant.sk`), and a test mailbox you control for the managers step. Each step's expected answer is exact. Set `KEY` (and `GKEY`, the groups key, or the same value).

```bash
H=https://help.egrant.sk; I=https://acceptance-test-1.egrant.sk
auth=(-H "Authorization: Bearer $GKEY" -H "Content-Type: application/json")

# A1 auth: no key → 401 {"error":"unauthorized"}; wrong key → 401
curl -s -o /dev/null -w '%{http_code}\n' -X PUT $H/api/egrant/groups -H "Content-Type: application/json" -d '{}'
curl -s -X PUT $H/api/egrant/groups -H "Authorization: Bearer wrong-wrong-wrong-wrong" -H "Content-Type: application/json" -d '{}'

# A2 create → 201 {"state":"created","group_id":…}; same again → 200 unchanged
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d "{\"instance_url\":\"$I\",\"name\":\"Acceptance Test 1\"}"
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d "{\"instance_url\":\"$I\",\"name\":\"Acceptance Test 1\"}"

# A3 rename → 200 updated; bare host matches the same group
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d '{"instance_url":"acceptance-test-1.egrant.sk","name":"Acceptance Test 1 renamed"}'

# A4 logo PNG → 200 updated; same logo → 200 unchanged; logo:null → 200 updated
LOGO=$(base64 < logo.png | tr -d '\n')
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d "{\"instance_url\":\"$I\",\"name\":\"Acceptance Test 1 renamed\",\"logo\":{\"content_type\":\"image/png\",\"data_base64\":\"$LOGO\"}}"

# A5 SVG logo → 200 updated (Help stores it as a PNG); refused logos: an SVG without a size or text as PNG → 422 invalid_logo; > 2 MiB → 413 file_too_large
SVG=$(base64 < logo.svg | tr -d '\n')
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d "{\"instance_url\":\"$I\",\"name\":\"Acceptance Test 1 renamed\",\"logo\":{\"content_type\":\"image/svg+xml\",\"data_base64\":\"$SVG\"}}"
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d "{\"instance_url\":\"$I\",\"name\":\"x\",\"logo\":{\"content_type\":\"image/svg+xml\",\"data_base64\":\"PHN2Zz48L3N2Zz4=\"}}"
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d "{\"instance_url\":\"$I\",\"name\":\"x\",\"logo\":{\"content_type\":\"image/png\",\"data_base64\":\"aGVsbG8=\"}}"

# A6 managers: add → 200 created (an invitation email arrives); repeat → 200 unchanged; remove → 200 removed
curl -s -X PUT $H/api/egrant/managers -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"instance_url\":\"$I\",\"email\":\"you+help-test@yourdomain.sk\",\"name\":\"Test Person\",\"active\":true}"

# A7 ticket → 201 {"id","number"}; same request_id → 200 with the same number
curl -s $H/api/tickets/intake -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"request_id\":\"acc-$(date +%s)\",\"subject\":\"Acceptance\",\"email\":\"you+help-test@yourdomain.sk\",\"instance_url\":\"$I\"}"

# A8 deactivate → 200 deactivated; ticket now → 409 group_inactive; managers → 409 group_inactive
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d "{\"instance_url\":\"$I\",\"name\":\"Acceptance Test 1 renamed\",\"active\":false}"

# A9 reactivate → 200 reactivated; repeat → 200 unchanged
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d "{\"instance_url\":\"$I\",\"name\":\"Acceptance Test 1 renamed\",\"active\":true}"

# A10 unknown instance with active:false → 404 unknown_instance (nothing created)
curl -s -X PUT $H/api/egrant/groups "${auth[@]}" -d '{"instance_url":"https://never-created-xyz.egrant.sk","name":"x","active":false}'

# Cleanup: deactivate the test group (A8) and ask the Help team to delete it if needed.
```

Automated tests on the eGrant side (unit, with a mocked HTTP client):

- the retry table of section 2.3 (each status → retry or not; backoff grows; jitter bounded);
- the key never appears in logs or stored jobs (assert on captured log output);
- ordering: a managers job for an instance waits for its group job; a `404 unknown_instance` reschedules;
- body builders: name trimmed to 100, logo omitted vs `null` vs object, `active` sent only on explicit operator actions (and never from a contract-date job), canonical `https://<host>` in every call;
- the backfill: `--dry-run` sends nothing; pacing ≤ 1/s per endpoint; resume from `--since-id`; a second run yields only `unchanged`.

## 10. Definition of done

- [ ] Config and secrets (section 1), no key in code or logs.
- [ ] Shared HTTP + queue + retry layer (section 2) with tests.
- [ ] Groups call on create, rename, logo change, explicit deactivate/restore (section 3).
- [ ] Managers call on add/reactivate/deactivate/remove/email change, after the group (section 4).
- [ ] Ticket intake with `request_id` and files (section 5).
- [ ] Projects call behind `HELP_PROJECTS_ENABLED`, off until Help releases it (section 6).
- [ ] Backfill command run once on test, then on production, with the Help team (section 7).
- [ ] Logging rules (section 8) and acceptance tests A1–A10 passing (section 9).
