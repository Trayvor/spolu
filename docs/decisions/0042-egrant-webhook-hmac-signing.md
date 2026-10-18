# 0042 Optional HMAC signing of the eGrant webhooks, with an in-memory replay cache

Date: 2026-10-18
Status: accepted

## Context
eGrant calls Help's webhooks (ticket intake, managers, groups, and the projects webhook of PR #113) with a Bearer key. The security review of 2026-10-18 (finding M4) noted that a Bearer key is a bearer token: whoever sees one request (an eGrant log, a proxy, a mis-sent `curl`) can send any body, and replay it, until the key is rotated. Item 4 of its fix: sign the body with a timestamp, so a leaked request cannot be replayed or altered. eGrant is PHP and must be able to sign with its standard library.

## Decision
- **Optional, per webhook, on top of the Bearer key.** `EGRANT_<NAME>_SIGNING_SECRET` (`TICKETS`, `MANAGERS`, `GROUPS`, `PROJECTS`), at least 32 characters, read into `config.egrantSigningSecrets`. Unset: the webhook behaves exactly as before, and signature headers are ignored, so eGrant can start sending them before Help turns the check on. Set: a missing, malformed, stale, wrong or replayed signature is `401 unauthorized`. The Bearer key stays required and is checked first.
- **The scheme** (the common Stripe/Slack shape, easy in PHP with `hash_hmac`):
  - `X-Spolu-Timestamp: <unix seconds>`
  - `X-Spolu-Signature: sha256=<hex>` where hex = HMAC-SHA256(secret, `"<timestamp>.<raw body>"`), over the exact bytes sent.
  - The timestamp must be within ±300 s of Help's clock. The comparison is constant time (`timingSafeEqual` on the 32-byte digests).
- **Order of checks** stays `503 → 429 → 401 (key)`, all in `onRequest`, before the body is read. Then the signature headers and the timestamp (`preParsing`, still before the body), then the body is read under the route's `bodyLimit`, then the digest is compared and the replay cache checked (`preValidation`, before the handler).
- **The raw body is hashed while Fastify reads it, not kept.** The route's `preParsing` hook passes the request stream through a `Transform` that feeds each chunk to the HMAC and on to Fastify's normal JSON parser. Only these routes get the hook (route options, not a global content-type parser), so other routes are untouched; the parser still enforces `bodyLimit` (and the content length) on the same bytes. Keeping a copy of the raw body instead was rejected: the intake takes up to 28 MiB, and a second copy of every intake body would double its memory for nothing.
- **Replay protection: an in-memory cache, not a table.** Each verified signature is remembered (keyed by webhook and digest) until its timestamp leaves the window; a repeat inside the window is `401`. Bounded at 10 000 entries (oldest dropped first). Reasons:
  - Help runs as a single process ([ADR 0005](0005-single-process-deployment.md)); the rate limiters are in memory for the same reason.
  - A table would add a write (and a cleanup job) to every webhook call for a window of five minutes.
  - What it does not cover: after a restart, a request captured in the five minutes before it could be replayed once. Every eGrant webhook is idempotent (state-setting `PUT`s, `request_id` on tickets), so such a replay changes nothing, and the attacker still needs a request that was signed less than five minutes ago.
  - If Help ever runs more than one instance, the cache must move to PostgreSQL (a table with a unique key on the digest and an expiry), like the rate limiters.
- **One helper for every webhook** (`infra/http/egrant-signature.ts`): `egrantSignature(config, webhook)` returns the route hooks (`{}` without a secret), spread into the route's options in one line next to its gate and `bodyLimit`; `verifyEgrantSignature(config, webhook, request)` tells a handler or test the outcome; `signEgrantRequest(secret, timestamp, body)` computes a signature (tests, docs).

## Consequences
- eGrant must sign every attempt anew, retries included, with a fresh timestamp: a retry with the old signature is a replay and answers `401`. eGrant's clock must be NTP-synced.
- Turning it on is two steps: eGrant sends the headers (ignored while unset), then the Help admin sets the secret and restarts. Rotation is the same as for the keys: a new value and a restart; the old signatures answer `401` from then on.
- A leaked request is useless after five minutes, and a leaked Bearer key alone no longer opens a signed webhook.
- The intake, managers and groups webhooks use it from the start; the projects webhook got the one-line spread with PR #113 (Phase 33 P3).
