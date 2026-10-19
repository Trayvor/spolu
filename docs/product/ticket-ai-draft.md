# AI draft of a ticket reply ("Navrhnúť odpoveď")

2026-10-19. Design and owner decisions: [spec](../superpowers/specs/2026-10-19-ticket-ai-draft-design.md), [plan](../superpowers/plans/2026-10-19-ticket-ai-draft.md), [ADR 0053](../decisions/0053-ai-draft-retrieval-with-trigrams.md).

An admin answering a ticket asks the AI for a draft reply, checks it, edits it and sends it as an ordinary message. **Nothing is sent, saved or shown to anyone else automatically.**

## Who

Admins and the superadmin, on every ticket chat. Clients and žiadatelia never see the button; the server refuses them (`403`) before it looks the ticket up. The button is hidden while the server's AI is off (`GET /api/ai/status` → `ticketDraft: false`), in threads and when editing a message.

## Flow

1. In the ticket chat's composer, between the emoji button and Send, the icon button **Navrhnúť odpoveď** (a speech bubble with a spark) opens the dialog "Návrh odpovede s AI" ("Tiket #123 · Supermesto"); a full-screen sheet on phones.
2. **Pokyn pre AI (nepovinné)**: up to 1 000 characters, for example "odpovedzte stručne".
3. **Navrhnúť** asks the server (typically 5–15 s, "Pripravujem návrh…"); closing the dialog aborts the request.
4. The draft is shown as the chat renders messages (Markdown), with **Podklady**: the knowledge items it used (type icon and title, "Spoločné" for an admin-group item; they open like a knowledge card in chat) and the similar tickets it used ("#98 Subject", opening in a new tab). Without sources: "Návrh nevychádza zo žiadnych podkladov — skontrolujte fakty." Under it the note that the AI wrote it and nothing is sent automatically.
5. **Vložiť do správy** (or **Nahradiť text správy** when the composer already has text) replaces the composer's text in one undo step (Cmd/Ctrl+Z brings the old text back), closes the dialog and focuses the composer. **Navrhnúť znova** keeps the instructions.

Errors in the dialog: "AI je teraz nedostupná. Skúste to neskôr." (502, 503), "Príliš veľa návrhov naraz. Skúste to o chvíľu." (429), "Tiket sa nenašiel." (404).

## What the AI sees

- The ticket (number, subject, area, programme, status, the requester's first name, body up to 4 000 characters) and its newest 30 chat messages (author and `team`/`client`, 1 500 characters each, 12 000 in all).
- Up to 5 knowledge items the ticket's client may be shown: its own public notes, files and links and the admin group's shareable ones, by the ticket's words (title, plain text up to 3 000 characters, URL, file names; never file contents). Never another client's item, never an admins-only item or one in an admins-only folder.
- Up to 3 similar **resolved tickets of any client** (owner decision), the ticket's own client first on an equal match, each with its subject, the start of its body and the team's newest 5 answers. Another client's requester name, email and phone, the client's name and the names of its people become `[meno]`, `[klient]`, `[e-mail]`, `[telefón]` before the AI sees them; within the same client the requester is masked too. The AI is told never to name anyone from the examples, and the reply is masked once more.
- The admin's instructions. Never finance data.

The reply is in the requester's language (else the client's, else Slovak), formal register, no signature; mentions and `@all` are removed so a sent draft notifies nobody as a mention.

## Limits and cost

Per admin 5 drafts a minute and 60 a day, for the installation 500 a day (`429`). One draft is about 12 000 input and 1 500 output tokens with `gpt-5-mini` (`OPENAI_MODEL`), about 0.006 USD. Every call that reaches the provider is logged with its usage, never with the texts.
