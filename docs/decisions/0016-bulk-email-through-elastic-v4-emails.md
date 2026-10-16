# 0016 Bulk email through Elastic's /v4/emails

Date: 2026-10-16
Status: accepted

## Context
Phase 23 adds bulk email (newsletters) for admins. Transactional email (login codes, invites, notifications) already goes through Elastic Email, over SMTP or the v4 transactional endpoint. Elastic treats newsletters as marketing: they must go through its marketing route, carry an unsubscribe link, and Elastic adds its own link until its support removes it for a paid account with a sending history. Spolu must record a send result per person, never send anyone the same campaign twice when a job is retried, and keep login codes reaching people who unsubscribed (owner answer P5). Spolu, not Elastic, is the source of truth for who unsubscribed (owner answer P3).

## Decision
- A separate `BulkEmailSender` (`apps/server/src/infra/email/bulk.ts`), chosen by `BULK_EMAIL_DRIVER`, with its own From (`MAIL_FROM_BULK`, default `MAIL_FROM`). No new dependency: `fetch` for Elastic, the existing nodemailer for SMTP.
- On servers (`elastic` driver) every person gets one `POST https://api.elasticemail.com/v4/emails` call (the marketing "bulk merge" endpoint) with the email already rendered for them, `Recipients: [{ Email }]`, `Content.Postback` and the header `Idempotency-Key` both `<campaignId>:<userId>`, `Options: { TrackOpens: false, TrackClicks: false }`, 15 s timeout. A network error, a timeout, `409`, `429` and `5xx` are retryable; any other `4xx` is final. The stable key makes a retry within Elastic's 24 h window return the stored answer instead of sending again. `TransactionID` and `MessageID` are kept for later webhook matching.
- Not the transactional endpoint (newsletters are marketing under Elastic's terms) and not SMTP for bulk on servers (no idempotency key, no per-call answer). The `smtp` driver exists for development, tests and e2e (Mailpit).
- Two unsubscribe modes (`BULK_EMAIL_UNSUBSCRIBE`). `elastic` (default): the footer link is `{unsubscribe:<Spolu page>}`, so Elastic records the unsubscribe and redirects to Spolu, and the `List-Unsubscribe` header comes from Elastic's account setting. `spolu`: the link goes straight to Spolu and Spolu passes `List-Unsubscribe: <one-click URL>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` in `Content.Headers`; used only after Elastic's support removed the forced link. The smtp driver always sends Spolu's own headers.
- The transactional SMTP sender adds `IsTransactional: True`, Elastic's documented marker for transactional mail, so Elastic's suppression of an unsubscribed address does not stop login codes.
- Unsubscribe links carry a stateless signed token: `<userId>.<campaignId>.<base64url HMAC-SHA256(APP_SECRET, "bulk-unsubscribe:<userId>:<campaignId>")>`, checked in constant time.

## Consequences
- One HTTP call per recipient: a few thousand people take minutes at the default `BULK_EMAIL_PER_MINUTE = 120`, far below Elastic's 20 concurrent connections. Fine for Spolu's size; a much larger audience would need Elastic's merge sending.
- A retried job never double-sends within 24 hours; a row stuck longer is failed instead of resent (part 23.5).
- In `elastic` mode Elastic also suppresses everyone who unsubscribes and Spolu can only ask it to drop the suppression (best effort). Whether Elastic keeps our own `List-Unsubscribe` in `spolu` mode is checked with a live send before switching.
- `BULK_EMAIL_DRIVER=smtp` needs `EMAIL_DRIVER=smtp`, so an env with `EMAIL_DRIVER=elastic` must set `BULK_EMAIL_DRIVER=elastic`.
- Rotating `APP_SECRET` invalidates old unsubscribe links; the Settings checkbox still works.
