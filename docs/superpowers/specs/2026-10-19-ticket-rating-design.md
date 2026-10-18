# Ticket rating: design

Date: 2026-10-19. Status: **built** on `feat/ticket-rating` (see "Decisions taken while building" at the end), reviewed by the owner on 2026-10-19 (privacy answered, see "Owner decisions"); the other open questions keep their recommended answers until the owner says otherwise. Implementation starts after the phases now in flight are done; its e2e spec runs in the final e2e pass after all seven 2026-10-19 specs (#169 to #175) are implemented. Plan: [2026-10-19-ticket-rating.md](../plans/2026-10-19-ticket-rating.md).

## Owner's request (2026-10-19)

After a ticket is resolved, the requester can rate it 👍/👎 with an optional comment. They can do it from the ticket page and from the link in the "resolved" notification (email or push). One rating per ticket per person, which they can change for a limited time. Admins see the ratings on the ticket and as a total (on the dashboard's Tickets card or a small stats view). No SLA. Decide anti-abuse, privacy (who sees comments) and i18n.

## Goal

eGrant learns, ticket by ticket, whether the person who asked was helped, and sees the share of 👍 over time and per client. This is a feedback signal, not a performance metric. Nothing is measured against a deadline, nothing is shown to clients as a score, and no rating changes the ticket's status.

## Owner decisions (2026-10-19)

- **Every admin sees the client's rating comment** (and the value), on the ticket and in `/tickets/ratings`: not only the ticket's riešitelia or the client's managers, but every admin, including finance admins and the superadmin. Clients other than the rater still see nothing. This answers the request's "privacy (who sees comments)" and open question 8.

## Decisions (proposed; see "Open questions" for the ones the owner should confirm)

1. **Who rates: the ticket's initiator only** (`tickets.requester_user_id`), while they can read the ticket and are not an admin. The initiator is a žiadateľ or a client of the group. Other clients of the group, riešitelia and admins never rate. The table is keyed per ticket and person anyway, so letting more people rate later is only a policy change.
2. **When: while the ticket is Resolved, up to 14 days after `resolved_at`** (`TICKET_RATING_LIMITS.editDays`). Inside the window the rating can be changed as often as the person likes. After it, the rating is read-only. A ticket that is reopened keeps its rating (nobody can change it while the ticket is open). When the ticket is resolved again, a new 14-day window starts from the new `resolved_at`, so the person can change their 👎 to 👍 after the fix.
3. **Value and comment**: `up` or `down`, and an optional plain-text comment of up to 1 000 characters. The comment is never rendered as Markdown and never goes into the ticket chat.
4. **Privacy: every admin, and only admins, sees ratings and comments** (owner decision 2026-10-19; no narrowing to the ticket's owners or the client's managers). The rater sees their own rating. Other clients of the group, including client riešitelia, see nothing: no value, no comment, no total. The comment never goes into a notification payload, a push, a digest email, a socket event or eGrant.
5. **Aggregates for admins**: one line on the dashboard's Tickets card ("Spokojnosť za 30 dní: 86 % · 14 hodnotení") and a small stats view `/tickets/ratings`, with period pills (30 / 90 / 365 days), an optional client, the 👍 / 👎 counts, the satisfaction share and the response rate, and the list of ratings newest first with their comments (50 per page).
6. **Notifications**: a 👎 notifies the ticket's admin owners once per rating (`ticket.rated`, "Tiket #123: negatívne hodnotenie"). A 👍 notifies nobody. The "resolved" push and digest link opens `/tickets/<id>?rate=1`, which scrolls to the rating card. There is no one-click rating link in email: mail scanners open links, and a GET must not write.
7. **No new dependency, no ADR.** It uses the existing module pattern, policy functions, HTTP writes with a socket push, notifications and lazy namespaces. ADR-XXXX is not needed unless the owner picks the dedicated rating email with a sign-in link (open question 3).

## Users and roles

|                                                    | rates                            | sees own rating | sees all ratings and comments on the ticket | sees totals and `/tickets/ratings` |
| -------------------------------------------------- | -------------------------------- | --------------- | ------------------------------------------- | ---------------------------------- |
| initiator (žiadateľ or client of the group)        | yes, in the window               | yes             | no                                          | no                                 |
| other client of the group (also a client riešiteľ) | no                               | –               | no                                          | no                                 |
| admin (any admin; also an admin initiator)         | no                               | –               | yes                                         | yes                                |
| finance admin, superadmin                          | no                               | –               | yes                                         | yes                                |
| MCP token                                          | read only, as its user (the DTO) |                 |                                             |                                    |

An admin who is the initiator of a ticket (an admin's email in the intake) does not rate: admins are the ones who solve tickets, and their rating would skew the total.

## UX

The design follows egrant.sk through the `frontend-design` skill (CLAUDE.md). The texts below are the Slovak source with English. The other seven languages follow [wording.md](../../design/wording.md); Italian uses the formal "Lei" and Slovenian vikanje in sentences ([ADR 0019](../../decisions/0019-nine-languages-and-one-email-design.md)).

### Rating card on the ticket page (the initiator)

Shown full width under the header and the unseen banner, above the details and chat. On a phone it is not folded into the details, so the person sees it without opening anything. It is shown only while `rating.canRate` is true, or when `rating.mine` exists (then read-only).

- **Not rated yet** (`canRate`, no `mine`):
  - title: **"Ako sme vám pomohli?"** (en "How did we do?")
  - line: "Tiket je vyriešený. Dajte nám vedieť, či vám riešenie pomohlo." (en "This ticket is resolved. Let us know whether the solution helped you.")
  - two toggle buttons with thumb icons (inline SVG in `features/tickets/icons.tsx`, not emoji, so they look the same on every system): **"Pomohlo"** (en "Helpful") and **"Nepomohlo"** (en "Not helpful"); `aria-pressed` on the chosen one.
  - A click saves at once (`PUT`, value only). Then the comment field opens.
- **Comment** (after a value is chosen, or after "Upraviť"):
  - label: "Chcete nám niečo odkázať? (nepovinné)" (en "Anything you want to tell us? (optional)")
  - textarea, 1 000 characters, with a counter from 900
  - hint: "Komentár uvidí iba tím eGrant." (en "Only the eGrant team sees your comment.")
  - button **"Odoslať"** (en "Send"), disabled while unchanged; Esc or "Zrušiť" closes the field without saving.
- **Rated, window open**:
  - "Ďakujeme za hodnotenie." (en "Thank you for your feedback.")
  - the chosen value as a pressed button, the comment (if any) under it in muted text
  - "Hodnotenie môžete zmeniť do {{date}}." (en "You can change your rating until {{date}}."), then the link **"Upraviť"** (en "Edit")
- **Rated, window closed** (`mine`, not `canRate`): one muted line, "Vaše hodnotenie: Pomohlo" (or "Nepomohlo"), plus the comment. No buttons.
- **Errors**: a refused save shows "Nepodarilo sa uložiť. Skúste to znova." A `409 rating_closed` (the window closed while the page was open) shows "Hodnotenie sa už nedá zmeniť." (en "The rating can no longer be changed.") and refetches the ticket.
- **`?rate=1`** (from the resolved push or email): once the ticket is loaded, the page removes the parameter (replace, as `?time=1` does) and, if `canRate`, scrolls the card into view and focuses its first button. For anyone else the parameter does nothing.

### Ratings on the ticket page (admins)

In the details list, after "Vyriešený" (resolved time), a row **"Hodnotenie"** (en "Rating"), shown only while the ticket is resolved or has a rating:

- each rating: thumb icon, name of the rater, date ("Jana Nováková · 19. 10. 2026"), and under it the comment as plain text (line breaks kept, `whitespace-pre-line`, no Markdown);
- no rating yet on a resolved ticket: "Zatiaľ bez hodnotenia" (en "Not rated yet");
- the row updates live (`ticket:rated`).

### Dashboard Tickets card (admins)

A third line under the existing two in the card's subline: **"Spokojnosť za 30 dní: 86 % · 14 hodnotení"** (en "Satisfaction, last 30 days: 86% · 14 ratings"). It counts every client, not only the clients the admin watches, so all admins see the same number. With no ratings: "Spokojnosť za 30 dní: zatiaľ bez hodnotení". The line is plain text, because the card has its own links and a link inside the subline would nest interactive elements. The stats view is reached from the global ticket list.

### Stats view `/tickets/ratings` (admins)

A lazy route with its own namespace `ticketRatings`, linked from the header of the global view `/tickets` (a secondary button **"Hodnotenia"**, en "Ratings", admins only).

- title "Hodnotenia tiketov" (en "Ticket ratings"); "Späť" to `/tickets`
- filters (in the URL, remembered like other lists): period pills **30 dní / 90 dní / 12 mesiacov** (default 30), a client select (default "Všetci klienti"), value pills **Všetky / Pomohlo / Nepomohlo**
- summary row of four numbers: **Pomohlo** n, **Nepomohlo** n, **Spokojnosť** % (`up / (up + down)`, "–" with no ratings), **Odozva** % (the response rate: tickets resolved in the period that have a rating, out of tickets resolved in the period that have an initiator account), with the hint "Podiel vyriešených tiketov, ktoré žiadateľ ohodnotil." (en "Share of resolved tickets the requester rated.")
- list, newest first (by when the rating was last changed), 50 per page with "Načítať ďalšie": thumb, "#123 Subject" (links to the ticket), client, rater, date, comment (plain text, clamped to 3 lines, expands on click)
- empty: "Za toto obdobie nie sú žiadne hodnotenia." (en "No ratings in this period.")

No charts: a number row and a list are enough, and charts would need either our own SVG (as finance, [ADR 0028](../../decisions/0028-finance-charts-own-svg.md)) or a library.

### Notifications

- **`ticket.resolved`** (unchanged recipients): its push and digest link becomes `/tickets/<id>?rate=1` for every recipient. The page decides whether the viewer may rate. The push and digest texts stay the same.
- **`ticket.rated`** (new kind, group **Ticket board** / `tickets`, rank 2): sent when a rating becomes `down` and the row's `down_notified_at` is null, which is then set. So a person who switches up and down repeatedly notifies once per rating. Recipients: the admins among the ticket's owners (`ticketOwnerIds`: its riešitelia, or the watchers while it has none); if none of them is an admin, the admins among the people who watch the client's tickets (`ticketWatcherIds`, the client's managers by default); for a ticket without a client, nobody (its initiator has no account, so it cannot be rated anyway). Only people who still read the ticket. Push: title **"Tiket #123: negatívne hodnotenie"** (en "Ticket #123: negative rating"), body the subject, url `/tickets/<id>`, tag `ticket:<id>`. The digest line comes from the push, as for the other ticket kinds. The payload is `ticketPayload` plus `{ value: 'down' }`, never the comment.
- `ticket.rated` is **not** an unseen-change kind (`unseen-kinds.ts` stays as it is), so the partial index `notification_events_unseen_ticket_idx` needs no change. The admin opens the ticket from the push, digest or bell. The bell (the notification centre, `notifications/centre.ts`, on main since #155) lists `ticket.rated` with the push's title and link like every other kind; its item visibility check (`canSeeCentreItem`) needs no change, since every admin reads every ticket.

## Data model

One new table in the tickets module (`modules/tickets/schema.ts`) and one index on `tickets`. Migration `00XX_ticket-rating` (the orchestrator assigns the number; main's newest is `0062_night_integration` and #113 takes `0063`, so this one is `0064` or later).

```ts
export const ticketRatings = pgTable(
  'ticket_ratings',
  {
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    value: text('value').$type<TicketRatingValue>().notNull(),
    comment: text('comment'),
    /** When the 👎 notification went; at most once per rating (anti-spam). */
    downNotifiedAt: timestamp('down_notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Last change of value or comment: the stats period and the list order. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.userId] }),
    check('ticket_ratings_value_check', sql`${t.value} in ('up', 'down')`),
    check(
      'ticket_ratings_comment_check',
      sql`${t.comment} is null or char_length(${t.comment}) between 1 and 1000`,
    ),
    // The stats list and summary: a period of ratings, newest first (keyset).
    index('ticket_ratings_updated_idx').on(t.updatedAt.desc(), t.ticketId.desc(), t.userId.desc()),
    // The user FK's cascade.
    index('ticket_ratings_user_idx').on(t.userId),
  ],
);
```

On `tickets`, for the response rate:

```ts
index('tickets_resolved_at_idx').on(t.resolvedAt.desc()).where(sql`${t.status} = 'resolved'`),
```

- **No `group_id` copy** on the rating. The client filter joins `tickets` by its primary key. A ticket moved to another client counts for its current client, as everywhere else.
- **Deleting**: a deleted ticket or user deletes their ratings (cascade). A deactivated user keeps theirs. There is no delete route; a person who regrets a comment clears it inside the window.
- **Module boundaries**: only the tickets module reads `ticket_ratings`. Notifications get their recipients through the tickets module's `audience.ts`, as today.

## API

All under `/api`, in a new plugin `modules/tickets/ratings-routes.ts` (`ticketRatingsRoutes`), registered in `app.ts` next to `ticketsRoutes`. Shared zod schemas in `packages/shared/src/tickets.ts`.

| method, path                   | who                             | body or query                                         | answer                                              |
| ------------------------------ | ------------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| `PUT /tickets/:id/rating`      | the initiator (`canRateTicket`) | `{ value: 'up' \| 'down', comment?: string \| null }` | `200 TicketDto`                                     |
| `GET /tickets/ratings/summary` | admins (`requireAdmin`)         | `days=30\|90\|365` (default 30), `groupId?`           | `200 TicketRatingSummary`                           |
| `GET /tickets/ratings`         | admins                          | `days`, `groupId?`, `value?=up\|down`, `cursor?`      | `200 { items: TicketRatingListItem[], nextCursor }` |

- **PUT semantics**: an upsert of the actor's row. `comment` absent keeps the stored comment, `null` or a blank string clears it, and a string is trimmed and stored. A value click therefore never erases a comment. The answer is the ticket as the actor sees it, so the web stores it as the other ticket mutations do.
- **Refusals**, in this order: `404 not_found` (unknown, or the actor cannot read it; checked first, so it leaks nothing); `403 forbidden` (an admin, or a reader who is not the initiator); `409 ticket_not_resolved`; `409 rating_closed` (more than 14 days after `resolved_at`); `400 validation_failed`; `429 rate_limited` (20 rating writes a minute per user, `createRateLimiter`).
- **TicketDto** gets:
  - `rating: { mine: TicketRating | null, canRate: boolean, editableUntil: string | null }` for every reader. `mine` is null for anyone but the rater. `editableUntil` is `resolved_at + 14 days` while `canRate`.
  - `ratings: TicketRatingWithRater[] | null`: every rating of the ticket with the rater's id and name for admins, null for everyone else.
  - Both come from one query by the primary key's prefix (`ticket_id`), added to `toTicketDto`'s `Promise.all`. List rows do not change.
- **Summary**: `{ days, up, down, resolved, rated }`. `up` and `down` count the ratings whose `updated_at` is in the period. `resolved` counts the tickets resolved in the period with a `requester_user_id`. `rated` counts those of them that have a rating. The web computes the shares, so the numbers stay exact.
- **List item**: `{ ticketId, number, subject, groupId, groupName, raterId, raterName, value, comment, ratedAt }`. The keyset cursor is (`updated_at`, `ticket_id`, `user_id`), base64url like the ticket list's. One query per page (ratings ⋈ tickets ⋈ groups ⋈ user).
- **Errors** are new `ErrorCodes`: `ticketNotResolved: 'ticket_not_resolved'` and `ratingClosed: 'rating_closed'`.
- **MCP**: `GET /api/tickets/:id` is already on the MCP allow-list, so `get_ticket` shows `rating` and, to an admin's token, `ratings`. The `PUT` and the stats routes are not added to the allow-list: an AI assistant does not rate on someone's behalf.

## Permissions

New policy functions in `modules/tickets/policy.ts`, pure and unit-tested like the rest. The routes call only these, and the client is never trusted.

```ts
/** The ticket's initiator, not an admin, who reads it. The time window is checked apart. */
export function canRateTicket(
  actor: SessionUser,
  ticket: TicketRef,
  role: MemberRole | null,
): boolean;
/** Until when a rating of a ticket resolved at `resolvedAt` can be set or changed. */
export function ratingEditableUntil(resolvedAt: Date): Date; // + TICKET_RATING_LIMITS.editDays
/** Whether the rating can be written now: resolved and inside the window. */
export function ratingOpen(
  ticket: { status: TicketStatus; resolvedAt: Date | null },
  now: Date,
): boolean;
/** Every rating, comments and totals: every admin (owner decision 2026-10-19), nobody else. */
export function canSeeTicketRatings(actor: SessionUser): boolean;
```

`canRateTicket` is `!isAdmin(actor) && ticket.requesterUserId === actor.id && canReadTicket(actor, ticket, role)`. A žiadateľ whom an admin removed from the group, or whose ticket moved to a client where they are not a member, loses the right with the read right. Their rating stays and admins still see it.

[permissions.md](../../architecture/permissions.md) gets a "Ticket ratings" row in the matrix and a paragraph with these rules.

## Realtime

After a committed `PUT`, the route emits **`ticket:rated`** (`TicketEvents.rated`, payload `{ ticketId, groupId }`) to `ADMINS_ROOM` and to the rater's `userRoom`, not to the group room, so other clients of the group are not even told that a rating exists. The web refetches the ticket (`ticketQuery`) and, for admins, invalidates `['tickets', 'ratings']` (summary and list). No `ticket:updated` is sent: list rows do not show ratings. [realtime.md](../../architecture/realtime.md) lists the event.

## Performance

- **Ticket page**: one extra indexed query (`ticket_ratings` by `ticket_id`, the primary key's prefix) inside the existing `Promise.all`, joined to `user` for the names only for admins. No N+1: lists are unchanged.
- **Summary**: two statements. (1) The ratings in the period, as a range on `ticket_ratings_updated_idx`, filtered by client through the `tickets` primary key. (2) The resolved tickets in the period, on `tickets_resolved_at_idx`, with `exists` on the `ticket_ratings` primary key. Bounded by the period (at most 365 days).
- **List**: a keyset page of 50 on `ticket_ratings_updated_idx`, with primary-key joins.
- **EXPLAIN**: the home volume (`modules/home/test-volume.ts`) seeds 6 000 ratings over two years on its tickets (a third of them `down`, a quarter with a comment), and `home/explain.test.ts` asserts no sequential scan of `ticket_ratings` or `tickets` for the summary (with and without `groupId`) and the first list page. Since the volume's seed changes, its template hash changes and it is rebuilt once ([ADR 0040](../../decisions/0040-explain-volumes-from-template-databases.md)).
- **Dashboard**: the card's line fetches `GET /tickets/ratings/summary?days=30` with its own query (`staleTime` 5 min), so it never slows the card's main list.
- **JS budget**: no new code in the initial JS. The rating card is in the ticket page chunk (already lazy). The admin ratings row is in `ticket-fields.tsx` (same chunk). The stats view is its own lazy route with the lazy namespace `ticketRatings`. The dashboard line is in the lazy `admin-home` chunk with `adminHome` texts. The ticket card's texts go into the lazy `tickets` namespace. Nothing goes into `locales/<code>.json`.

## Security and privacy

- **Anti-abuse**: one row per ticket and person (primary key, upsert); only the initiator; only while resolved and for 14 days; 20 writes a minute per user; the comment limited to 1 000 characters (zod and a database check); the 👎 notification at most once per rating; no write from a GET (the email link only opens the page); CSRF and Origin checks as on every write.
- **Comment content**: stored as typed, shown with React text nodes (escaped), never `dangerouslySetInnerHTML` or Markdown, so no HTML or link injection. It is never sent outside Help. CSP ([ADR 0044](../../decisions/0044-enforced-csp-set-by-the-app.md)) needs no change: no new source, no inline script, inline SVG icons only.
- **Who sees it**: every admin (owner decision 2026-10-19), and the rater for their own. Not in payloads of `notification_events` (they are kept and shown in the bell), not in socket events, not in eGrant webhooks, not in the bulk email audience. The server logs only ids, never the comment.
- **Personal data**: the comment may hold personal data. It lives as long as the ticket and the user, and goes with them (cascade). The rater's name is shown to admins only (all of them). The privacy note in [product/tickets.md](../../product/tickets.md) says this, and the hint under the field tells the rater who sees it.
- **Mail scanners and prefetch**: `?rate=1` writes nothing; the rating needs a click in a signed-in session.

## i18n

- **Web, lazy namespaces only**: `tickets` (`tickets.rating.*`: the card, the admin row), `ticketRatings` (new namespace: the stats view, all nine `locales/ticketRatings/<code>.json`), `adminHome` (`adminHome.cards.tickets.satisfaction`, `satisfactionNone`). The new namespace is listed in `withNamespaces` of the new route. Counts use the i18next plural forms the project already uses (`_one`, `_few`, `_many`, `_other`). Dates use the existing `formatCreated` and Intl formatters with the user's language.
- **Server**: `notifications.ticketRated(n)` and the error texts, if any, in all nine `infra/i18n/<code>.ts` (the `ServerTexts` type forces all of them).
- **Register**: the card speaks to the requester, so its sentences are polite and plural-formal: sk/cs "vám", it "Lei" ("Ci faccia sapere se la soluzione Le è stata utile."), sl vikanje ("Sporočite nam, ali vam je rešitev pomagala."), the buttons in the bare form ("Utile", "Koristno"). The full table for all nine languages is in the plan, task 9.
- Terms: "tiket", "žiadateľ", "eGrant" (declined: "tím eGrantu" where the case needs it) as in [wording.md](../../design/wording.md). A new row "Ticket rating" (sk hodnotenie) is added to its table.

## Docs to update (with the implementation)

`product/tickets.md` (a "Rating" section, the privacy note), `product/admin-home.md` (the card line), `product/notifications.md` (`ticket.rated`, the `?rate=1` link), `architecture/data-model.md` (table, index), `architecture/permissions.md`, `architecture/realtime.md` (`ticket:rated`), `architecture/performance.md` (the EXPLAIN cases), `design/wording.md` (the term), `glossary.md` ("Hodnotenie tiketu"), `integrations/mcp.md` (the DTO fields), `roadmap.md` (by the orchestrator).

## End-to-end scenario (`e2e/ticket-rating.spec.ts`; written with the work, run in the final e2e pass after all seven 2026-10-19 specs are implemented)

1. The intake creates a ticket for a new žiadateľ. An admin resolves it.
2. The žiadateľ signs in through the one-click link, opens `/tickets/<id>?rate=1`, sees the card focused, clicks "Nepomohlo", writes a comment and sends it.
3. The admin (the client's manager) gets the `ticket.rated` push or email (Mailpit, after the digest window), opens the ticket and sees "Nepomohlo", the name and the comment live.
4. A client of the same group opens the ticket and sees no rating at all.
5. A second admin who is neither the ticket's riešiteľ nor the client's manager opens the ticket and sees the same rating and comment.
6. The žiadateľ changes the rating to "Pomohlo"; the admin's `/tickets/ratings` shows 1 rating, 100 % satisfaction, and the comment.
7. The ticket's `resolved_at` is moved 15 days back (`withDb` from `e2e/db.ts`, as other specs do): the card is read-only.

## Open questions (with the recommended answer)

1. **May other clients of the group rate too, or only the initiator?** Recommended: **only the initiator.** They asked and they know whether it was solved; other clients' votes on someone else's ticket would be noise. The schema allows more raters later.
2. **How long can a rating be changed?** Recommended: **14 days after resolving**, restarted when the ticket is resolved again. Long enough to notice that a fix did not hold, short enough that the totals settle.
3. **Should the requester get a dedicated "Rate the solution" email with a one-click sign-in link (as ADR 0022), instead of relying on the resolved notification?** Recommended: **not now.** The resolved notification already reaches the initiator (push and digest) and opens the card. A sign-in link in a second email widens ADR 0022's risk (forwarded mail) and needs an ADR-XXXX. Revisit if the response rate stays under 20 % after a month.
4. **Notify on 👍 too?** Recommended: **no**, only 👎, once per rating, to the admin owners. A 👍 shows on the ticket and in the totals.
5. **Can clients see their own organisation's totals?** Recommended: **no.** It is internal feedback for eGrant. A score shown to clients turns into an SLA, which the owner ruled out.
6. **Show a 👎 marker in the admins' ticket lists?** Recommended: **not in this version.** It needs a column in every list row (the list queries change) and the stats view filtered to "Nepomohlo" covers it. Add it if admins ask.
7. **Should `/tickets/ratings` respect "the clients I manage" by default, like the global list?** Recommended: **no, every client by default.** The dashboard line and the stats view should show the same number to every admin; the client select narrows it.
8. **Who sees the comment?** **Answered by the owner (2026-10-19): every admin.** A riešiteľ who is a client (not an admin) does not (decision 4): feedback about eGrant's work stays with eGrant.

## Out of scope

Star scales or several questions, ratings of single answers in the chat, SLA or response times, per-admin rankings, exports, a rating API for eGrant, an AI summary of comments.

## Decisions taken while building (2026-10-19)

- **A second, narrow index for the summary.** The EXPLAIN check showed the 365-day count (half of the volume's ratings) scanning the heap: the list's index `(updated_at, ticket_id, user_id)` is too wide to win. `ticket_ratings_updated_value_idx` `(updated_at, value)` makes it an index-only scan; the list keeps `ticket_ratings_updated_idx`.
- **The raters' names come from the users module** (`getUserNames`, one query per ticket or page) instead of a join of `user` in the list query, so the tickets module touches no other module's table except the `groups` name, the ticket list's existing exception.
- **A bad list cursor answers `400 invalid_filter`**, the code the ticket lists use (the plan said `invalid_cursor`).
- **The `/tickets/ratings` route has no `validateSearch`**: the lazy page validates its search (`ratings-search.ts`), so the entry chunk grows by the route definition only (+0.14 kB).
- **The rate limit is lowered in tests through `config.ticketRatingsPerMinute`** (test-only, like `aiBurstLimits`).
- **The save error text is `tickets.rating.saveFailed`** in the `tickets` namespace: the `forms` namespace had no such key.
- **The notification tests are in `ratings-routes.test.ts`** with the route tests (they need the same setup), not in `notify.test.ts`.
- **The migration** is `0063_ticket_rating` on this branch; the orchestrator renumbers it at integration.
