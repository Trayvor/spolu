# Weekly client summary: design

Date: 2026-10-19
Status: **draft, owner decisions of 2026-10-19 applied** (never sent without the manager's review; drafts never expire or get replaced; every report is kept permanently in a searchable archive, §6, §7.3, §12.8). The open questions left in §14 carry a recommended answer each.
Plan: [../plans/2026-10-19-client-weekly-summary.md](../plans/2026-10-19-client-weekly-summary.md)
Implementation starts only after the phases in flight are done (owner instruction, 2026-10-19); the final e2e pass comes after all seven specs of 2026-10-19 (ticket AI draft, ICS calendar, admin workload, ticket rating, this one, audit log, chat message search) are implemented.

## 1. Goal

Once a week every client group gets one email from its eGrant team that answers three questions:

1. **What we did this week** (finished tasks, resolved tickets).
2. **What we need from you** (tasks waiting for the client).
3. **What is coming** (deadlines of open tasks and project events in the next 14 days).

The AI prepares a **draft** per group from what the group's clients may already see in Help. The group's **manager** (an admin in `group_managers`) reviews it, edits it and sends it from the app. **Nothing ever reaches a client without the manager's review and a person pressing Send** (owner decision, 2026-10-19: no automatic sending, now or later). When the AI is off or fails, the draft is a plain, factual list built without AI, so the feature works without OpenAI.

**Every weekly report is kept permanently** (owner decision, 2026-10-19), whether it was sent, skipped or never sent: a draft never expires, is never deleted and is never replaced by the next week's draft or by a regeneration (the earlier text is kept as a revision, §6). Together the rows form a searchable **archive of work reports per client** (Archív prehľadov, §7.3, §12.8): a manager or any admin finds the reports of any client and period by client, date range and text ("what did we do for client X from March to June").

Not in scope: showing the archive to clients in the app (§14 Q6), automatic sending (never, owner decision), summaries for the admin group, summaries for requesters (žiadatelia), SMS or push to clients, the archive in the global search (§14 Q9).

## 2. Users and roles

| who                                                                 | what they do                                                                                                                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Group manager (admin with a `group_managers` row for the group)     | reads, edits, regenerates, test-sends, sends or skips the group's draft; turns the group's summaries on or off; gets the "drafts are ready" reminder if they want it |
| Any other admin, the superadmin included                            | reads every draft and its preview (read-only); cannot edit, send, skip or change the group setting (403)                                                             |
| Every admin (managers included)                                     | searches and reads the archive of every client's reports (§7.3, §12.8), read-only                                                                                    |
| Client (active `client` membership, verified email, active account) | receives the email in their own language; can turn it off per group in the profile or with the link in the email                                                     |
| Žiadateľ (requester only)                                           | never receives it, never sees anything (they do not read the group)                                                                                                  |

Why managers only (not every admin): the summary speaks for the eGrant team to one client; the person responsible for the client signs it off. A group with no active manager gets **no draft** (nobody would review it) and the groups page already shows such groups.

## 3. The weekly cycle

All times are Europe/Bratislava.

| when                 | job                                                                    | what happens                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Friday 07:00         | `weekly-summary.prepare` (cron `0 7 * * 5`, `tz: 'Europe/Bratislava'`) | lists the eligible groups in one query and sends one `weekly-summary.draft` job per group (`sendMany`); earlier weeks' rows are never touched                                       |
| right after          | `weekly-summary.draft` (one per group, `localConcurrency: 2`)          | collects the facts, asks the AI (60 s timeout) or builds the factual draft, stores it, pushes `weekly-summary:changed`                                                              |
| Friday 09:00         | `weekly-summary.remind` (cron `0 9 * * 5`)                             | one email per manager who wants reminders and has drafts of this week in status `draft`                                                                                             |
| when a manager sends | `weekly-summary.send`                                                  | emails the frozen recipients, 20 a run, then marks the summary `sent`                                                                                                               |
| daily 04:10          | `weekly-summary.purge`                                                 | blanks the email address of recipient rows older than 90 days (the row, the person's id, name lookup, language and `sent_at` stay); summaries and their revisions are never deleted |

**Eligible group** (one SQL query, §9): `kind = 'client'`, `deactivated_at is null`, not turned off (`weekly_summary_group_settings.enabled = false`), at least one active manager, at least one recipient (§8), no row yet for this week. A group with **no facts and no client-visible messages in the window** gets a row in status `skipped` with `skipReason = 'no_activity'` and no AI call, so "nothing happened" is visible in the list but no one is asked to review it.

**Week and window.** `week` is the ISO week of the prepare moment (`2026-W43`, text, sorts correctly). The window ends at the prepare moment and starts at the previous row's `window_end` for the group (any status), or 7 days earlier when there is none; it is never longer than 14 days. So a skipped or unsent week is not lost silently: the next draft covers the gap up to 14 days. A draft that is not sent before the next Friday's prepare **stays a draft** of its own week: the new week gets its own row next to it (`unique (group_id, week)`), the old one is neither expired, nor deleted, nor overwritten. Its manager can still send it late, mark it "Tento týždeň neposielať", or leave it; either way it stays in the archive as "Neodoslané" (not sent).

**Statuses** of `weekly_summaries.status`: `preparing` → `draft` → `sending` → `sent`; `draft` → `skipped` (a manager chose "Tento týždeň neposielať", or no activity); `draft` → `preparing` (regenerate; the current content is first stored as a revision) → `draft`. There is no `expired` status and no transition made by time alone: only a manager's action moves a draft. `sent` and `skipped` are final; every status is kept permanently.

## 4. Sources: only what the clients already see

The draft is built from **facts** (structured rows) and **messages** (chat text for the AI to pick highlights from). Every source is a function exported by the module that owns the table (modules never read each other's tables), limited and indexed (§9):

| section   | source                                                                            | owner and function                               | limit                                          |
| --------- | --------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| done      | tasks of the group with `completed_at` in the window                              | `tasks/weekly-facts.ts` `doneTasksOf`            | 50                                             |
| done      | tickets of the group with `resolved_at` in the window                             | `tickets/weekly-facts.ts` `resolvedTicketsOf`    | 50                                             |
| waiting   | open tasks in the group's `client_review` bucket ("Na kontrole u klienta")        | `tasks/weekly-facts.ts` `waitingOnClientTasksOf` | 50                                             |
| upcoming  | open tasks with `due_date` from tomorrow to +14 days                              | `tasks/weekly-facts.ts` `dueTasksOf`             | 50                                             |
| upcoming  | events of active projects with `occurs_on` from tomorrow to +14 days              | `projects/weekly-facts.ts` `upcomingEventsOf`    | 50                                             |
| (AI only) | live messages of the group chat and the group's task chats, created in the window | `chat/weekly-facts.ts` `clientVisibleMessagesOf` | newest 150, 500 characters each, 40 000 in all |

**Never used:** knowledge items of any visibility (admins-only items, meetings, files, notes), finance, ticket chats (they hold requesters' personal data; §14 Q4), the admin group, deactivated groups, deleted messages, anything from a ticket without a client. Every group chat and task chat of a client group is read by the group's clients (permissions.md, chat policy), and every task and ticket of the group is read by them, so the facts and messages are exactly the clients' view. A mentioned person is written by name only when they are a person of the group (`listGroupPeople`); anyone else is `@?`, as in knowledge excerpts.

**Only text and names leave the server** to the AI, as in the task split and the meeting summary: no emails, phone numbers from profiles, ids of users, file contents or links to files. Item ids sent to the AI are opaque short keys (`t1`, `k3`, `e2`), mapped back on the server.

## 5. The AI draft and the factual fallback

`modules/ai/weekly-summary.ts` (next to `meeting-summary.ts`): a `WeeklySummaryProvider` built from `config.ai` (the task split's model and key, `OPENAI_MODEL`), with a fake for dev and e2e, `null` when AI is off.

Request: group name, draft language, today, window (dates as text), the facts per section (`{ key, text, date }`), the messages (`{ author, text, at }`). Strict JSON schema answer:

```json
{ "intro": "…", "done": [{ "key": "t1" | null, "text": "…" }], "waiting": [ … ], "upcoming": [ … ], "closing": "…" }
```

System prompt (rules): write in the draft language, address the client formally (Vy, Sie, Lei, vikanje), short and friendly; each item one sentence; use only the facts and messages given; never invent dates, amounts or promises; a `key` must be one of the facts' keys or null; chat highlights may become `done` or `waiting` items without a key only when a message clearly says something was finished or is needed from the client; leave out internal details, money, personal data and anything said about third persons; at most 15 items per section; intro at most 600 characters, closing at most 300.

**Sanitizing** (`sanitizeWeeklyDraft`, server side, whatever the model returns): unknown keys become `null`; texts are trimmed and cut to the limits of §6; empty items dropped; at most 15 items per section; the language is not trusted from the model. The model's output is untrusted text, never HTML: the email renderer escapes it.

**Prompt injection.** Clients write the chat, so a message can try to steer the model. The damage is bounded: the output is only a draft that a manager reads before sending; it can only cite facts the server gave; it is rendered as escaped text; and it goes only to the same group's clients who wrote or read those messages. That is why sending without review is not offered (§14 Q1).

**Fallback** (`factsDraft(facts, lang, groupName, window)` in `modules/weekly-summary/facts-draft.ts`, no AI): the intro is a fixed server text ("Dobrý deň, posielame prehľad práce za obdobie 13. 10. – 17. 10. 2026."), each fact becomes one item with its own title (task title; ticket `#12 Subject`; event `Name (Project)`; dates formatted in the draft language), the closing is a fixed text ("Ak máte otázky, odpovedzte v chate skupiny v Help."). It is used when: AI is off (`source = 'facts'`, no banner), the AI call fails or times out (`source = 'facts'`, `aiFailed = true`, a banner tells the manager), or the sanitized AI answer has no item at all while facts exist. A manager can press "Pripraviť znova s AI" later (§7).

**Draft language**: the most common `user.language` among the recipients; a tie or no recipient → `sk`. The manager can change it before regenerating. The fixed headings of the email are in each recipient's own language; the written text (intro, items, closing) is in the draft language (§14 Q3).

## 6. Data model

New module `modules/weekly-summary` owns seven tables (migration `00XX_client-weekly-summary`, one migration; numbers assigned by the orchestrator: main's newest is `0062_night_integration` and #113 takes `0063`, so check `origin/main` before `db:generate`). Every foreign key leads an index (`foreign-key-indexes.test.ts`).

```
weekly_summaries
  id               text pk (uuid)
  group_id         text not null → groups.id on delete cascade
  week             text not null                    -- 'YYYY-Www', check ~ '^\d{4}-W\d{2}$'
  window_start     timestamptz not null
  window_end       timestamptz not null             -- check window_end > window_start
  status           text not null default 'preparing' -- check in ('preparing','draft','sending','sent','skipped')
  skip_reason      text                             -- check in ('no_activity','manager') or null
  source           text                             -- check in ('ai','facts'); null while preparing
  ai_failed        boolean not null default false
  language         text not null default 'sk'       -- languageIn(...)
  content          jsonb not null                   -- WeeklySummaryContent (§6.1), validated by zod on every write
  search_text      text not null default ''         -- plain text of intro, items and closing, rewritten by the service on every content write (§7.3)
  version          integer not null default 1       -- bumped by every write; optimistic concurrency
  updated_by       text → user.id on delete set null
  sent_by          text → user.id on delete set null
  sent_at          timestamptz
  created_at, updated_at timestamptz not null default now()
  unique (group_id, week)                           -- idempotent prepare; the latest week of a group (order by week desc)
  index  (week, status, group_id)                   -- the list and the reminder
  index  (group_id, window_end desc, id)            -- the archive of one client by date range
  index  (window_end desc, id)                      -- the archive of all clients by date range
  index  gin (spolu_fold(search_text) gin_trgm_ops) -- the archive's text search (as #143's `*_fold_trgm_idx`)
  index  (group_id, status) where status = 'draft'  -- older unsent drafts of a group (§12.2)
  index  (status, created_at) where status in ('preparing','sending')  -- the stuck-job sweep
  index  (updated_by), index (sent_by)

weekly_summary_recipients        -- frozen at Send (insert … select)
  summary_id  text → weekly_summaries.id on delete cascade
  user_id     text → user.id on delete cascade
  name        text not null                     -- the name at Send, so the archive shows who got it after the person changes or leaves
  email       text                              -- null once blanked by the purge after 90 days
  language    text not null (languageIn)
  status      text not null default 'pending'   -- check in ('pending','sent','failed')
  sent_at     timestamptz
  pk (summary_id, user_id); index (user_id); index (summary_id) where status = 'pending'
  index (sent_at) where email is not null       -- the purge

weekly_summary_revisions         -- append-only: the content a regeneration or a restore replaced, kept permanently
  id          text pk (uuid)
  summary_id  text not null → weekly_summaries.id on delete cascade
  version     integer not null                  -- the summary's version the content had
  content     jsonb not null                    -- WeeklySummaryContent
  language    text not null
  source      text not null                     -- 'ai' | 'facts'
  created_by  text → user.id on delete set null (indexed)
  created_at  timestamptz not null default now()
  index (summary_id, created_at desc)

weekly_summary_group_settings    -- absence = enabled (default on, §14 Q2)
  group_id    text pk → groups.id on delete cascade
  enabled     boolean not null
  updated_by  text → user.id on delete set null (indexed)
  updated_at  timestamptz not null default now()

weekly_summary_unsubscribes      -- a client who turned it off for one group
  user_id     text → user.id on delete cascade
  group_id    text → groups.id on delete cascade
  created_at  timestamptz not null default now()
  pk (user_id, group_id); index (group_id)

weekly_summary_admin_prefs       -- absence = remind (default on)
  user_id     text pk → user.id on delete cascade
  remind      boolean not null

weekly_summary_reminders         -- one reminder per manager and week
  user_id     text → user.id on delete cascade
  week        text not null
  pk (user_id, week)
```

### 6.1 Content (shared zod, `packages/shared/src/weekly-summary.ts`)

```ts
WeeklySummaryItem = { id: string /* uuid, stable for React keys */, ref: { kind: 'task' | 'ticket' | 'event'; id: string } | null, text: string /* 1..500 */ }
WeeklySummaryContent = { intro: string /* ≤ 1500 */, done: Item[] /* ≤ 30 */, waiting: Item[] /* ≤ 30 */, upcoming: Item[] /* ≤ 30 */, closing: string /* ≤ 600 */ }
```

A `ref` ties an item to a task, ticket or event of the group; the manager's own items have `ref: null`. Refs are checked again at Send (§7).

`searchText(content): string` (in `modules/weekly-summary/search-text.ts`) joins intro, every item's text and closing with newlines; the service writes it with every content write (draft job, PATCH, regenerate, Send's ref clean-up). It is never sent to the web.

## 7. API

All under `/api`, JSON, zod schemas in `packages/shared`. Rate limits per acting user unless noted. Writes push `weekly-summary:changed` after commit (§10).

| route                                                                                                        | who                                             | answer                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /weekly-summaries?week=&scope=mine\|all&status=review\|sent\|all&cursor=&limit=`                        | admins (`requireAdmin`)                         | `{ items: WeeklySummaryListItem[], nextCursor }`, keyset by `(group name, id)` within one week; `scope=mine` (default) = `managedGroupIds`, an admin who manages none sees all; `week` default the current one |
| `GET /weekly-summaries/:id`                                                                                  | admins                                          | `WeeklySummaryDto` (§7.1) with `canEdit`                                                                                                                                                                       |
| `PATCH /weekly-summaries/:id` `{ version, content, language? }`                                              | the group's manager                             | the DTO; `409 stale_version` with the current DTO; `409 not_draft` unless `draft`                                                                                                                              |
| `POST /weekly-summaries/:id/regenerate` `{ version, language? }`                                             | manager                                         | `202`, status `preparing`; in the same transaction the current content goes to `weekly_summary_revisions`; a draft job runs again (AI, fallback); 10 an hour per admin, `429 rate_limited`                     |
| `GET /weekly-summaries/:id/revisions`                                                                        | admins                                          | `{ items: { id, version, language, source, createdBy: { name } \| null, createdAt, content }[] }`, newest first, at most 20                                                                                    |
| `POST /weekly-summaries/:id/revisions/:revisionId/restore` `{ version }`                                     | manager                                         | the DTO; in one transaction the current content goes to `weekly_summary_revisions` and the revision's content becomes the draft's; `409 stale_version`, `409 not_draft`                                        |
| `GET /weekly-summaries/archive?groupId=&from=&to=&q=&status=sent\|unsent\|all&cursor=&limit=`                | admins                                          | `{ items: WeeklySummaryArchiveItem[], nextCursor }` (§7.3)                                                                                                                                                     |
| `POST /weekly-summaries/:id/preview` `{ language }`                                                          | admins                                          | `{ subject, html, text }` of the email as a recipient in `language` gets it (unsubscribe link is a dummy)                                                                                                      |
| `POST /weekly-summaries/:id/test`                                                                            | manager                                         | `204`; the email in the admin's language to the admin's own address only, subject prefixed "[Test]"; 10 an hour                                                                                                |
| `POST /weekly-summaries/:id/send` `{ version }`                                                              | manager                                         | `202 { recipients: n }`, status `sending`; `409 stale_version`; `409 refs_changed` with the corrected DTO (§7.2); `409 no_recipients`; `409 not_draft`                                                         |
| `POST /weekly-summaries/:id/skip` `{ version }`                                                              | manager                                         | the DTO, status `skipped`, `skip_reason = 'manager'`                                                                                                                                                           |
| `GET /groups/:id/weekly-summary/settings`                                                                    | admins                                          | `{ enabled, canEdit }`                                                                                                                                                                                         |
| `PUT /groups/:id/weekly-summary/settings` `{ enabled }`                                                      | manager                                         | `{ enabled }`; turning off does not touch an existing draft                                                                                                                                                    |
| `GET /me/weekly-summary`                                                                                     | any client                                      | `{ groups: { groupId, name, subscribed, enabled }[] }` for their active client groups                                                                                                                          |
| `PUT /me/weekly-summary/:groupId` `{ subscribed }`                                                           | client of that group (`canReadGroup`, else 404) | `{ subscribed }`                                                                                                                                                                                               |
| `GET /me/weekly-summary/reminder`, `PUT …` `{ remind }`                                                      | admins                                          | `{ remind }`                                                                                                                                                                                                   |
| `GET /weekly-summary/unsubscribe/:token`, `POST …/unsubscribe/:token`, `POST …/unsubscribe/:token/one-click` | public, signed token                            | `{ groupName, language, subscribed }`; 30 a minute per IP; CSRF exempt; bad or forged token `404`                                                                                                              |

Unknown ids and malformed ids answer `404 not_found`. A client calling an admin route gets `403 forbidden` (as `requireAdmin` does everywhere); a non-manager admin calling a manager route gets `403 forbidden`.

### 7.1 DTOs

`WeeklySummaryListItem`: `{ id, groupId, groupName, week, status, skipReason, source, aiFailed, itemCount, recipientCount, updatedAt, sentAt, managedByMe }`.
`WeeklySummaryDto`: list item fields + `{ windowStart, windowEnd, language, content, version, canEdit, revisionCount, recipients: { name, language }[] /* who would get it now, or who got it (the frozen rows' names) */, refs: Record<itemId, { kind, title, url }> /* app links for the editor */ }`. Recipients' emails are never sent to the web (names and languages are enough to review).
`WeeklySummaryArchiveItem`: `{ id, groupId, groupName, week, windowStart, windowEnd, status, skipReason, sentAt, sentBy: { name } | null, content }`. The content is small (≤ 90 items of ≤ 500 characters), so one archive page shows the reports themselves, not only titles.

### 7.2 Send

In one transaction under `select … for update` of the summary row: check `status = 'draft'` and `version`; check every `ref` still belongs to the group and is client-readable (`taskRefsInGroup`, `ticketRefsInGroup`, `eventRefsInGroup`, exported by their modules: a ticket moved to another client, a deleted task or event fails). If any fails, drop those items, bump the version, store and answer `409 refs_changed` with the new DTO: the manager sees what changed and presses Send again. Otherwise freeze the recipients (`insert … select`, §8), set `status = 'sending'`, `sent_by`, bump the version, and after commit send one `weekly-summary.send` job. The job takes up to 20 `pending` rows with `for update skip locked`, renders each person's email, queues it with `sendEmailLater` (the email job retries), marks the row `sent`; it sends itself again while rows are left; with none left it sets `status = 'sent'`, `sent_at` and pushes the change. A crash leaves rows `pending` and the five-minute sweep (`weekly-summary.sweep`, cron `*/5 * * * *`) re-sends jobs for summaries stuck in `sending` or `preparing` for over 10 minutes.

### 7.3 The archive (Archív prehľadov)

One read-only search over every `weekly_summaries` row that is not `preparing`, for every admin (`canReadWeeklySummaries`), managers and non-managers alike; clients get `403`. Filters, all optional and combined with `and`:

- `groupId` — one client group (any admin may pick any client group; an unknown or malformed id is `404`);
- `from`, `to` — calendar days (`YYYY-MM-DD`, Europe/Bratislava); a report matches when its window overlaps the range (`window_end > from` and `window_start < to + 1 day`), so "March to June" (`from=2026-03-01&to=2026-06-30`) finds every week that touched it; `from > to` is `400 validation_failed`; no range = all time;
- `q` — text, 2 to 100 characters, folded like the global search (`normalizeSearch` on the query, `spolu_fold(search_text) like '%' || $q || '%'` with `%`/`_` escaped), served by the trigram index;
- `status` — `sent` (only `sent`), `unsent` (`draft`, `sending`, `skipped`), `all` (default).

Order: `window_end desc, id desc`, keyset cursor on that pair, 20 a page (`limit` 1..50). Rows of the admin group never exist. **Deactivated groups:** their reports stay in the archive (they are a record of work done, read-only: Send already answers `409 group_inactive`), and the group picker lists a deactivated group marked "(deaktivovaná)"; see §14 Q9. The archive is **not** part of the global search (#143), so the global search's rule (owner decision, 2026-10-19: nothing of a deactivated group, admins included) is untouched; if the archive is ever added there, that rule applies to it.

## 8. Recipients and email settings

A recipient is a person with an active `client` membership of the group (`removed_at is null`), a verified email, an account that is not disabled, and no `weekly_summary_unsubscribes` row for the group. Žiadatelia are never recipients. Admins and managers are never recipients (they review the draft in the app; the test send covers "how it looks"). The list comes from the groups module (`listGroupPeople`, clients only) and `getNotificationProfiles` (email, language, disabled) in two queries, then one query for the unsubscribes.

The summary is a service email about the client's own work, not marketing, so it does **not** read the bulk email subscription (ADR 0016/0024 keep that for campaigns) nor the notification channels (those are per event category and push-first). It has its own switch:

- in the profile, Notifications page, a section "Týždenný prehľad e-mailom" with one checkbox per group of the client;
- in every summary email, a footer line with a personal unsubscribe link and the `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058), because it is a recurring email. The token is `<userId>.<groupId>.<base64url HMAC-SHA256(APP_SECRET, "weekly-summary-unsubscribe:<userId>:<groupId>")>`, verified in constant time like `bulk-email/token.ts`; nothing is stored for it.

The email is in the recipient's `user.language` (nine languages, it with "Lei", sl with vikanje, ADR 0019), in the one email design (`buildEmail`, ADR 0019).

### 8.1 The email

- Subject: `serverTexts(lang).weeklySummary.subject(groupName, range)`, sk: `Týždenný prehľad: {skupina}, 13. 10. – 17. 10. 2026`.
- Heading: sk `Týždenný prehľad práce`.
- Paragraph: the intro.
- Sections (only non-empty ones), each a heading and one paragraph line per item (`• text`): sk `Čo sme urobili`, `Čo od vás potrebujeme`, `Čo nás čaká`.
- The closing paragraph, then the button sk `Otvoriť v Help` → `<PUBLIC_URL>/groups/<id>/overview`.
- Footer: the system footer plus sk `Tento prehľad dostávate ako člen skupiny {skupina}. Odhlásiť sa: {url}`.

`EmailMessage` gains an optional `headers?: Record<string, string>`, passed through by the SMTP and Elastic transactional senders (today only the bulk path sets headers); `buildEmail` gains an optional `footerLines?: string[]`.

## 9. Performance

- Every screen is a lazy route; texts in a new lazy namespace `weeklySummary` (nine files); no new runtime dependency; no eager text added (the entry points are the admin home card, the group Overview card for admins and the reminder email; no header link). The initial JS must not grow (measure as in performance.md, "How to check").
- The editor is plain `<textarea>`s and buttons (move up / down, remove, add); no ProseMirror, no drag and drop.
- The prepare job's eligibility is **one** query over `groups` with `not exists` / `exists` subqueries on `group_managers` (pk leads with `group_id`), `group_members` (`group_members_group_active_idx`), `weekly_summary_group_settings` (pk) and `weekly_summaries` (`unique (group_id, week)`).
- A draft job runs six bounded queries (§4), each served by an index:
  - `doneTasksOf`: `tasks_open_group_idx (group_id, completed_at)` with `completed_at >= $from and < $to`;
  - `resolvedTicketsOf`: **new** `tickets_group_resolved_idx (group_id, resolved_at) where resolved_at is not null`;
  - `waitingOnClientTasksOf`: `buckets_group_fixed_kind_unique (group_id, kind)` then `tasks_bucket_position_unique (bucket_id, position)`, filtered `completed_at is null`;
  - `dueTasksOf`: **new** `tasks_group_due_open_idx (group_id, due_date) where completed_at is null` (the existing `tasks_due_date_open_idx` has no group);
  - `upcomingEventsOf`: `project_events_group_occurs_idx (group_id, occurs_on, id)` joined to `projects` by pk, `status = 'active'`;
  - `clientVisibleMessagesOf`: `channels_group_id_idx` for the group's group and task channels, then `messages_channel_parent_created_idx`-style range on `(channel_id, created_at)` per channel through one lateral join, newest first, `deleted_at is null`.
- The list endpoint is keyset-paged (50 a page) and its counts (`itemCount`, `recipientCount`) come from the row (`jsonb_array_length`) and one grouped query per page, never per row.
- The archive grows by about 52 rows per client a year and is never purged, so every archive query is bounded and indexed: one client and a range reads `(group_id, window_end desc, id)`; all clients and a range reads `(window_end desc, id)`; text reads the `spolu_fold(search_text)` trigram index (with `q` and no client, the planner may combine it with the range index); 20 rows a page, group names in one join by pk, `sentBy` names in one query per page. Revisions are read only for one summary (`(summary_id, created_at desc)`, at most 20).
- EXPLAIN checks (ADR 0040) on the seeded `home` volume (3 100 groups, with a test volume of three years of weekly summaries for its groups, about 480 000 rows): the eligibility query, the six source queries, the list page and the three archive shapes (one client and a range, all clients and a range, a text query) must not seq-scan `groups`, `tasks`, `tickets`, `project_events`, `messages`, `channels`, `weekly_summaries`; with `RUN_BENCH=1` each source query and archive page under 30 ms (the text query under 100 ms) and the eligibility query under 200 ms.
- AI calls run in jobs, at most two at a time, never inside a request (the regenerate route answers 202 at once).

## 10. Realtime

`weekly-summary:changed` `{ id, groupId, week, status, version }` to `ADMINS_ROOM` after every commit (draft stored, edited, regenerated, sending, sent, skipped). The list and the editor invalidate their queries on it (2 s debounce). The editor compares `version`: another manager's save shows "Koncept medzitým upravil {meno}. Načítať novú verziu?" instead of overwriting the textareas. Clients get no event (they never see drafts).

## 11. Security and privacy

- Policy functions (`modules/weekly-summary/policy.ts`, test-first): `canReadWeeklySummaries(actor) = isAdmin(actor)` (drafts, revisions and the archive alike); `canManageWeeklySummary(actor, managesGroup: boolean) = isAdmin(actor) && managesGroup`; `canSetMyWeeklySummary(actor, groupId, actorGroupIds) = actor.role === 'client' && actorGroupIds.includes(groupId)`. `managesGroup` comes from `isGroupManager(db, groupId, actor.id)` (groups module, active admins only).
- Sources are client-visible only (§4); refs are re-checked at Send (§7.2), so a ticket moved to another client between draft and send never leaks its subject.
- Recipient emails stay on the server; the DTO has names only. The test email goes only to the acting admin's own address.
- The AI gets text and names only (§4); the provider never logs prompts or answers; its log line has `groupId`, outcome, duration and token usage only.
- The unsubscribe routes act only on the token's person and group, tell only `{ groupName, language, subscribed }`, answer 404 for a bad token or a removed person, and are limited per IP.
- CSP (ADR 0044): the preview is shown in an `<iframe srcdoc sandbox="">` like the bulk email preview; it uses only our own origin's images (the logo), so the policy is unchanged. No new third-party source.
- Retention: summaries and their revisions are **kept permanently** (owner decision, 2026-10-19); they hold only client-visible facts and the manager's text. Recipient email addresses are blanked after 90 days (`weekly-summary.purge`); the recipient's name, language and `sent_at` stay so the archive still shows who got a report. Deleting a group (not deactivating) deletes its reports with it (`on delete cascade`), as for every other group-owned row.
- Deactivating a group stops new drafts; existing drafts can still be read by admins but not sent (`409 group_inactive`); its reports stay in the archive (§7.3).
- The archive's text search runs on the server over `search_text`, which is never returned; the answer carries only the content the reader may already open in the editor.

## 12. UX (Slovak is the source language)

### 12.1 Admin home card (namespace `adminHome`)

A card "Týždenné prehľady" shown on Fridays to Mondays when the admin manages a group with a draft: "Na kontrolu: 3" and a button "Skontrolovať". The count comes from `GET /api/me/home/counts` (`weeklySummaries`, via the exported `pendingDraftCount(db, adminId, week)`), so the home makes no extra request.

### 12.2 List `/weekly-summaries` (lazy route, admins)

- Title "Týždenné prehľady", subtitle "Týždeň 43 · 13. 10. – 17. 10. 2026", week arrows "Predchádzajúci týždeň" / "Nasledujúci týždeň".
- Filter pills "Moji klienti" / "Všetci" (remembered with `useRememberedFilters`) and "Na kontrolu" / "Odoslané" / "Všetky".
- A row per group: logo, name, status chip, "AI" or "Iba fakty", item count "8 bodov", recipients "4 príjemcovia", last change. Status chips: "Pripravuje sa", "Koncept", "Odosiela sa", "Odoslané", "Neposiela sa", "Bez aktivity".
- Older drafts never vanish: when the admin's groups have drafts of earlier weeks, a line above the rows "Neodoslané koncepty z minulých týždňov: 2 · Zobraziť" opens the archive filtered to `status=unsent`.
- A link "Archív prehľadov" in the header opens §12.8.
- Empty: "Tento týždeň nie je čo kontrolovať."

### 12.3 Editor `/weekly-summaries/$summaryId` (lazy route)

- Header: group name, week, status chip, "Pripravené s AI – pred odoslaním text skontrolujte." or, when `aiFailed`, a yellow note "AI nebola dostupná. Koncept obsahuje iba fakty; môžete ho doplniť alebo skúsiť AI znova."
- Fields: "Úvod" (textarea); three sections "Čo sme urobili", "Čo od vás potrebujeme", "Čo nás čaká", each a list of items (textarea, a small link "Otvoriť úlohu" / "Otvoriť tiket" / "Otvoriť udalosť" when it has a ref, buttons "Vyššie", "Nižšie", "Odstrániť") and "Pridať bod"; "Záver" (textarea).
- "Jazyk textu" select (nine languages) with the hint "Nadpisy e-mailu dostane každý príjemca vo svojom jazyku."
- Recipients: "Dostanú ho: Jana Nováková (sk), Marco Rossi (it)". None: "Skupina nemá komu poslať prehľad (žiadny overený klient)."
- Actions: "Uložiť" (also on leaving a changed field after 1 s idle), "Náhľad", "Poslať skúšobný e-mail mne", "Pripraviť znova s AI" (confirm "Pripraviť koncept znova? Súčasný text sa uloží medzi predchádzajúce verzie."), "Tento týždeň neposielať", primary "Poslať klientom".
- "Predchádzajúce verzie (2)" when `revisionCount > 0`: a dialog listing each revision ("Verzia 3 · AI · 17. 10. 2026 9:12 · Jana Nováková") with its text read-only and, for the manager of a draft, "Obnoviť túto verziu" (the restore route; the text it replaces becomes a revision too, so nothing is lost).
- An older week's draft opens with the note "Koncept z týždňa 41. Môžete ho ešte poslať alebo označiť ako neposielaný." and the same actions.
- Send confirmation: "Poslať prehľad 4 príjemcom? Odoslaný e-mail sa už nedá zmeniť." / "Poslať" / "Zrušiť". `refs_changed`: "Niektoré body už neplatia (úloha bola zmazaná alebo tiket presunutý) a boli odstránené. Skontrolujte koncept a pošlite ho znova."
- Read-only for an admin who is not the manager: "Tento prehľad môže upraviť a poslať manažér skupiny." Sent: read-only with "Odoslané {dátum} · {meno}".
- Preview dialog: language select and the email in a sandboxed iframe.
- Settings strip: checkbox "Pripravovať týždenný prehľad pre túto skupinu" (managers), and "Pripomenúť mi koncepty e-mailom" (the admin's own).

### 12.4 Group Overview (namespace `projects`, admins only)

A small line on the group's Prehľad tab for admins: "Týždenný prehľad: Koncept · Skontrolovať" (or "Vypnutý"), linking to the editor, and "Archív prehľadov" linking to the archive filtered to the group; nothing for clients.

### 12.5 Client profile (namespace `notifications`)

Section "Týždenný prehľad e-mailom", text "Raz týždenne vám pošleme, čo sme urobili, čo od vás potrebujeme a čo nás čaká.", one checkbox per group. A group whose summaries are off shows "(skupina ho momentálne nedostáva)".

### 12.6 Unsubscribe page `/weekly-summary/unsubscribe/$token` (namespace `unsubscribe`)

"Odhlásili ste sa z týždenného prehľadu skupiny {skupina}." and a button "Znova prihlásiť". A bad link: "Odkaz je neplatný alebo už neplatí."

### 12.7 Manager reminder email (server texts)

Subject sk "Týždenné prehľady na kontrolu: 3", body "Pripravili sme koncepty týždenných prehľadov pre vašich klientov: Firma A, Firma B a 1 ďalší. Skontrolujte ich a pošlite.", button "Skontrolovať".

### 12.8 Archive `/weekly-summaries/archive` (lazy route, admins, namespace `weeklySummary`)

- Title "Archív prehľadov", subtitle "Výkazy práce podľa klienta: všetky týždenné prehľady, odoslané aj neodoslané."
- Filters (in the URL, so a search can be shared with another admin): "Klient" (searchable group picker, "Všetci klienti" by default; a deactivated group as "Firma A (deaktivovaná)"), "Od" and "Do" (date inputs), "Hľadať v texte" (search input, 300 ms debounce, from 2 characters), pills "Všetky" / "Odoslané" / "Neodoslané".
- A card per report, newest first: group name, "Týždeň 43 · 13. 10. – 17. 10. 2026", status chip, "Odoslané 17. 10. 2026 · Jana Nováková" or "Neodoslané"; then the intro, the three sections with their items and the closing, as the client got (or would have got) them; matched text marked with `<mark>` (escaped text, no HTML from the stored content). "Otvoriť" opens the editor (read-only unless it is a draft of the reader's group).
- "Načítať ďalšie" for the next page; the count line "Nájdené prehľady: 18" is not shown (no `count(*)` over the archive).
- Empty: "Pre tieto filtre nie je žiadny prehľad."
- Entry points: the list header (§12.2) and the group Overview line (§12.4, "Archív prehľadov" filtered to that group).

## 13. i18n

- Web: new namespace `apps/web/src/locales/weeklySummary/<code>.json` for all nine languages (list, editor, revisions dialog and archive texts), registered on the three routes with `withNamespaces(['weeklySummary'])`; new keys in the existing lazy namespaces `adminHome`, `projects`, `notifications`, `unsubscribe`. No key in the eager `<code>.json`.
- Server: `ServerTexts.weeklySummary` in all nine `infra/i18n/<code>.ts` (subject, heading, section headings, intro and closing of the factual draft, footer line, reminder email). Italian uses "Lei", Slovenian vikanje in sentences and the singular imperative on buttons (ADR 0019); wording terms from `docs/design/wording.md`.
- Dates through `Intl.DateTimeFormat(serverTexts(lang).intl)`.

## 14. Open questions (recommended answer first)

1. **Can a summary be sent without review (auto-send)?** **Decided by the owner (2026-10-19): never.** Every summary is reviewed and sent by the manager; no automatic or timed sending is planned. The AI reads client-written chat (prompt injection, §5) and speaks for eGrant.
2. **On by default for every group?** Recommended: **yes, drafts on by default**; nothing is sent without a manager, and groups with no activity are skipped without an AI call. Managers turn a group off with one checkbox.
3. **One language per summary or a translation per recipient?** Recommended: **one text language per summary** (the recipients' majority), with headings, dates and the footer in each recipient's language. An AI translation per recipient would send text nobody reviewed.
4. **Ticket chats as a source?** Recommended: **no** (minimization: they hold requesters' personal data and are often one person's matter). Resolved tickets are listed by subject only.
5. **Which day and hour?** Recommended: **drafts Friday 07:00, reminder Friday 09:00**, so the manager sends Friday morning. An env `WEEKLY_SUMMARY_CRON` is not added unless the owner wants another day.
6. **Do clients see sent summaries in the app?** Recommended: **not now**; the archive (§7.3) is for admins. A later "Týždenné prehľady" card on the Overview tab can read the `sent` rows (they are kept permanently).
7. **Can any admin send when the manager is away?** Recommended: **no**; another admin makes themselves a manager of the group (one click on the groups page) and then sends. This keeps one rule.
8. **Do managers get a copy of the sent email?** Recommended: **no**, the editor and the archive show the sent text; the test email is for the look.
9. **Do a deactivated group's reports stay in the archive?** Recommended: **yes**, read-only and marked "(deaktivovaná)" in the client picker: the archive is the record of work done for that client. The global search never shows them (owner decision, 2026-10-19, for everything of a deactivated group), and the archive is not part of the global search. If the owner wants the archive to hide them too, it is one `deactivated_at is null` join on `groups`.

## 15. ADR

A new ADR (`ADR-XXXX`, number assigned by the orchestrator): "Weekly client summaries: AI draft, mandatory human send, own unsubscribe". It records: AI drafts only from client-visible sources, never sent without a manager (no auto-send, owner decision); every report kept permanently as the per-client archive, drafts never expired or replaced (revisions); the factual fallback; the summary's own opt-out (not the bulk email subscription, not the notification channels) with RFC 8058 headers on a transactional sender; one text language per summary.

## 16. Docs to update when built

New `docs/product/weekly-summary.md`; `product/README.md`; `architecture/permissions.md` (a "Weekly summaries" section, the archive included), `data-model.md` (seven tables, two new source indexes, the archive indexes, permanent retention), `realtime.md` (the event), `performance.md` (the EXPLAIN results), `overview.md` (the module and its jobs); `glossary.md` ("Týždenný prehľad"); `decisions/README.md` (the ADR); `design/wording.md` (the section names in nine languages). The orchestrator links this spec and the plan from `roadmap.md`.
