# Personal calendar subscription (ICS feed) — design

Date: 2026-10-19. Status: draft, waiting for the owner's review. Plan: [2026-10-19-ics-calendar.md](../plans/2026-10-19-ics-calendar.md). ADR: ADR-XXXX (placeholder, "Personal calendar feed: a derived secret URL, expanded call occurrences, a content ETag"). Migration: `00XX_ics-calendar` (the orchestrator assigns the number).

## 1. Goal

Every person of Help subscribes once to **their own calendar feed** (iCalendar over HTTPS, RFC 5545) in Google Calendar, Outlook or Apple Calendar, and from then on sees their Help dates there without exporting anything:

- **project events** (`project_events`, an all-day date per event),
- **task deadlines** (`tasks.due_date`, all-day),
- **calls** (knowledge items of type `meeting`, with their start; recurring series from PR #165 / ADR 0049 included as their individual calls).

Today Help has only one-off exports: the reminders' `GET /api/reminders/…/calendar.ics` (one subject, a snapshot) and the Teams public page `/m/<token>` (one call). Neither follows later changes. The feed does: the calendar app polls the URL, and every poll answers with what the person may read **at that moment**.

Out of scope: writing back from the calendar (the feed is read-only), CalDAV, a per-group or shared team feed, reminders' own times as events (they already notify in Help), free/busy.

## 2. Users and roles

| Who | Gets a feed | Project events | Task deadlines | Calls |
|---|---|---|---|---|
| Admin, superadmin | yes | groups of their scope: the clients they manage plus the admin group; every active group when they manage none (as the global lists, `managedGroupIdsOf`) | tasks they are assigned to, in any active group; optionally (switch, off by default) every open task with a deadline in the clients they manage | calls of their scope; public and admins-only |
| Client (active `client` membership) | yes | every active group they are a client of | tasks they are assigned to there | public calls of those groups |
| Žiadateľ only (no client membership) | no: the card is hidden, the API answers 403 | — | — | — |

- **Decision: tasks for admins = assigned only, by default.** An admin managing 20 clients would otherwise get hundreds of deadlines. The switch "Termíny všetkých úloh klientov, ktorých spravujem" adds the managed clients' open tasks with a deadline (an admin who manages nobody gets nothing extra from it: "all clients" would be the whole office's board). Clients never see the switch; the server ignores it for them.
- Completed tasks are left out (`completed_at is null`). A task moved out of Completed comes back on the next poll.
- Events of **archived projects** are left out (the timeline also hides them by default).
- **Deactivated groups** (`groups.deactivated_at is not null`, ADR 0038) give nothing, to anyone, from the next poll on. The admin group is never deactivated.

## 3. UX

The feed is managed in **Nastavenia** (`/settings`), a new card **Kalendár** between "Upozornenia" and "Uložené odpovede", for admins and clients. Its code and texts are a lazy chunk and the lazy namespace `calendarFeed`, loaded only when the settings route renders the card (as `McpSection`). Slovak is the source language; the other eight follow in the plan (it and sl in the formal register).

### 3.1 No feed yet

> **Kalendár**
> Pridajte si termíny z Help do svojho kalendára (Google, Outlook, Apple). Kalendár sa obnovuje sám, zvyčajne raz za niekoľko hodín.
>
> Čo sa má zobrazovať:
> ☑ Udalosti projektov
> ☑ Termíny mojich úloh
> ☐ Termíny všetkých úloh klientov, ktorých spravujem *(admins only)*
> ☑ Hovory
>
> [ Vytvoriť odkaz na kalendár ]

### 3.2 A feed exists

> **Kalendár**
> Odkaz na odber
> `https://help.egrant.sk/api/public/calendar/Xy…Q/help.ics` [ Kopírovať ] → "Skopírované"
> [ Pridať do Google Kalendára ] [ Pridať do Apple alebo Outlook ]
> ⚠ Kto má tento odkaz, vidí vaše termíny bez prihlásenia. Nezdieľajte ho.
> Naposledy načítané kalendárom: 19. 10. 2026 14:05 / "Kalendár odkaz zatiaľ nenačítal."
>
> (the same four checkboxes; a change saves at once, "Uložené")
>
> [ Vytvoriť nový odkaz ] [ Zrušiť odber ]

- **Pridať do Google Kalendára** opens `https://calendar.google.com/calendar/r?cid=<webcal URL, encoded>` in a new tab; **Pridať do Apple alebo Outlook** is the `webcal://` form of the URL (the system hands it to the default calendar app). Both are plain links (`rel="noopener noreferrer"`), no script, nothing for the CSP to allow.
- **Vytvoriť nový odkaz** asks (native dialog sheet, ADR 0020): "Vytvoriť nový odkaz? Starý odkaz prestane fungovať. V kalendároch, ktoré ho používajú, ho treba nahradiť novým." [Vytvoriť nový odkaz] [Zrušiť].
- **Zrušiť odber** asks: "Zrušiť odber kalendára? Odkaz prestane fungovať. Termíny z Help zmiznú z kalendára, keď ho kalendár nabudúce obnoví (alebo keď odber odstránite v kalendári)." [Zrušiť odber] [Späť].
- Errors: the standard error toast; 429 says "Príliš veľa pokusov. Skúste to o chvíľu."
- The link can be shown again at any time (it is derived, not stored; §7), so the card has no "shown once" warning.
- The card is a plain egrant card (`frontend-design` skill first, as every screen): no new visual pattern; the URL in a read-only `Input` with the copy button, as the MCP token reveal.

### 3.3 In the calendar

- Calendar name: "Help – Mária Nováková" (`X-WR-CALNAME`, the user's name, server text `calendarFeed.name`).
- **Project event**: all-day on `occurs_on`. SUMMARY "Projekt Lúky 2026 · Odovzdanie žiadosti"; for an admin prefixed with the client: "Obec Lúky: Projekt Lúky 2026 · Odovzdanie žiadosti". DESCRIPTION: the event's description (first 1 000 characters) and the link `/groups/<g>/overview?event=<id>`.
- **Task deadline**: all-day on `due_date`. SUMMARY "Termín: <title>" (the existing `reminders.deadlineEvent` text), admins with the client prefix. DESCRIPTION: the task's description (first 1 000 characters) and `/groups/<g>/tasks/<id>`.
- **Call**: timed, from `starts_at`; its end is the Teams meeting's length when the call has a Teams link (`teams_meeting_links.duration_minutes`), else **60 minutes**. SUMMARY "Hovor: <title>" (admins: with the client prefix). LOCATION: the call's meeting link when set (Teams or other). DESCRIPTION: only the link to `/groups/<g>/knowledge?k=<id>` and the meeting link: **no notes, no transcript, no summary** (the feed may sit in a shared family or work calendar).
- No alarms (`VALARM`) in the feed: Help already notifies through its own reminders; calendar alarms on top would double them.
- Texts in the feed are in the user's profile language (`user.language`), the server texts of `apps/server/src/infra/i18n/<code>.ts`.

## 4. Data model

One new table in a new module `calendar` (`apps/server/src/modules/calendar/schema.ts`), migration `00XX_ics-calendar`:

```
calendar_feeds
  user_id          text PK, FK user(id) on delete cascade   -- one feed per person
  nonce            text not null                             -- 16 random bytes, base64url
  token_hash       text not null, unique                     -- SHA-256 hex of the derived token
  include_events   boolean not null default true
  include_tasks    text not null default 'assigned'          -- 'none' | 'assigned' | 'managed'
  include_calls    boolean not null default true
  last_fetched_at  timestamptz(3)                            -- throttled, once an hour at most
  created_at       timestamptz(3) not null default now()
  updated_at       timestamptz(3) not null default now()
  check (include_tasks in ('none', 'assigned', 'managed'))
```

- **Revoking deletes the row**; **rotating** writes a new `nonce` and `token_hash`.
- The unique index on `token_hash` is the fetch's only lookup; `user_id` is the PK (the FK leads an index, as `foreign-key-indexes.test.ts` asks).
- One index for the admins' "all tasks of my managed clients" option: `tasks_group_due_open_idx on tasks (group_id, due_date) where completed_at is null and due_date is not null` (tasks module schema, same migration). The other reads use existing indexes (§8).

No change to the knowledge, projects or groups tables.

## 5. API

Signed-in routes (the person's own feed only; every write is HTTP, CSRF-guarded as usual):

| Route | Body | Answer |
|---|---|---|
| `GET /api/me/calendar-feed` | — | 200 `{ feed: CalendarFeed \| null }` |
| `PUT /api/me/calendar-feed` | `{ include: { events: boolean, tasks: 'none' \| 'assigned' \| 'managed', calls: boolean } }` | 201 `{ feed }` when created, 200 when the settings changed |
| `POST /api/me/calendar-feed/rotate` | — | 200 `{ feed }` with the new URL; 404 `not_found` without a feed |
| `DELETE /api/me/calendar-feed` | — | 204; 404 `not_found` without a feed |

`CalendarFeed` (zod in `packages/shared/src/calendar-feed.ts`): `{ url: string, webcalUrl: string, googleUrl: string, include: CalendarFeedInclude, createdAt: string, lastFetchedAt: string | null }`. A client sending `tasks: 'managed'` gets it stored as `'assigned'` (clamped by the policy, not refused, so a client's form never errors).

Public route (no session; the token is the credential):

`GET /api/public/calendar/:token/help.ics`

- 200 `text/calendar; charset=utf-8`, `Content-Disposition: inline; filename="help.ics"`, `Cache-Control: private, max-age=900`, `ETag: "<hash>"`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`.
- 304 with an empty body when `If-None-Match` equals the ETag.
- 404 `not_found` for a malformed, unknown, rotated or revoked token and for a disabled user (indistinguishable).
- 429 `rate_limited`: 60 a minute per IP and 20 a minute per token (Google polls from many addresses, so the per-token limit is the one that protects).
- `HEAD` is answered by Fastify's automatic HEAD route with the same headers.

None of these routes is in the MCP allowlist (ADR 0033): an AI assistant cannot read or reveal the feed URL.

## 6. Permissions

`apps/server/src/modules/calendar/policy.ts`:

- `canUseCalendarFeed(actor, actorGroupIds)`: `isAdmin(actor) || (actor.role === 'client' && actorGroupIds.length > 0)`. Guards the four `/me` routes (403 `forbidden` otherwise; no session 401).
- `canIncludeManagedTasks(actor)`: `isAdmin(actor)`; a client's `'managed'` is stored as `'assigned'`.

**At fetch time** the feed is built for the token's owner read fresh, exactly like a session (`toSessionUser`: role, disabled). Nothing is decided when the feed is created:

1. `readable` = admin: every active group; client: `clientGroupIds(user)` minus deactivated groups (groups service `activeGroupLabels`, §9).
2. `scope` (events, calls, managed tasks) = admin: `managedGroupIdsOf(user)` ∩ active, or every active group when that is empty; client: `readable`.
3. Each source module returns rows only from the group ids it is given, and the calendar module re-checks every row with that module's own policy function before it becomes an event: `canReadProjects` (events), `canUseBoard` (tasks), `canReadItem` (calls: an admins-only call reaches admins only). The SQL filter is the performance path; the policy call is the rule (`permissions.md`: "only through each module's policy functions").
4. A client who loses their last client membership gets an empty calendar (200, no events), so their calendar app clears the dates instead of showing an error forever; a disabled account gets 404.
5. `deactivateUser` (users service) deletes the person's feed, as it revokes MCP tokens: an admin added back makes a new link.

## 7. Security and privacy

- **Token.** `token = base64url(HMAC-SHA256(APP_SECRET, "calendar-feed\0" + userId + "\0" + nonce))`, the full 32 bytes: 43 characters, 256 bits. The database holds the nonce and `sha256(token)`, never the token; the settings card can still show the link again (the Teams public page's pattern, `teams/calendar-token.ts`). A fetch finds the row by the hash, then compares with the token derived from the row in constant time. Rotating `APP_SECRET` breaks every feed link (as every Teams calendar link); the deploy runbook says so.
- **The token never reaches a log.** Fastify logs `req.url` of every request; a request serializer in `app.ts` replaces the token segment of `/api/public/calendar/<token>/…` with `:token` (the same treatment `redactUrl` gives CSP reports). A test captures the log stream (`buildApp({ logStream })`) and asserts the token is absent.
- **Minimal content.** Calls carry no notes or transcript; tasks and events carry their description (the person reads it in Help anyway), cut to 1 000 characters. Mentions in descriptions are rendered as in the reminders export (`@?` for a name the reader may not see, `permissions.md`).
- **Email on create and rotate.** The owner gets "Vytvorili ste odkaz na odber kalendára" (server texts, nine languages), as with a new MCP token, so a link made with a stolen session gets noticed. Not on settings changes or revoke.
- **CSP (ADR 0044).** The feed is not HTML; the `onSend` hook still sets the app's CSP, which does no harm. The settings card uses only links, no new source.
- Brute force: 256-bit tokens, a 404 for every failure, and the per-IP limit.

## 8. Performance

A feed is polled by a calendar server every 15 minutes to 24 hours per subscriber; eGrant has a few hundred people. Each poll costs one token lookup and at most four indexed reads, and answers 304 when nothing changed.

- **Window.** Dated items (events, deadlines) from 30 days before to 365 days after today in Europe/Bratislava (`bratislavaDay`); calls from 30 days back to 365 days ahead (series calls exist only 60 days ahead, ADR 0049).
- **Caps instead of pages.** An ICS feed cannot be paged. Each source returns at most **1 000 rows**, in date order from the window start (so a cut drops the farthest future); a cut is logged at `warn` with the user id.
- **Reads:**
  - events: `project_events_group_occurs_idx (group_id, occurs_on, id)` with `group_id = any($ids)` and the date range, joined to `projects` by its key for the name and `status = 'active'`;
  - assigned tasks: `task_assignees_user_id_idx` → `tasks` by PK, `due_date` in range, `completed_at is null`;
  - managed tasks: the new `tasks_group_due_open_idx`;
  - calls: `knowledge_meetings_starts_at_idx` on the window joined to `knowledge_items` by PK and filtered by group; the Teams lengths with one `in (...)` read of `teams_meeting_links` by its PK.
  - EXPLAIN checks (ADR 0040): events and tasks on the `projects` volume, calls on a new small `calendar` volume (`calendar/test-volume.ts`: 200 groups, 40 000 calls); no sequential scan of `project_events`, `tasks`, `task_assignees`, `knowledge_meetings`, `knowledge_items`.
- **No N+1**: four statements per feed whatever its size, plus the group labels (one statement) and the Teams lengths (one).
- **ETag.** The body is deterministic: no `METHOD`, `DTSTAMP` is each event's own `updated_at`, events sorted by (start, UID). The ETag is the first 22 base64url characters of the body's SHA-256; a poll with a matching `If-None-Match` gets 304 and no body. The database work is still done per poll (correct permissions beat a stale cache); it is bounded by the caps.
- `last_fetched_at` is written at most once an hour per feed (a conditional update, like MCP's `last_used_at`).
- `REFRESH-INTERVAL;VALUE=DURATION:PT1H` and `X-PUBLISHED-TTL:PT1H` ask clients to poll hourly (Apple and Outlook honour it; Google polls on its own schedule).
- **Web**: the card is a lazy chunk with the lazy `calendarFeed` namespace; the initial JS must not grow by more than 0.05 kB (only the `lazy()` import in `routes/settings.tsx`).

## 9. How the modules talk

The new module `calendar` owns `calendar_feeds`, the routes and the feed assembly. It reads other modules only through exported functions (new ones marked ✚):

- groups: ✚ `activeGroupLabels(db, ids: string[] | 'all'): Promise<Map<string, string>>` (non-deactivated groups, id → name); `clientGroupIds`; knowledge `managedGroupIdsOf`.
- projects: ✚ `feedEvents(db, { groupIds, from, to, limit })` in `projects/feed.ts`.
- tasks: ✚ `feedAssignedDeadlines(db, { userId, groupIds, from, to, limit })` and ✚ `feedGroupDeadlines(db, { groupIds, from, to, limit })` in `tasks/feed.ts`.
- knowledge: ✚ `feedCalls(db, { groupIds, adminsOnly: boolean, from, to, limit })` in `knowledge/feed.ts` (`adminsOnly` false leaves admins-only calls out in SQL).
- teams: ✚ `meetingDurations(db, itemIds): Promise<Map<string, number>>` in `teams/service.ts`.
- reminders: `buildIcsText` gets a sibling ✚ `buildIcsFeed({ name, events })` in `reminders/ics.ts` (shared escaping and folding; no `METHOD`, `DTSTAMP` = `updatedAt`, calendar properties, no alarms).
- users: `deactivateUser` calls ✚ `deleteFeedOf(db, userId)`.

**Realtime**: none. The feed is pulled; the settings card updates from its own HTTP answers (React Query), and there is no other screen showing the feed. **Jobs**: none.

## 10. Time zones and recurring calls

- **Timed events are UTC** (`DTSTART:20261025T090000Z`), so no `VTIMEZONE` block is needed and every calendar shows them in its own zone. A call created in Bratislava at 10:00 stays 10:00 for a Bratislava viewer across DST because each call's `starts_at` is already the right instant (ADR 0049's series math keeps the local time).
- **Dates are all-day** (`DTSTART;VALUE=DATE`), the same day in every zone, as the existing export does.
- **Recurring calls: expanded occurrences, no RRULE.** ADR 0049 already makes every call of a series a real item 60 days ahead; each one is its own `VEVENT` with UID `call-<itemId>@spolu`. A cancelled call is a deleted item and simply disappears; an edited "this call" is just that event; no `RECURRENCE-ID` or `EXDATE` bookkeeping. The cost: calls further out than 60 days appear as the series job creates them (hourly).
- UIDs: `event-<id>@spolu`, `task-<id>-deadline@spolu` (the same UID the reminders export already gives a task's deadline, so a person who imported that file earlier gets the event updated, not doubled, in clients that merge by UID), `call-<itemId>@spolu`. `SEQUENCE` and `LAST-MODIFIED` come from `updated_at`, as today.

## 11. Notifications

Only the security email of §7 (create and rotate), through the existing `sendEmailLater` job and the one email design (ADR 0019). No in-app notification, no push.

## 12. i18n

- Web: lazy namespace `apps/web/src/locales/calendarFeed/<code>.json` in all nine languages (picked up by `src/i18n/namespaces.ts` from the folder, no registration). it and sl in the formal register (Lei / vi).
- Server: `calendarFeed` block in `apps/server/src/infra/i18n/types.ts` and the nine `<code>.ts`: `name(userName)`, `eventSummary(project, event)`, `callSummary(title)`, `withGroup(group, summary)`, `createdEmail` (subject, lines, button). The deadline SUMMARY reuses `reminders.deadlineEvent`.
- Wording follows `docs/design/wording.md` ("Hovor" for a call, "Termín" for a deadline, "Udalosť" for a project event).

## 13. Open questions (with the recommended answer)

1. **Admins: assigned tasks only, or all of the managed clients?** Recommended: assigned by default, the managed-clients switch off by default (§2).
2. **Recurring calls as RRULE?** Recommended: no, expanded occurrences (§10); revisit only if people want series beyond 60 days.
3. **Call length without Teams?** Recommended: 60 minutes. Alternative: add a "Dĺžka" field to calls (a knowledge change, out of scope here).
4. **Include task reminders' own times as events?** Recommended: no; they are notifications, and the one-off `.ics` export remains for them.
5. **Email on create and rotate?** Recommended: yes (§7), as for MCP tokens.
6. **A server-side cache of the built feed (e.g. 60 s per token)?** Recommended: not now; four indexed reads per poll and the 304 are enough for eGrant's size. Add it if the poll volume shows in the logs.
7. **One feed per person or several (one per device)?** Recommended: one; rotation covers a leaked link.
