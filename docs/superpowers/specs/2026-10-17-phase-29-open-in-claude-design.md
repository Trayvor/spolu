# Phase 29 — Solve with AI ("Vyriešiť s Claude"): design

Owner request of 2026-10-17, approved without a review round (night run); the manager's flow (§4) was fixed by the owner the same night. Roadmap: [Phase 29](../../roadmap.md#phase-29--solve-with-ai). Requirements: [product/solve-with-claude.md](../../product/solve-with-claude.md).

## 1. Goal

An admin looking at a ticket or a task presses **"Vyriešiť s Claude"**, optionally writes notes for Claude, and lands in a new claude.ai chat that already holds everything needed to solve it: the ticket or task, its chat, the notes, the file names, the client's eGrant instance, and instructions to work through the eGrant MCP connector the admin already has in Claude. The admin's own Claude subscription does the work; Spolu runs no AI and has no API cost for it.

## 2. Who

Admins and the superadmin only. Clients and ziadatelia never see the button, and the endpoint answers them 403. The rule is a policy function, `canOpenInClaude(actor)` in `modules/ai/policy.ts`.

## 3. Server: the prompt endpoint

- `POST /api/tickets/:id/claude-prompt` and `POST /api/tasks/:id/claude-prompt`, body `{ notes?: string }` (at most 4 000 characters, `CLAUDE_NOTES_MAX`), answer `{ prompt, files: [{ id, name }] }` (`ClaudePromptRequestSchema`, `ClaudePromptSchema` in `packages/shared/src/open-in-claude.ts`). POST because of the notes; it writes nothing and sends no socket event.
- 401 without a session, 403 for a non-admin (checked before the lookup, so a client cannot probe ids), 400 `validation_failed` for notes that are too long, 404 for an unknown id.
- Formatting is pure and unit-tested (`modules/ai/claude-prompt.ts`); the context is gathered in `modules/ai/claude-context.ts` through the owning modules' exported service functions (`getTicketRow`, `ticketFiles`, `assigneesOf`, `getTask`, `getBucket`, `getGroup`, `listPickablePeople`, `getTicketChannel`, the new `getTaskChannel`, `listRecentMessages`, the new `messageFileNames`). No new table, no migration.

### Content

A first line saying what to solve, the heading (`Tiket #12: subject` or `Úloha: title`) with its link in Help by eGrant, then:

| Ticket | Task |
|---|---|
| status (Nový / V riešení / Vyriešený), client (or "bez klienta"), area, programme, due date, riešitelia, requester (name and email; no phone), the page link the requester sent, created | bucket (Na spracovanie / Kontrola eGrant / Kontrola &lt;klient&gt; / Hotové / custom name), client, urgent, due date, riešitelia, link, the ticket it came from, created by, created |
| text (cut to 6 000 characters) | description (cut to 6 000) |
| file names of the ticket | file names of the task |
| ticket chat | task chat |

Chat: the newest **30** messages that are not deleted (thread replies included), oldest first, each `[2026-10-17 14:05] Name: text` (Europe/Bratislava), mentions as `@Name`, each cut to **1 500** characters with `…`, the names of its files on the next line. "(staršie správy vynechané)" when older messages exist. At most 50 file names are listed.

eGrant instance: the ticket's `instance_url` (normalized), else the client's `egrantUrl`; for a task the client's `egrantUrl`. Without either the prompt says the instance is unknown and Claude asks for it.

The admin's notes, when given, come in their own section ("majú prednosť") before the instructions.

Instructions: use the eGrant MCP connector; find the instance with `admin_instance_list` (query = hostname) and check the hostname; work only on that instance; list its tools with `admin_instance_tools`; only read (`admin_instance_call`) to find the cause. **The first reply must be informative and contain (a) the cause, (b) what or whom it affected if relevant, (c) the steps to solve it, (d) the real, relevant risks if any, (e) the question whether to fix it by this plan.** Until the admin confirms, no change: no `admin_instance_call_write` or anything else that writes; after the confirmation only the approved steps, and a question before any other change. Then a short reply to the client for the chat. Answer in the admin's UI language.

Total cap **20 000** characters (`CLAUDE_PROMPT_MAX`): the oldest messages are dropped first; the header, notes and instructions always stay.

### Files

claude.ai takes no files through the URL. Signed, time-limited download links that Claude could fetch were considered and rejected: the link would stay in the Claude chat history (and in any share of that chat), anyone holding it could download a client's confidential file until it expires, claude.ai's fetcher would need public access to help.egrant.sk, and nothing in the storage serves signed links yet. So the prompt lists **file names only** and tells Claude to ask for a file it needs; the dialog reminds the admin to attach the files in Claude by hand and lists each file as a download link (`/api/files/:id`, the admin's own session).

## 4. Web: the flow (owner, 2026-10-17)

1. **Button** "Vyriešiť s Claude" (outline, small, a spark icon; not the Claude logo): on the ticket page at the end of the header row, in the task panel header before the bucket select (icon only below 641 px). Only for admins; a lazy chunk (`features/open-in-claude/`) with its own locale namespace `openInClaude`, so clients download nothing.
2. **Dialog** (`SheetDialog`): a short intro (what the prompt carries; Claude changes nothing without confirmation), the field "Poznámky pre Claude (nepovinné)" with a placeholder and a hint that says it may stay empty, and **Vygenerovať**, enabled with the field empty.
3. **After generation** the dialog shows "Prompt je pripravený" with:
   - **Otvoriť v Claude**: `https://claude.ai/new?q=<encodeURIComponent(prompt)>` in a new tab when that URL is at most **8 000** characters (`CLAUDE_URL_MAX`); longer, the prompt goes to the clipboard, an empty chat (`https://claude.ai/new`) opens and the dialog says to paste it (Ctrl+V / ⌘V);
   - **Kopírovať prompt**;
   - when there are files: the reminder to attach them in Claude by hand and a download link per file;
   - "Zobraziť prompt" (folded) to read what goes to Claude;
   - "Vygenerovať znova" after changing the notes.
   Clipboard failure says so in the dialog; a failed generation shows "Skúste to znova".

Both actions run straight from a click, so browsers allow the new tab and the clipboard write; the copy starts before the new tab takes the focus.

### Why 8 000 characters

`?q=` travels in the request line to claude.ai. Browsers accept much longer URLs (Chrome about 2 MB), but proxies and CDNs commonly reject request lines or headers above 8 KB (nginx `large_client_header_buffers` 8 k, many load balancers 8–16 KB) with 414/431, which the admin would see as a broken page. 8 000 characters of the whole encoded URL stays under all of them. A Slovak letter with a diacritic encodes to 6 characters and a space to 3, so a ticket with a short chat (about 2 000 characters of prompt, about 3 500 encoded) fits, and a long chat goes through the clipboard.

## 5. Owner decisions (taken for the owner; change on request)

1. **The flow of §4** (owner, fixed). Button label "Vyriešiť s Claude"; the action inside is "Otvoriť v Claude".
2. **Language: the prompt is always Slovak** (the team's working language, the language of the tickets and instances), with "Odpovedaj …" in the admin's UI language (`user.language`). One template to test; the dialog is in all nine UI languages.
3. **URL limit 8 000 characters** of the full URL; longer goes through the clipboard.
4. **Chat window: the newest 30 messages, 1 500 characters each; text 6 000; notes 4 000; at most 50 file names; prompt at most 20 000 characters.**
5. **Files: names only, no signed links** (§3 "Files"); the dialog reminds to attach them and offers download links.
6. **Personal data:** the requester's name and email go into the prompt (they help find the user in the instance); no phone. The admin sends it to their own Claude account.
7. **Admins only**, also on tickets without a client.
8. **The first reply (a)–(e) and no writes before confirmation**, as in §3; the prompt also asks for a draft reply to the client after solving.

## 6. Tests

- Unit `claude-prompt.test.ts`: fields, chat lines with Bratislava time and file names, the first-reply block, notes, cuts, the 50-file cap, the dropped-messages note and the total cap, the unknown instance, the answer language.
- Routes `claude-prompt.routes.test.ts`: ticket and task prompts with chat, mentions, files (own and chat ones in `files`), instance and notes; a ticket without a client; 401, 403 for a client and a ziadatel (also for an unknown id), 404, 400 for long notes.
- Policy `policy.test.ts`: `canOpenInClaude` per role.
- Web `solve-with-claude.test.tsx`: no button for a client; empty notes generate and open the `?q=` URL; notes are sent, a long prompt is copied with an empty chat opened, the file reminder and links; a refused clipboard.
- e2e `e2e/open-in-claude.spec.ts`: an admin generates with notes and the new page opens at `claude.ai/new?q=…` carrying the ticket (claude.ai is intercepted).

## 7. Plan

1. Shared: schemas and limits (`open-in-claude.ts`).
2. Server: policy, prompt builder, context gathering and helpers (`getTaskChannel`, `messageFileNames`, `listRecentMessages` with id and time), routes; each test-first.
3. Web: `features/open-in-claude/` (button, dialog), the namespace in nine languages, placement on the ticket page and the task panel; test-first.
4. e2e spec (run by the orchestrator), docs.
