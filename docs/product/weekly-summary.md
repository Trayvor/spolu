# Weekly client summaries (Týždenný prehľad)

Built 2026-10-19 from the [design](../superpowers/specs/2026-10-19-client-weekly-summary-design.md) and [plan](../superpowers/plans/2026-10-19-client-weekly-summary.md); decision: [ADR 0055](../decisions/0055-weekly-client-summaries.md).

Once a week every client group gets one email from its eGrant team: **what we did** (finished tasks, resolved tickets), **what we need from you** (open tasks in "Na kontrole u klienta") and **what is coming** (open task deadlines and events of active projects in the next 14 days). The AI drafts it from what the group's clients already see in Help; the group's **manager** reviews, edits and sends it. **Nothing reaches a client without a manager pressing Send** (owner decision, no automatic sending). Without AI, or when it fails, the draft is a plain list of the facts.

**Every report is kept permanently**, sent or not: a draft never expires and is never replaced; a regeneration or a restore keeps the replaced text as a revision. The rows form the **archive of work reports per client** (Archív prehľadov), searchable by client, days and text.

## The weekly cycle (Europe/Bratislava)

| when | job | what happens |
|---|---|---|
| Friday 07:00 | `weekly-summary.prepare` | one query lists the eligible groups (an active client group not turned off, with an active manager, someone to send to and no row for the week) and inserts a `preparing` row each (`on conflict (group_id, week) do nothing`), then one `weekly-summary.draft` job per new row; earlier weeks' rows are never touched |
| right after | `weekly-summary.draft` (two at a time, 1 s poll: pg-boss waits the poll interval after every job, so with the 30 s NOTIFY backstop a Friday with many groups would draft two every 30 s) | collects the facts; a first draft with no facts and no messages becomes `skipped` / `no_activity` without an AI call; otherwise the AI answer (60 s timeout) or the factual draft; `draft` |
| Friday 09:00 | `weekly-summary.remind` | one email per manager who wants reminders and has drafts of the week (once a week per manager) |
| on Send | `weekly-summary.send` | emails 20 frozen recipients a run, then `sent` |
| every 5 minutes | `weekly-summary.sweep` | a row stuck in `preparing` or `sending` for over 10 minutes gets its job again |
| daily 04:10 | `weekly-summary.purge` | blanks recipient email addresses older than 90 days; the rows (name, language, `sent_at`) stay |

The window ends at the prepare moment and starts at the end of the group's latest row (any status), at most 14 days back, 7 days when there is none. An unsent draft of an earlier week stays a draft of its own week; it can still be sent late or marked "Tento týždeň neposielať".

Statuses: `preparing` → `draft` → `sending` → `sent`; `draft` → `skipped` (a manager, or no activity); `draft` → `preparing` (regenerate) → `draft`. No status changes by time alone.

## Sources

Only what the group's clients read, through functions of the owning modules (`tasks/weekly-facts.ts`, `tickets/weekly-facts.ts`, `projects/weekly-facts.ts`, `chat/weekly-facts.ts`), 50 facts each: tasks completed in the window, tickets resolved in it (number and subject only), open `client_review` tasks, open tasks due in the next 14 days, events of active projects in the next 14 days, and (for the AI only) the newest 150 live messages of the group chat and the group's task chats (500 characters each, 40 000 in all; a mention of someone outside the group is `@?`). Never knowledge, meetings, finance, ticket chats or the admin group. Only text and names go to the AI; facts carry opaque keys (`t1`, `k1`, `e1`) mapped back on the server, and `sanitizeWeeklyDraft` drops unknown keys, cuts texts and sections and keeps markup as text (the email escapes it).

The draft's text language is the recipients' most common language (a tie or nobody: sk); the manager can change it. The email's headings, button and footer are in each recipient's own language.

## Recipients and opting out

A recipient is a verified, named, active client member of the group whose account is not disabled and who has not turned the summary off for the group; never a žiadateľ, an admin or a manager. They are taken at Send (frozen in `weekly_summary_recipients` with name and language), not at draft time. The summary is a service email, not a campaign: it reads neither the bulk email subscription nor the notification channels. A client turns it off per group in Settings → Notifications ("Týždenný prehľad e-mailom") or with the email's personal link (`/weekly-summary/unsubscribe/<token>`, the token an HMAC of user and group with `APP_SECRET`), which also backs the RFC 8058 `List-Unsubscribe` one-click header; the page offers "Znova prihlásiť".

## Screens (admins)

- **Home card** "Týždenné prehľady · Na kontrolu: 3" (Friday to Monday, from the header counts `weeklySummaries`).
- **`/weekly-summaries`**: one ISO week (arrows), "Moji klienti" / "Všetci" and "Na kontrolu" / "Odoslané" / "Všetky" (remembered), a row per group with status, "AI" or "Iba fakty", item and recipient counts; a line for older unsent drafts linking to the archive; the archive link.
- **`/weekly-summaries/$summaryId`**: the editor (intro, the three sections as textareas with Up / Down / Remove / Add, closing, text language), autosave 1 s after the last change with the row's `version`; while a save is on its way the buttons and the autosave wait for it, so a second save never sends the same, by then old, version (a `409 stale_version` asks "Koncept medzitým upravil … Načítať novú verziu?" and keeps the typed text), preview in a sandboxed `srcdoc` iframe, a test email to the admin only, "Pripraviť znova s AI" (asks first; the text becomes a revision), "Tento týždeň neposielať", "Predchádzajúce verzie" with restore, and "Poslať klientom" (asks with the count; `409 refs_changed` shows the corrected draft). Read-only for an admin who is not the group's manager, and once sent. The settings strip: the group switch (managers) and "Pripomenúť mi koncepty e-mailom".
- **`/weekly-summaries/archive`**: filters in the URL, read as text (the router parses `?q=2026` as a number) (client picker with deactivated groups marked "(deaktivovaná)", Od / Do, text with matches marked, Všetky / Odoslané / Neodoslané), the full reports, 20 a page.
- **Group Prehľad tab** (admins): "Týždenný prehľad: Koncept · Skontrolovať" (or "Vypnutý") and "Archív prehľadov" for the group.

## API

See [permissions.md](../architecture/permissions.md#weekly-summaries-2026-10-19) for who may call what. Routes under `/api`: `GET /weekly-summaries` (list, plus `olderDrafts`), `GET /weekly-summaries/archive`, `GET /weekly-summaries/groups?q=` (the archive's picker, deactivated groups included), `GET|PATCH /weekly-summaries/:id`, `POST …/:id/regenerate` (202, 10 an hour), `GET …/:id/revisions`, `POST …/:id/revisions/:revisionId/restore`, `POST …/:id/preview`, `POST …/:id/test` (10 an hour), `POST …/:id/send` (202), `POST …/:id/skip`, `GET|PUT /groups/:id/weekly-summary/settings`, `GET /me/weekly-summary`, `PUT /me/weekly-summary/:groupId`, `GET|PUT /me/weekly-summary/reminder`, and the public `GET|POST /weekly-summary/unsubscribe/:token`, `POST …/:token/one-click`, `POST /weekly-summary/subscribe/:token` (30 a minute per IP, CSRF exempt).
