# Solve with Claude ("Vyriešiť s Claude")

Phase 29. Design and owner decisions: [spec](../superpowers/specs/2026-10-17-phase-29-open-in-claude-design.md).

Admins solve a ticket or a task with their own Claude subscription and the **eGrant MCP** connector they already have in Claude (tools `admin_instance_list`, `admin_instance_tools`, `admin_instance_call`, `admin_instance_call_write`). Spolu only prepares the text; it runs no AI and pays for nothing.

## Who

Admins and the superadmin, on every ticket (also one without a client) and every task. Clients and requesters never see it; the server refuses them.

## Flow

1. **"Vyriešiť s Claude"** on the ticket page (end of the header row) or in the task panel header (icon only on phones).
2. A dialog asks for **optional notes** for Claude (placeholder, hint "Nepovinné"); **Vygenerovať** works with the field empty.
3. The server builds the prompt; the dialog then offers:
   - **Otvoriť v Claude**: opens `claude.ai/new` in a new tab with the prompt filled in. When the link would be longer than 8 000 characters, the prompt is copied to the clipboard instead, an empty Claude chat opens, and the dialog says to paste it (Ctrl+V / ⌘V);
   - **Kopírovať prompt**;
   - when the ticket or task has files (its own or in its chat): a reminder that files cannot reach Claude through the link, with a download link for each, to attach them in Claude by hand;
   - **Zobraziť prompt** to read what goes to Claude, and **Vygenerovať znova** after changing the notes.

## What the prompt carries

In Slovak, with "answer in <the admin's UI language>":

- the ticket (number, subject, status, client, area, programme, due date, riešitelia, requester's name and email, the page link, created, text) or the task (title, bucket, client, urgent, due date, riešitelia, link, the ticket it came from, created by, created, description), with its link in Help by eGrant;
- who generated it: a line `Vygeneroval: <name> <<email>> (<admin|superadmin>, Help by eGrant), <time>` (Europe/Bratislava), taken on the server from the signed-in user, never from the request body; no other person's data is added;
- the file names (never contents or links);
- its chat: the newest 30 messages, oldest first, with author, time (Europe/Bratislava) and file names, each cut to 1 500 characters;
- the client's eGrant instance (the ticket's instance link, else the client's eGrant address), or a note that it is unknown;
- the admin's notes, which take precedence;
- the instructions: find the instance with `admin_instance_list` by its hostname and stay on it, list its tools, only read while looking for the cause; the **first reply** gives (a) the cause, (b) what or whom it affected if relevant, (c) the steps to solve it, (d) the real risks if any, (e) the question whether to fix it by this plan; **no change before the admin confirms**, then only the approved steps; finally a short reply for the client.

The prompt is at most 20 000 characters: the oldest chat messages go first.
