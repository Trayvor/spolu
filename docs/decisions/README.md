# Architecture decision records

One file per decision, named `NNNN-kebab-title.md`, numbered in order. Never rewrite history: to change a decision, add a new ADR and mark the old one `superseded by NNNN`. Use the `update-kb` skill when a decision is made.

## Template

```markdown
# NNNN Title

Date: YYYY-MM-DD
Status: accepted | superseded by NNNN

## Context
Why a decision was needed.

## Decision
What we chose.

## Consequences
What gets easier, what gets harder.
```

## Index

| # | title | status |
|---|---|---|
| [0001](0001-typescript-monorepo.md) | TypeScript monorepo | accepted |
| [0002](0002-postgres-job-queue-no-redis.md) | Postgres job queue, no Redis | accepted |
| [0003](0003-disk-storage-behind-interface.md) | Disk storage behind an interface | accepted |
| [0004](0004-scripts-first-ci.md) | Scripts-first CI | accepted |
| [0005](0005-single-process-deployment.md) | Single-process deployment | accepted |
| [0006](0006-better-auth-email-otp.md) | better-auth with email OTP | accepted |
| [0007](0007-egrant-design-via-frontend-design.md) | egrant.sk design via frontend-design | accepted |
| [0008](0008-self-hosted-only.md) | Self-hosted only | accepted |
| [0009](0009-web-client-stack.md) | Web client stack | accepted |
| [0010](0010-web-i18n.md) | Web i18n with i18next | accepted |
| [0011](0011-pwa-with-vite-plugin-pwa.md) | Installable PWA with vite-plugin-pwa | accepted |
| [0012](0012-dnd-kit-and-fractional-indexing.md) | dnd-kit and fractional-indexing for the task board | accepted |
| [0013](0013-web-push.md) | Web Push with VAPID | accepted |
| [0014](0014-lazy-locale-namespaces.md) | Lazy locale namespaces | accepted |
| [0015](0015-trigram-search.md) | Trigram search for the knowledge base | accepted |
| [0016](0016-bulk-email-through-elastic-v4-emails.md) | Bulk email through Elastic's /v4/emails | accepted |
| [0017](0017-intake-files-as-base64.md) | Ticket intake files as base64 in the JSON body | accepted |
| [0018](0018-visible-name-help-and-domain-redirects.md) | Visible name Help, code name Spolu, and old-domain redirects | accepted |
| [0019](0019-nine-languages-and-one-email-design.md) | Nine languages and one email design | accepted |
| [0020](0020-header-menus-on-first-use-and-native-dialog-sheets.md) | Header menus on first use and native dialog sheets | accepted |
| [0021](0021-ticket-riesitelia-and-watching.md) | Ticket riešitelia, and watching tickets instead of managing the client (amended 2026-10-17: watch until assigned, no per-ticket following) | accepted |
| [0022](0022-one-click-ticket-sign-in-link.md) | One-click sign-in link in the "Ticket created" email | accepted |
| [0023](0023-ffmpeg-static-build-for-meeting-audio.md) | A static ffmpeg build for meeting audio, and speech-to-text over plain fetch | accepted |
| [0024](0024-bulk-email-content-v2.md) | Bulk email content v2: a document tree, a phone version and an upgrade on read | accepted |
| [0025](0025-prosemirror-chat-editor.md) | ProseMirror core for the chat composer, with our own Markdown conversion | accepted |
| [0026](0026-bulk-email-wide-layout-and-linked-preview.md) | A wider email for split containers, and a preview linked to the builder | accepted |
| [0027](0027-sealed-finance-module.md) | A sealed finance module: own tables, own room, finance-only files | accepted |
| [0028](0028-finance-charts-own-svg.md) | Finance charts as our own SVG components, no chart library | accepted |
| [0029](0029-admin-group-as-a-group-row.md) | The internal admin group as one `groups` row with `kind = 'admin'` | accepted |
| [0030](0030-projects-composite-keys-and-egrant-matching.md) | Projects: composite keys, exact-key matching with aliases, and created by eGrant | accepted |
| [0031](0031-local-deploy-without-registry.md) | Local deploy from the orchestrator's Mac, without a registry | accepted |
| [0032](0032-finance-items-without-a-client.md) | Finance items without a client, and client shares | accepted |
| [0033](0033-mcp-server-over-the-http-api.md) | An MCP server over our own HTTP API, with personal tokens and no SDK | accepted |
| [0034](0034-mcp-oauth-authorization-server.md) | OAuth for the MCP server: Help as its own authorization server, tokens in `mcp_tokens` | accepted |
| [0035](0035-in-memory-mail-capture-for-server-tests.md) | Server tests capture email in memory; Mailpit for e2e and one SMTP check | accepted |
| [0036](0036-teams-graph-app-only-plain-fetch.md) | Microsoft Teams through Graph app-only over plain fetch, calendar events and polling | accepted |
| [0037](0037-supply-chain-policy.md) | Supply-chain policy: pnpm release age and trust, images by digest | accepted |
| [0038](0038-egrant-groups-webhook-and-group-deactivation.md) | eGrant groups webhook (JSON logo, no image library) and group deactivation by a database guard | accepted |
| [0039](0039-svg-logos-rendered-to-png-with-resvg-wasm.md) | SVG logos from eGrant are rendered to PNG with resvg compiled to WebAssembly | accepted |
| [0040](0040-explain-volumes-from-template-databases.md) | The EXPLAIN volumes come from template databases, cloned per run | accepted |
| [0041](0041-ffmpeg-hardened-for-untrusted-uploads.md) | ffmpeg runs hardened for untrusted uploads: input whitelists and a minimal environment | accepted |
| [0042](0042-egrant-webhook-hmac-signing.md) | Optional HMAC signing of the eGrant webhooks, with an in-memory replay cache | accepted |
| [0043](0043-signed-invitation-context-in-the-login-link.md) | Signed invitation context in the invitation email's login link | accepted |
| [0044](0044-enforced-csp-set-by-the-app.md) | An enforced Content-Security-Policy, set by the app, with a report endpoint | accepted |
| [0045](0045-notification-centre-from-the-events-table.md) | The notification centre reads `notification_events`, with a delivery verdict and held events | accepted |
| [0046](0046-global-search-module-functions-and-fold-index.md) | Global search: one search function per module and an indexed fold function | accepted |
| [0047](0047-push-actions-through-the-session-api.md) | Push notification buttons act through the session API, with no one-time capability | accepted |
| [0048](0048-ffmpeg-in-a-media-sandbox-container.md) | ffmpeg runs in a media sandbox container with no network, reached over a Unix socket | accepted |
| [0049](0049-recurring-calls-rule-and-materialised-occurrences.md) | Recurring calls: a stored rule, occurrences created ahead as items, one Teams event per call | accepted |
| [0050](0050-admin-passkeys-with-simplewebauthn.md) | Passkeys for admins with SimpleWebAuthn, next to the email code | accepted |
| [0051](0051-personal-calendar-feed.md) | Personal calendar feed: a derived secret URL, expanded call occurrences, a content ETag | accepted |
| [0053](0053-ai-draft-retrieval-with-trigrams.md) | Retrieval for AI ticket drafts with pg_trgm terms and a folded body index, no embeddings | accepted |
| [0054](0054-audit-log-explicit-actor-same-transaction.md) | Audit log: an explicit author, written in the change's transaction, append only | accepted |
| [0055](0055-weekly-client-summaries.md) | Weekly client summaries: AI draft, mandatory human send, own unsubscribe | accepted |
| [0057](0057-message-search-stored-fold-column-trigram.md) | Message search: a stored folded column with a trigram index | accepted |
| [0058](0058-notification-read-on-open.md) | Opening a notification reads it: a per-event read time next to the read mark | accepted |
| [0059](0059-admin-substitution-derived-manager-rows.md) | Admin substitution: derived manager rows with an origin marker | accepted |
| [0060](0060-read-notifications-when-the-subject-opens.md) | Opening a subject reads its notifications: a subject key and a partial index of unread items | accepted |
| [0061](0061-translate-received-messages-stored-per-language.md) | Translating received messages: one stored translation per text and language | accepted |
| [0062](0062-bulk-email-container-modes-and-look.md) | Bulk email container: simple and split modes and a look on the stored `columns` block | accepted |
| [0063](0063-translate-received-messages-in-every-client-group.md) | Translating received messages in every client group, into the language the reader sees | accepted |
| [0064](0064-ticket-area-autoassign-table-replaced-by-egrant.md) | Automatic ticket assignees: a per-client area table keyed by a folded area, replaced whole by eGrant | accepted |
| [0065](0065-salaries-own-records-and-cost-document-links.md) | Salaries are their own records; documents link to costs through one link table | accepted |
| [0066](0066-contract-masters-schedules-and-payment-links.md) | Contract masters one level deep, computed payment schedules, payments recorded by linked documents | accepted |
| [0067](0067-whats-new-announcements-in-code-seen-per-user.md) | "What's new" announcements defined in code, seen once per person in `announcement_seen` | accepted |
| [0068](0068-company-gitlab-jenkins-behind-apache.md) | Company GitLab + Jenkins (`Jenkinsfile`, main only), production behind Apache in proxy mode (`BEHIND_PROXY`, `HTTP_PORT`) | accepted |
| [0069](0069-ticket-area-rules-by-clients-and-sources.md) | Clients edit their automatic ticket assignees; Help's and eGrant's rows kept apart (`source`) | accepted |
| [0070](0070-elastic-webhook-tracking.md) | Bulk email opens, clicks, bounces and complaints through Elastic's signed webhook (`ELASTIC_WEBHOOK_SECRET`, `bulk_events`) | accepted |
