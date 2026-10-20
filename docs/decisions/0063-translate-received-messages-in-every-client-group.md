# 0063 Translating received messages in every client group, into the language the reader sees

Date: 2026-10-21
Status: accepted (amends [ADR 0061](0061-translate-received-messages-stored-per-language.md))

## Context
After ADR 0061 shipped, the owner reported that translating another person's message did not work for the clients of foreign eGrant instances. The production data showed why the instance link was the wrong gate:
- The foreign foundations (cnvos.egrant.si, cfslagalica.egrant.hr) have no group in Help at all. Their tickets arrive without a client (`group_id` null), and the ticket route refused those with 403; the web never offered Translate on them.
- A foreign person also writes in a group whose instance is on `.sk` (a Ukrainian or English-speaking member of a Slovak client). The gate (`egrantUrl` not on `.sk`) refused those messages with 403 and hid the action.
- The target was the reader's profile language. The web stores the UI language there on every app start, so with two devices (a phone in Ukrainian, a computer in Slovak) the profile holds the language of the device opened last. A reader could get "Already in Ukrainian" on a screen in Slovak, which looks like a failure.

## Decision
- **Every client group offers it, never the admin group's chat.** `translatesIncoming` in `modules/ai/text-routes.ts` no longer looks at the eGrant link. The model tells the source language anyway, and a text already in the reader's language comes back `unchanged`. That answer is stored like any other, so it costs one call per message and language.
- **A ticket without a client translates its description for admins**, who are the only ones to read it. `GET /api/ai/admin/ai-tools` carries `translateIncoming: true` when AI is on, and the ticket page asks it for a ticket without a client.
- **The target is the language the reader sees**: the first of the nine languages in the request's `Accept-Language` (the web sends `i18n.language` on every call), else the profile language. The request still chooses no other language. There are at most nine stored rows per text, as before.
- The cost guard stays: the per-text, per-language store and the composer's per-user limits (20 a minute, 300 a day) on model calls only.
- The composer's own Translate (into the client's language) keeps its `.sk` gate: it needs a client language, and only the instance's domain tells it.

## Consequences
- In Slovak groups Translate also shows on others' messages. A Slovak reader who clicks it on a Slovak text gets "Already in Slovak" after one stored model call.
- Old clients keep working: the answer's shape did not change, only when `translateIncoming` is sent.
