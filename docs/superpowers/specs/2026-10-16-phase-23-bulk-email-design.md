# Spolu — Phase 23: Bulk email (design)

Date: 2026-10-16 · Status: decisions P1–P5 answered by the owner (2026-10-16); ready to build

Owner brief: [2026-10-16-bulk-email.md](../briefs/2026-10-16-bulk-email.md), including its later **owner update** for the first version. Plan: [2026-10-16-phase-23-bulk-email.md](../plans/2026-10-16-phase-23-bulk-email.md).

Builds on: [Phase 2](2026-10-15-phase-2-login-and-users-design.md) (users, the email sender), [Phase 3](2026-10-15-phase-3-groups-and-invites-design.md) and [Phase 21](2026-10-16-phase-21-tickets-and-requesters-design.md) §1 (groups and memberships with roles `client | ziadatel`), [Phase 18](2026-10-16-phase-18-client-managers-design.md) (managers), and the pg-boss jobs of [ADR 0002](../../decisions/0002-postgres-job-queue-no-redis.md).

## Goal

Every admin can write an email out of blocks (heading, text, image, button, divider, eGrant logo), see it as it looks on a computer and on a phone, send a test to themselves, pick recipients among the people in Spolu, and send it to them through a queue. Spolu records for each person whether the email was sent or failed, and leaves out people who unsubscribed. The UI calls the module "Hromadné e-maily" (en: "Bulk email").

## Owner decisions

From the brief (2026-10-16):

| # | topic | decision |
|---|---|---|
| 1 | Builder | Blocks: heading, text, image, button, divider, eGrant logo. Blocks can be reordered. Live preview on a computer and on a phone. No free drag-and-drop layout. |
| 2 | Recipients | Only people in Spolu: filters by client group, by role (client, ziadatel, admin), by a manager's groups, and individual people. No import of outside contacts. |
| 3 | Who sends | Every admin. |
| 4 | Unsubscribe | Every bulk email has an unsubscribe link and a `List-Unsubscribe` header. People who unsubscribed are left out of later sends. |

**Owner update for the first version (2026-10-16, later; overrides the brief):**

| # | topic | decision |
|---|---|---|
| 5 | Sender | The existing egrant.sk sender (today's `MAIL_FROM` domain). `news.egrant.sk` comes later. |
| 6 | Tracking | No Elastic Email webhooks and no open or click tracking for now. |
| 7 | Report | Recipients, sent, failed, unsubscribed; a status per person from Spolu's own send results (queued, sent, failed). |
| 8 | Later | The bulk sender is its own config value, and the data model has room for provider events, so the sender domain and webhook tracking can be added without rework. See [Later](#later). |

## Owner answers on the proposed decisions (2026-10-16)

| # | question | decision (confirmed) |
|---|---|---|
| P1 | People who never signed in (an invited client, a requester who never used a login code) | **Included.** Every active (not disabled) person who matches the audience gets the email, signed in or not. |
| P2 | Greeting by name | One merge field, `{{name}}` (the person's name in Spolu), in headings and text. Nothing else is personalized. |
| P3 | Where unsubscribing happens | **Spolu is the source of truth.** The footer link and the `List-Unsubscribe` header point to Spolu (a signed token per person), with RFC 8058 one-click. Elastic's own forced link and suppression are handled as described in [Unsubscribe and Elastic](#unsubscribe-and-elastic); the daily copy of Elastic's unsubscribe and complaint lists stays only as a secondary safety net. |
| P4 | Re-subscribing | **In the first version.** A checkbox in the profile (Settings), "Dostávať hromadné e-maily" / "Receive mailings", on by default: unchecking unsubscribes, checking again subscribes. The public unsubscribe page also offers "Subscribe again". |
| P5 | Login codes and notifications for people who unsubscribed | **Must keep arriving.** Unsubscribing in Spolu touches only bulk email; the Elastic side is covered in [Unsubscribe and Elastic](#unsubscribe-and-elastic) and checked before the first real send. |

## What Elastic Email offers (verified 2026-10-16)

The design is based on these facts. Sources: the v4 OpenAPI spec ([api.elasticemail.com/public/v4/swagger](https://api.elasticemail.com/public/v4/swagger), the JSON behind [the REST API docs](https://elasticemail.com/developers/api-documentation/rest-api)), Elastic's examples repository ([github.com/ElasticEmail/elasticemail-examples](https://github.com/ElasticEmail/elasticemail-examples): `docs/sending-email.md`, `docs/webhooks.md`), and the help pages linked below.

- **Two send endpoints.** `POST /v4/emails/transactional` sends one message whose recipients see each other; `POST /v4/emails` ("send bulk merge email") sends each recipient their own copy, with `Recipients: [{ Email, Fields }]`. Both take `Content` (`From`, `Subject`, `Body: [{ ContentType, Content }]`, `Headers`, `Postback`, `Merge`, …) and `Options` (`TrackOpens`, `TrackClicks`, `ChannelName`, …). The answer is `{ TransactionID, MessageID }`, one per call, not per recipient. Source: the OpenAPI spec.
- **Idempotency.** Every send endpoint accepts an `Idempotency-Key` header, kept 24 hours. A repeat with the same key and body returns the stored answer (`Idempotency-Replayed: true`). The same key with another body returns `422`, and the same key while the first call still runs returns `409`. Source: examples repo, `docs/sending-email.md`.
- **Unsubscribe.** See [Unsubscribe and Elastic](#unsubscribe-and-elastic) below.
- **Suppression.** Addresses that hard-bounce, unsubscribe or complain are added to the suppression list automatically and get no more mail. The list is readable through `GET /v4/suppressions/unsubscribes` and `GET /v4/suppressions/complaints` (`search`, `limit`, `offset`; records `{ Email, ErrorCode, FriendlyErrorMessage, DateUpdated }`). Sources: [suppression list](https://help.elasticemail.com/en/articles/16180114-how-to-use-the-suppressions-list-in-elastic-email), the OpenAPI spec.
- **Limits.** The API allows 20 concurrent connections and 600 s per request. No requests-per-minute limit or `429` behaviour is documented. Paid plans have no daily limit, only the monthly email count. Sources: the OpenAPI spec, [pricing plans](https://help.elasticemail.com/en/articles/3331811-elastic-email-pricing-plans).
- **Later items (not built now).** Webhooks ("notifications") report `Sent`, `Opened`, `Clicked`, `Unsubscribed`, `Error` (bounces) and `AbuseReport` (complaints); there is no separate "Delivered" event. They need a PRO plan, can be created through `POST /v4/webhook` with `DeliveryMethod: PostJson` and `EnableSigning: true` (HMAC-SHA256 headers `X-ElasticEmail-Timestamp`, `X-ElasticEmail-Signature`, `X-ElasticEmail-Webhook-Id`), retry for up to 24 hours, and echo our `Content.Postback` value as `postback`. Domain records: SPF `include:_spf.elasticemail.com`, DKIM at `api._domainkey`, DMARC at `_dmarc`, tracking CNAME `tracking` → `api.elasticemail.com`. Sources: [notification settings](https://help.elasticemail.com/en/articles/4804685-notification-settings), examples repo `docs/webhooks.md`, [domain verification](https://help.elasticemail.com/en/articles/4934400-how-to-verify-your-domain).

### Unsubscribe and Elastic

What Elastic documents (checked again 2026-10-16 for the owner's answer P3):
- "Elastic Email adds an unsubscribe link to all emails automatically, including emails sent through the API and the SMTP relay." "You cannot remove the link yourself." To have it removed, contact Elastic's support, "who will review your account and sending practices"; on new free accounts it cannot be removed, and it "becomes possible only after you move to a paid plan and your account has a sending history". Source: [unsubscribe settings](https://help.elasticemail.com/en/articles/4808492-unsubscribe-settings).
- With your own unsubscribe page "you are still required to redirect unsubscribes through Elastic Email": the link `{unsubscribe:https://your.page}` "always registers as an 'unsubscribe from all' on Elastic Email before redirecting the contact to your third-party page". Sources: the same page and [how to manage the unsubscribe link](https://help.elasticemail.com/en/articles/2288355-how-to-manage-the-unsubscribe-link).
- The account setting **List-Unsubscribe header** makes Elastic add `List-Unsubscribe` and `List-Unsubscribe-Post`; turning it off "removes only the header", not the link. Whether a `List-Unsubscribe` header we pass in `Content.Headers` is kept is not documented; "the list-unsubscribe header cannot be passed in transactional emails". Source: [unsubscribe settings](https://help.elasticemail.com/en/articles/4808492-unsubscribe-settings).
- Sending a newsletter through the transactional endpoint is not a way out: Elastic defines marketing as "any email that is sent for commercial purposes" and lists newsletters there; transactional email is "generated as a response to a particular action done by the subscriber". The transactional route (`/emails/transactional`, or the SMTP header `IsTransactional: True`) is meant for transactional mail to contacts who opted out of marketing. Sources: [marketing vs transactional](https://help.elasticemail.com/en/articles/2419281-what-is-the-difference-between-marketing-and-transactional-email), [how to manage the unsubscribe link](https://help.elasticemail.com/en/articles/2288355-how-to-manage-the-unsubscribe-link).

So no account setting or merge field lets a marketing email go without Elastic's link; only Elastic's support can lift it, for a paid account with a sending history. **The design therefore has two unsubscribe modes**, chosen by `BULK_EMAIL_UNSUBSCRIBE` (§5). In both, the link people click lands on Spolu's page and Spolu records the choice:

| mode | footer link | `List-Unsubscribe` | Elastic's side | when |
|---|---|---|---|---|
| `elastic` (default) | `{unsubscribe:<Spolu page>}`: Elastic records "unsubscribe from all", then redirects to Spolu | Elastic's account setting (points to Elastic) | Elastic suppresses the address too. Re-subscribing in Spolu also asks Elastic to drop the suppression (`DELETE /v4/suppressions/{email}`, best effort, not documented to work for unsubscribes). The daily sync copies unsubscribes made on Elastic's side into Spolu. | until Elastic's support has removed the forced link; compliant with Elastic's terms from day one |
| `spolu` | Spolu's page directly | Spolu's own headers in `Content.Headers` (`<one-click URL>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`); Elastic's header setting turned off | Elastic records nothing, so re-subscribing just works and login codes are never at risk. The daily sync only catches complaints. | after Elastic's support confirms the link is removed for the account, and the 23.1 live check shows Elastic keeps our header |

Plainly: until Elastic lifts its link, Elastic also suppresses everyone who unsubscribes, and Spolu cannot fully undo that; Spolu still holds the setting people see and change. In `elastic` mode, Elastic's suppression might also block transactional mail sent over SMTP (not documented either way); the transactional SMTP sender therefore adds the documented header `IsTransactional: True`, and the owner checks P5 before the first real send.

Not verified, so the plan checks them with a real test send in part 23.1: whether Elastic keeps a `List-Unsubscribe` header we pass ourselves (needed only for `spolu` mode), and whether `DELETE /v4/suppressions/{email}` re-enables an address that unsubscribed.

**Consequences for the design.**
1. On servers, bulk email goes through `POST /v4/emails` (the marketing endpoint), never the transactional endpoint and never SMTP. Spolu makes **one call per recipient**, with the email already rendered for that person. That gives a send result per person, keeps Elastic's merge syntax out of the admin's text, and lets each call carry `Idempotency-Key = <campaign id>:<user id>`, so a retried job never sends twice.
2. The footer's unsubscribe link always leads to Spolu's page; in `elastic` mode it passes through Elastic first (`{unsubscribe:…}`), in `spolu` mode it goes straight there and the `List-Unsubscribe` header is Spolu's own.
3. `TrackOpens: false` and `TrackClicks: false` are sent explicitly (owner decision 6), so links are not rewritten and no tracking pixel is added, whatever the account default is.
4. `Content.Postback` is set to `<campaign id>:<user id>` now, and the answer's `TransactionID` and `MessageID` are stored on the recipient row. A later webhook can then be matched to a recipient without changing how emails are sent.

## 1. Data model

Module `modules/bulk-email` (server) and `features/bulk-email` (web), built with the `new-module` skill. One migration (`db:generate --name bulk_email`) creates all four tables.

**`bulk_campaigns`**

| column | type | note |
|---|---|---|
| `id` | text pk | random UUID |
| `name` | text not null | internal name in the list, ≤ 200 |
| `subject` | text not null default `''` | ≤ 200; required to send |
| `preheader` | text not null default `''` | ≤ 200; hidden preview line shown by mail apps |
| `blocks` | jsonb not null default `[]` | the block list, §3; validated by the shared zod schema on every write |
| `audience` | jsonb not null | the filter, §2 |
| `status` | text, check `draft \| sending \| sent \| cancelled` | default `draft` |
| `version` | integer not null default 1 | optimistic lock for edits by two admins |
| `sender` | text null | the From address used, copied from config when sending starts |
| `recipient_count` | integer null | set when sending starts |
| `created_by`, `updated_by`, `sent_by` | text → `user` (set null) | |
| `created_at`, `updated_at`, `send_started_at`, `finished_at` | timestamptz | `finished_at` when it became `sent` or `cancelled` |

Index: `(status, updated_at desc)` for the list.

**`bulk_recipients`** — the frozen recipient list of a campaign, created in one `insert … select` when sending starts.

| column | type | note |
|---|---|---|
| `campaign_id` | text → `bulk_campaigns` (cascade) | pk with `user_id` |
| `user_id` | text → `user` (cascade) | |
| `email`, `name`, `language` | text | copied at send start, so the sent email is reproducible |
| `status` | text, check `queued \| sending \| sent \| failed \| skipped \| cancelled` | default `queued` |
| `error` | text null | short reason for `failed` and `skipped` (`unsubscribed`, `disabled`, provider message ≤ 500) |
| `attempts` | smallint not null default 0 | |
| `provider_transaction_id`, `provider_message_id` | text null | from Elastic's answer; for later webhook matching |
| `sent_at`, `updated_at` | timestamptz | |

Indexes: `(campaign_id, status)`, `(user_id)`.

**`bulk_subscriptions`** — a person's bulk email setting. No row means subscribed (the default, P4).

| column | type | note |
|---|---|---|
| `user_id` | text pk → `user` (cascade) | |
| `subscribed` | boolean not null | false = unsubscribed |
| `email` | text not null | the address at the time of the change, for the admin list |
| `campaign_id` | text null → `bulk_campaigns` (set null) | the campaign whose link was used, when it was a link |
| `source` | text, check `link \| one_click \| profile \| provider` | `provider` = copied from Elastic by the daily sync |
| `changed_at` | timestamptz not null | the last change; the sync never overrides a newer change made in Spolu |

The audience and the batch job read it by primary key; no other index is needed.

**`bulk_images`** — images uploaded in the builder, served publicly (§3).

| column | type | note |
|---|---|---|
| `id` | text pk | random UUID (122 random bits): the public URL is unguessable |
| `storage_key` | text not null | `bulk/<id>` in the existing `Storage` |
| `mime` | text, check `image/png \| image/jpeg` | sniffed from the bytes, never taken from the request |
| `size`, `width`, `height` | integer | |
| `uploaded_by` | text → `user` (set null) | |
| `created_at` | timestamptz | |

**Room for later (not created now).** Provider events will get their own table `bulk_events (campaign_id, user_id, kind, occurred_at, provider_event_key unique, payload jsonb)`, joined to recipients through `provider_message_id` or the postback value. Nothing in the first version reads or writes it, so it is not created yet.

## 2. Audience

**The filter** (`BulkAudience`, zod in `packages/shared`), stored on the campaign:

```ts
{
  groupIds: string[];        // client groups; empty = every group
  managerIds: string[];      // admins: adds the groups each of them manages
  roles: ('client' | 'ziadatel' | 'admin')[];
  includeUserIds: string[];  // individual people, always added
  excludeUserIds: string[];  // individual people, always removed
}
```

Limits: each list ≤ 500 ids.

**Who is in it** (one SQL statement, `resolveAudience` in `bulk-email/audience.ts`, which reads the users and memberships through exported SQL helpers of the users and groups modules):
1. The **group scope** is `groupIds` ∪ the groups managed by `managerIds` (Phase 18's managed-groups subquery). When both lists are empty the scope is every group.
2. For `client` and `ziadatel` in `roles`: people with an **active** membership (`removed_at is null`) of that role in a group of the scope.
3. For `admin` in `roles`: every active admin and superadmin. The group scope does not apply to admins.
4. Plus `includeUserIds`, minus `excludeUserIds`. Each person once, even when they match several ways.
5. Then left out, and counted per reason: disabled accounts (`user.disabled_at` set) and people with `bulk_subscriptions.subscribed = false`. People who never signed in are **included** (P1).

**API** (admins only):
- `POST /api/bulk-email/audience/count` with a `BulkAudience` → `{ count, left_out: { unsubscribed, disabled } }`. The builder calls it 300 ms after the last filter change. One query with counts by reason.
- `POST /api/bulk-email/audience/people?cursor=` with a `BulkAudience` → `{ items: [{ id, name, email, role, groups: string[] }], nextCursor }`, 50 per page, by name; the "Show recipients" list.
- The pickers use existing endpoints: the groups list, the admins list (managers), and a new `GET /api/bulk-email/people?q=` (people search by name or email over active users, 20 results, for "add a person" and "leave out a person").

The list is **frozen when sending starts**: later changes in groups do not change who gets a campaign that is already sending. Unsubscribes are checked again right before each person's email, so someone who unsubscribes during a long send is skipped.

## 3. The block builder and the email

**Blocks** (`BulkBlock`, a zod discriminated union in `packages/shared`; each block has a client-made `id`):

| type | fields | limits |
|---|---|---|
| `heading` | `text`, `align: left \| center` | text ≤ 200 |
| `text` | `text`, `align` | ≤ 5 000; paragraphs split on a blank line; `**bold**`; http(s) URLs become links |
| `image` | `imageId`, `alt`, `href?` | `alt` required, ≤ 200; `href` http(s) |
| `button` | `label`, `url`, `align` | label ≤ 60; `url` http(s) or `mailto:` |
| `divider` | — | |
| `logo` | `align` | the eGrant logo |

A campaign has at most 50 blocks. Colours, fonts and spacing are fixed to the egrant.sk tokens ([design/tokens.md](../../design/tokens.md)); the admin chooses content and order, not styles. There is no raw-HTML block: every text is escaped, so a campaign cannot carry a script or a hidden form. `{{name}}` in a heading or text is replaced by the recipient's name (P2); no other placeholder exists, and a lone `{{` stays as written.

**Editing.** The editor page shows the block list on the left and the preview on the right (stacked on a phone). Each block has an edit form, **Move up**, **Move down** and **Delete**; "Add block" offers the six types. Reordering uses buttons, not drag and drop, so it works the same on a phone and with a keyboard and adds no library. Edits save automatically 1 s after the last change with `PUT /api/bulk-email/campaigns/:id` and the `version` read last; a stale version answers `409 changed` and the editor offers to reload.

**Rendering** (`bulk-email/render.ts`, a pure function, test-first):

```ts
renderCampaign(input: {
  subject: string; preheader: string; blocks: BulkBlock[];
  recipient: { name: string; language: 'sk' | 'en' };
  unsubscribeHref: string;   // already wrapped by the sender, see §5
  publicUrl: string;         // for image and logo URLs
}): { html: string; text: string }
```

The HTML is built for old mail apps (Outlook, Gmail, Apple Mail): an XHTML doctype, nested `role="presentation"` tables 600 px wide (100 % on a phone through one `@media (max-width: 620px)` rule; every other style is inline), web-safe font stacks after the egrant font, images with `width` attributes, `display:block`, `border:0` and their `alt`, buttons as a table cell with a background colour and a padded link (works without CSS in Outlook), the preheader as hidden text at the top, and a footer in the recipient's language: "You get this email because you have an account in Spolu by eGrant. Unsubscribe", with the link. The text part has the same content: headings in capitals, button as `label: url`, images as `[alt]`, the unsubscribe line at the end.

**Preview.** `POST /api/bulk-email/campaigns/:id/preview` with the current draft (`{ subject, preheader, blocks }`) answers `{ html }`, rendered with the signed-in admin's name and a dummy unsubscribe link. The web shows it in a sandboxed `<iframe sandbox srcdoc>` (no scripts, no same-origin) at 600 px ("Computer") or 375 px ("Phone"), refreshed 500 ms after the last edit. The server renderer is the only renderer, so the preview is exactly what is sent.

**Images.** Mail apps load images without a Spolu session, so they cannot be files of the files module (those are group files behind a login). Instead:
- `POST /api/bulk-email/images` (admins; raw body ≤ 2 MB, 30 a minute per admin) stores the image in the existing `Storage` under `bulk/<uuid>` and answers `{ id, url, width, height }`. The browser first shrinks it to at most 1 200 px wide and encodes it as JPEG (or PNG when the source is PNG), because many mail apps do not show WebP. The server sniffs the bytes and accepts only PNG and JPEG (`415 unsupported_type` otherwise).
- `GET /api/bulk-email/images/:id` is **public**: no session, the id is the only secret. It answers with the stored type, `x-content-type-options: nosniff`, `content-disposition: inline`, `content-security-policy: default-src 'none'`, `cache-control: public, max-age=31536000, immutable`, and `404` for an unknown id. Only admins can create such URLs, only PNG and JPEG are ever served, and nothing else in storage is reachable through this route (it reads `bulk_images` by id, never a key from the request).
- Images stay as long as the server: a sent email keeps pointing to them. Cleaning up images of deleted drafts is a later item.

**The eGrant logo.** SVG is not shown by Gmail or Outlook, so `pnpm --filter @spolu/web icons` also writes `apps/web/public/brand/egrant-logo-email.png` (the light logo, 360 px wide, shown at 180 px) from `egrant-logo.svg`. The email links it as `${PUBLIC_URL}/brand/egrant-logo-email.png`, served by the existing static file serving.

## 4. Campaigns, states and sending

**States.** `draft` → `sending` → `sent`; `sending` → `cancelled`. Only a draft can be edited or deleted. A sent or cancelled campaign is read-only and has **Duplicate**, which creates a new draft with the same content and audience. Every admin can do everything (owner decision 3).

**API** (admins only, `requireAdmin`; a client gets `403`):

| route | does |
|---|---|
| `GET /api/bulk-email/campaigns?cursor=` | list, newest first, 50 per page: name, subject, status, counts, author, dates |
| `POST /api/bulk-email/campaigns` | new draft (`name`; empty audience, no blocks) |
| `GET /api/bulk-email/campaigns/:id` | the campaign with its counts |
| `PUT /api/bulk-email/campaigns/:id` | save a draft: name, subject, preheader, blocks, audience, `version` (`409 changed`, `409 not_draft`) |
| `DELETE /api/bulk-email/campaigns/:id` | delete a draft (`409 not_draft`) |
| `POST /api/bulk-email/campaigns/:id/duplicate` | new draft from any campaign |
| `POST /api/bulk-email/campaigns/:id/test` | test send to the signed-in admin |
| `POST /api/bulk-email/campaigns/:id/send` | start sending |
| `POST /api/bulk-email/campaigns/:id/cancel` | stop sending |
| `GET /api/bulk-email/campaigns/:id/recipients?status=&cursor=` | the per-person list, 50 per page |

**Ready to send** (`validateForSend`, test-first): a subject; at least one block; every image block's image exists; every button and link URL is valid; no block over its limits. Missing pieces answer `400 not_ready` with a list of `{ blockId?, problem }` that the editor shows next to the block.

**Test send.** Sends the campaign as it is now to the signed-in admin's own address only (never another address, so the test cannot be used to mail anyone), rendered with their name, subject prefixed `[Test] `, through the same bulk sender and the same From. It is queued as a job like a real send. 10 test sends a minute per admin (`429 rate_limited`). The unsubscribe link in a test email carries a token for the campaign id `test`; Spolu's page says it was a test and changes nothing (in `elastic` mode Elastic would still record a click on its wrapper, so an admin should not click it).

**Send.** The confirm dialog shows the subject, the sender address and the live recipient count ("Send to 248 people?"). `POST …/send`, in one transaction:
1. lock the campaign row (`for update`); `409 not_draft` unless it is a draft; `validateForSend`;
2. insert the recipients from `resolveAudience` (with tokens) — `400 empty_audience` when there are none;
3. set `status = sending`, `sender`, `recipient_count`, `sent_by`, `send_started_at`;

then, after commit, queue the job `bulk-email.batch` with `{ campaignId }` and emit `bulk:updated` to the admins.

**The batch job** (`bulk-email.batch`, its own queue, one worker, `localConcurrency: 1`):
1. If the campaign is not `sending`, stop.
2. Take up to `BATCH_SIZE = 20` rows `where status in ('queued', 'sending')` (`for update skip locked`; rows in `sending` are retries of a run that crashed). For each: if the person is now unsubscribed (`bulk_subscriptions`) or disabled, set `skipped` with the reason. Otherwise set `sending`, `attempts + 1`, and commit.
3. For each row in `sending`: render it, send it with `Idempotency-Key: <campaignId>:<userId>` and `Postback: <campaignId>:<userId>`, then set `sent` (with the provider ids and `sent_at`) or handle the error:
   - `BulkSendError` with `retryable: true` (network error, timeout, `409` "in progress", `429`, `5xx`): back to `queued` until `attempts = 3`, then `failed`;
   - `retryable: false` (any other `4xx`, e.g. an address Elastic rejects): `failed` with the provider's message.
   A `422` (same key, different body) cannot happen, because the frozen row and the read-only campaign render the same email; it is treated as `failed` with a clear message.
4. Emit `bulk:updated { campaignId }` to the admins room.
5. If rows remain in `queued`, queue the next `bulk-email.batch` with `startAfter = ceil(BATCH_SIZE / BULK_EMAIL_PER_MINUTE × 60)` seconds; otherwise set `status = sent`, `finished_at`, and emit `bulk:updated`.

So with the default `BULK_EMAIL_PER_MINUTE = 120` a batch of 20 goes every 10 s: 1 000 people take about 8 minutes. Spolu has hundreds to a few thousand people, so this is enough, and it stays far below Elastic's 20 concurrent connections. pg-boss retries a batch job that throws (e.g. the database was briefly down); because each row's state is committed before and after its call and the idempotency key is stable, a retry never sends anyone twice. A row stuck in `sending` for more than 20 hours (the idempotency key lasts 24) becomes `failed` with `unknown` instead of being sent again. A daily sweep (`bulk-email.sweep`, 04:15) re-queues the batch job of any campaign still `sending` with no job pending, so a lost job cannot leave a campaign stuck.

**Cancel.** `POST …/cancel` on a `sending` campaign sets `status = cancelled`, `finished_at`, and every `queued` row to `cancelled`, in one transaction. Rows already `sending` finish; the next batch job sees the status and stops. `409 not_sending` otherwise.

## 5. The bulk sender, unsubscribe and configuration

**Sender interface** (`infra/email/bulk.ts`):

```ts
type BulkMessage = EmailMessage & {
  to: [string];                       // exactly one recipient
  idempotencyKey: string;
  postback: string;
  unsubscribeUrl: string;             // Spolu's page for this person (signed token)
  oneClickUrl: string;                // Spolu's RFC 8058 endpoint for this person (signed token)
};
interface BulkEmailSender {
  /** How the footer link must look for this driver. */
  unsubscribeHref(unsubscribeUrl: string): string;
  send(msg: BulkMessage): Promise<{ transactionId: string | null; messageId: string | null }>;
}
class BulkSendError extends Error { retryable: boolean; status: number | null }
```

Two drivers, chosen by `BULK_EMAIL_DRIVER`:
- **`elastic`** (servers): `POST https://api.elasticemail.com/v4/emails` with `Recipients: [{ Email }]`, `Content: { From: <MAIL_FROM_BULK>, Subject, Body: [HTML, PlainText], Postback }`, `Options: { TrackOpens: false, TrackClicks: false }`, headers `X-ElasticEmail-ApiKey` and `Idempotency-Key`; 15 s timeout. In `elastic` unsubscribe mode `unsubscribeHref(url)` = `{unsubscribe:<url>}` and the `List-Unsubscribe` header comes from Elastic's account setting; in `spolu` mode `unsubscribeHref(url)` = `url` and `Content.Headers` carries `List-Unsubscribe: <oneClickUrl>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Errors never include the API key.
- **`smtp`** (development, tests, e2e with Mailpit): nodemailer with the SMTP settings of `EMAIL_DRIVER=smtp`, From `MAIL_FROM_BULK`, and our own headers `List-Unsubscribe: <oneClickUrl>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. `unsubscribeHref(url)` = `url`. Returns null ids. Mailpit shows the headers, so dev and e2e test the one-click flow.

A **fake** sender for unit tests records the messages and can be told to fail with a given status.

**Unsubscribe and re-subscribe (P3, P4).** Spolu is the source of truth.
- **Token.** `token = <userId>.<campaignId>.<sig>`, where `sig` = base64url HMAC-SHA256 of `bulk-unsubscribe:<userId>:<campaignId>` with `APP_SECRET`, checked in constant time (`bulk-email/token.ts`). Nothing is stored; the campaign id lets the report count unsubscribes per campaign; a test email uses the campaign id `test`. Rotating `APP_SECRET` invalidates old links (the profile checkbox still works).
- **Page** `/unsubscribe/:token` (web, public, lazy, outside the signed-in layout, in the person's language). On load it calls `POST /api/bulk-email/unsubscribe/:token` and shows "You will no longer get bulk emails from eGrant. Login codes and notifications from Spolu still arrive." with a **Subscribe again** button (`POST /api/bulk-email/subscribe/:token`). A link scanner that fetches the page without running scripts changes nothing. A bad token shows "This link is not valid"; a `test` token shows "This was a test email; nothing changed".
- **Public API** (no session, 30 a minute per IP, `429`): `GET /api/bulk-email/unsubscribe/:token` → `{ language, subscribed, test }` or `404`; `POST /api/bulk-email/unsubscribe/:token` → `subscribed = false`, `source = link`, `campaign_id`, `204`; `POST /api/bulk-email/unsubscribe/:token/one-click` → the same with `source = one_click`, for the RFC 8058 POST (form body `List-Unsubscribe=One-Click`, accepted whatever the body); `POST /api/bulk-email/subscribe/:token` → `subscribed = true`, `204`. All idempotent; a bad signature `404`. The POSTs are exempt from the CSRF guard in `app.ts`: mail providers post the one-click from their servers, and none of them uses a session.
- **Profile** (Settings, every signed-in person: admins, clients and ziadatel people): a checkbox "Dostávať hromadné e-maily" / "Receive mailings", on by default. `GET /api/me/bulk-email` → `{ subscribed }`; `PUT /api/me/bulk-email { subscribed }` → `source = profile`. The texts live in the profile's namespace.
- **Elastic in `elastic` mode.** A change to subscribed (page or profile) queues a job `bulk-email.provider-resubscribe` that calls `DELETE /v4/suppressions/{email}`; a failure is logged and not retried more than pg-boss's default, because it is not documented to work for unsubscribes. In `spolu` mode no call is made.
- **Daily safety net.** A job `bulk-email.sync-suppressions` (04:30, only with `BULK_EMAIL_DRIVER=elastic`) reads `GET /v4/suppressions/unsubscribes` and `/complaints` page by page (`limit 1000`) and sets `subscribed = false, source = provider` for each address that matches a Spolu user, unless the person's row was changed in Spolu after Elastic's `DateUpdated`. It exists only to catch unsubscribes and complaints made on Elastic's side; Spolu's own link and profile are the normal way.
- **Effect.** An unsubscribed person is left out of the audience count and every later send, and skipped by a running send before their turn. **Only bulk email is affected**: login codes, invites, notifications and ticket emails never read `bulk_subscriptions` (P5).

**Configuration** (`infra/config/config.ts`, `.env.example`, `deploy/test.env.example`):

| variable | meaning | default |
|---|---|---|
| `MAIL_FROM_BULK` | From of bulk email, e.g. `eGrant <info@egrant.sk>`. Later `…@news.egrant.sk` without code changes. | `MAIL_FROM` |
| `BULK_EMAIL_DRIVER` | `smtp` (dev, tests, e2e: the SMTP settings above) or `elastic` (servers) | `smtp` |
| `ELASTIC_EMAIL_API_KEY` | now also read when `BULK_EMAIL_DRIVER=elastic` (required then), whatever `EMAIL_DRIVER` is | — |
| `BULK_EMAIL_PER_MINUTE` | upper bound of bulk emails a minute | `120` |
| `BULK_EMAIL_UNSUBSCRIBE` | `elastic` (the footer link passes through Elastic) or `spolu` (Spolu's link and headers only, after Elastic's support removed the forced link); see [Unsubscribe and Elastic](#unsubscribe-and-elastic) | `elastic` |

`Config` gains `bulkEmail: { driver: 'smtp'; from } | { driver: 'elastic'; apiKey; from; unsubscribe: 'elastic' | 'spolu' }` and `bulkEmailPerMinute`. The transactional SMTP sender gains the header `IsTransactional: True` (harmless for Mailpit). `BULK_EMAIL_DRIVER=smtp` with `EMAIL_DRIVER=elastic` is a `ConfigError` (there are no SMTP settings to use). The API key is never logged.

## 6. Report

The campaign page of a sent, sending or cancelled campaign shows:
- the numbers: **recipients**, **sent**, **failed**, **skipped** (unsubscribed or disabled before their turn), **cancelled**, and **unsubscribed** (people whose current setting is unsubscribed through this campaign's link, from `bulk_subscriptions.campaign_id`); while sending, a progress bar updated by `bulk:updated`;
- the per-person list (name, email, status, error, sent time) with a status filter, 50 per page;
- the sender address and who sent it when;
- a note: "Spolu does not measure opens and clicks yet. 'Sent' means Elastic Email accepted the email, not that it reached the inbox."

The counts are one `count(*) filter (where …)` query by `(campaign_id, status)`.

## 7. Permissions

Policy `bulk-email/policy.ts`: `canUseBulkEmail(actor)` = `isAdmin(actor)` (owner decision 3). Every `/api/bulk-email/*` route uses `requireAdmin` except the public five: `GET /images/:id`, `GET /unsubscribe/:token`, `POST /unsubscribe/:token`, `POST /unsubscribe/:token/one-click`, `POST /subscribe/:token` (all token routes check the signature). `GET`/`PUT /api/me/bulk-email` need a session and act only on the signed-in person. Any admin can edit, send, cancel or delete any campaign; there are no per-campaign owners. Clients and ziadatel people never see the module (the header link is admin-only, and the routes answer `403`). A row is added to [architecture/permissions.md](../../architecture/permissions.md).

## 8. Interface

Design replicates egrant.sk; every web part starts with the `frontend-design` skill. Texts live in a lazy `bulkEmail` namespace (sk, en); the email content is whatever the admin writes, and only the footer is translated (by the recipient's language). All screens are lazy routes.

- **Header**: "Hromadné e-maily" for admins, beside Admins.
- **`/bulk-email`**: the campaign list (name, subject, status badge, "248 sent · 2 failed", author, date) and **New email**.
- **`/bulk-email/:id`** for a draft: three steps on one page — **Content** (subject, preheader, the block list and the preview with a Computer / Phone switch), **Recipients** (the audience builder: groups, managers' groups, roles as checkboxes, add a person, leave out a person, the live count with the "left out" reasons and **Show recipients**), and **Send** (**Send a test to me**, then **Send** with the confirm dialog). Errors from `not_ready` appear at their block.
- **`/bulk-email/:id`** for any other state: the report (§6) and **Duplicate**; **Cancel sending** while sending.
- **`/unsubscribe/:token`**: the public page (§5).
- **Settings**: the "Receive mailings" checkbox (§5), for everyone.

Realtime: `bulk:updated { campaignId }` to the `admins` room after each state change and each batch; the list and the report refetch. No other event.

## 9. Performance

- The module is three lazy chunks (list, editor/report, unsubscribe page); the eager shell gains only the route definitions and the header link. No new dependency: reordering is buttons, the preview is an iframe.
- The audience count and list are one query each over existing indexes (`group_members` partial indexes, `user_role_idx`, `group_managers`), plus the `bulk_subscriptions` primary key. The recipient insert is one `insert … select`.
- The preview call is debounced (500 ms), autosave 1 s, the audience count 300 ms.
- Sending runs only in the job, 20 people per run, `skip locked`; the request returns at once.
- Lists are cursor-paginated, 50 per page. Blocks are capped (50 blocks, a 200 kB JSON body limit on the save route).

## 10. Testing

- Test-first: `render.ts` (escaping, `{{name}}`, every block type, the text part, the footer per language, the unsubscribe href); `validateForSend`; `resolveAudience` (each filter, union and exclusion, each "left out" reason, a person matched twice counted once, removed memberships and disabled users out, group scope not applied to admins); the batch job (skip of a person who unsubscribed mid-send, retryable versus final errors, three attempts, resume of a `sending` row with the same idempotency key, cancel stops it, finish sets `sent`); the policy.
- Integration (Vitest + test DB): every route's admin / client / anonymous answer; `409 changed` and `409 not_draft`; image upload with a PNG, a JPEG, a GIF renamed `.png` (`415`), over 2 MB (`413`); public image headers; unsubscribe, one-click and subscribe again, idempotent, a forged or altered token `404`; the profile checkbox both ways; the suppression sync never overrides a newer Spolu change; the Elastic driver's request body and headers against a fake `fetch` (`TrackOpens: false`, `Idempotency-Key`, `Postback`, `{unsubscribe:…}` in `elastic` mode, our headers in `spolu` mode); the suppression sync with a fake `fetch`.
- Web: block editing and reordering, audience builder count, preview switch, send dialog, report.
- e2e (`e2e/bulk-email.spec.ts`, Mailpit): an admin writes an email with a heading, text with `{{name}}`, a button and the logo, sends a test to themselves (it arrives in Mailpit with `[Test]`), picks a client group, sends; both clients get it with their names, the `List-Unsubscribe` header is present; one client opens the unsubscribe link and is unsubscribed; a second campaign to the same group reaches only the other client; that client ticks "Receive mailings" again in Settings and a third campaign reaches both; the report shows the counts.

## 11. Parts

Each part is one pull request. Details are in the [plan](../plans/2026-10-16-phase-23-bulk-email.md).

| part | content | waits for |
|---|---|---|
| 23.1 | Foundation: shared contracts, the four tables, policy, config, the bulk sender (both drivers) | — |
| 23.2 | Campaigns and audience API | 23.1 |
| 23.3 | Email renderer, images, preview, logo PNG | 23.1 |
| 23.4 | Unsubscribe and re-subscribe: signed tokens, public API and page, profile checkbox, Elastic resubscribe call and daily sync | 23.1 |
| 23.5 | Sending: test send, the batch job, cancel, progress, report API | 23.2, 23.3 |
| 23.6 | Web: campaign list, block builder, audience builder, preview, test send | 23.2, 23.3 |
| 23.7 | Web: send flow and report, e2e, docs, roadmap | 23.4, 23.5, 23.6 |

23.2, 23.3 and 23.4 can run in parallel after 23.1; 23.5 and 23.6 in parallel after 23.2 and 23.3.

## What the owner must do

Before the first real send (none of this blocks building and testing locally with Mailpit):
1. **Elastic plan**: an Email API plan (paid). New accounts can only send to their own address until they are on a paid plan.
2. **Elastic API key** with the `SendHttp` access level and suppression access (`ViewSuppressions`, `ModifySuppressions`), set as `ELASTIC_EMAIL_API_KEY` on the server, with `BULK_EMAIL_DRIVER=elastic`.
3. **Sender**: the egrant.sk sender address used for `MAIL_FROM_BULK` must be on a domain already verified in Elastic (SPF, DKIM, DMARC). Today's `MAIL_FROM` domain is.
4. **Start in `elastic` unsubscribe mode** (the default) and turn on the account setting **List-Unsubscribe header** (Settings → Unsubscribe settings).
5. **Ask Elastic's support to remove the automatic unsubscribe link** for the account, explaining that Spolu runs its own unsubscribe page and `List-Unsubscribe` one-click. When they confirm (they require a paid plan with sending history): turn the List-Unsubscribe header setting **off**, set `BULK_EMAIL_UNSUBSCRIBE=spolu`, and send one test to check that the email has only Spolu's link and Spolu's header.
6. **Check P5** with a test address: send it a test bulk email, unsubscribe through the link, then request a login code for that address. If the code does not arrive, switch the server to `EMAIL_DRIVER=elastic` (the transactional endpoint) before sending to clients.

## Later

Not built now, and the design leaves room for each:
- **Sender `news.egrant.sk`**: verify the subdomain in Elastic (DNS at Webglobe: SPF TXT on `news` with `include:_spf.elasticemail.com`, DKIM TXT `api._domainkey.news`, DMARC TXT `_dmarc.news`, tracking CNAME `tracking.news` → `api.elasticemail.com`), then set `MAIL_FROM_BULK=…@news.egrant.sk`. No code change.
- **Webhook tracking** (needs Elastic's PRO plan): `POST /api/bulk-email/webhook` with Elastic's HMAC signature check (`EnableSigning`, 5-minute timestamp window, the save-time test event ignored), the `bulk_events` table, idempotent by a key built from `messageid`, `status` and `date`, matched to a recipient by `postback` (already sent with every email); report columns delivered (`Sent`), opened, clicked, bounced (`Error`), complaints (`AbuseReport`), with "opens are approximate" (Apple Mail opens every message, some apps block images). Turning on `TrackOpens`/`TrackClicks` and the tracking domain go with it.
- Deleting images of deleted drafts; scheduled sends; more merge fields; saved audiences.

## Out of scope

Outside contacts or CSV import; free layout or custom colours; raw HTML; A/B tests; attachments; sending as another admin's address; clients sending bulk email.
