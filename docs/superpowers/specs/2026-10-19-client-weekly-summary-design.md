# Weekly client summary: design

Date: 2026-10-19
Status: **draft, waiting for the owner's review** (the open questions in §14 carry a recommended answer each).
Plan: [../plans/2026-10-19-client-weekly-summary.md](../plans/2026-10-19-client-weekly-summary.md)
Implementation starts only after the phases in flight are done (owner instruction, 2026-10-19); the final e2e run comes after all of them.

## 1. Goal

Once a week every client group gets one email from its eGrant team that answers three questions:

1. **What we did this week** (finished tasks, resolved tickets).
2. **What we need from you** (tasks waiting for the client).
3. **What is coming** (deadlines of open tasks and project events in the next 14 days).

The AI prepares a **draft** per group from what the group's clients may already see in Help. The group's **manager** (an admin in `group_managers`) reviews it, edits it and sends it from the app. Nothing reaches a client without a person pressing Send. When the AI is off or fails, the draft is a plain, factual list built without AI, so the feature works without OpenAI.

Not in scope: an archive of sent summaries for clients in the app (§14 Q6), automatic sending, summaries for the admin group, summaries for requesters (žiadatelia), SMS or push to clients.

## 2. Users and roles

| who | what they do |
| --- | --- |
| Group manager (admin with a `group_managers` row for the group) | reads, edits, regenerates, test-sends, sends or skips the group's draft; turns the group's summaries on or off; gets the "drafts are ready" reminder if they want it |
| Any other admin, the superadmin included | reads every draft and its preview (read-only); cannot edit, send, skip or change the group setting (403) |
| Client (active `client` membership, verified email, active account) | receives the email in their own language; can turn it off per group in the profile or with the link in the email |
| Žiadateľ (requester only) | never receives it, never sees anything (they do not read the group) |

Why managers only (not every admin): the summary speaks for the eGrant team to one client; the person responsible for the client signs it off. A group with no active manager gets **no draft** (nobody would review it) and the groups page already shows such groups.

## 3. The weekly cycle

All times are Europe/Bratislava.

| when | job | what happens |
| --- | --- | --- |
| Friday 07:00 | `weekly-summary.prepare` (cron `0 7 * * 5`, `tz: 'Europe/Bratislava'`) | expires last week's unsent drafts, lists the eligible groups in one query and sends one `weekly-summary.draft` job per group (`sendMany`) |
| right after | `weekly-summary.draft` (one per group, `localConcurrency: 2`) | collects the facts, asks the AI (60 s timeout) or builds the factual draft, stores it, pushes `weekly-summary:changed` |
| Friday 09:00 | `weekly-summary.remind` (cron `0 9 * * 5`) | one email per manager who wants reminders and has drafts of this week in status `draft` |
| when a manager sends | `weekly-summary.send` | emails the frozen recipients, 20 a run, then marks the summary `sent` |
| daily 04:10 | `weekly-summary.purge` | deletes recipient rows older than 90 days and summaries older than 400 days |

**Eligible group** (one SQL query, §9): `kind = 'client'`, `deactivated_at is null`, not turned off (`weekly_summary_group_settings.enabled = false`), at least one active manager, at least one recipient (§8), no row yet for this week. A group with **no facts and no client-visible messages in the window** gets a row in status `skipped` with `skipReason = 'no_activity'` and no AI call, so "nothing happened" is visible in the list but no one is asked to review it.

**Week and window.** `week` is the ISO week of the prepare moment (`2026-W43`, text, sorts correctly). The window ends at the prepare moment and starts at the previous row's `window_end` for the group (any status), or 7 days earlier when there is none; it is never longer than 14 days. So a skipped or expired week is not lost silently: the next draft covers the gap up to 14 days. A draft that is not sent before the next Friday's prepare becomes `expired`.

**Statuses** of `weekly_summaries.status`: `preparing` → `draft` → `sending` → `sent`; `draft` → `skipped` (a manager chose "Tento týždeň neposielať", or no activity); `draft` → `expired` (next prepare); `draft` → `preparing` (regenerate) → `draft`.

## 4. Sources: only what the clients already see

The draft is built from **facts** (structured rows) and **messages** (chat text for the AI to pick highlights from). Every source is a function exported by the module that owns the table (modules never read each other's tables), limited and indexed (§9):

| section | source | owner and function | limit |
| --- | --- | --- | --- |
| done | tasks of the group with `completed_at` in the window | `tasks/weekly-facts.ts` `doneTasksOf` | 50 |
| done | tickets of the group with `resolved_at` in the window | `tickets/weekly-facts.ts` `resolvedTicketsOf` | 50 |
| waiting | open tasks in the group's `client_review` bucket ("Na kontrole u klienta") | `tasks/weekly-facts.ts` `waitingOnClientTasksOf` | 50 |
| upcoming | open tasks with `due_date` from tomorrow to +14 days | `tasks/weekly-facts.ts` `dueTasksOf` | 50 |
| upcoming | events of active projects with `occurs_on` from tomorrow to +14 days | `projects/weekly-facts.ts` `upcomingEventsOf` | 50 |
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

New module `modules/weekly-summary` owns six tables (migration `00XX_client-weekly-summary`, one migration; numbers assigned by the orchestrator). Every foreign key leads an index (`foreign-key-indexes.test.ts`).

```
weekly_summaries
  id               text pk (uuid)
  group_id         text not null → groups.id on delete cascade
  week             text not null                    -- 'YYYY-Www', check ~ '^\d{4}-W\d{2}$'
  window_start     timestamptz not null
  window_end       timestamptz not null             -- check window_end > window_start
  status           text not null default 'preparing' -- check in ('preparing','draft','sending','sent','skipped','expired')
  skip_reason      text                             -- check in ('no_activity','manager') or null
  source           text                             -- check in ('ai','facts'); null while preparing
  ai_failed        boolean not null default false
  language         text not null default 'sk'       -- languageIn(...)
  content          jsonb not null                   -- WeeklySummaryContent (§6.1), validated by zod on every write
  version          integer not null default 1       -- bumped by every write; optimistic concurrency
  updated_by       text → user.id on delete set null
  sent_by          text → user.id on delete set null
  sent_at          timestamptz
  created_at, updated_at timestamptz not null default now()
  unique (group_id, week)                           -- idempotent prepare; the latest week of a group (order by week desc)
  index  (week, status, group_id)                   -- the list and the reminder
  index  (status, created_at) where status in ('preparing','sending')  -- the stuck-job sweep
  index  (updated_by), index (sent_by)

weekly_summary_recipients        -- frozen at Send (insert … select)
  summary_id  text → weekly_summaries.id on delete cascade
  user_id     text → user.id on delete cascade
  email       text not null
  language    text not null (languageIn)
  status      text not null default 'pending'   -- check in ('pending','sent','failed')
  sent_at     timestamptz
  pk (summary_id, user_id); index (user_id); index (summary_id) where status = 'pending'

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

## 7. API

All under `/api`, JSON, zod schemas in `packages/shared`. Rate limits per acting user unless noted. Writes push `weekly-summary:changed` after commit (§10).

| route | who | answer |
| --- | --- | --- |
| `GET /weekly-summaries?week=&scope=mine\|all&status=review\|sent\|all&cursor=&limit=` | admins (`requireAdmin`) | `{ items: WeeklySummaryListItem[], nextCursor }`, keyset by `(group name, id)` within one week; `scope=mine` (default) = `managedGroupIds`, an admin who manages none sees all; `week` default the current one |
| `GET /weekly-summaries/:id` | admins | `WeeklySummaryDto` (§7.1) with `canEdit` |
| `PATCH /weekly-summaries/:id` `{ version, content, language? }` | the group's manager | the DTO; `409 stale_version` with the current DTO; `409 not_draft` unless `draft` |
| `POST /weekly-summaries/:id/regenerate` `{ version, language? }` | manager | `202`, status `preparing`; a draft job runs again (AI, fallback); 10 an hour per admin, `429 rate_limited` |
| `POST /weekly-summaries/:id/preview` `{ language }` | admins | `{ subject, html, text }` of the email as a recipient in `language` gets it (unsubscribe link is a dummy) |
| `POST /weekly-summaries/:id/test` | manager | `204`; the email in the admin's language to the admin's own address only, subject prefixed "[Test]"; 10 an hour |
| `POST /weekly-summaries/:id/send` `{ version }` | manager | `202 { recipients: n }`, status `sending`; `409 stale_version`; `409 refs_changed` with the corrected DTO (§7.2); `409 no_recipients`; `409 not_draft` |
| `POST /weekly-summaries/:id/skip` `{ version }` | manager | the DTO, status `skipped`, `skip_reason = 'manager'` |
| `GET /groups/:id/weekly-summary/settings` | admins | `{ enabled, canEdit }` |
| `PUT /groups/:id/weekly-summary/settings` `{ enabled }` | manager | `{ enabled }`; turning off does not touch an existing draft |
| `GET /me/weekly-summary` | any client | `{ groups: { groupId, name, subscribed, enabled }[] }` for their active client groups |
| `PUT /me/weekly-summary/:groupId` `{ subscribed }` | client of that group (`canReadGroup`, else 404) | `{ subscribed }` |
| `GET /me/weekly-summary/reminder`, `PUT …` `{ remind }` | admins | `{ remind }` |
| `GET /weekly-summary/unsubscribe/:token`, `POST …/unsubscribe/:token`, `POST …/unsubscribe/:token/one-click` | public, signed token | `{ groupName, language, subscribed }`; 30 a minute per IP; CSRF exempt; bad or forged token `404` |

Unknown ids and malformed ids answer `404 not_found`. A client calling an admin route gets `403 forbidden` (as `requireAdmin` does everywhere); a non-manager admin calling a manager route gets `403 forbidden`.

### 7.1 DTOs

`WeeklySummaryListItem`: `{ id, groupId, groupName, week, status, skipReason, source, aiFailed, itemCount, recipientCount, updatedAt, sentAt, managedByMe }`.
`WeeklySummaryDto`: list item fields + `{ windowStart, windowEnd, language, content, version, canEdit, recipients: { name, language }[] /* who would get it now, or who got it */, refs: Record<itemId, { kind, title, url }> /* app links for the editor */ }`. Recipients' emails are never sent to the web (names and languages are enough to review).

### 7.2 Send

In one transaction under `select … for update` of the summary row: check `status = 'draft'` and `version`; check every `ref` still belongs to the group and is client-readable (`taskRefsInGroup`, `ticketRefsInGroup`, `eventRefsInGroup`, exported by their modules: a ticket moved to another client, a deleted task or event fails). If any fails, drop those items, bump the version, store and answer `409 refs_changed` with the new DTO: the manager sees what changed and presses Send again. Otherwise freeze the recipients (`insert … select`, §8), set `status = 'sending'`, `sent_by`, bump the version, and after commit send one `weekly-summary.send` job. The job takes up to 20 `pending` rows with `for update skip locked`, renders each person's email, queues it with `sendEmailLater` (the email job retries), marks the row `sent`; it sends itself again while rows are left; with none left it sets `status = 'sent'`, `sent_at` and pushes the change. A crash leaves rows `pending` and the five-minute sweep (`weekly-summary.sweep`, cron `*/5 * * * *`) re-sends jobs for summaries stuck in `sending` or `preparing` for over 10 minutes.

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
- EXPLAIN checks (ADR 0040) on the seeded `home` volume (3 100 groups): the eligibility query, the six source queries and the list page must not seq-scan `groups`, `tasks`, `tickets`, `project_events`, `messages`, `channels`, `weekly_summaries`; with `RUN_BENCH=1` each source query under 30 ms and the eligibility query under 200 ms.
- AI calls run in jobs, at most two at a time, never inside a request (the regenerate route answers 202 at once).

## 10. Realtime

`weekly-summary:changed` `{ id, groupId, week, status, version }` to `ADMINS_ROOM` after every commit (draft stored, edited, regenerated, sending, sent, skipped, expired). The list and the editor invalidate their queries on it (2 s debounce). The editor compares `version`: another manager's save shows "Koncept medzitým upravil {meno}. Načítať novú verziu?" instead of overwriting the textareas. Clients get no event (they never see drafts).

## 11. Security and privacy

- Policy functions (`modules/weekly-summary/policy.ts`, test-first): `canReadWeeklySummaries(actor) = isAdmin(actor)`; `canManageWeeklySummary(actor, managesGroup: boolean) = isAdmin(actor) && managesGroup`; `canSetMyWeeklySummary(actor, groupId, actorGroupIds) = actor.role === 'client' && actorGroupIds.includes(groupId)`. `managesGroup` comes from `isGroupManager(db, groupId, actor.id)` (groups module, active admins only).
- Sources are client-visible only (§4); refs are re-checked at Send (§7.2), so a ticket moved to another client between draft and send never leaks its subject.
- Recipient emails stay on the server; the DTO has names only. The test email goes only to the acting admin's own address.
- The AI gets text and names only (§4); the provider never logs prompts or answers; its log line has `groupId`, outcome, duration and token usage only.
- The unsubscribe routes act only on the token's person and group, tell only `{ groupName, language, subscribed }`, answer 404 for a bad token or a removed person, and are limited per IP.
- CSP (ADR 0044): the preview is shown in an `<iframe srcdoc sandbox="">` like the bulk email preview; it uses only our own origin's images (the logo), so the policy is unchanged. No new third-party source.
- Retention: recipient rows (emails) are deleted after 90 days, summaries after 400 days (`weekly-summary.purge`).
- Deactivating a group stops new drafts; existing drafts can still be read by admins but not sent (`409 group_inactive`).

## 12. UX (Slovak is the source language)

### 12.1 Admin home card (namespace `adminHome`)

A card "Týždenné prehľady" shown on Fridays to Mondays when the admin manages a group with a draft: "Na kontrolu: 3" and a button "Skontrolovať". The count comes from `GET /api/me/home/counts` (`weeklySummaries`, via the exported `pendingDraftCount(db, adminId, week)`), so the home makes no extra request.

### 12.2 List `/weekly-summaries` (lazy route, admins)

- Title "Týždenné prehľady", subtitle "Týždeň 43 · 13. 10. – 17. 10. 2026", week arrows "Predchádzajúci týždeň" / "Nasledujúci týždeň".
- Filter pills "Moji klienti" / "Všetci" (remembered with `useRememberedFilters`) and "Na kontrolu" / "Odoslané" / "Všetky".
- A row per group: logo, name, status chip, "AI" or "Iba fakty", item count "8 bodov", recipients "4 príjemcovia", last change. Status chips: "Pripravuje sa", "Koncept", "Odosiela sa", "Odoslané", "Neposiela sa", "Bez aktivity", "Prepadlo".
- Empty: "Tento týždeň nie je čo kontrolovať."

### 12.3 Editor `/weekly-summaries/$summaryId` (lazy route)

- Header: group name, week, status chip, "Pripravené s AI – pred odoslaním text skontrolujte." or, when `aiFailed`, a yellow note "AI nebola dostupná. Koncept obsahuje iba fakty; môžete ho doplniť alebo skúsiť AI znova."
- Fields: "Úvod" (textarea); three sections "Čo sme urobili", "Čo od vás potrebujeme", "Čo nás čaká", each a list of items (textarea, a small link "Otvoriť úlohu" / "Otvoriť tiket" / "Otvoriť udalosť" when it has a ref, buttons "Vyššie", "Nižšie", "Odstrániť") and "Pridať bod"; "Záver" (textarea).
- "Jazyk textu" select (nine languages) with the hint "Nadpisy e-mailu dostane každý príjemca vo svojom jazyku."
- Recipients: "Dostanú ho: Jana Nováková (sk), Marco Rossi (it)". None: "Skupina nemá komu poslať prehľad (žiadny overený klient)."
- Actions: "Uložiť" (also on leaving a changed field after 1 s idle), "Náhľad", "Poslať skúšobný e-mail mne", "Pripraviť znova s AI" (confirm "Pripraviť koncept znova? Vaše úpravy sa stratia."), "Tento týždeň neposielať", primary "Poslať klientom".
- Send confirmation: "Poslať prehľad 4 príjemcom? Odoslaný e-mail sa už nedá zmeniť." / "Poslať" / "Zrušiť". `refs_changed`: "Niektoré body už neplatia (úloha bola zmazaná alebo tiket presunutý) a boli odstránené. Skontrolujte koncept a pošlite ho znova."
- Read-only for an admin who is not the manager: "Tento prehľad môže upraviť a poslať manažér skupiny." Sent: read-only with "Odoslané {dátum} · {meno}".
- Preview dialog: language select and the email in a sandboxed iframe.
- Settings strip: checkbox "Pripravovať týždenný prehľad pre túto skupinu" (managers), and "Pripomenúť mi koncepty e-mailom" (the admin's own).

### 12.4 Group Overview (namespace `projects`, admins only)

A small line on the group's Prehľad tab for admins: "Týždenný prehľad: Koncept · Skontrolovať" (or "Vypnutý"), linking to the editor; nothing for clients.

### 12.5 Client profile (namespace `notifications`)

Section "Týždenný prehľad e-mailom", text "Raz týždenne vám pošleme, čo sme urobili, čo od vás potrebujeme a čo nás čaká.", one checkbox per group. A group whose summaries are off shows "(skupina ho momentálne nedostáva)".

### 12.6 Unsubscribe page `/weekly-summary/unsubscribe/$token` (namespace `unsubscribe`)

"Odhlásili ste sa z týždenného prehľadu skupiny {skupina}." and a button "Znova prihlásiť". A bad link: "Odkaz je neplatný alebo už neplatí."

### 12.7 Manager reminder email (server texts)

Subject sk "Týždenné prehľady na kontrolu: 3", body "Pripravili sme koncepty týždenných prehľadov pre vašich klientov: Firma A, Firma B a 1 ďalší. Skontrolujte ich a pošlite.", button "Skontrolovať".

## 13. i18n

- Web: new namespace `apps/web/src/locales/weeklySummary/<code>.json` for all nine languages, registered on the two routes with `withNamespaces(['weeklySummary'])`; new keys in the existing lazy namespaces `adminHome`, `projects`, `notifications`, `unsubscribe`. No key in the eager `<code>.json`.
- Server: `ServerTexts.weeklySummary` in all nine `infra/i18n/<code>.ts` (subject, heading, section headings, intro and closing of the factual draft, footer line, reminder email). Italian uses "Lei", Slovenian vikanje in sentences and the singular imperative on buttons (ADR 0019); wording terms from `docs/design/wording.md`.
- Dates through `Intl.DateTimeFormat(serverTexts(lang).intl)`.

## 14. Open questions (recommended answer first)

1. **Can a summary be sent without review (auto-send)?** Recommended: **no**, not in this phase. The AI reads client-written chat (prompt injection, §5) and speaks for eGrant; a person signs it off. Revisit after a few weeks of drafts with a per-group "send automatically on Monday if not reviewed" switch.
2. **On by default for every group?** Recommended: **yes, drafts on by default**; nothing is sent without a manager, and groups with no activity are skipped without an AI call. Managers turn a group off with one checkbox.
3. **One language per summary or a translation per recipient?** Recommended: **one text language per summary** (the recipients' majority), with headings, dates and the footer in each recipient's language. An AI translation per recipient would send text nobody reviewed.
4. **Ticket chats as a source?** Recommended: **no** (minimization: they hold requesters' personal data and are often one person's matter). Resolved tickets are listed by subject only.
5. **Which day and hour?** Recommended: **drafts Friday 07:00, reminder Friday 09:00**, so the manager sends Friday morning. An env `WEEKLY_SUMMARY_CRON` is not added unless the owner wants another day.
6. **Do clients see sent summaries in the app?** Recommended: **not now**; a later "Týždenné prehľady" card on the Overview tab can read the `sent` rows (the data is kept 400 days).
7. **Can any admin send when the manager is away?** Recommended: **no**; another admin makes themselves a manager of the group (one click on the groups page) and then sends. This keeps one rule.
8. **Do managers get a copy of the sent email?** Recommended: **no**, the editor shows the sent text; the test email is for the look.

## 15. ADR

A new ADR (`ADR-XXXX`, number assigned by the orchestrator): "Weekly client summaries: AI draft, mandatory human send, own unsubscribe". It records: AI drafts only from client-visible sources, never sent without a manager; the factual fallback; the summary's own opt-out (not the bulk email subscription, not the notification channels) with RFC 8058 headers on a transactional sender; one text language per summary.

## 16. Docs to update when built

New `docs/product/weekly-summary.md`; `product/README.md`; `architecture/permissions.md` (a "Weekly summaries" section), `data-model.md` (six tables, two new indexes), `realtime.md` (the event), `performance.md` (the EXPLAIN results), `overview.md` (the module and its jobs); `glossary.md` ("Týždenný prehľad"); `decisions/README.md` (the ADR); `design/wording.md` (the section names in nine languages). The orchestrator links this spec and the plan from `roadmap.md`.
