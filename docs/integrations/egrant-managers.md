# eGrant managers webhook: integration guide

For the eGrant developers who tell Help by eGrant ("Help", code name Spolu, at https://help.egrant.sk) who manages a client. A **manager** is one of the eGrant team's administrators responsible for a client (an eGrant instance); see [product/client-managers.md](../product/client-managers.md). This call adds a manager to the client of one instance, or removes one. If this page and the product doc ever disagree, the product doc wins.

## In short

- One endpoint: `PUT https://help.egrant.sk/api/egrant/managers`, JSON body `{ "instance_url", "email", "active" }`.
- The same shared key as the ticket intake ([egrant-ticket-intake.md](egrant-ticket-intake.md)): `Authorization: Bearer <key>`, on the Help server `TICKETS_API_KEY`. There is no second key.
- Idempotent: send the state you want (`active: true` = is a manager, `false` = is not). A repeat answers `200 unchanged` and does nothing.
- **It never creates accounts or gives anyone the admin role.** The email must belong to an existing, active administrator of Help (or its superadmin); anything else answers `422 unknown_admin`. New administrators are added in Help by the eGrant team.

## Example

```bash
curl -sS -X PUT https://help.egrant.sk/api/egrant/managers \
  -H "Authorization: Bearer $SPOLU_TICKETS_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "instance_url": "https://mesto-x.egrant.sk", "email": "eva.kovacova@egrant.sk", "active": true }'
```

Answer:

```json
{ "state": "added", "group_id": "0b7c…", "user_id": "c41e…" }
```

## The JSON body

| field | meaning | rules |
|---|---|---|
| `instance_url` | the eGrant instance whose client is meant | required; a URL (`https://mesto-x.egrant.sk/app`) or a bare host (`mesto-x.egrant.sk`), up to 2048 characters. Matched by host, as for tickets: scheme, a leading `www.`, path and case do not matter |
| `email` | the administrator's email in Help | required, a valid email up to 254 characters; case and surrounding spaces do not matter (no other spelling tricks: `+tags` or Gmail dots are not folded) |
| `active` | `true`: make them a manager of that client; `false`: stop them being one | required boolean |

Unknown fields are ignored. The body may be at most 16 KiB.

## Answers

| status | body | meaning, what to do |
|---|---|---|
| `200` | `{ "state": "added", "group_id", "user_id" }` | they became a manager now; Help emailed them |
| `200` | `{ "state": "removed", "group_id", "user_id" }` | they stopped being a manager now |
| `200` | `{ "state": "unchanged", "group_id", "user_id" }` | it was so already (also when someone set it by hand in Help); nothing happened, no email |
| `400` | `{ "error": "validation_failed", "fields": ["email"] }` | a malformed field (or JSON); fix it, do not retry unchanged |
| `401` | `{ "error": "unauthorized" }` | missing or wrong key; check the configuration, do not retry |
| `404` | `{ "error": "unknown_instance" }` | no client in Help has this instance. Help does not store the call: send it again after the eGrant team has created the client (or fixed its eGrant address) |
| `413` | (no fixed body) | the body is over 16 KiB |
| `422` | `{ "error": "unknown_admin" }` | the email is not an active administrator of Help: unknown, a client's account, or a disabled administrator (for `active: true`). Nothing changed, no account was created. Ask the eGrant team to add the administrator in Help first |
| `429` | `{ "error": "rate_limited" }` | more than 60 calls a minute from one IP address (every call counts, a wrong key too); retry later |
| `503` | `{ "error": "intake_disabled" }` | Help has no key configured; retry later, tell the eGrant team if it lasts |
| other `5xx`, timeout | | retry with the same body |

`group_id` and `user_id` are Help's internal ids, for your logs.

## What happens in Help

- **Added** (`active: true`, not a manager yet): the administrator becomes a manager through the same path as the button in Help, so everything a manager gets applies: their notification mode for that client switches to "All messages" (unless they chose one themselves), they watch its tickets by default, and every open Help screen sees the new manager list at once. They get one email in their own language: "You are now a manager of <client>", with a button that opens the client in Help.
- **Removed** (`active: false`): they stop managing that client only; their account stays active and keeps managing other clients. Their "All messages" from becoming a manager is dropped (a mode they chose stays). No email. A disabled administrator can be removed too. Removing the last manager is allowed: Help logs it, and the client simply has no manager until someone adds one.
- Only the client matched by `instance_url` changes; other clients of the same administrator are not touched.
- Help logs every call (the client and the administrator by id, never the key or the email).

## What it does not do

- No accounts and no roles: it never creates a user, re-enables a disabled one, or makes anyone an administrator.
- No callbacks: Help never calls eGrant back. Managers changed by hand in Help are not reported to eGrant.
- No bulk call: one call per administrator and client.
