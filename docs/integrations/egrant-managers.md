# eGrant managers webhook: integration guide

For the eGrant developers who tell Help by eGrant ("Help", code name Spolu, at https://help.egrant.sk) who the people of an organisation are. In eGrant, a **manager** of an organisation is the client's own person (for example the town's grant officer). In Help, every eGrant instance is one client **group**, and the client's people are its **client members**: they read and write the group's chat, tasks, tickets and knowledge. This call adds a person as a client member of the group of one instance, or removes them from it. The product rules are in [product/groups.md](../product/groups.md) ("Adding members by email" and "From eGrant"); if this page and the product doc ever disagree, the product doc wins.

Not to be confused with Help's own "managers" ([product/client-managers.md](../product/client-managers.md)): those are eGrant team administrators responsible for a client. This webhook never touches them.

## In short

- One endpoint: `PUT https://help.egrant.sk/api/egrant/managers`, JSON body `{ "instance_url", "email", "active", "name"? }`.
- The same shared key as the ticket intake ([egrant-ticket-intake.md](egrant-ticket-intake.md)): `Authorization: Bearer <key>`, on the Help server `TICKETS_API_KEY`. There is no second key.
- Idempotent: send the state you want (`active: true` = is a member of that client, `false` = is not). A repeat answers `200 unchanged` and does nothing.
- `active: true` with an email Help does not know **creates a client account** and emails the person an invitation with a login link. It never creates or changes an administrator: an administrator's email answers `422 email_is_admin`.
- `active: false` removes the person from that one client only. It never deletes or disables the account.

## Example

```bash
curl -sS -X PUT https://help.egrant.sk/api/egrant/managers \
  -H "Authorization: Bearer $SPOLU_TICKETS_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "instance_url": "https://mesto-x.egrant.sk", "email": "jana.kovacova@mesto-x.sk", "name": "Jana Kováčová", "active": true }'
```

Answer:

```json
{ "state": "created", "group_id": "0b7c…", "user_id": "c41e…" }
```

## The JSON body

| field | meaning | rules |
|---|---|---|
| `instance_url` | the eGrant instance whose client is meant | required; a URL (`https://mesto-x.egrant.sk/app`) or a bare host (`mesto-x.egrant.sk`), up to 2048 characters. Matched by host, as for tickets: scheme, a leading `www.`, path and case do not matter |
| `email` | the person's email | required, a valid email up to 254 characters; case and surrounding spaces do not matter (no other spelling tricks: `+tags` or Gmail dots are not folded) |
| `active` | `true`: make them a member of that client; `false`: remove them from it | required boolean |
| `name` | the person's full name | optional (may be missing or `null`), up to 100 characters. Used only when Help creates the account or the account has no name yet; Help never renames anyone. Without it the person is asked for their name at the first login |

Unknown fields are ignored. The body may be at most 16 KiB.

## Answers

| status | body | meaning, what to do |
|---|---|---|
| `200` | `{ "state": "created", "group_id", "user_id" }` | Help had no account for the email: it created a client account and made it a member; the person got an invitation email |
| `200` | `{ "state": "added", "group_id", "user_id" }` | an existing account became a member of this client now (it may be a member of other clients too); the person got an email |
| `200` | `{ "state": "removed", "group_id", "user_id" }` | the person is no longer a member of this client |
| `200` | `{ "state": "unchanged", "group_id", "user_id" }` | it was so already (also when an administrator did it by hand in Help); nothing happened, no email. `user_id` is `null` for `active: false` with an email Help does not know |
| `400` | `{ "error": "validation_failed", "fields": ["email"] }` | a malformed field (or JSON); fix it, do not retry unchanged |
| `401` | `{ "error": "unauthorized" }` | missing or wrong key; check the configuration, do not retry |
| `404` | `{ "error": "unknown_instance" }` | no client in Help has this instance. Help does not store the call: send it again after the eGrant team has created the client (or fixed its eGrant address) |
| `413` | (no fixed body) | the body is over 16 KiB |
| `422` | `{ "error": "email_is_admin" }` | the email belongs to an eGrant team administrator of Help. Nothing changed: an administrator is never made a client. Use another email for the person |
| `422` | `{ "error": "user_disabled" }` | (`active: true` only) the account exists but is blocked in Help. Nothing changed: the webhook does not unblock anyone. Ask the eGrant team to restore the person in Help |
| `429` | `{ "error": "rate_limited" }` | more than 60 calls a minute from one IP address (every call counts, a wrong key too); retry later |
| `503` | `{ "error": "intake_disabled" }` | Help has no key configured; retry later, tell the eGrant team if it lasts |
| other `5xx`, timeout | | retry with the same body |

`group_id` and `user_id` are Help's internal ids, for your logs.

## What happens in Help

- **`active: true`** goes through the same path as an administrator's "+ Add member" in Help, so it behaves the same:
  - no account with the email: Help creates a **client** account (with `name`, if given) and makes it a member. It shows as "Invited" on the client's Members tab until the first sign-in. The person gets the invitation email ("Invitation to Help by eGrant – <client>", "eGrant invited you…") with a **Log in** button that fills in their email. State `created`;
  - an account that never signed in, a client of other clients, or a person who reported tickets for this client (a requester): they become a client member of this client too. A person who has signed in before gets "You were added to <client>" with a button opening the client; one who never has gets the invitation. State `added`;
  - a person removed from this client before (by this webhook or by an administrator) is brought back: eGrant decides who its organisation's people are. State `added`, with the email;
  - already a member (or invited and not signed in yet): `unchanged`, no email. An invitation is not sent again;
  - the email is in the person's language in Help (Slovak for a new account).
- **`active: false`** removes the person's membership of that client only. Their other clients, their account and their tickets stay. When it was their last client, they can still sign in but see nothing except the tickets they reported themselves (there is no client to open); an administrator can add them again. No email. A person who only reported tickets for this client (a requester, not a member) is left alone: `unchanged`.
- Only the client matched by `instance_url` changes; the person's other clients are not touched.
- Help logs every call (the client and the account by id, never the key or the email).

## What it does not do

- Nothing about administrators: it never creates, changes, adds or removes an eGrant team administrator, and never touches Help's own managers of a client.
- No unblocking: a blocked (disabled) account answers `user_disabled` and stays blocked.
- No deleting or blocking: removing the last membership leaves the account active.
- No callbacks: Help never calls eGrant back. Members changed by hand in Help are not reported to eGrant.
- No bulk call: one call per person and client.
