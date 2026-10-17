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
| [0021](0021-ticket-riesitelia-and-watching.md) | Ticket riešitelia, and watching tickets instead of managing the client | accepted |
| [0022](0022-one-click-ticket-sign-in-link.md) | One-click sign-in link in the "Ticket created" email | accepted |
| [0023](0023-ffmpeg-static-build-for-meeting-audio.md) | A static ffmpeg build for meeting audio, and speech-to-text over plain fetch | accepted |
| [0024](0024-bulk-email-content-v2.md) | Bulk email content v2: a document tree, a phone version and an upgrade on read | accepted |
| [0026](0026-bulk-email-wide-layout-and-linked-preview.md) | A wider email for split containers, and a preview linked to the builder | accepted |
