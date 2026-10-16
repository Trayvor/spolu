# Bulk email

Every administrator can write an email to many people in Spolu at once ("Hromadné e-maily", en "Bulk email"). Clients and requesters (ziadatel) never see the module. Design: [Phase 23 spec](../superpowers/specs/2026-10-16-phase-23-bulk-email-design.md); plan: [Phase 23 plan](../superpowers/plans/2026-10-16-phase-23-bulk-email.md).

## What admins can do

- **Campaigns.** A campaign is an email with an internal name, a subject, a preheader (the hidden preview line), up to 50 blocks (heading, text, image, button, divider, eGrant logo) and an audience. States: `draft` → `sending` → `sent`, or `sending` → `cancelled`.
- **Drafts.** A new campaign is a draft with only its name, an empty audience and no blocks. Any admin edits any draft; edits are saved with the `version` read last, so when two admins edit the same draft the later save is refused (`409 changed`) and the editor offers to reload. Only a draft can be edited or deleted (`409 not_draft` otherwise).
- **Duplicate.** Any campaign, also a sent or cancelled one, can be duplicated into a new draft with the same subject, preheader, blocks and audience, version 1, named "<name> (kópia)" / "<name> (copy)" in the admin's language.
- **List.** All campaigns, last changed first, 50 a page, with status, counts (queued, sending, sent, failed, skipped, cancelled, unsubscribed through this campaign's link), author and dates.
- Test sends, sending, cancelling and the report arrive with the later parts (23.5–23.7).

## Audience rules

The audience is a filter stored on the campaign (`BulkAudience`): `groupIds`, `managerIds`, `roles` (`client`, `ziadatel`, `admin`), `includeUserIds`, `excludeUserIds`, each list at most 500 ids.

1. The **group scope** is the picked groups plus the groups managed by the picked managers. With no groups and no managers picked, the scope is every group. A picked manager who manages no group adds nothing.
2. `client` and `ziadatel` take the people with an active membership (not removed) of that role in a group of the scope. With no role ticked nobody comes from the groups.
3. `admin` takes every admin and superadmin; the group scope does not apply to them.
4. People added by hand are always in; people left out by hand are always out (also when added by hand). Everyone counts once, however many ways they match.
5. Then **left out**, and counted per reason: disabled accounts, and people who unsubscribed. A disabled person who also unsubscribed counts as disabled. People who never signed in (invited, or requesters who never used a code) are **included** (owner answer P1). A person who subscribed again is included.

The builder shows the live count with the "left out" numbers, and "Show recipients" lists the people who would get it (name, email, role, their groups), 50 a page by name. "Add a person" and "Leave out a person" search active people by name or email (at least 2 characters, 20 results). The list is frozen when sending starts (part 23.5).

## API (part 23.2, admins only; clients 403, no session 401)

| route | does |
|---|---|
| `GET /api/bulk-email/campaigns?cursor=` | the list (`BulkCampaignPage`) |
| `POST /api/bulk-email/campaigns` | `{ name }` → 201, a new draft (`BulkCampaignDto`) |
| `GET /api/bulk-email/campaigns/:id` | the campaign with its counts; 404 if unknown |
| `PUT /api/bulk-email/campaigns/:id` | save a draft (`BulkCampaignDraftSchema`, body ≤ 200 kB, else 413); 400 `validation_failed`, 404, 409 `not_draft` (wins over a stale version), 409 `changed` |
| `DELETE /api/bulk-email/campaigns/:id` | 204; 404; 409 `not_draft` |
| `POST /api/bulk-email/campaigns/:id/duplicate` | 201 with the new draft; 404 |
| `POST /api/bulk-email/audience/count` | `BulkAudience` → `{ count, leftOut: { unsubscribed, disabled } }` |
| `POST /api/bulk-email/audience/people?cursor=` | `BulkAudience` → `{ items: BulkPerson[], nextCursor }` |
| `GET /api/bulk-email/people?q=` | people search (`BulkPerson[]`, 2–200 characters) |
| `POST /api/bulk-email/people/lookup` | `{ ids }` (≤ 1 000) → the people behind saved ids, disabled ones too, unknown ids left out (the editor shows the people added or left out by hand) |

A malformed `cursor` is `400 validation_failed`. Every write pushes `bulk:updated { campaignId }` to the admins room.

## Unsubscribing and subscribing again (part 23.4)

Spolu is the source of truth (owner answer P3). Every person is subscribed until they unsubscribe; people who never signed in too.

- **The link.** Every bulk email's footer link and its `List-Unsubscribe` header lead to Spolu with a signed token for that person and campaign (`<userId>.<campaignId>.<signature>`; nothing is stored, rotating `APP_SECRET` invalidates old links). The page `/unsubscribe/<token>` needs no login. When it opens it unsubscribes the person and says "You will no longer get bulk emails from eGrant. Login codes and notifications from Spolu still arrive.", with **Subscribe again** (and, after that, **Unsubscribe** again). It is shown in the person's language. A link scanner that only fetches the page changes nothing (the page's script does the unsubscribe). A broken or forged link shows "This link is not valid"; the link of a test email shows "This was a test email; nothing changed." The page never shows the person's name or address.
- **One-click.** Mail apps that offer "Unsubscribe" next to the sender (RFC 8058) post to `/api/bulk-email/unsubscribe/<token>/one-click`; it works from the provider's servers, whatever the body.
- **Settings.** Every signed-in person (admins, clients and requesters) has the checkbox **"Dostávať hromadné e-maily" / "Receive mailings"** in the Profile card of Settings, ticked by default; unticking unsubscribes, ticking subscribes again (owner answer P4). It saves at once and says "Saved".
- **Effect.** An unsubscribed person is left out of the audience count and of every later send (a running send checks again before each person, part 23.5). The campaign's "unsubscribed" count is the people whose current setting is unsubscribed through that campaign's link. **Only bulk email is affected**: login codes, invites, notifications and ticket emails always arrive (P5).
- **Elastic Email.** Until Elastic's support removes its forced unsubscribe link (`BULK_EMAIL_UNSUBSCRIBE=elastic`, the default), the footer link passes through Elastic, which also suppresses the address; when the person subscribes again in Spolu, Spolu asks Elastic to drop that suppression (best effort, not documented to work for unsubscribes). In `spolu` mode Elastic records nothing and no call is made. With `BULK_EMAIL_DRIVER=elastic` a daily job at 04:30 copies the unsubscribes and complaints recorded on Elastic's side into Spolu (source `provider`), but never over a change the person made in Spolu after Elastic's date: it is only a safety net.

| route | does |
|---|---|
| `GET /api/bulk-email/unsubscribe/:token` | public: `{ language, subscribed, test }`; 404 for a bad link |
| `POST /api/bulk-email/unsubscribe/:token` | public: unsubscribe (source `link`), 204 |
| `POST /api/bulk-email/unsubscribe/:token/one-click` | public: the same with source `one_click`, any body, 204 |
| `POST /api/bulk-email/subscribe/:token` | public: subscribe again, 204 |
| `GET /api/me/bulk-email` | signed in: `{ subscribed }` |
| `PUT /api/me/bulk-email` | signed in: `{ subscribed }` → 204 (source `profile`) |

The public routes allow 30 calls a minute per IP (`429 rate_limited`); all of them are idempotent.

## Status

Phase 23 in progress: part 23.1 (tables, policy, config, sender), part 23.2 (campaigns and audience API), part 23.3 (renderer, images, preview) and part 23.4 (unsubscribe, subscribe again, the Settings checkbox, the Elastic suppression jobs) are built.
