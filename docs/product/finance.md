# Finance (Finančná správa)

Phase 32. The owner's request, the decisions and the design are in the [spec](../superpowers/specs/2026-10-17-finance-module-design.md); the five pull requests in the [plan](../superpowers/plans/2026-10-17-finance-module.md). The UI calls it **Financie** (tab, header link) and **Finančná správa** (EN "Financial administration", the page title). This file describes what is built; each part fills its own section.

## Access

Built in part A1.

- **The finance right.** Only an admin can hold it (a **finance admin**); the superadmin always has it without a grant. Clients never (a database CHECK on `user.finance_access_at`).
- **Who grants it.** Only the superadmin, on the Admins page: every admin's row has a **Finance** switch (the superadmin's own row has none; other admins see no switches and `GET /api/admins` shows them nobody's right). The switch acts at once (`PUT` / `DELETE /api/admins/:id/finance-access`). A finance admin cannot pass it on.
- **Live.** A grant or a removal acts on the admin's next request (sessions read the user row every time) and on their open app at once: their sockets join or leave the `finance` room and get `me:changed`, so the **Financie** tab and header link appear or vanish without a reload, and an open Finance screen turns into the not-found screen.
- **Deactivation** removes the right; an admin added back needs a new grant.
- **Where it shows.** For finance admins only: the **Financie** tab, the last pill of every client (`/groups/<id>/finance`); the **Financie** header link after Knowledge (`/finance`), a row of the section menu under 1280 px. Anyone else gets the not-found screen at those addresses, and `403` from every finance route.
- **The screens (empty until parts B and C).** The client tab is a grid of three cards: **Overview** (top left, 40 % of the height, 70 % of the width), **Documents** (bottom left, 60 %), **Work log** (the whole right column, 30 %). From 1024 px it fills the window under the group header and each card scrolls inside itself; from 641 to 1023 px Overview spans the top and Documents and Work log sit side by side; on phones a segmented control **Overview · Documents · Work log** (remembered per person) shows one card at a time. `/finance` has the same grid across clients (Overview, **Contracts**, Work log) with the two ranking cards under it (a fourth segment **Rankings** on phones). Until the parts land, each card says in one line what it will hold.
- **Sealed.** Finance data never reaches anyone without the right: finance rows live in their own tables (no knowledge list, search, chat picker or digest reads them, [ADR 0027](../decisions/0027-sealed-finance-module.md)); finance files are readable only by finance admins and can be attached by no other module; finance events go to the `finance` room only; the **Finance** notification group shows in Settings only to finance admins and its events reach only people who hold the right when they are delivered; task and ticket answers carry no time and no money (their time has its own routes, answering only about the caller unless they are a finance admin).

## Time on done

Built in part A2 (spec §5 and §5.6).

- **When.** A task is completed (`completed_at` goes from empty to a time: the done circle, a drag into Completed, the panel's bucket select, also on the global board, or creating it straight in Completed), or a ticket's status becomes **Vyriešený** (resolved). Moving inside Completed is no new completion.
- **Who is asked.** Every active admin (and the superadmin) among the task's assignees or the ticket's riešitelia, whether or not they hold the finance right; clients never. The admin who completed it gets the dialog at once; the others get the notification **Vyplňte, koľko času ste strávili** (kind `task.time_missing` in the Task board group, `ticket.time_missing` in the Ticket board group, passing every mode, once) and a **Vyplňte svoj čas** row on the dashboard's My tasks card until they answer (0 is an answer). An admin who is no assignee, or a client, completing the task gets no dialog; every admin assignee is notified.
- **One entry per admin per task (ticket).** It counts on the Bratislava day of the first completion (resolution). Reopening drops the unanswered requests, filled time stays; completing again asks only those with no filled time. Removing an assignee (riešiteľ) drops their request, not their filled time. Deleting a task drops the requests; filled entries stay with the task's title ("deleted task"). Time filled before the completion (in the panel) starts counting at the completion, and that admin is not asked.
- **The dialog.** "Koľko času ste na tom strávili?" with the task's title and client; a field that reads `1:30`, `1,5`, `90m`, `2h 15m` (shown back as "1 h 30 min"), chips 15 min, 30 min, 1 h, 2 h, 4 h and **Žiadny čas** (0); above 12 h "To je viac ako pracovný deň. Je to správne?", above 100 h refused. **Uložiť** saves, **Neskôr** closes and leaves the request (the dashboard row, no notification). Several completions open one dialog after another. A full-screen sheet on phones. Its own lazy chunk.
- **Tickets.** "Koľko času ste strávili na #123 Predmet?". When a linked task (made from the ticket) has logged time, two choices: **Čas na tiket** (added to the tasks' hours) or **Hodiny na súvisiacich úlohách to pokrývajú** (stored as 0 minutes, covered by the tasks, so nothing is added and no request stays), with the caller's own minutes on each linked task (never anyone else's).
- **My time.** In the task panel under the assignees, and on the ticket page under the riešitelia: "Nevyplnený" with an amber dot and **Vyplniť**, or the minutes with **Upraviť** (on a ticket also "Pokryté úlohami"); it opens the same dialog, before completion too. A finance admin also sees everyone's time in one line ("Čas: Eva 1 h 30 min, Ján Nevyplnený"). Nobody else sees any of it; the task and ticket answers carry no time.
- **Links.** The push and the email open the task panel or the ticket page with `?time=1`, which opens the dialog for an admin assignee (riešiteľ).
- **Tickets without a client** (owner decision 24, 2026-10-17): asked like any ticket; the entries have no client (`group_id` null, migration 0035), appear in no client's Financie tab, only on `/finance` as **Bez klienta** (part D), and move to the client the ticket gets.

## Documents and contracts

Part B (spec §6.1): not built yet.

## Overview and work log

Part C (spec §6.1–6.3): not built yet. A ticket and the tasks made from it will show as one unit in the work log, totals counting every row once.

## System-wide

Part D (spec §6.2): not built yet.
