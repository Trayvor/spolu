# 0051 Personal calendar feed: a derived secret URL, expanded call occurrences, a content ETag

Date: 2026-10-19
Status: accepted

## Context
Help had only one-off calendar exports: a reminder's or a task's `.ics` (a snapshot of one subject) and the Teams public page `/m/<token>` (one call). Neither follows later changes. The owner asked for a personal calendar subscription that Google Calendar, Outlook and Apple Calendar poll, showing a person's project events, task deadlines and calls, always with what the person may read at that moment. A calendar app cannot sign in: the URL itself must be the credential, and it must be possible to show it again, rotate it and revoke it. Spec: [2026-10-19-ics-calendar-design.md](../superpowers/specs/2026-10-19-ics-calendar-design.md).

## Decision
- **One feed per person, a derived token.** `calendar_feeds` (migration 0063, module `calendar`) holds the user, a 16-byte nonce, `sha256(token)` and three switches. The token is `base64url(HMAC-SHA256(APP_SECRET, "calendar-feed\0" + userId + "\0" + nonce))`, the full 32 bytes (43 characters, 256 bits). The database never holds the token, yet the settings card shows the link again (the Teams calendar page's pattern). A fetch finds the row by the hash's unique index and compares the derived token in constant time. Rotating writes a new nonce; revoking deletes the row; deactivating a user deletes it.
- **Permissions at fetch time, not at creation.** Every poll reads the owner fresh (`toSessionUser`: role, disabled) and asks the source modules for rows of the groups the person reads now (deactivated groups never), then checks each row again with the module's own policy function. An admin's feed holds the events and calls of their own clients (`managedGroupIdsOf`) and the deadlines of tasks assigned to them (owner decision 2026-10-19).
- **Recurring calls as expanded occurrences, no RRULE.** ADR 0049 already makes every call of a series a real item 60 days ahead, so each is a `VEVENT` of its own; cancelling or editing one call needs no `RECURRENCE-ID` or `EXDATE`.
- **A deterministic body and a content ETag, no server cache.** No `METHOD`, `DTSTAMP` = each event's `updated_at`, events sorted by start and UID: the same data gives the same bytes, and the ETag is the first 22 base64url characters of their SHA-256. A matching `If-None-Match` gets 304. The three indexed reads (at most 1 000 rows each) run on every poll; correct permissions beat a stale cache.
- **The token never reaches a log.** The Fastify request serializer rewrites `/api/public/calendar/<token>/…` to `:token` (`infra/http/log-url.ts`).
- **No new dependency.** The serializer is `buildIcsFeed` next to the existing `buildIcsText` (`reminders/ics.ts`).

## Consequences
- Rotating `APP_SECRET` breaks every feed link (as every Teams calendar link); people make a new link in Settings ([deploy.md](../runbooks/deploy.md)).
- Calls of a series further than 60 days ahead appear as the series job creates them (hourly).
- Each poll costs one token lookup and up to eight indexed statements even when the answer is 304. Enough for eGrant's few hundred people; a short per-token cache can be added if the polls show in the logs.
- The feed routes are outside the MCP allowlist: an AI assistant can neither read nor reveal a feed URL.
