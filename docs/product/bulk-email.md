# Bulk email

Every administrator can write an email to many people in Spolu at once ("Hromadné e-maily", en "Bulk email"). Clients and requesters (ziadatel) never see the module. Design: [Phase 23 spec](../superpowers/specs/2026-10-16-phase-23-bulk-email-design.md); plan: [Phase 23 plan](../superpowers/plans/2026-10-16-phase-23-bulk-email.md).

## What admins can do

- **Campaigns.** A campaign is an email with an internal name, a subject, a preheader (the hidden preview line), up to 50 blocks (heading, text, image, button, divider, eGrant logo) and an audience. States: `draft` → `sending` → `sent`, or `sending` → `cancelled`.
- **Drafts.** A new campaign is a draft with only its name, an empty audience and no blocks. Any admin edits any draft; edits are saved with the `version` read last, so when two admins edit the same draft the later save is refused (`409 changed`) and the editor offers to reload. Only a draft can be edited or deleted (`409 not_draft` otherwise).
- **Duplicate.** Any campaign, also a sent or cancelled one, can be duplicated into a new draft with the same subject, preheader, blocks and audience, version 1, named "<name> (kópia)" / "<name> (copy)" in the admin's language.
- **List.** All campaigns, last changed first, 50 a page, with status, counts (queued, sending, sent, failed, skipped, cancelled, unsubscribed through this campaign's link), author and dates.
- Test sends, sending, cancelling, the report, the preview and images arrive with the later parts (23.3–23.7); unsubscribing and the "Receive mailings" setting with part 23.4.

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

## Status

Phase 23 in progress: part 23.1 (tables, policy, config, sender) and part 23.2 (campaigns and audience API) are built.
