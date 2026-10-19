# 0061 Translating received messages: one stored translation per text and language

Date: 2026-10-19
Status: accepted

## Context
Phase 28's composer translates what a person is about to send into the client's language, in groups whose eGrant instance is not on `.sk` (Czech, Slovenian, Croatian … foundations). The other direction was missing: an admin reading a Czech client's message, or a Slovenian client reading an admin's Slovak answer, had to copy it into an outside tool. The owner asked that every person who reads a message written by someone else in such a group can translate it into their own UI language (their profile language, one of the nine), in the group chat, thread replies, task and ticket chats, and the ticket description. A message is read by many people, often with the same language, and clicked again on every visit; asking the model each time would multiply the cost for the same text.

## Decision
- **Two endpoints in the AI module**: `POST /messages/:id/translate` and `POST /tickets/:id/translate` (`modules/ai/translate-routes.ts`). Access is the owning module's exported functions only: `findReadableMessage` of the chat (404 for a missing, unreadable or deleted message, as every chat route) and `getTicketRow` + `actorReadsTicket` of the tickets. The core of the composer's tools (`text-routes.ts`) then refuses with 403 the reader's own text (a ticket's author is `createdBy`, else its initiator) and any group that is the admin group or has no or a `.sk` eGrant link (the composer's Translate gate). AI off is 503, an empty text 400.
- **The target is the reader's profile language**, never chosen in the request. The model returns the translation and the ISO 639-1 code of the source language (a strict `{ text, source_language }` schema on the composer's model and prompt style; mention tokens `<@id>`, links and Markdown are kept). When the source is the target, the original comes back with `unchanged: true`.
- **A table `ai_translations`** (migration 0067): `message_id` or `ticket_id` (exactly one, each a cascading FK, unique with `language` by a partial index), `language`, `source_hash` (SHA-256 of the translated text), `source_language`, `text`, `unchanged`. A request first looks up its row (one index lookup) and serves it only while the hash is the current text's; only a miss calls the model and counts against the composer's per-user limits (20 a minute, 300 a day). Each call is logged with `logCall` (no text; `cached` true or false).
- **Invalidation**: the chat calls a new body hook (`chat/body-hooks.ts`, `onMessageBodyChange`) inside the edit and delete transactions, and the AI module deletes that message's rows there; a ticket's rows go on its `updated` change (`onTicketChange`). The hash also stops a translation that raced an edit from being served.
- **Offered by the AI tools answer**: `GET /channels/:id/ai-tools` (and the group's) carries `translateIncoming: true` when AI is on and the group is foreign, for every reader of the channel, a ziadatel in a ticket chat too. The web shows Translate on others' messages there, and the translation in place of the text with "Translated from <language>" and "Show original".

## Consequences
- One model call per message, language and version, whoever asks; a second reader with the same language is answered from the table, without a limit.
- The table grows with the translated messages (at most nine rows each) and loses them with their message, ticket, channel or group; a deleted message keeps no translated copy of its text.
- The fake text tools translate a received message as `[<Language>] <text>`; a leading `[xx]` tag is its language, else German, so dev and e2e need no key.
- A ticket's subject is not translated, only its description.
