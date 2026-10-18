# Ticket rating: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** after a ticket is resolved, its initiator rates it 👍/👎 with an optional comment, from the ticket page or from the resolved notification's link. They can change it for 14 days. Admins see the ratings on the ticket, a 30-day line on the dashboard's Tickets card and a stats view `/tickets/ratings`. A 👎 notifies the admin owners once.

**Architecture:** one new table `ticket_ratings` owned by the tickets module, with the rules in `tickets/policy.ts`, the queries in `tickets/ratings.ts` and the routes in a new plugin `tickets/ratings-routes.ts`. The ticket DTO carries the viewer's own rating, and every rating for admins only. Writes go over HTTP; afterwards `ticket:rated` is pushed to the admins' room and the rater's own room. A new notification kind `ticket.rated` goes through the existing pipeline, and it is not an unseen kind. Web: a rating card in the ticket page chunk, a row in the admin details, a dashboard line and a lazy stats route with its own namespace.

**Tech stack:** Fastify, Drizzle and PostgreSQL 17, zod in `@spolu/shared`, React with TanStack Query and Router, i18next lazy namespaces, Vitest, Playwright.

**Spec:** [2026-10-19-ticket-rating-design.md](../specs/2026-10-19-ticket-rating-design.md). Read its "Decisions" and "Open questions" first. If the owner answers an open question differently, change the spec first, then the affected tasks.

**Status:** planned, not started. **Timing (owner instruction, 2026-10-19):** implementation starts only when the orchestrator says so, after the phases now in flight are finished. The e2e spec of task 13 is written with the work, but it runs only in the final e2e pass after all seven 2026-10-19 plans (#169 to #175) are implemented, not in this branch's own runs.

**Owner decisions (2026-10-19):** every admin sees the client's rating comment (spec, "Owner decisions"). `canSeeTicketRatings` is a plain admin check, never narrowed to the ticket's owners or the client's managers; tasks 2, 5, 6 and 13 test it with an admin who is neither.

**Branch:** `feat/ticket-rating` from a fresh `origin/main`. One PR. Migration placeholder `00XX_ticket-rating`: before generating it, check the latest number on `origin/main` (CLAUDE.md, "Migrations"; as of 2026-10-19 it is `0062_night_integration`, and #113 takes `0063`); the orchestrator assigns the final number. No ADR is needed (no new dependency, no new approach). If the owner picks open question 3 (a rating email with a sign-in link), add `ADR-XXXX` and a task for it.

---

## Global Constraints

- **English** in code, comments, docs and commits. **Every new UI text in all nine languages** (sk, en, cs, sl, hr, bg, uk, et, it), in **lazy namespaces only** (`tickets`, `adminHome`, the new `ticketRatings`), never in the eager `locales/<code>.json`. Server texts go into all nine `apps/server/src/infra/i18n/<code>.ts` (the `ServerTexts` type in `types.ts` forces it). Italian uses the formal "Lei" in sentences and the bare imperative on buttons; Slovenian uses vikanje in sentences and the singular imperative on buttons (ADR 0019). Terms come from `docs/design/wording.md`.
- **Test-first** for every server rule and query (`test-driven-development`): write the test, watch it fail for the right reason, then implement.
- **Permissions only through policy functions** (`canRateTicket`, `ratingOpen`, `canSeeTicketRatings`); routes never compare roles inline. The client is never trusted: the web hides the card, and the server refuses anyway.
- **Writes over HTTP; sockets only push after a committed write.** The payload is `{ ticketId, groupId }` and never holds a value or a comment.
- **Module boundaries:** only `modules/tickets/*` touches `ticket_ratings`. Notifications use `recordNotifications` and `requestDelivery` from the notifications service, as `notify.ts` already does.
- **Privacy:** a comment is never in a notification payload, a push, a digest, a socket event, a log line, the MCP allow-list's write routes or an eGrant call. Ratings are visible to every admin (owner decision 2026-10-19) and to their own rater, nobody else.
- **Performance:** indexed queries only (EXPLAIN checks in task 8), keyset pagination of 50, no N+1 (the ticket DTO adds one query; lists are unchanged). The initial JS budget is full: nothing new goes into the entry chunk. Check with the "How to check" steps in `docs/architecture/performance.md`.
- **Design:** start the web tasks (9 to 12) with the `frontend-design` skill (`.claude/skills/frontend-design/`). Icons are inline SVG in `features/tickets/icons.tsx`, not emoji. No visual effects beyond the existing subtle transitions.
- **CSP (ADR 0044):** no new source, no inline script, no `dangerouslySetInnerHTML`. Comments are React text nodes.
- **Tests:** no wall-clock assertions; e2e waits poll with 25 to 30 s deadlines. Server tests use their own database when agents run in parallel (`TEST_DATABASE_URL=.../spolu_test_ticket_rating`).
- **Docs in the same commit** (`update-kb`). Do not edit `docs/roadmap.md`: the orchestrator links plans there.
- **Never push to `main`.** Run `bash scripts/ci.sh` before the PR. It runs e2e: run it only when no other `ci.sh` or `test:e2e` runs (CLAUDE.md, "Tips for agents"), or leave it to whoever merges.

## Review Focus

Reviewers check, in this order:

1. **Leaks.** No route, DTO field, socket event, notification payload, digest or push carries another person's rating or any comment to a non-admin. `ratings` is `null` for every non-admin; `rating.mine` is the actor's own only. The `404` comes before the `403` (no existence leak).
2. **Window and state rules.** A write is refused while the ticket is not resolved, and more than 14 days after `resolved_at`. Reopening and resolving again opens a new window. An admin initiator cannot rate.
3. **Notification spam.** `ticket.rated` is sent only on a change to `down`, at most once per (ticket, person), only to admins who still read the ticket, and never to the rater.
4. **Index use.** The summary and the list read `ticket_ratings_updated_idx` and `tickets_resolved_at_idx`; EXPLAIN shows no sequential scan of `ticket_ratings` or `tickets`.
5. **Bundle.** The entry chunk is unchanged (± 0.1 kB); the stats view is its own lazy chunk; the new namespace loads with its route.
6. **i18n.** Nine languages for every key, the register rules, and the terms from `wording.md`.

---

## File map

| file                                                                                       | change                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/tickets.ts`                                                           | `TICKET_RATING_LIMITS`, `TicketRatingValues`, rating schemas, `TicketDto.rating` and `.ratings`, the summary and list schemas, `TicketEvents.rated` |
| `packages/shared/src/users.ts`                                                             | `ErrorCodes.ticketNotResolved`, `ErrorCodes.ratingClosed`                                                                                           |
| `packages/shared/src/notifications.ts`                                                     | kind `ticket.rated`                                                                                                                                 |
| `packages/shared/src/tickets.test.ts`                                                      | schema tests                                                                                                                                        |
| `apps/server/src/modules/tickets/schema.ts`                                                | `ticketRatings`, `tickets_resolved_at_idx`                                                                                                          |
| `apps/server/src/infra/db/migrations/00XX_ticket-rating.sql` (+ `meta/`)                   | generated                                                                                                                                           |
| `apps/server/src/modules/tickets/policy.ts` (+ `.test.ts`)                                 | `canRateTicket`, `ratingEditableUntil`, `ratingOpen`, `canSeeTicketRatings`                                                                         |
| `apps/server/src/modules/tickets/ratings.ts` (new, + `ratings.test.ts`)                    | `setTicketRating`, `ratingsOfTicket`, `ratingSummarySql`, `getRatingSummary`, `ratingListSql`, `listRatings`                                        |
| `apps/server/src/modules/tickets/service.ts`                                               | `toTicketDto` and `getTicketForActor` take the viewer and fill `rating` and `ratings`                                                               |
| `apps/server/src/modules/tickets/ratings-routes.ts` (new, + `ratings-routes.test.ts`)      | `PUT /tickets/:id/rating`, `GET /tickets/ratings/summary`, `GET /tickets/ratings`                                                                   |
| `apps/server/src/app.ts`                                                                   | register `ticketRatingsRoutes`                                                                                                                      |
| `apps/server/src/modules/tickets/events.ts`                                                | `emitTicketRated`                                                                                                                                   |
| `apps/server/src/modules/tickets/notify.ts` (+ `notify.test.ts`)                           | `notifyTicketRated`                                                                                                                                 |
| `apps/server/src/modules/notifications/{categories,decide,push-content}.ts` (+ tests)      | the `ticket.rated` kind; the `?rate=1` url on `ticket.resolved`                                                                                     |
| `apps/server/src/infra/i18n/{types,sk,en,cs,sl,hr,bg,uk,et,it}.ts`                         | `notifications.ticketRated`                                                                                                                         |
| `apps/server/src/modules/home/{test-volume,explain.test}.ts`                               | seeding and plan checks                                                                                                                             |
| `apps/web/src/features/tickets/api.ts`                                                     | `useRateTicket`, `ratingSummaryQuery`, `ratingsListQuery`                                                                                           |
| `apps/web/src/features/tickets/ticket-rating.tsx` (new, + `.test.tsx`)                     | the rating card                                                                                                                                     |
| `apps/web/src/features/tickets/icons.tsx`                                                  | `ThumbUp`, `ThumbDown`                                                                                                                              |
| `apps/web/src/features/tickets/ticket-page.tsx` (+ test)                                   | mount the card, `useRateParam`                                                                                                                      |
| `apps/web/src/features/tickets/ticket-fields.tsx` (+ `ticket-page.test.tsx`)               | the admins' "Hodnotenie" row                                                                                                                        |
| `apps/web/src/features/tickets/use-ticket-events.ts`                                       | `ticket:rated`                                                                                                                                      |
| `apps/web/src/features/admin-home/cards.tsx` (+ `home-page.test.tsx`)                      | the satisfaction line                                                                                                                               |
| `apps/web/src/features/tickets/ratings-page.tsx` (new, + `.test.tsx`), `ratings-search.ts` | the stats view                                                                                                                                      |
| `apps/web/src/features/tickets/tickets-page.tsx`                                           | the "Hodnotenia" link (admins)                                                                                                                      |
| `apps/web/src/router.tsx`                                                                  | route `/tickets/ratings` (before `/tickets/$ticketId`)                                                                                              |
| `apps/web/src/locales/tickets/*.json`, `adminHome/*.json`, `ticketRatings/*.json` (new)    | texts                                                                                                                                               |
| `e2e/ticket-rating.spec.ts` (new)                                                          | the scenario                                                                                                                                        |
| docs (task 14)                                                                             | see the spec, "Docs to update"                                                                                                                      |

---

### Task 1: Shared schemas, limits, error codes, event and kind

**Files:** modify `packages/shared/src/tickets.ts`, `users.ts`, `notifications.ts`; test `packages/shared/src/tickets.test.ts`.

- [ ] **Step 1: Write the failing tests** in `tickets.test.ts`:

```ts
describe('TicketRatingBodySchema', () => {
  it('takes up or down with no comment', () => {
    expect(TicketRatingBodySchema.parse({ value: 'up' })).toEqual({ value: 'up' });
  });
  it('trims the comment and turns a blank one into null', () => {
    expect(TicketRatingBodySchema.parse({ value: 'down', comment: '  zle  ' }).comment).toBe('zle');
    expect(TicketRatingBodySchema.parse({ value: 'down', comment: '   ' }).comment).toBeNull();
    expect(TicketRatingBodySchema.parse({ value: 'down', comment: null }).comment).toBeNull();
  });
  it('refuses another value and a comment over 1000 characters', () => {
    expect(TicketRatingBodySchema.safeParse({ value: 'meh' }).success).toBe(false);
    expect(
      TicketRatingBodySchema.safeParse({ value: 'up', comment: 'x'.repeat(1001) }).success,
    ).toBe(false);
  });
});
describe('TicketRatingQuerySchema', () => {
  it('defaults to 30 days and takes only 30, 90 or 365', () => {
    expect(TicketRatingQuerySchema.parse({}).days).toBe(30);
    expect(TicketRatingQuerySchema.parse({ days: '365' }).days).toBe(365);
    expect(TicketRatingQuerySchema.safeParse({ days: '7' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail:** `pnpm --filter @spolu/shared test -- tickets` (an import error is the expected failure).
- [ ] **Step 3: Implement** in `tickets.ts`:

```ts
export const TICKET_RATING_LIMITS = { comment: 1000, editDays: 14, pageSize: 50 } as const;
export const TicketRatingValues = ['up', 'down'] as const;
export type TicketRatingValue = (typeof TicketRatingValues)[number];

export const TicketRatingBodySchema = z.object({
  value: z.enum(TicketRatingValues),
  /** Absent: keep the stored comment; null or blank: clear it. */
  comment: z
    .string()
    .max(TICKET_RATING_LIMITS.comment * 2) // raw, before the trim
    .transform((v) => v.trim())
    .pipe(z.string().max(TICKET_RATING_LIMITS.comment))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});
export type TicketRatingBody = z.infer<typeof TicketRatingBodySchema>;

export const TicketRatingSchema = z.object({
  value: z.enum(TicketRatingValues),
  comment: z.string().nullable(),
  ratedAt: z.string(),
});
export const TicketRatingWithRaterSchema = TicketRatingSchema.extend({
  userId: z.string(),
  name: z.string().nullable(),
});
export const TicketRatingViewSchema = z.object({
  mine: TicketRatingSchema.nullable(),
  canRate: z.boolean(),
  editableUntil: z.string().nullable(),
});
export const TicketRatingQuerySchema = z.object({
  days: z.coerce
    .number()
    .pipe(z.union([z.literal(30), z.literal(90), z.literal(365)]))
    .default(30),
  groupId: z.string().max(100).optional(),
  value: z.enum(TicketRatingValues).optional(),
  cursor: z.string().max(300).optional(),
});
export const TicketRatingSummarySchema = z.object({
  days: z.number().int(),
  up: z.number().int(),
  down: z.number().int(),
  resolved: z.number().int(),
  rated: z.number().int(),
});
export const TicketRatingListItemSchema = z.object({
  ticketId: z.string(),
  number: z.number().int(),
  subject: z.string().nullable(),
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
  raterId: z.string(),
  raterName: z.string().nullable(),
  value: z.enum(TicketRatingValues),
  comment: z.string().nullable(),
  ratedAt: z.string(),
});
export const TicketRatingListSchema = z.object({
  items: z.array(TicketRatingListItemSchema),
  nextCursor: z.string().nullable(),
});
```

Add the types (`z.infer`). In `TicketDtoSchema` add `rating: TicketRatingViewSchema` and `ratings: z.array(TicketRatingWithRaterSchema).nullable()`, each with a doc comment ("admins only; null for everyone else"). In `TicketEvents` add `rated: 'ticket:rated'` with a comment (to the admins' and the rater's rooms only). In `users.ts` `ErrorCodes` add `ticketNotResolved: 'ticket_not_resolved'` and `ratingClosed: 'rating_closed'`. In `notifications.ts` add `'ticket.rated'` after `'ticket.resolved'`, with the comment `// 2026-10-19: a 👎 rating (once per rating) to the ticket's admin owners.`

- [ ] **Step 4: Run** `pnpm --filter @spolu/shared test`. It passes. `pnpm typecheck` now fails in the server and web where `TicketDto` and `NOTIFICATION_GROUP_OF` are built. That is expected; tasks 5 and 7 fix it. To keep the branch green between commits, do steps 1 to 4 of task 7 (the kind maps) right after this task.
- [ ] **Step 5: Commit** `feat(shared): ticket rating schemas, codes and the ticket.rated kind`.

### Task 2: Policy functions

**Files:** modify `apps/server/src/modules/tickets/policy.ts`; test `policy.test.ts`.

- [ ] **Step 1: Failing tests** (pure, no database):

```ts
describe('canRateTicket', () => {
  const ticket = { groupId: 'g', requesterUserId: 'u1' };
  it('the initiator who reads the ticket rates it, as a ziadatel or a client', () => {
    expect(canRateTicket(client('u1'), ticket, 'ziadatel')).toBe(true);
    expect(canRateTicket(client('u1'), ticket, 'client')).toBe(true);
  });
  it('nobody else: another client, an admin initiator, a removed initiator', () => {
    expect(canRateTicket(client('u2'), ticket, 'client')).toBe(false);
    expect(canRateTicket(admin('u1'), ticket, null)).toBe(false);
    expect(canRateTicket(client('u1'), ticket, null)).toBe(false);
    expect(canRateTicket(client('u1'), { groupId: null, requesterUserId: 'u1' }, null)).toBe(false);
  });
});
describe('ratingOpen', () => {
  const at = new Date('2026-10-01T10:00:00Z');
  it('is open while resolved and up to 14 days after resolving', () => {
    expect(
      ratingOpen({ status: 'resolved', resolvedAt: at }, new Date('2026-10-15T10:00:00Z')),
    ).toBe(true);
    expect(
      ratingOpen({ status: 'resolved', resolvedAt: at }, new Date('2026-10-15T10:00:01Z')),
    ).toBe(false);
  });
  it('is closed while the ticket is open', () => {
    expect(ratingOpen({ status: 'in_progress', resolvedAt: null }, at)).toBe(false);
  });
});
it('ratingEditableUntil adds 14 days', () => {
  expect(ratingEditableUntil(new Date('2026-10-01T10:00:00Z')).toISOString()).toBe(
    '2026-10-15T10:00:00.000Z',
  );
});
it('canSeeTicketRatings: every admin, nobody else (owner decision 2026-10-19)', () => {
  expect(canSeeTicketRatings(admin('a'))).toBe(true); // any admin, no owner or manager check
  expect(canSeeTicketRatings({ ...admin('f'), finance: true })).toBe(true); // use the file's finance-admin helper if it has one
  expect(canSeeTicketRatings(client('c'))).toBe(false);
});
```

(`admin` and `client` are the file's existing `SessionUser` helpers; add them if the file has none.)

- [ ] **Step 2: Run** `pnpm --filter @spolu/server exec vitest run src/modules/tickets/policy.test.ts`. It fails.
- [ ] **Step 3: Implement** the four functions with the signatures from the spec ("Permissions"). `canRateTicket = !isAdmin(actor) && ticket.requesterUserId === actor.id && canReadTicket(actor, ticket, role)`. `ratingEditableUntil(r) = new Date(r.getTime() + TICKET_RATING_LIMITS.editDays * 86_400_000)`. `ratingOpen = status === 'resolved' && resolvedAt !== null && now <= ratingEditableUntil(resolvedAt)`.
- [ ] **Step 4: Run** the test again. It passes.
- [ ] **Step 5: Commit** `feat(tickets): rating policy`.

### Task 3: Table and migration

**Files:** modify `apps/server/src/modules/tickets/schema.ts`; generate `apps/server/src/infra/db/migrations/00XX_ticket-rating.sql` and its `meta/`.

- [ ] **Step 1:** Add `ticketRatings` exactly as in the spec ("Data model"), and on `tickets` the index `tickets_resolved_at_idx` (`resolved_at desc`, partial `status = 'resolved'`). Import `TicketRatingValue` from `@spolu/shared`.
- [ ] **Step 2:** Check the latest migration number on `origin/main` (`git ls-tree origin/main apps/server/src/infra/db/migrations/ | tail -3`). Then run `pnpm --filter @spolu/server db:generate` and rename the generated file's name part to `ticket-rating` (in the SQL file name and the journal's `tag`), so it reads `00NN_ticket-rating`. Read the SQL: one `CREATE TABLE`, two checks, the PK, two FKs with `ON DELETE cascade`, three `CREATE INDEX`. Nothing else may change.
- [ ] **Step 3:** Write the failing test `ratings.test.ts` → `it('the table refuses a third value and a 1001-character comment')`: insert with raw SQL and expect the `23514` check violation both times. Then `it('deleting the ticket deletes its ratings')`.
- [ ] **Step 4: Run** `TEST_DATABASE_URL=postgres://spolu:spolu@localhost:5432/spolu_test_ticket_rating pnpm --filter @spolu/server exec vitest run src/modules/tickets/ratings.test.ts`. It passes once the migration exists (`test/setup-db.ts` migrates).
- [ ] **Step 5: Commit** `feat(tickets): ticket_ratings table (migration 00XX)`.

### Task 4: Rating service

**Files:** create `apps/server/src/modules/tickets/ratings.ts`; extend `ratings.test.ts`.

Signatures:

```ts
export type RatingWrite = { value: TicketRatingValue; comment?: string | null };
/** Upserts the actor's rating; `turnedDown`: the 👎 notification is due (and is now marked). */
export async function setTicketRating(
  db: Db,
  ticketId: string,
  userId: string,
  body: RatingWrite,
  now: Date,
): Promise<{ turnedDown: boolean }>;
/** Every rating of the ticket, with the rater's name, newest first (one query). */
export async function ratingsOfTicket(db: Db, ticketId: string): Promise<TicketRatingWithRater[]>;
export function ratingSummarySql(q: { since: Date; groupId?: string }): {
  ratings: SQL;
  resolved: SQL;
};
export async function getRatingSummary(
  db: Db,
  q: { days: 30 | 90 | 365; groupId?: string },
  now: Date,
): Promise<TicketRatingSummary>;
export function ratingListSql(q: {
  since: Date;
  groupId?: string;
  value?: TicketRatingValue;
  after?: RatingCursor;
}): SQL;
export async function listRatings(
  db: Db,
  q: TicketRatingQuery,
  now: Date,
): Promise<TicketRatingList>;
export class InvalidRatingCursorError extends Error {}
```

- [ ] **Step 1: Failing tests** (database, the file's own group, ticket and users):
  - `it('setTicketRating inserts, then changes the value and keeps the comment when it is absent')`: set `{ value: 'up', comment: 'ok' }`, then `{ value: 'down' }`. Expect one row with `value 'down'`, `comment 'ok'`, and `updated_at` later than `created_at`.
  - `it('a null comment clears it')`.
  - `it('turnedDown is true once per rating: up→down yes, down→up→down no')`: expect `[false, true, false, false]` for the writes `up`, `down`, `up`, `down`. `down_notified_at` is set after the second.
  - `it('ratingsOfTicket lists every rater with their name, newest first')`.
  - `it('getRatingSummary counts the period, the client, the resolved tickets with an initiator and the rated ones')`: seed 3 rated tickets in the group (2 up, 1 down), 1 resolved and not rated, 1 resolved without `requester_user_id`, 1 rating 40 days old, and 1 rating in another group. Expect `{ days: 30, up: 2, down: 1, resolved: 4, rated: 3 }` with `groupId`; with no `groupId` the other group's rating counts too.
  - `it('listRatings pages by 50 with a cursor and filters by value')`: 55 ratings, page 1 has 50 and a `nextCursor`, page 2 has 5 and `null`; `value: 'down'` returns only those.
  - `it('a bad cursor throws InvalidRatingCursorError')`.
- [ ] **Step 2: Run** the file. It fails.
- [ ] **Step 3: Implement.** Write `setTicketRating` as one statement:

```sql
insert into ticket_ratings as r (ticket_id, user_id, value, comment, created_at, updated_at, down_notified_at)
values ($1, $2, $3, $4, $now, $now, case when $3 = 'down' then $now end)
on conflict (ticket_id, user_id) do update set
  value = excluded.value,
  comment = case when $commentGiven then excluded.comment else r.comment end,
  updated_at = excluded.updated_at,
  down_notified_at = coalesce(r.down_notified_at, case when excluded.value = 'down' then excluded.updated_at end)
returning (down_notified_at = $now) as turned_down
```

(`$commentGiven` is `body.comment !== undefined`.) `turnedDown` is true only when this statement set `down_notified_at`, which is atomic under concurrent writes. The summary's `ratings` part is `select count(*) filter (where r.value='up')::int up, count(*) filter (where r.value='down')::int down from ticket_ratings r [join tickets t on t.id = r.ticket_id and t.group_id = $g] where r.updated_at >= $since`. Its `resolved` part is `select count(*)::int resolved, count(*) filter (where exists (select 1 from ticket_ratings x where x.ticket_id = t.id))::int rated from tickets t where t.status = 'resolved' and t.resolved_at >= $since and t.requester_user_id is not null [and t.group_id = $g]`. The list is keyset on `(r.updated_at, r.ticket_id, r.user_id) < (...)`, `order by r.updated_at desc, r.ticket_id desc, r.user_id desc limit 51`, joined to `tickets`, `left join groups`, `join "user"`. The cursor is base64url of `iso|ticketId|userId`, as `encodeCursor` in `service.ts`.

- [ ] **Step 4: Run** the file. It passes.
- [ ] **Step 5: Commit** `feat(tickets): rating service`.

### Task 5: Ratings in the ticket DTO

**Files:** modify `apps/server/src/modules/tickets/service.ts`; test `ratings.test.ts` (or `routes.test.ts`, whichever the file's helpers fit).

- [ ] **Step 1: Failing tests** (through `GET /api/tickets/:id`):
  - `it('the initiator sees canRate and editableUntil on a resolved ticket, and their own rating')`
  - `it('a client of the group who is not the initiator gets rating { mine: null, canRate: false } and ratings null')`
  - `it('an admin gets every rating with the names and canRate false')`
  - `it('an admin who is neither a riešiteľ of the ticket nor a manager of its client also gets every rating and comment')` (owner decision 2026-10-19)
  - `it('canRate is false 15 days after resolving and on a reopened ticket; mine is still there')`: set `resolved_at` by SQL.
- [ ] **Step 2: Run.** They fail (the fields are missing).
- [ ] **Step 3: Implement.** `toTicketDto(db, row, seesTasks, canAssign, viewer: { actor: SessionUser; role: MemberRole | null; now: Date })` adds `ratingsOfTicket(db, row.id)` to its `Promise.all`, then builds `rating` (`mine` = the actor's row; `canRate = canRateTicket(...) && ratingOpen(row, now)`; `editableUntil` only while `canRate`) and `ratings = canSeeTicketRatings(actor) ? all : null`. A non-admin's copy never holds anyone else's row: filter before building the DTO. Update every caller of `toTicketDto` and `getTicketForActor` (grep for them; `getTicketForActor` passes `new Date()`).
- [ ] **Step 4: Run** the tickets tests (`vitest run src/modules/tickets`). Everything passes. Then `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(tickets): the viewer's rating and the admins' ratings in the ticket`.

### Task 6: Routes and socket event

**Files:** create `apps/server/src/modules/tickets/ratings-routes.ts` and `ratings-routes.test.ts`; modify `events.ts` and `app.ts`.

- [ ] **Step 1: Failing tests** (`buildTestApp`, `loginAs`, the helpers of `assignees.test.ts`):
  - `it('the initiator rates a resolved ticket: 200 with the ticket, and can change it')`
  - `it('404 for an outsider before anything else, 403 for an admin and for another client of the group')`
  - `it('409 ticket_not_resolved on an open ticket, 409 rating_closed 15 days after resolving')`
  - `it('400 for a bad value or a long comment')`
  - `it('429 after 20 writes a minute')`: create the limiter in the plugin options so the test can pass `{ max: 2 }`, the same idea as `config.aiBurstLimits` (performance.md: lower the limits in tests, do not exhaust them).
  - `it('summary and list: every admin, also one who manages no client, gets the comments (403 for a client), 400 for days=7 or a bad cursor')`
  - `it('emits ticket:rated to the admins room and the rater room, not the group room')`: spy on `app.io.to` as the existing events tests do, and assert the rooms `[ADMINS_ROOM, userRoom(rater)]` and the payload `{ ticketId, groupId }`.
- [ ] **Step 2: Run.** They fail.
- [ ] **Step 3: Implement.** The `PUT` order: `readable` → `canRateTicket` (403) → status (409 `ticket_not_resolved`) → `ratingOpen` (409 `rating_closed`) → body (400) → rate limit (429) → `setTicketRating` → `emitTicketRated(app.io, ticket, actor.id)` → if `turnedDown`, `await notifyTicketRated(deps, ticket, actor.id)` (task 7; until then a no-op stub) → `200 getTicketForActor`. The `GET`s use `requireAdmin`, parse `TicketRatingQuerySchema` (400 `validation_failed`) and map `InvalidRatingCursorError` to 400 `invalid_cursor` (the code the ticket list uses). Register in `app.ts`: `await app.register(ticketRatingsRoutes, { prefix: '/api', deps })`, right after `ticketsRoutes`. The static `/tickets/ratings` path does not clash with `/tickets/:id` (find-my-way prefers static segments); a test asserts `GET /api/tickets/ratings` answers the list, not a ticket 404.
- [ ] **Step 4: Run.** Everything passes.
- [ ] **Step 5: Commit** `feat(tickets): rating routes and the ticket:rated event`.

### Task 7: Notifications

**Files:** modify `notifications/categories.ts`, `decide.ts`, `push-content.ts`, `infra/i18n/types.ts` and the nine `<code>.ts`, `tickets/notify.ts`; tests `categories.test.ts`, `push-content.test.ts`, `digest-entries.test.ts`, `tickets/notify.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `categories.test.ts`: `it('ticket.rated belongs to the tickets group')`.
  - `push-content.test.ts`: `it('ticket.rated: "Tiket #123: negatívne hodnotenie", the subject, /tickets/<id>, tag ticket:<id>')`, and `it('ticket.resolved opens /tickets/<id>?rate=1')` (update the existing resolved expectation).
  - `digest-entries.test.ts`: `it('a ticket.rated event is a line in the ticket section')`.
  - `notify.test.ts` (log in only the actors, as the file does):
    - `it('a down rating notifies the admin riešitelia, not the client riešitelia, not the rater')`
    - `it('without an admin riešiteľ it notifies the admins who watch the client (its managers)')`
    - `it('the payload has the ticket fields and value down, never the comment')`
  - `centre.test.ts`: `it('the bell lists ticket.rated for the admin with the push title and /tickets/<id>')` (the notification centre is on main since #155).: assert `Object.keys(payload).sort()` equals `['groupId','number','subject','ticketId','value']`.
- [ ] **Step 2: Run.** They fail.
- [ ] **Step 3: Implement:**
  - `NOTIFICATION_GROUP_OF['ticket.rated'] = 'tickets'`; `decide.ts` rank `'ticket.rated': 2`; `push-content.ts` `else if (i.kind === 'ticket.rated') title = t.ticketRated(n);`; add `'ticket.rated'` to the push tag list at line ~187 that holds `'ticket.resolved'`; the resolved url is `` `/tickets/${enc(id)}${i.kind === 'ticket.resolved' ? '?rate=1' : ''}` ``.
  - `types.ts`: `ticketRated(number: number): string;`. The nine texts: sk `` `Tiket #${n}: negatívne hodnotenie` ``, en `` `Ticket #${n}: negative rating` ``, cs `` `Tiket #${n}: negativní hodnocení` ``, sl `` `Zahtevek #${n}: negativna ocena` ``, hr `` `Tiket #${n}: negativna ocjena` ``, bg `` `Тикет #${n}: отрицателна оценка` ``, uk `` `Тікет #${n}: негативна оцінка` ``, et `` `Pöördumine #${n}: negatiivne hinnang` ``, it `` `Ticket #${n}: valutazione negativa` ``.
  - `notify.ts`:

```ts
/**
 * A 👎 rating (2026-10-19), once per rating (the caller checks `turnedDown`): to the admins among
 * the ticket's owners, else to the admins who watch its client's tickets. Never the comment.
 */
export async function notifyTicketRated(
  deps: AppDeps,
  ticket: TicketRow,
  raterId: string,
): Promise<void>;
```

    Filter with the users module's exported admin check (`listAdmins` ids or `getUserById(...).role`; use whichever export exists, never read `user` directly). Keep `readingIds`. Record with kind `ticket.rated`, payload `{ ...ticketPayload(ticket), value: 'down' }`, then `requestDelivery`.

- Do **not** add the kind to `unseen-kinds.ts`. A test in `unseen.test.ts` asserts `UNSEEN_TICKET_KINDS` does not include `'ticket.rated'`, so the partial index stays valid.
- [ ] **Step 4: Run** `vitest run src/modules/notifications src/modules/tickets src/infra/i18n`. Everything passes (`i18n.test.ts` checks all nine).
- [ ] **Step 5: Commit** `feat(notifications): ticket.rated and the rate link on resolved`.

### Task 8: EXPLAIN checks

**Files:** modify `apps/server/src/modules/home/test-volume.ts` and `explain.test.ts`.

- [ ] **Step 1:** In the volume, after the tickets insert: set `resolved_at = created_at + interval '1 day'` for the resolved tickets, and `requester_user_id` to the group's client (`<p>-c<n>`) for every fourth ticket with a client. Then insert 6 000 ratings on resolved tickets with an initiator (`value` `down` for `i % 3 = 0`, a comment for `i % 4 = 0`, `updated_at` spread over 730 days). Add `'ticket_ratings'` to `HOME_VOLUME_TABLES`. Update the doc comment's counts.
- [ ] **Step 2:** In `explain.test.ts` add `const RATING_TABLES = ['ticket_ratings', 'tickets'];` and in the existing `it`:

```ts
// 2026-10-19: ticket ratings, the dashboard line and the stats view (30 and 365 days, one client).
const since = (d: number) => new Date(Date.now() - d * 86_400_000);
for (const q of [
  { since: since(30) },
  { since: since(365) },
  { since: since(365), groupId: managedIds[0]! },
]) {
  const { ratings, resolved } = ratingSummarySql(q);
  await expectIndexed(tx, ratings, RATING_TABLES);
  await expectIndexed(tx, resolved, RATING_TABLES);
}
await expectIndexed(tx, ratingListSql({ since: since(365) }), RATING_TABLES);
await expectIndexed(
  tx,
  ratingListSql({ since: since(365), groupId: managedIds[0]!, value: 'down' }),
  RATING_TABLES,
);
```

- [ ] **Step 3: Run** `pnpm --filter @spolu/server test:explain` (it rebuilds the home template once). If a plan scans `tickets` for the `groupId` variant, print it with `EXPLAIN_DEBUG=1` and fix the query, not the volume (performance.md: a check must pass on the first seeding). A plain `(group_id, status, resolved_at)` partial index is the fallback. Add it only with the plan as evidence, and note it in the spec.
- [ ] **Step 4:** Run the whole explain suite again: the volume change must not move the other plans. Record the numbers in `performance.md` (task 14).
- [ ] **Step 5: Commit** `test(home): EXPLAIN checks for ticket ratings`.

### Task 9: Web — the rating card for the initiator

Start with the `frontend-design` skill.

**Files:** create `apps/web/src/features/tickets/ticket-rating.tsx` and `ticket-rating.test.tsx`; modify `api.ts`, `icons.tsx`, `ticket-page.tsx`, `use-ticket-events.ts` and `locales/tickets/<nine>.json`.

- [ ] **Step 1: Texts.** Add `rating` to every `locales/tickets/<code>.json`:

| key             | sk                                                             | en                                                                    | cs                                                          | sl                                                             | hr                                                       | bg                                                        | uk                                                       | et                                                                    | it                                                                      |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `title`         | Ako sme vám pomohli?                                           | How did we do?                                                        | Jak jsme vám pomohli?                                       | Kako smo vam pomagali?                                         | Kako smo vam pomogli?                                    | Как Ви помогнахме?                                        | Як ми вам допомогли?                                     | Kuidas me teid aitasime?                                              | Le siamo stati utili?                                                   |
| `intro`         | Tiket je vyriešený. Dajte nám vedieť, či vám riešenie pomohlo. | This ticket is resolved. Let us know whether the solution helped you. | Tiket je vyřešený. Dejte nám vědět, zda vám řešení pomohlo. | Zahtevek je rešen. Sporočite nam, ali vam je rešitev pomagala. | Tiket je riješen. Javite nam je li vam rješenje pomoglo. | Тикетът е решен. Кажете ни дали решението Ви е помогнало. | Тікет вирішено. Повідомте нам, чи допомогло вам рішення. | Pöördumine on lahendatud. Andke meile teada, kas lahendus aitas teid. | Il ticket è risolto. Ci faccia sapere se la soluzione Le è stata utile. |
| `up`            | Pomohlo                                                        | Helpful                                                               | Pomohlo                                                     | Pomagalo je                                                    | Pomoglo je                                               | Помогна                                                   | Допомогло                                                | Aitas                                                                 | Utile                                                                   |
| `down`          | Nepomohlo                                                      | Not helpful                                                           | Nepomohlo                                                   | Ni pomagalo                                                    | Nije pomoglo                                             | Не помогна                                                | Не допомогло                                             | Ei aidanud                                                            | Non utile                                                               |
| `commentLabel`  | Chcete nám niečo odkázať? (nepovinné)                          | Anything you want to tell us? (optional)                              | Chcete nám něco vzkázat? (nepovinné)                        | Bi nam želeli kaj sporočiti? (neobvezno)                       | Želite li nam nešto poručiti? (neobavezno)               | Искате ли да ни кажете нещо? (по желание)                 | Хочете щось нам передати? (необов'язково)                | Kas soovite meile midagi öelda? (valikuline)                          | Vuole dirci qualcosa? (facoltativo)                                     |
| `commentHint`   | Komentár uvidí iba tím eGrant.                                 | Only the eGrant team sees your comment.                               | Komentář uvidí jen tým eGrant.                              | Komentar vidi samo ekipa eGrant.                               | Komentar vidi samo tim eGranta.                          | Коментарът се вижда само от екипа на eGrant.              | Коментар бачить лише команда eGrant.                     | Kommentaari näeb ainult eGranti meeskond.                             | Solo il team eGrant vede il Suo commento.                               |
| `send`          | Odoslať                                                        | Send                                                                  | Odeslat                                                     | Pošlji                                                         | Pošalji                                                  | Изпрати                                                   | Надіслати                                                | Saada                                                                 | Invia                                                                   |
| `cancel`        | Zrušiť                                                         | Cancel                                                                | Zrušit                                                      | Prekliči                                                       | Odustani                                                 | Отказ                                                     | Скасувати                                                | Tühista                                                               | Annulla                                                                 |
| `thanks`        | Ďakujeme za hodnotenie.                                        | Thank you for your feedback.                                          | Děkujeme za hodnocení.                                      | Hvala za oceno.                                                | Hvala na ocjeni.                                         | Благодарим за оценката.                                   | Дякуємо за оцінку.                                       | Täname hinnangu eest.                                                 | Grazie per la Sua valutazione.                                          |
| `editableUntil` | Hodnotenie môžete zmeniť do {{date}}.                          | You can change your rating until {{date}}.                            | Hodnocení můžete změnit do {{date}}.                        | Oceno lahko spremenite do {{date}}.                            | Ocjenu možete promijeniti do {{date}}.                   | Можете да промените оценката до {{date}}.                 | Ви можете змінити оцінку до {{date}}.                    | Hinnangut saate muuta kuni {{date}}.                                  | Può modificare la valutazione fino al {{date}}.                         |
| `edit`          | Upraviť                                                        | Edit                                                                  | Upravit                                                     | Uredi                                                          | Uredi                                                    | Редактирай                                                | Редагувати                                               | Muuda                                                                 | Modifica                                                                |
| `yours`         | Vaše hodnotenie: {{value}}                                     | Your rating: {{value}}                                                | Vaše hodnocení: {{value}}                                   | Vaša ocena: {{value}}                                          | Vaša ocjena: {{value}}                                   | Вашата оценка: {{value}}                                  | Ваша оцінка: {{value}}                                   | Teie hinnang: {{value}}                                               | La Sua valutazione: {{value}}                                           |
| `closed`        | Hodnotenie sa už nedá zmeniť.                                  | The rating can no longer be changed.                                  | Hodnocení už nelze změnit.                                  | Ocene ni več mogoče spremeniti.                                | Ocjena se više ne može promijeniti.                      | Оценката вече не може да се промени.                      | Оцінку вже не можна змінити.                             | Hinnangut ei saa enam muuta.                                          | La valutazione non può più essere modificata.                           |
| `row`           | Hodnotenie                                                     | Rating                                                                | Hodnocení                                                   | Ocena                                                          | Ocjena                                                   | Оценка                                                    | Оцінка                                                   | Hinnang                                                               | Valutazione                                                             |
| `none`          | Zatiaľ bez hodnotenia                                          | Not rated yet                                                         | Zatím bez hodnocení                                         | Še brez ocene                                                  | Još bez ocjene                                           | Все още без оценка                                        | Ще без оцінки                                            | Veel hindamata                                                        | Non ancora valutato                                                     |

The save error reuses the existing "Nepodarilo sa uložiť. Skúste to znova." key of the `forms` namespace (loaded by the ticket route). A native speaker or the wording pass checks the cs, sl, hr, bg, uk, et and it rows before the merge; they follow the register rules above.

- [ ] **Step 2: Failing tests** (`ticket-rating.test.tsx`, with the `test-api.ts` helpers of the folder):
  - `it('shows the question and two buttons when the viewer can rate')`
  - `it('a click on Nepomohlo sends PUT { value: "down" } at once and opens the comment field')`: assert the request body has no `comment` key.
  - `it('sends the comment, then shows the thanks and the date until which it can change')`
  - `it('Upraviť reopens the field with the stored comment; Zrušiť closes it without a request')`
  - `it('read-only after the window: "Vaše hodnotenie: Pomohlo", no buttons')`
  - `it('renders nothing for a viewer who cannot rate and has no rating')`
  - `it('a 409 rating_closed shows the closed text and refetches the ticket')`
  - `it('a comment with <b>tags</b> and a link shows as plain text')`
  - `ticket-page.test.tsx`: `it('?rate=1 scrolls to the card, focuses its first button and leaves the URL')`, and `it('?rate=1 does nothing for an admin')`.
- [ ] **Step 3: Run** `pnpm --filter @spolu/web exec vitest run src/features/tickets`. They fail.
- [ ] **Step 4: Implement.** `useRateTicket(id)` in `api.ts`: `apiSend('PUT', `/tickets/${enc(id)}/rating`, body, TicketDtoSchema)` with `onSuccess: store`, like `useSetTicketProject`. `ThumbUp` and `ThumbDown` are 16 px stroke icons with `aria-hidden`. `TicketRating({ ticket })` renders the states from the spec (UX): buttons with `aria-pressed`, the textarea with `maxLength={1000}` and a counter from 900, the date through the existing `formatCreated` (day only). Mount it in `TicketPage` between `<UnseenBanner>` and the two-column block, as `<section id="ticket-rating" aria-labelledby=...>`. Add `useRateParam(ticket)`, built like `useTimeParam`: delete `search.rate` with `replace`, then if `ticket.rating.canRate`, `document.getElementById('ticket-rating')?.scrollIntoView({ block: 'center' })` and focus the first button. In `use-ticket-events.ts` listen to `TicketEvents.rated`: invalidate `ticketQuery(ticketId)` and `['tickets', 'ratings']`.
- [ ] **Step 5: Run** the tests. They pass. Then `pnpm --filter @spolu/web build` and compare the entry chunk with `origin/main` (performance.md, "How to check"): it must not grow.
- [ ] **Step 6: Commit** `feat(web): rate a resolved ticket`.

### Task 10: Web — the admins' ratings row

**Files:** modify `ticket-fields.tsx`; test `ticket-page.test.tsx`.

- [ ] **Step 1: Failing tests:**
  - `it('an admin sees each rating with the name, the date and the comment under Vyriešený')`
  - `it('a resolved ticket without ratings shows "Zatiaľ bez hodnotenia" to an admin')`
  - `it('a client of the group never sees the row (ratings null)')`
- [ ] **Step 2: Run.** They fail.
- [ ] **Step 3: Implement** a `<Row label={t('tickets.rating.row')}>` after the resolved row, shown when `ticket.ratings !== null && (ticket.status === 'resolved' || ticket.ratings.length > 0)`. The comment goes in `<p className="whitespace-pre-line text-muted-foreground">`.
- [ ] **Step 4: Run.** They pass.
- [ ] **Step 5: Commit** `feat(web): ratings on the ticket for admins`.

### Task 11: Web — the dashboard line

**Files:** modify `features/admin-home/cards.tsx` (and `api.ts` if the card's queries live there), `locales/adminHome/<nine>.json`; test `home-page.test.tsx`.

- [ ] **Step 1: Texts** in `adminHome.cards.tickets`: `satisfaction` sk "Spokojnosť za 30 dní: {{percent}} % · {{count}} hodnotení" with the plural forms `_one` "{{count}} hodnotenie", `_few` "{{count}} hodnotenia", `_many` and `_other` "{{count}} hodnotení". en "Satisfaction, last 30 days: {{percent}}% · {{count}} ratings" (`_one` "1 rating"). Also `satisfactionNone`, sk "Spokojnosť za 30 dní: zatiaľ bez hodnotení", en "Satisfaction, last 30 days: no ratings yet". Translate the other seven following `wording.md` (the percent sign and its spacing as the language writes it: sk, cs, sl, hr, bg, uk, et with a space; en and it without).
- [ ] **Step 2: Failing tests:**
  - `it('the Tickets card shows the 30-day satisfaction line')`: mock summary `{ up: 12, down: 2 }`, expect "86 %" and "14 hodnotení".
  - `it('with no ratings it says so')`
  - `it('a failed summary hides the line and leaves the card working')`
- [ ] **Step 3: Run.** They fail.
- [ ] **Step 4: Implement** `ratingSummaryQuery({ days: 30 })` (`staleTime: 5 * 60_000`, key `['tickets', 'ratings', 'summary', 30, null]`), and a third `<span>` in `useTicketsCard`'s `subline`, shown only when the query succeeded. Percent: `Math.round((100 * up) / (up + down))`.
- [ ] **Step 5: Run.** They pass.
- [ ] **Step 6: Commit** `feat(web): satisfaction line on the Tickets card`.

### Task 12: Web — the stats view `/tickets/ratings`

Start with the `frontend-design` skill.

**Files:** create `features/tickets/ratings-page.tsx`, `ratings-page.test.tsx`, `ratings-search.ts`, `locales/ticketRatings/<nine>.json`; modify `router.tsx` and `tickets-page.tsx`.

- [ ] **Step 1: Texts** (`ticketRatings` namespace, sk / en; translate the other seven by `wording.md`): `title` "Hodnotenia tiketov" / "Ticket ratings"; `back` "Späť" / "Back"; `period.30` "30 dní" / "30 days"; `period.90` "90 dní" / "90 days"; `period.365` "12 mesiacov" / "12 months"; `client.all` "Všetci klienti" / "All clients"; `value.all` "Všetky" / "All"; `value.up` "Pomohlo" / "Helpful"; `value.down` "Nepomohlo" / "Not helpful"; `summary.up` "Pomohlo" / "Helpful"; `summary.down` "Nepomohlo" / "Not helpful"; `summary.satisfaction` "Spokojnosť" / "Satisfaction"; `summary.response` "Odozva" / "Response rate"; `summary.responseHint` "Podiel vyriešených tiketov, ktoré žiadateľ ohodnotil." / "Share of resolved tickets the requester rated."; `empty` "Za toto obdobie nie sú žiadne hodnotenia." / "No ratings in this period."; `more` "Zobraziť ďalšie" / "Show more"; `error` "Hodnotenia sa nepodarilo načítať. Skúste to znova." / "Could not load the ratings. Try again."; `link` "Hodnotenia" / "Ratings" (used on `/tickets`; it goes into `tickets.global.ratingsLink` so the global view does not load this namespace).
- [ ] **Step 2: Failing tests:**
  - `it('shows the four numbers and the list for the default 30 days')`
  - `it('the period, client and value filters go into the URL and refetch')`
  - `it('"Zobraziť ďalšie" loads the next page')`
  - `it('the satisfaction is "–" with no ratings')`
  - `it('a non-admin gets the not-found page')`: the route's `beforeLoad` uses the existing admin guard.
  - `tickets-page.test` (or `ticket-list.test.tsx`): `it('the global view links to Hodnotenia for admins')`.
- [ ] **Step 3: Run.** They fail.
- [ ] **Step 4: Implement.** Add a route `/tickets/ratings`, declared before `/tickets/$ticketId` in `router.tsx`, using the existing admin guard pattern of the admin-only routes: `lazyRouteComponent(withNamespaces(['ticketRatings', 'tickets'], () => import('@/features/tickets/ratings-page')), 'RatingsPage')`, with `validateSearch` from `ratings-search.ts` (`days`, `groupId`, `value`, remembered like the other lists). Use `useInfiniteQuery(ratingsListQuery(filter))`. The client select uses the existing groups list query that the global view's client filter uses. Rows link to `/tickets/$ticketId`. Comments are clamped with `line-clamp-3` and expand on click (a `<button aria-expanded>`).
- [ ] **Step 5: Run** the tests and `pnpm --filter @spolu/web build`. `ratings-page` must be its own chunk and the entry chunk unchanged.
- [ ] **Step 6: Commit** `feat(web): ticket ratings view for admins`.

### Task 13: e2e spec (written now, run in the final e2e pass)

**Files:** create `e2e/ticket-rating.spec.ts`.

- [ ] **Step 1:** Write the scenario from the spec ("End-to-end scenario"), copying the setup of `e2e/ticket-link.spec.ts`: the intake with `KEY`, `waitForMessage`, a fresh context for the žiadateľ through the one-click link. Then:
  - an admin resolves the ticket over the API;
  - the žiadateľ opens `/tickets/<id>?rate=1`; `expect(page.getByRole('button', { name: 'Pomohlo' })).toBeFocused()` and the URL has no `rate`;
  - click "Nepomohlo", fill the comment, "Odoslať", then "Ďakujeme za hodnotenie.";
  - the admin's page shows "Nepomohlo" and the comment without a reload (`ticket:rated`);
  - a second admin who is neither the ticket's riešiteľ nor the client's manager sees the same rating and comment;
  - a client of the group (a second context) sees no "Hodnotenie" row and no comment text;
  - the žiadateľ switches to "Pomohlo"; the admin's `/tickets/ratings` shows "100 %" and the comment;
  - `withDb((sql) => sql\`update tickets set resolved_at = now() - interval '15 days' where id = ${id}\`)`, then reload: "Vaše hodnotenie: Pomohlo", no buttons.
Use unique addresses (`e2e-rate-${stamp}@example.com`).
- [ ] **Step 2:** Run only the TypeScript check (`pnpm typecheck` covers `e2e/`) and `pnpm lint`. **Do not run** `pnpm test:e2e` in this branch unless the orchestrator says so: the owner wants the final e2e run after all seven 2026-10-19 plans are implemented.
- [ ] **Step 3: Commit** `test(e2e): ticket rating scenario`.

### Task 14: Docs (`update-kb`) and the PR

- [ ] **Step 1:** Run the `update-kb` skill. Update: `product/tickets.md` (a "Rating" section: who, when, the 14 days, what admins see, the privacy note; the phase line), `product/admin-home.md` (the card line), `product/notifications.md` (`ticket.rated`, the `?rate=1` link), `architecture/data-model.md` (`ticket_ratings`, `tickets_resolved_at_idx`), `architecture/permissions.md` (matrix row, paragraph), `architecture/realtime.md` (`ticket:rated` and its rooms), `architecture/performance.md` (the EXPLAIN cases with the measured times and the bundle numbers), `design/wording.md` (row "Ticket rating": sk hodnotenie, en rating, cs hodnocení, sl ocena, hr ocjena, bg оценка, uk оцінка, et hinnang, it valutazione), `glossary.md`, `integrations/mcp.md` (the new DTO fields, and that rating is not exposed as a tool). Set the spec's status to "built", and record any decision taken while building in the spec. Not `roadmap.md`.
- [ ] **Step 2:** `bash scripts/check-docs.sh origin/main`: no warning.
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test`, then `bash scripts/ci.sh` when no other run is going (it includes e2e; if the orchestrator holds e2e for the final pass, say so in the PR and run everything but e2e).
- [ ] **Step 4:** Push `feat/ticket-rating` and open the PR (body: what, the spec link, the migration number to assign, the bundle numbers, "e2e written, run in the final pass"; it ends with the Claude Code line). Never push to `main`.

---

## Self-review checklist (for the implementer, before the PR)

- [ ] A client riešiteľ's `GET /api/tickets/:id` has `ratings: null` and `rating.mine: null` (test in task 5).
- [ ] No comment in `notification_events.payload` (task 7 test), in socket payloads (task 6 test) or in logs (grep `request.log` in `ratings-routes.ts`).
- [ ] `ticket.rated` is not in `unseen-kinds.ts`, and migration 0051's partial index is untouched.
- [ ] Nine languages for every new key; `pnpm --filter @spolu/web test -- locales` and the server's `i18n.test.ts` pass.
- [ ] Entry chunk unchanged; `ratings-page` in its own chunk.
- [ ] The EXPLAIN suite is green on the first seeding.
