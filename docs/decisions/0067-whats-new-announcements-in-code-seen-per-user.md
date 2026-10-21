# 0067: "What's new" announcements are defined in code, seen once per person on the server

- Status: accepted
- Date: 2026-10-21

## Context

The owner asked (2026-10-21) for a popup about the latest update, shown to everyone once — not
on every page change, not again after it is closed, and only with the parts a person can use
(finance only for the finance right). It should be reusable for later updates, and it must not
grow the initial JS, which is practically full ([performance.md](../architecture/performance.md)).

## Decision

- **Announcements live in code**, not in the database: `modules/announcements/catalogue.ts`
  lists them newest first, each with a stable id (the day of the update) and its section ids;
  the texts are the web's lazy `whatsNew` namespace, keyed by the id. A new update is a code
  change (an entry, its section rules, its nine translations), reviewed and deployed like any
  feature; there is no admin editor.
- **Seen is stored per person on the server**: a table `announcement_seen` (`user_id` FK
  cascade, `announcement_id`, `seen_at`; primary key `(user_id, announcement_id)`), migration
  0071. A row per closed announcement keeps the history and makes "seen" idempotent with one
  `insert … on conflict do nothing`; a column "last seen id" on `user` would have tied the
  users module to this feature and lost which ones were closed.
- **The server decides the sections** with each feature's own policy (`canUseBoard` with the AI
  on, `canUseSnippets`, `canUseBulkEmail`, `canSeeFinance`) and answers only the newest
  announcement with a section the person can use, or none; an older announcement never shows
  after a newer one, and nobody gets an empty popup.
- **One cheap request per app load**: `GET /api/me/announcement` from a small lazy chunk of the
  signed-in layout (no zod, no texts); the popup and its texts are a second lazy chunk, loaded
  only when there is something to show.
- **`WHATS_NEW=off`** (config, default `on`) answers no announcement; only the e2e server sets
  it, because a popup would cover the first screen of every spec.

## Consequences

- Translating and wording an announcement goes through the usual locale rules (all nine
  languages, the locale tests).
- Removing an old announcement from the catalogue leaves its rows harmless; a reused id would
  count as seen, so ids are never reused.
- The `SheetDialog` gained `onOutside`, for a sheet with nothing to lose that may close on a
  click outside.
