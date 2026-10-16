# Phase 23: Bulk email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins write an email out of blocks, preview it, test it on themselves, choose recipients among Spolu's people and send it through a queue; Spolu records a status per person and leaves out people who unsubscribed.

**Architecture:** A new module `modules/bulk-email` owns campaigns, frozen recipient lists, unsubscribes and public images. A pure server renderer turns blocks into table-based HTML, used both for the preview and for sending. A pg-boss job sends 20 people per run, one Elastic Email `POST /v4/emails` call per person with a stable `Idempotency-Key`, through a new `BulkEmailSender` (drivers `elastic` and `smtp`).

**Tech Stack:** Fastify, Drizzle (PostgreSQL 17), pg-boss, Socket.IO, zod in `@spolu/shared`, nodemailer (dev/e2e), React + TanStack Router/Query, Vitest, Playwright.

**Spec:** [2026-10-16-phase-23-bulk-email-design.md](../specs/2026-10-16-phase-23-bulk-email-design.md). Read it together with this plan; §1–§11 refer to it. The owner answered P1–P5 on 2026-10-16; the spec records the answers.

## Global Constraints

- English in code, comments, docs and commits; UI texts only through i18n keys, sk and en, in the lazy namespace `bulkEmail` (`apps/web/src/locales/bulkEmail/{en,sk}.json`). Email footer texts (sk, en) live in `bulk-email/texts.ts` on the server.
- Test-first for the policy, `renderCampaign`, `validateForSend`, `resolveAudience` and the batch job (`test-driven-development`).
- Every `/api/bulk-email/*` route uses `requireAdmin`, except exactly five public routes: `GET /api/bulk-email/images/:id`, `GET /api/bulk-email/unsubscribe/:token`, `POST /api/bulk-email/unsubscribe/:token`, `POST /api/bulk-email/unsubscribe/:token/one-click`, `POST /api/bulk-email/subscribe/:token`. `GET`/`PUT /api/me/bulk-email` need a session and act on the signed-in person only.
- Owner answers (spec, "Owner answers on the proposed decisions"): P1 people who never signed in are included; P2 only `{{name}}`; P3 Spolu is the source of truth for unsubscribing, the Elastic sync is only a safety net; P4 re-subscribing through the profile checkbox and the public page; P5 transactional email is never affected.
- Modules talk through exported functions: bulk-email reads users, memberships and managers only through SQL helpers exported by the users and groups modules.
- One migration for the phase, in part 23.1: `pnpm --filter @spolu/server db:generate --name bulk_email`. If another branch merged a migration first, regenerate and renumber.
- Every web part starts by invoking `frontend-design:frontend-design`; every screen is a lazy route.
- Each part ends with `update-kb`, `bash scripts/ci.sh` green, one PR to `main` (never push to `main`, never merge).
- Values pinned by the spec: statuses `draft | sending | sent | cancelled`; recipient statuses `queued | sending | sent | failed | skipped | cancelled`; subscription sources `link | one_click | profile | provider` (no row = subscribed); image types `image/png | image/jpeg`, ≤ 2 MB, browser-shrunk to ≤ 1 200 px wide; ≤ 50 blocks; heading ≤ 200, text ≤ 5 000, alt ≤ 200, button label ≤ 60, name/subject/preheader ≤ 200; audience id lists ≤ 500; `BATCH_SIZE = 20`; 3 attempts; stuck `sending` rows fail after 20 h; test sends 10/min per admin; image uploads 30/min per admin; unsubscribe endpoints 30/min per IP; pages of 50; debounce: audience count 300 ms, preview 500 ms, autosave 1 s; env `MAIL_FROM_BULK` (default `MAIL_FROM`), `BULK_EMAIL_DRIVER=smtp|elastic` (default `smtp`), `BULK_EMAIL_PER_MINUTE` (default 120), `BULK_EMAIL_UNSUBSCRIBE=elastic|spolu` (default `elastic`), `ELASTIC_EMAIL_API_KEY`; unsubscribe token `<userId>.<campaignId>.<base64url HMAC-SHA256(APP_SECRET, "bulk-unsubscribe:<userId>:<campaignId>")>`, campaign id `test` for test sends.
- Elastic request (spec §5): `POST https://api.elasticemail.com/v4/emails`, header `X-ElasticEmail-ApiKey`, `Idempotency-Key: <campaignId>:<userId>`, body `Recipients: [{ Email }]`, `Content.Postback: <campaignId>:<userId>`, `Options: { TrackOpens: false, TrackClicks: false }`, unsubscribe href `{unsubscribe:<url>}` in `elastic` mode, the plain URL plus our `List-Unsubscribe`/`List-Unsubscribe-Post` in `Content.Headers` in `spolu` mode, 15 s timeout.

## Review Focus

1. A person who unsubscribes while a long campaign is sending → skipped before their turn, counted as skipped, never sent. Test in Task 5.2.
2. The server crashes after Elastic accepted an email but before the row became `sent` → the retry uses the same `Idempotency-Key` and the person gets one email. Test in Task 5.2 (fake sender counts calls per key).
3. A person who is in two selected groups, also added by hand, and also an admin → one recipient row. Test in Task 2.2.
4. Text with `<script>`, `"` in an alt, `javascript:` in a button URL → escaped or rejected (`400 validation_failed`), never in the HTML. Test in Task 3.1 and in the shared schema tests of Task 1.1.
5. Two admins edit the same draft → the second save gets `409 changed`, and nobody can edit a campaign after it started sending (`409 not_draft`). Test in Task 2.1.

---

## Parts and order

| part | branch | PR content | waits for | can run in parallel with |
|---|---|---|---|---|
| 23.1 | `phase-23-1-bulk-foundation` | Contracts, tables, policy, config, bulk sender | — | — |
| 23.2 | `phase-23-2-bulk-campaigns` | Campaigns and audience API | 23.1 merged | 23.3, 23.4 |
| 23.3 | `phase-23-3-bulk-render` | Renderer, images, preview, logo PNG | 23.1 merged | 23.2, 23.4 |
| 23.4 | `phase-23-4-bulk-unsubscribe` | Unsubscribe and re-subscribe: public API and page, profile checkbox, Elastic resubscribe call, suppression sync | 23.1 merged | 23.2, 23.3, 23.5, 23.6 |
| 23.5 | `phase-23-5-bulk-sending` | Test send, batch job, cancel, report API | 23.2 and 23.3 merged | 23.4, 23.6 |
| 23.6 | `phase-23-6-bulk-web-editor` | Web: list, builder, audience, preview, test send | 23.2 and 23.3 merged | 23.4, 23.5 |
| 23.7 | `phase-23-7-bulk-web-send` | Web: send flow, report; e2e; docs; roadmap | 23.4, 23.5, 23.6 merged | — |

Each branch is cut from the latest `main`. 23.6 shows **Send a test to me** only when the API answers anything but `404` (the route arrives with 23.5), so 23.5 and 23.6 merge in either order.

---

## Part 23.1 — Foundation (spec §1, §5)

**As built (2026-10-16, branch `phase-23-1-bulk-foundation`).** Differences and details later parts must use:
- Migration `0020_bulk_email` (the next free number on `main`). Tables are picked up by the drizzle glob `src/**/schema.ts`; `infra/db/schema.ts` needs no export. `bulk_campaigns.audience` has no default (the service writes the empty audience); `created_at`/`updated_at` default `now()`; `bulk_recipients.language` has a CHECK `sk`/`en`. `schema.test.ts` covers defaults, the status checks and `campaign_id` set null on a subscription.
- `BulkAudienceCount.leftOut` is `{ unsubscribed, disabled }` only: people who never signed in are included (P1), so there is no `neverSignedIn` count.
- Shared (`packages/shared/src/bulk-email.ts`): also `BULK_LIMITS` (every pinned limit, `pageSize: 50`, `imageBytes`, `imageWidth`), `BulkCampaignStatuses`, `BulkRecipientStatuses`, `BulkSubscriptionSources`, `BulkImageMimes`, `BulkAudienceRoleSchema`, `BulkCampaignCounts`, `BulkEventPayload = { campaignId }`. `BulkCampaignDto` and the other DTOs are TypeScript types, not zod schemas. Draft `name` is trimmed and required (1–200); `subject` and `preheader` may be empty in a draft (`validateForSend` checks the subject). A button URL is http(s) or `mailto:<something>`; an image `href` http(s) only; `alt` is trimmed and required. The error codes are in `ErrorCodes` (`changed`, `notDraft`, `notSending`, `notReady`, `emptyAudience`, `unsupportedType`).
- `token.ts` also exports `TEST_CAMPAIGN_ID = 'test'`. `verifyUnsubscribeToken` rejects any token that is not exactly three non-empty dot-separated parts or whose signature is not canonical base64url; `unsubscribeUrls` strips a trailing `/` of `PUBLIC_URL`.
- Config: `ELASTIC_EMAIL_API_KEY` moved to the base schema (optional) and stays required in the `EMAIL_DRIVER=elastic` branch; the bulk checks run after parsing (`bulkEmailConfig`), so a bulk `ConfigError` names only `BULK_EMAIL_DRIVER` or `ELASTIC_EMAIL_API_KEY`. An env with `EMAIL_DRIVER=elastic` must now set `BULK_EMAIL_DRIVER=elastic`. `testConfig()` uses `bulkEmail: { driver: 'smtp', from: 'eGrant <news@example.com>' }`, `bulkEmailPerMinute: 120`.
- Sender: `bulk.ts` also exports `BulkSendResult`, `FakeBulkSender`, `isRetryableStatus(status)` (`409`, `429`, `5xx`). `createElasticBulkSender(opts, fetchImpl, timeoutMs = 15 000)` and `createSmtpBulkSender(opts, transport?)` can be built directly. Error messages carry at most 300 characters of provider text with the key masked; a `422` is final. The smtp bulk driver never sets `IsTransactional` and always adds Spolu's `List-Unsubscribe`/`List-Unsubscribe-Post`. The fake replays a repeated idempotency key like Elastic: `sent` holds one message per key, `callsByKey` counts every call (failures included), `failNext` queues failures in order.
- `buildTestApp({ bulkEmail })` overrides the bulk sender (default: the smtp driver to Mailpit), so the batch job tests of 23.5 pass `createFakeBulkSender()`.
- Step 5 (live check with the owner's key) was not run: no key in this environment. It stays open for the owner before 23.5 goes live.

### Task 1.1: Shared contracts

**Files:**
- Create: `packages/shared/src/bulk-email.ts`, `bulk-email.test.ts`; export from `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `BulkBlockSchema` (discriminated union on `type`: `heading | text | image | button | divider | logo`, fields and limits of spec §3), `BulkAlign = 'left' | 'center'`, `BulkAudienceSchema` (spec §2, lists default `[]`, ≤ 500 each), `BulkCampaignStatus`, `BulkRecipientStatus`, `BulkCampaignDraftSchema` (`{ name, subject, preheader, blocks (≤ 50), audience, version }`), `BulkCampaignDto` (all campaign columns camelCase + `counts: Record<BulkRecipientStatus, number> & { unsubscribed: number }` + `createdByName`, `sentByName`), `BulkCampaignListItem`, `BulkAudienceCount = { count: number; leftOut: { unsubscribed: number; disabled: number; neverSignedIn: number } }`, `BulkRecipientItem`, `BulkNotReadyProblem = { blockId?: string; problem: 'subject_missing' | 'no_blocks' | 'image_missing' | 'invalid_url' }`, `BulkEvents = { updated: 'bulk:updated' }`, error codes `changed`, `not_draft`, `not_sending`, `not_ready`, `empty_audience`, `unsupported_type`.

- [x] **Step 1: Failing tests** in `bulk-email.test.ts`: `a button with javascript: URL is rejected`, `a button accepts mailto:`, `an image without alt is rejected`, `a text of 5 001 characters is rejected`, `51 blocks are rejected`, `audience lists default to []`, `an audience list of 501 ids is rejected`, `an unknown block type is rejected`.
- [x] **Step 2: Run** `pnpm --filter @spolu/shared test` — FAIL.
- [x] **Step 3: Implement** with zod; URLs through a helper `httpUrl` (http/https only, ≤ 2 048, the shared `MAX_URL_LENGTH`).
- [x] **Step 4: Run** — PASS. Commit `feat(shared): bulk email contracts`.

### Task 1.2: Schema, policy and config

**Files:**
- Create: `apps/server/src/modules/bulk-email/schema.ts`, `policy.ts`, `policy.test.ts`, `token.ts`, `token.test.ts`
- Modify: `apps/server/src/infra/db/schema.ts` (export), `infra/config/config.ts` + `config.test.ts`, `.env.example`, `deploy/test.env.example`
- Migration: `db:generate --name bulk_email`

**Interfaces:**
- Produces: tables `bulkCampaigns`, `bulkRecipients`, `bulkSubscriptions`, `bulkImages` exactly as spec §1 (checks, indexes `bulk_campaigns_status_updated_idx`, `bulk_recipients_campaign_status_idx`, `bulk_recipients_user_idx`).
- Produces (`token.ts`): `signUnsubscribeToken(secret: string, userId: string, campaignId: string): string`; `verifyUnsubscribeToken(secret: string, token: string): { userId: string; campaignId: string } | null` (constant-time compare); `unsubscribeUrls(publicUrl, token): { page: string; oneClick: string }` (`/unsubscribe/<token>`, `/api/bulk-email/unsubscribe/<token>/one-click`).
- Produces: `canUseBulkEmail(actor: SessionUser): boolean`.
- Produces (`Config`): `bulkEmail: { driver: 'smtp'; from: string } | { driver: 'elastic'; apiKey: string; from: string; unsubscribe: 'elastic' | 'spolu' }`, `bulkEmailPerMinute: number`.

- [x] **Step 1: Failing tests:** policy `admin and superadmin may, client may not`; config `MAIL_FROM_BULK defaults to MAIL_FROM`, `BULK_EMAIL_DRIVER=elastic without ELASTIC_EMAIL_API_KEY → ConfigError(['ELASTIC_EMAIL_API_KEY'])`, `BULK_EMAIL_DRIVER=elastic works with EMAIL_DRIVER=smtp`, `BULK_EMAIL_DRIVER=smtp with EMAIL_DRIVER=elastic → ConfigError(['BULK_EMAIL_DRIVER'])`, `BULK_EMAIL_PER_MINUTE defaults to 120`, `BULK_EMAIL_UNSUBSCRIBE defaults to elastic`; token `round-trips`, `a changed user id, campaign id or signature → null`, `a token signed with another secret → null`, `malformed (two parts, empty) → null`.
- [x] **Step 2: Run** `pnpm --filter @spolu/server exec vitest run src/modules/bulk-email src/infra/config` — FAIL.
- [x] **Step 3: Implement**; `ELASTIC_EMAIL_API_KEY` moves to `base` as optional and is required by a `superRefine` when either driver is `elastic`. Generate the migration. Document the five variables in both env examples (comments in the style of the file).
- [x] **Step 4: Run** — PASS. Commit `feat(bulk-email): schema, policy and config`.

### Task 1.3: Bulk sender

**Files:**
- Create: `apps/server/src/infra/email/bulk.ts`, `bulk-elastic.ts`, `bulk-smtp.ts`, `bulk-fake.ts`, `bulk.test.ts`
- Modify: `apps/server/src/infra/email/smtp-sender.ts` (+ test: header `IsTransactional: True` on every transactional email, spec §5), `apps/server/src/infra/email/index.ts` (export `createBulkSender`), `apps/server/src/deps.ts` (`AppDeps.bulkEmail: BulkEmailSender`), the test deps helper used by route tests

**Interfaces:**
- Produces: `BulkMessage`, `BulkEmailSender`, `BulkSendError { retryable: boolean; status: number | null }` exactly as spec §5; `createBulkSender(config: Config['bulkEmail'], smtp: Config['email'], fetchImpl?): BulkEmailSender`; `createFakeBulkSender(): BulkEmailSender & { sent: BulkMessage[]; failNext(status: number | 'network'): void; callsByKey: Map<string, number> }`.

- [x] **Step 1: Failing tests** (fake `fetch`): `elastic posts to /v4/emails with Recipients [{Email}], From = MAIL_FROM_BULK, Postback, TrackOpens false, TrackClicks false`; `sends Idempotency-Key and X-ElasticEmail-ApiKey`; `returns TransactionID and MessageID`; `5xx, 429, 409 and a network error are retryable`; `400 is not retryable and the message carries the response text but never the API key`; `elastic mode: unsubscribeHref wraps as {unsubscribe:url} and no List-Unsubscribe in Content.Headers`; `spolu mode: unsubscribeHref returns the url and Content.Headers has List-Unsubscribe <oneClickUrl> and List-Unsubscribe-Post`; `the transactional smtp sender adds IsTransactional: True`; smtp (nodemailer stream transport): `adds List-Unsubscribe <oneClickUrl> and List-Unsubscribe-Post: List-Unsubscribe=One-Click`, `unsubscribeHref returns the url`.
- [x] **Step 2: Run** `pnpm --filter @spolu/server exec vitest run src/infra/email/bulk.test.ts` — FAIL.
- [x] **Step 3: Implement.** The smtp driver reuses the SMTP options of `Config['email']` (driver `smtp`).
- [x] **Step 4: Run** — PASS.
- [ ] **Step 5: Live check (owner's key, optional, not in CI).** With a real key, send one email to an address you own and record in the PR: whether Elastic replaced our footer link wrapper correctly, where `{unsubscribe:…}` redirects, the headers of the received mail, whether a `spolu`-mode send keeps our `List-Unsubscribe` header, and whether `DELETE /v4/suppressions/{email}` re-enables the address after an unsubscribe. If anything differs from spec §5, stop and report before 23.5.
- [x] **Step 6: Docs and PR.** `update-kb`: `architecture/overview.md` (Email: the bulk sender), `architecture/data-model.md` (four tables), `product/integrations.md` (Elastic: bulk email), ADR `0016-bulk-email-through-elastic-v4-emails.md` (one call per person to `/v4/emails`, idempotency key, no SMTP for bulk on servers, why not the transactional endpoint, the two unsubscribe modes). `bash scripts/ci.sh`; push; PR.

---

## Part 23.2 — Campaigns and audience API (spec §2, §4)

**As built (2026-10-16, branch `phase-23-2-bulk-campaigns`).** No migration. Differences and details later parts must use:
- Errors live in `bulk-email/errors.ts`: `CampaignNotFoundError` (404), `NotDraftError` (409 `not_draft`, wins over a stale version), `CampaignChangedError` (409 `changed`), `InvalidCursorError` (400 `validation_failed`); `routes.ts` maps them in `bulkError`. The routes run `requireAdmin`, then `canUseBulkEmail`; they are registered as `bulkEmailRoutes` in `app.ts`. 23.3/23.5 add their routes to this plugin or beside it.
- `getCampaign(db, id)` and `listCampaigns(db, cursor?)` share one query (`campaignsQuery`): counts per status plus `unsubscribed` (rows of `bulk_subscriptions` with `subscribed = false` and this `campaign_id`), `createdByName`, `sentByName`; dates are ISO strings with milliseconds. The list items have no `blocks`/`audience`. `listCampaigns` returns `BulkCampaignPage`. `deleteDraft` and `duplicateCampaign` throw `CampaignNotFoundError` for an unknown id. The duplicate's name is cut so name + suffix ≤ 200; the suffix follows `user.language` of the actor.
- `bulk:updated` (`emitBulkUpdated(io, campaignId)`, `events.ts`) is sent after create, save, delete and duplicate.
- Shared additions: `BulkCampaignCreateSchema`, `BulkCampaignPage`, `BulkPerson = { id, name, email, role: 'client' | 'ziadatel' | 'admin', groups: string[] }` (spec §2's people item; `listAudience` returns `BulkAudiencePage = { items: BulkPerson[]; nextCursor }`, not `BulkRecipientItem`), `BULK_PEOPLE_SEARCH`, `BulkPeopleLookupSchema`.
- Audience (`audience.ts`): `audienceSql(audience)` (matched ids, subquery), `recipientsSql(audience)` — `select user_id, email, name, language` of matched, not disabled, not unsubscribed people, each once — for 23.5's one `insert into bulk_recipients (campaign_id, user_id, email, name, language) select ${campaignId}, r.* from (${recipientsSql(a)}) r`; `resolveAudience(db, audience): AudienceRecipient[]` (`{ userId, email, name, language }`, ordered by id) runs the same select. A disabled person who also unsubscribed counts as `disabled`. No roles and no hand-picked people = nobody. Disabled admins match the `admin` role and are counted as left out (disabled).
- Group helpers added for the boundary rule: `activeMemberIdsSql(roles, groupScope)`, `hasActiveRoleSql(userId, role)`, `activeGroupNamesSql(userId)` (`groups/memberships.ts`), `managedGroupsOfSql(userIds)` (`groups/managers.ts`). The audience joins `user` read-only directly instead of a new `searchActiveUsers` in the users service: `searchPeople` and `lookupPeople` live in `audience.ts`, because they return `BulkPerson` (role and group names).
- Extra route `POST /api/bulk-email/people/lookup` (`{ ids }` ≤ 1 000 → `BulkPerson[]`, disabled included, unknown left out), so 23.6 can show the hand-picked people of a saved draft by name.
- The campaign list sorts `bulk_campaigns` by `updated_at desc, id desc` without a dedicated index (the table holds hundreds of rows; the spec's `(status, updated_at)` index serves a status filter later).


### Task 2.1: Campaign CRUD

**Files:**
- Create: `bulk-email/service.ts`, `service.test.ts`, `routes.ts`, `routes.test.ts`
- Modify: `apps/server/src/app.ts` (register under `/api`)

**Interfaces:**
- Produces: `createCampaign(db, actor, name): Promise<BulkCampaignDto>`; `getCampaign(db, id): Promise<BulkCampaignDto | null>`; `listCampaigns(db, cursor?): Promise<{ items: BulkCampaignListItem[]; nextCursor: string | null }>` (keyset on `(updated_at, id)`); `saveDraft(db, actor, id, draft): Promise<BulkCampaignDto>` (throws `CampaignChangedError` → `409 changed`, `NotDraftError` → `409 not_draft`; bumps `version`); `deleteDraft(db, id)`; `duplicateCampaign(db, actor, id): Promise<BulkCampaignDto>` (name gets the suffix ` (copy)` / ` (kópia)` from the actor's language).
- Routes: spec §4 table rows for list, create, get, put, delete, duplicate; the put route has `bodyLimit: 200_000`.
- Produces: `emitBulkUpdated(io, campaignId)` → `ADMINS_ROOM`, event `bulk:updated`.

- [x] **Step 1: Failing tests:** `client gets 403 on every route, anonymous 401`; `save with an old version → 409 changed` (Review Focus 5); `save of a sending campaign → 409 not_draft`; `delete of a sent campaign → 409 not_draft`; `duplicate of a sent campaign is a draft with the same blocks and audience, version 1`; `list is newest first, 50 per page with a cursor`; `bulk:updated reaches an admin socket and not a client socket`.
- [x] **Step 2–4:** run (FAIL), implement, run (PASS). Commit `feat(bulk-email): campaigns API`.

### Task 2.2: Audience

**Files:**
- Create: `bulk-email/audience.ts`, `audience.test.ts`
- Modify: `groups/memberships.ts` or `groups/managers.ts` only to export SQL helpers if missing (`managedGroupsSql` exists); `users/service.ts`: `searchActiveUsers(db, q, limit)` if no such helper exists
- Modify: `bulk-email/routes.ts`

**Interfaces:**
- Produces: `audienceSql(audience: BulkAudience): SQL` (the eligible user ids before "left out"); `countAudience(db, audience): Promise<BulkAudienceCount>`; `listAudience(db, audience, cursor?): Promise<{ items: BulkRecipientItem[]; nextCursor: string | null }>`; `resolveAudience(tx, audience): Promise<{ userId: string; email: string; name: string; language: 'sk' | 'en' }[]>` (eligible minus left out; used by 23.5).
- Routes: `POST /api/bulk-email/audience/count`, `POST /api/bulk-email/audience/people?cursor=`, `GET /api/bulk-email/people?q=` (≥ 2 characters, 20 results, active users).

- [x] **Step 1: Failing tests:** `group filter takes active clients of the group, not removed memberships`; `roles ziadatel takes only ziadatel memberships`; `empty groups and managers = every group`; `managerIds adds the groups that admin manages`; `admin role adds every active admin, ignoring the group scope`; `includeUserIds adds a person outside the filters`; `excludeUserIds removes a person`; `a person in two groups, included by hand and admin is counted once` (Review Focus 3); `disabled and unsubscribed people are left out and counted per reason`; `a person who never signed in is included` (P1); `a person who re-subscribed (row with subscribed true) is included`; `count runs one SQL statement` (use the db `onQuery` hook).
- [x] **Step 2–4:** run, implement, run. Commit `feat(bulk-email): audience`.
- [x] **Step 5: Docs and PR.** `update-kb`: new `product/bulk-email.md` (what admins can do, audience rules), `product/README.md` row, `architecture/permissions.md` row (spec §7). `bash scripts/ci.sh`; PR.

---

## Part 23.3 — Renderer, images, preview (spec §3)

**As built (2026-10-16, branch `phase-23-3-bulk-render`).** No migration (the `bulk_images` table came with 23.1). Differences and details later parts must use:
- The routes live in `bulk-email/render-routes.ts` (`bulkEmailRenderRoutes`, registered in `app.ts` after the tickets routes), not in `routes.ts`, so this part and 23.2 do not both create `routes.ts`; 23.5 may move them or leave them.
- `renderCampaign(input)` has the spec's signature plus an optional `imageSizes?: ReadonlyMap<imageId, { width, height }>` (from `imageSizes(db, ids)`): an image is shown at its stored width capped at the 520 px column, with the matching `height`; without it at 520 px. 23.5 should pass it for test and real sends (one query per batch). The renderer is deterministic, so a retried send has the same body (Elastic's `422` cannot happen).
- `render.ts` also exports `RenderInput`; `texts.ts` exports `BULK_FOOTER` (sk: "Tento e-mail dostávate, pretože máte účet v Spolu by eGrant." / "Odhlásiť sa z odberu"; en: "You get this email because you have an account in Spolu by eGrant." / "Unsubscribe"). The text part ends with `---` and the footer (`<reason>\n<unsubscribe>: <href>`); dividers are `---`, the logo is left out. A button whose URL is not http(s)/`mailto:` or an image `href` that is not http(s) renders without a link (defence in depth behind the shared schema).
- `images.ts`: `saveImage(deps: { db, storage, config }, actor: { id }, body: Readable)`, `getImage(db, id)` (null for a non-UUID id), `imageSizes(db, ids)`, `imageExists(db, ids): Promise<Set<string>>`, `imageSize(buf)` (PNG IHDR / JPEG SOF, 1–20 000 px), errors `ImageTooLargeError` (→ `413 file_too_large`) and `UnsupportedImageError` (→ `415 unsupported_type`).
- The public image GET also sends `cross-origin-resource-policy: cross-origin` (webmail shows it on its own origin) and `content-length`; it never reads the session.
- Preview: the admin's name and language come from `getUserById`; the unsubscribe link is `#`; the body is checked with `BulkCampaignDraftSchema.pick({ subject, preheader, blocks })` (`400 validation_failed`), an unknown campaign answers `404`. The campaign row is read directly from `bulk_campaigns` (same module) until 23.2's `getCampaign` exists.
- Test helpers for image bytes: `apps/server/test/bulk-images.ts` (`pngBytes`, `jpegBytes`, `GIF`).
- `product/bulk-email.md` is written by 23.2; the block and image rules of this part are in `architecture/overview.md` (Bulk email renderer), `architecture/permissions.md` and `design/README.md` (Bulk email look). 23.7 adds the block rules to the product doc when it sweeps the docs.

### Task 3.1: `renderCampaign`

**Files:**
- Create: `bulk-email/render.ts`, `render.test.ts`, `texts.ts`

**Interfaces:**
- Produces: `renderCampaign(input)` with the exact signature of spec §3; `BULK_FOOTER: Record<'sk' | 'en', { reason: string; unsubscribe: string }>`.
- Produces: `imageUrl(publicUrl, imageId) = ${publicUrl}/api/bulk-email/images/${imageId}`, `LOGO_PATH = '/brand/egrant-logo-email.png'`.

- [x] **Step 1: Failing tests:** `escapes <script> and quotes in every text field` (Review Focus 4); `{{name}} is replaced in heading and text, escaped`; `a lone {{ stays`; `text: blank line → paragraphs, **bold** → <strong>, URLs → links`; `image renders width, alt, display:block and its link`; `button is a table cell with background and a link`; `logo uses LOGO_PATH on publicUrl`; `footer is Slovak for sk, English for en, with unsubscribeHref`; `preheader is hidden text at the top`; `text part: heading in capitals, button as "label: url", image as [alt], unsubscribe line last`; `html has role=presentation tables 600 wide and the 620px media rule`.
- [x] **Step 2–4:** run, implement, run. Commit `feat(bulk-email): email renderer`.

### Task 3.2: Images and preview

**Files:**
- Create: `bulk-email/images.ts`, `images.test.ts`
- Modify: `bulk-email/routes.ts`, `routes.test.ts`; `apps/web/scripts/generate-icons.mjs` (also writes `public/brand/egrant-logo-email.png`, 360 px wide, from `egrant-logo.svg`); commit the PNG

**Interfaces:**
- Produces: `saveImage(deps, actor, body: Readable): Promise<{ id: string; url: string; width: number; height: number }>` (reads ≤ 2 MB, sniffs with `files/sniff.ts` limited to PNG and JPEG, reads width and height from the PNG IHDR or the JPEG SOF marker); `imageExists(db, ids: string[]): Promise<Set<string>>`.
- Routes: `POST /api/bulk-email/images` (admins, raw body, 30/min), `GET /api/bulk-email/images/:id` (public, headers of spec §3), `POST /api/bulk-email/campaigns/:id/preview` (`{ subject, preheader, blocks }` → `{ html }`).

- [x] **Step 1: Failing tests:** `PNG and JPEG upload answer 201 with width and height`; `a GIF named .png → 415 unsupported_type`; `3 MB → 413`; `client upload → 403`; `public GET has nosniff, inline, CSP default-src 'none', public immutable cache`; `unknown id → 404`; `GET with a path-like id (../x) → 404`; `preview renders with the admin's name and is 403 for a client`.
- [x] **Step 2–4:** run, implement, run. Run `pnpm --filter @spolu/web icons`. Commit `feat(bulk-email): images and preview`.
- [x] **Step 5: Docs and PR.** `update-kb`: `product/bulk-email.md` (blocks, images are public by URL), `architecture/overview.md` (public image route), `design/README.md` (the email logo PNG). PR.

---

## Part 23.4 — Unsubscribe and re-subscribe (spec §5, P3, P4)

**As built (2026-10-16, branch `phase-23-4-bulk-unsubscribe`).** No migration. Differences and details later parts must use:
- Files: the routes are `bulk-email/unsubscribe-routes.ts` (`bulkEmailUnsubscribeRoutes`: the four public token routes and `GET`/`PUT /api/me/bulk-email`), not `public-routes.ts` or the users routes. The Elastic suppression HTTP client is `infra/email/elastic-suppressions.ts` (`createElasticSuppressions(apiKey, fetch)` with `list(kind, offset, limit)` and `remove(email)`), used by `bulk-email/jobs.ts`. Users gained `getUsersByEmails(db, emails)`.
- `subscriptions.ts`: `setSubscribed` returns `'changed'` only when the setting flipped (a repeated unsubscribe keeps the first row and its campaign; subscribing someone with no row writes nothing); a campaign id that is no campaign (deleted, or random) is stored as null so the FK never fails; an unknown user is `'unchanged'`. Subscribing again (page or profile) stores `campaign_id` null, so 23.2's per-campaign `unsubscribed` count stays "currently unsubscribed through this link". `unsubscribedSql(userIdColumn)` exists for 23.5's batch job (skip check before each person); 23.2's audience keeps its own left join. `applyProviderSuppressions(db, [{ email, date }])` is the sync's one upsert.
- `jobs.ts` exports `BULK_PROVIDER_RESUBSCRIBE_JOB`, `BULK_SYNC_SUPPRESSIONS_JOB`, `bulkEmailJobHandlers({ db, config }, fetch?)`, `bulkEmailSchedules(config)` (04:30 Europe/Bratislava, only with the elastic driver), `syncSuppressions(deps, fetch?)` → `{ checked, changed }` and `queueProviderResubscribe({ config, jobs }, email)`. 23.5 adds its batch job and sweep to this file and to `bulkEmailJobHandlers`. `createDeps` and `buildTestApp` register the handlers; `buildTestApp({ bulkFetch })` gives the jobs a fake `fetch` (the default throws, so no test can reach Elastic).
- The resubscribe call is queued only on an actual flip to subscribed; the job logs and rethrows a failure (pg-boss retries twice, then keeps the failed job). The routes catch a queueing failure and still answer `204`.
- Public route details: one rate limiter for all four routes (30/min per IP); a token whose person was deleted is `404` like a forged one; the one-click route's plugin accepts any content type (≤ 4 kB, ignored). Fastify's `maxParamLength` is raised to 256 (a token is ~115 characters; the default 100 answered `414`). The SPA fallback serves `index.html` for `/unsubscribe/<token>` although the token has dots (the not-found handler treated dotted paths as files).
- Web: the page is `features/bulk-email/unsubscribe-page.tsx` with `unsubscribe-api.ts`, and its texts are a small lazy namespace `unsubscribe` (`locales/unsubscribe/{en,sk}.json`), not `bulkEmail`, so the public page never loads the editor's texts and 23.6 owns `bulkEmail` alone. The page GETs the link first (language, test), switches the UI language with `setLanguage`, then POSTs the unsubscribe once; after "Subscribe again" it offers "Unsubscribe" again. The setting is `features/profile/bulk-email-setting.tsx` (queries in `features/profile/api.ts`), the third row of the Profile card; its texts are `settings.profile.bulkEmail.{label,hint}` (the plan's `profile.bulkEmail.*` lives in the `settings` namespace).
- Initial JS unchanged: 198.8 kB gzip, the same as `main`.
- Not done here: the P5 owner check with a real Elastic account and the live check whether `DELETE /v4/suppressions/{email}` re-enables an unsubscribed address (both need the owner's key).

### Task 4.1: Server

**Files:**
- Create: `bulk-email/subscriptions.ts`, `subscriptions.test.ts`, `bulk-email/public-routes.ts`, `public-routes.test.ts`, `bulk-email/jobs.ts`, `jobs.test.ts`
- Modify: `apps/server/src/app.ts` (register the public routes; CSRF guard skips `/api/bulk-email/unsubscribe/` and `/api/bulk-email/subscribe/`), `apps/server/src/deps.ts` (job handlers and schedule), `apps/server/src/modules/users/routes.ts` or the profile routes (`GET`/`PUT /api/me/bulk-email`)

**Interfaces:**
- Consumes: `verifyUnsubscribeToken` (1.2).
- Produces: `setSubscribed(db, userId, subscribed: boolean, source: 'link' | 'one_click' | 'profile' | 'provider', campaignId: string | null): Promise<'changed' | 'unchanged'>` (upsert, sets `email` and `changed_at`); `isSubscribed(db, userId): Promise<boolean>`; `unsubscribedSql(userIdColumn): SQL` (`exists … subscribed = false`; used by 23.2's audience if 23.4 merges first, 23.2 may inline it until then).
- Public routes (30/min per IP): `GET /api/bulk-email/unsubscribe/:token` → `{ language, subscribed, test }` / `404`; `POST /api/bulk-email/unsubscribe/:token` → `204`; `POST /api/bulk-email/unsubscribe/:token/one-click` → `204`, any body; `POST /api/bulk-email/subscribe/:token` → `204`. A `test` campaign id answers `test: true` and changes nothing.
- Session routes: `GET /api/me/bulk-email` → `{ subscribed: boolean }`; `PUT /api/me/bulk-email { subscribed: boolean }` → `204`, `source = profile`.
- Jobs: `bulk-email.provider-resubscribe` (`{ email }`; only with the `elastic` driver in `elastic` unsubscribe mode; `DELETE /v4/suppressions/{email}`, `retryLimit: 2`, a final failure only logs); `bulk-email.sync-suppressions` (cron `30 4 * * *`, Europe/Bratislava, only with the `elastic` driver): `syncSuppressions(deps, fetchImpl?)`.

- [x] **Step 1: Failing tests:** `link unsubscribe stores subscribed false, source link and the campaign id`; `second call is idempotent (204, one row)`; `one-click with body List-Unsubscribe=One-Click stores one_click`; `subscribe again sets subscribed true`; `a cross-site POST (Sec-Fetch-Site: cross-site) to one-click is not blocked by the CSRF guard`; `a token with a changed user id → 404 and nothing stored`; `a test token answers test true and changes nothing`; `31st call a minute from one IP → 429`; `GET /api/me/bulk-email is true with no row`; `PUT false then true flips it with source profile`; `PUT without a session → 401`; `re-subscribing in elastic mode queues provider-resubscribe; in spolu mode it does not`; `a login code still reaches an unsubscribed person` (auth route with the fake email sender, P5); sync: `pages through /v4/suppressions/unsubscribes and /complaints with limit 1000`, `sets provider unsubscribes for matching Spolu users`, `never overrides a row changed in Spolu after Elastic's DateUpdated`.
- [x] **Step 2–4:** run, implement, run. Commit `feat(bulk-email): unsubscribe, re-subscribe and suppression sync`.

### Task 4.2: Public page and profile checkbox

**Files:**
- Create: `apps/web/src/features/bulk-email/unsubscribe-page.tsx`, `unsubscribe-page.test.tsx`, `apps/web/src/locales/bulkEmail/{en,sk}.json`
- Create: `apps/web/src/features/profile/bulk-email-setting.tsx`, `bulk-email-setting.test.tsx`
- Modify: `apps/web/src/router.tsx` (public lazy route `/unsubscribe/$token`, outside the signed-in layout, with the `bulkEmail` namespace); the Settings page in `features/profile` (render the setting); the profile locale keys `profile.bulkEmail.label` = "Dostávať hromadné e-maily" / "Receive mailings" and a one-line hint that login codes and notifications are not affected

- [x] **Step 1: Invoke `frontend-design:frontend-design`.** Failing tests: page `posts unsubscribe once on load and shows the done text with Subscribe again`; `Subscribe again posts subscribe and shows the subscribed text`; `a test token shows the test text and posts nothing`; `an invalid token shows the invalid text`; `switches to the language the API returns`; setting `is checked by default`, `unchecking PUTs false, checking PUTs true`, `shown for a client, an admin and a ziadatel-only person`.
- [x] **Step 2–4:** run (`pnpm --filter @spolu/web exec vitest run src/features/bulk-email src/features/profile`), implement, run.
- [x] **Step 5: Docs and PR.** `update-kb`: `product/bulk-email.md` (unsubscribe, re-subscribe, the two modes, P3–P5), `product/profile.md` (the checkbox), `architecture/permissions.md` (public routes). PR.

---

## Part 23.5 — Sending (spec §4, §6)

### Task 5.1: Send, test send, cancel

**Files:**
- Create: `bulk-email/send.ts`, `send.test.ts`
- Modify: `bulk-email/routes.ts`, `routes.test.ts`, `bulk-email/jobs.ts`, `apps/server/src/deps.ts` (queues and schedules)

**Interfaces:**
- Consumes: `resolveAudience` (2.2), `renderCampaign`, `imageExists` (3.x), `BulkEmailSender` (1.3).
- Produces: `validateForSend(campaign, existingImageIds: Set<string>): BulkNotReadyProblem[]`; `startSending(deps, actor, id): Promise<BulkCampaignDto>` (spec §4 "Send" steps 1–3; `NotReadyError`, `EmptyAudienceError`, `NotDraftError`); `cancelSending(deps, id)` (`NotSendingError`); `queueTestSend(deps, actor, id)`.
- Jobs: `BULK_BATCH_JOB = 'bulk-email.batch'` (`{ campaignId }`), `BULK_TEST_JOB = 'bulk-email.test'` (`{ campaignId, userId }`), `BULK_SWEEP_JOB = 'bulk-email.sweep'` (cron `15 4 * * *`); queue settings `{ [BULK_BATCH_JOB]: { localConcurrency: 1, notify: false, pollingIntervalSeconds: 2 } }`.
- Routes: `POST …/:id/send`, `POST …/:id/cancel`, `POST …/:id/test` (10/min per admin).

- [ ] **Step 1: Failing tests:** `validateForSend` (each problem with its block id); `send freezes recipients and sets sending, sender, recipient_count`; `each sent email links /unsubscribe/<signed token for that person and campaign>`; `send with no recipients → 400 empty_audience, still a draft`; `two concurrent sends → one 409 not_draft`; `test send reaches only the actor, subject starts with [Test] , its unsubscribe token carries the campaign id test`; `11th test a minute → 429`; `cancel marks queued rows cancelled and the campaign cancelled`.
- [ ] **Step 2–4:** run, implement, run. Commit `feat(bulk-email): start, test and cancel sending`.

### Task 5.2: The batch job

**Files:** `bulk-email/batch.ts`, `batch.test.ts`, `bulk-email/jobs.ts`

**Interfaces:**
- Produces: `runBatch(deps: { db; bulkEmail; jobs; io?; config }, campaignId): Promise<'more' | 'done' | 'stopped'>` — spec §4 steps 1–5; `nextDelaySeconds(perMinute: number) = Math.ceil(BATCH_SIZE / perMinute * 60)`; `sweepStuck(deps, now)` (rows `sending` with `updated_at` older than 20 h → `failed`, `error = 'unknown'`; re-queue campaigns `sending` with queued rows).

- [ ] **Step 1: Failing tests** (fake sender, test DB): `sends 20, queues the next run with the delay, then finishes with status sent`; `a person unsubscribed after send start is skipped with error unsubscribed` (Review Focus 1); `a disabled person is skipped with error disabled`; `retryable failure goes back to queued, third failure is failed`; `400 is failed at once with the provider message`; `a row left in sending is sent again with the same Idempotency-Key and counted once by the fake` (Review Focus 2); `a cancelled campaign stops`; `Postback is campaignId:userId and provider ids are stored`; `sweep fails rows stuck 21 h and leaves 19 h rows`; `bulk:updated after each run`.
- [ ] **Step 2–4:** run, implement, run. Commit `feat(bulk-email): batch sending job`.

### Task 5.3: Report API

**Files:** `bulk-email/service.ts`, `routes.ts`, tests

**Interfaces:**
- Produces: `campaignCounts(db, ids: string[]): Promise<Map<string, BulkCampaignDto['counts']>>` (one grouped query; also used by the list, so no N+1); `listRecipients(db, id, { status?, cursor? })`.
- Route: `GET …/:id/recipients?status=&cursor=`.

- [ ] **Step 1: Failing tests:** `counts per status and unsubscribed through this campaign`; `list of 3 campaigns runs one counts query`; `recipients filter by status, 50 per page`.
- [ ] **Step 2–4:** run, implement, run. Commit `feat(bulk-email): report API`.
- [ ] **Step 5: Docs and PR.** `update-kb`: `product/bulk-email.md` (states, sending speed, report), `architecture/realtime.md` (`bulk:updated`), `architecture/performance.md` (batch job). PR.

---

## Part 23.6 — Web: list and builder (spec §3, §8)

**As built (2026-10-16, branch `phase-23-6-bulk-web`).** Web only, no server change. Differences and details 23.7 must use:
- Files in `apps/web/src/features/bulk-email/`: `api.ts` (queries, mutations and the zod schemas of the answers, since the bulk DTOs are TypeScript types in `@spolu/shared`; `BULK_KEY`, `campaignListKey`, `campaignQuery(id)`, `campaignsQuery`, `audienceCountQuery`, `audiencePeopleQuery`, `peopleSearchQuery`, `peopleLookupQuery`, `uploadImage`, `sendTest`, `previewCampaign`, `duplicateCampaign`, `deleteCampaign`), `blocks.ts` (`BulkBlockTypes`, `newBlock`, `blocksReducer`), `validation.ts` (`draftProblems`, `hasProblems`, `validBlocks`: the client mirror of `BulkCampaignDraftSchema`), `use-autosave.ts`, `use-bulk-events.ts`, `campaign-list-page.tsx`, `editor-page.tsx` (`CampaignPage`, `DraftEditor`, `CampaignSummary`), `block-list.tsx`, `block-forms.tsx`, `preview-frame.tsx`, `audience-builder.tsx`, `person-picker.tsx`, `recipients-dialog.tsx`, `test-send.tsx`, `parts.tsx`, `screens.ts`, `test-api.ts` (test helpers).
- **One lazy chunk** for both routes (`screens.ts`, 9.6 kB gzip), not two: two chunks made the bundler split `useBaseQuery` out of the entry (+1.4 kB initial, over the 200 kB budget). Initial JS 199.3 kB gzip (main 199.0 kB). 23.7 should add the report and send dialog to this chunk (or lazy-load the report from it), not as new routes' chunks.
- **Autosave** (`useAutosave`): 1 s after the last change, only when `draftProblems` finds nothing (a new image block has no image or alt and a new button no URL, so such a draft stays local, "Not saved: fix the marked fields"); the answer's version is used for the next save; edits during a save are saved 1 s after it; `409 changed` / `409 not_draft` stop autosaving for good and show **Reload** (refetches and remounts the editor); a pending change is saved on unmount. When `bulk:updated` brings a newer version and nothing waits to be saved, the editor reloads itself.
- **Not ready**: `TestSend` reads `400 { error: 'not_ready', problems: BulkNotReadyProblem[] }` (23.5 must answer `problems` under that key) and passes them to the block list; problems without `blockId` show under the button. **Test send route (23.5)**: any 2xx counts as sent ("Test sent to <my email>"); `429` shows a wait message; a 404 whose `error` is not `not_found` (Fastify's generic unknown-route answer) hides the button for the session. The button is disabled while the autosave state is not `saved`.
- The preview sends only `validBlocks` and the subject and preheader cut to 200 characters, so it never gets `400`; it keeps the last HTML while a new one loads. Images in the editor are shown from the relative `/api/bulk-email/images/<id>`.
- `lib/resize-image.ts` `resizeImageWithSize(file, max, { outputType: 'image/jpeg' | 'image/png', fit: 'width' })`; the editor uses JPEG unless the source is PNG.
- The audience builder reuses `groupsQuery` (groups) and `adminsQuery` (managers); hand-picked people of a saved draft are named once through `POST /people/lookup`; adding a person to one list removes them from the other.
- Non-draft campaigns show a small read-only `CampaignSummary` (status, subject, who sent when from which sender, recipients, sent, failed, Duplicate). **23.7 must**: replace `CampaignSummary` with the report (counts, progress on `bulk:updated`, per-person list, Cancel sending), add the **Send** step (confirm dialog with subject, sender and live count) as section 4 of `DraftEditor` (or under section 3), and route `400 not_ready` from send through the same `onProblems` path as `TestSend`.

### Task 6.1: API client, list, header link

**Files:**
- Create: `apps/web/src/features/bulk-email/api.ts`, `campaign-list-page.tsx` (+ tests)
- Modify: `apps/web/src/router.tsx` (lazy `/bulk-email`, `/bulk-email/$campaignId`, admin-only like `/admins`), `apps/web/src/components/app-header.tsx` (admin link `nav.bulkEmail` beside Admins), main locales (`nav.bulkEmail`), `bulkEmail` locales

- [x] **Step 1: Invoke `frontend-design:frontend-design`.** Failing tests: `list shows status badges and counts`; `New email creates a draft and opens it`; `header link only for admins`; `bulk:updated refetches the list`.
- [x] **Step 2–4:** run, implement, run. Commit `feat(web): bulk email list`.

### Task 6.2: Block builder and preview

**Files:** `features/bulk-email/editor-page.tsx`, `block-list.tsx`, `block-forms.tsx`, `preview-frame.tsx`, `use-autosave.ts` (+ tests); `apps/web/src/lib/resize-image.ts` (add an `outputType` option: `image/jpeg` or `image/png`, default today's WebP)

- [x] **Step 1: Failing tests:** `add each of the six block types`; `move up and down reorder, first block has no Move up`; `delete removes the block`; `autosave PUTs once 1 s after the last change with the version`; `409 changed shows the reload prompt`; `preview iframe has sandbox without allow-scripts and switches 600/375 px`; `an image upload is shrunk to 1 200 px JPEG before the POST`; `not_ready problems show at their block`.
- [x] **Step 2–4:** run, implement, run. Commit `feat(web): bulk email block builder`.

### Task 6.3: Audience builder and test send

**Files:** `features/bulk-email/audience-builder.tsx`, `person-picker.tsx`, `recipients-dialog.tsx` (+ tests)

- [x] **Step 1: Failing tests:** `changing a filter asks for the count once after 300 ms`; `left-out reasons are shown`; `add and leave out a person by search`; `Show recipients pages by 50`; `Send a test to me posts and shows "sent to <my email>"`, hidden when the route answers 404.
- [x] **Step 2–4:** run, implement, run. `pnpm --filter @spolu/web build`: record in the PR the eager chunk size change (expected: route definitions and the header link only).
- [x] **Step 5: Docs and PR.** `update-kb`: `product/bulk-email.md` (screens), `architecture/performance.md` (chunks). PR.

---

## Part 23.7 — Send flow, report, e2e (spec §6, §8, §10)

### Task 7.1: Send dialog and report

**Files:** `features/bulk-email/send-dialog.tsx`, `report-view.tsx` (+ tests); `editor-page.tsx` switches to `report-view` when the status is not `draft`

- [ ] **Step 1: Invoke `frontend-design:frontend-design`.** Failing tests: `send dialog shows subject, sender and the live count`; `confirm posts send and shows the report`; `report shows recipients, sent, failed, skipped, cancelled, unsubscribed and the "opens are not measured" note`; `progress bar updates on bulk:updated`; `Cancel sending only while sending`; `Duplicate opens the new draft`; `status filter of the per-person list`.
- [ ] **Step 2–4:** run, implement, run. Commit `feat(web): bulk email sending and report`.

### Task 7.2: e2e, docs, roadmap

- [ ] Write `e2e/bulk-email.spec.ts` exactly as spec §10 (Mailpit API: message list, headers, HTML body).
- [ ] `update-kb`: `product/bulk-email.md` as built, `runbooks/deploy.md` (the server env for bulk email and the owner checklist of spec "What the owner must do"), `glossary.md` (campaign, audience, unsubscribe), `roadmap.md` Phase 23 status.
- [ ] `bash scripts/ci.sh` green; push; PR.

---

## Later (not in this plan)

Spec "Later": the `news.egrant.sk` sender (config and DNS only), Elastic webhook tracking with the `bulk_events` table and opened/clicked/bounced/complaint columns, re-subscribing, image cleanup, scheduled sends. Each needs its own short plan when the owner asks for it.
