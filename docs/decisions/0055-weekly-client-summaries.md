# 0055 Weekly client summaries: AI draft, mandatory human send, own unsubscribe

Date: 2026-10-19
Status: accepted

## Context
The owner wants every client group to get a weekly email from its eGrant team (what we did, what we need from you, what is coming), drafted with AI from Help's data ([spec](../superpowers/specs/2026-10-19-client-weekly-summary-design.md)). The AI reads chat that clients write, so a message can try to steer it; the email speaks for eGrant; and the reports are also wanted as a permanent record of the work done for each client.

## Decision
- **AI drafts only from client-visible sources** (the group's tasks, tickets by subject, events of active projects, live group and task chat messages), read through functions of the owning modules, with opaque fact keys and only text and names sent to the model (the task split's OpenAI model, strict JSON schema, 60 s timeout, in a job). Its answer is sanitized on the server and rendered as escaped text.
- **Never sent without a manager** (owner decision, now or later): the group's manager reviews, edits and presses Send; a Send re-checks every cited task, ticket and event against the group in the same transaction.
- **Kept permanently**: no status expires, no job deletes or replaces a report; a regeneration or a restore stores the replaced content as a revision first. The rows are the per-client archive, with a trigram index on the folded `search_text`; only recipient email addresses are blanked after 90 days.
- **The factual fallback**: without AI, on a failure or an empty answer, the draft is the list of facts with a fixed intro and closing (`source = 'facts'`, `ai_failed` when the AI failed), so the feature works without OpenAI.
- **Its own opt-out**: the summary is a recurring service email, so it reads neither the bulk email subscription (ADR 0016/0024) nor the notification channels; a client turns it off per group, in the profile or through a signed per-person link (HMAC with `APP_SECRET`, nothing stored). The transactional senders now pass extra headers through (`EmailMessage.headers`), so the email carries the RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers; `buildEmail` gains footer lines for the link.
- **One text language per summary** (the recipients' majority, changeable), with headings, dates and the footer in each recipient's language; no per-recipient AI translation nobody reviewed.

## Consequences
- No new dependency; four new pg-boss jobs on cron and two on demand (`modules/weekly-summary/jobs.ts`).
- A prompt injection through chat can at worst produce an odd draft that a manager reads before sending; it can cite only facts the server gave.
- The archive grows by about 52 rows per client a year and is never purged; every archive query is bounded and checked by EXPLAIN on a 483 600-row volume.
