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

Part A2 (spec §5): the time question when an admin assignee completes a task, and (extension of 2026-10-17, spec §5.6) when an admin riešiteľ resolves a ticket, with the "the linked tasks' hours cover it" answer. The data model is built (part A1): one time entry per admin per task or ticket, `ticket` entries, `linked_ticket_id` and `covered_by_tasks` ([data model](../architecture/data-model.md)). A ticket without a client asks no time (spec decision 24, recommended, waiting for the owner's confirmation).

## Documents and contracts

Built in part B (spec §6.1). The client tab's bottom-left card keeps the client's contracts, documents and notes, in folders, like the knowledge base in a smaller frame.

- **Four kinds.** "+ New" offers **Contract** (title, optional number up to 60 characters, an amount with its currency, a period from–to, a description, files, reminders), **Document** (title, description, files), **Note** (title, text, optional files) and **Folder**. Up to 20 files per item; a contract may have none and its row then says "No file" (decision 13).
- **Money.** The amount is typed as people write it (`12 000`, `1200,50`, `1.200,50`; `parseMoney`) and stored as integer cents with its currency. Only **EUR** can be entered now (`ENABLED_CURRENCIES`); the currency select appears once a second currency is enabled. The server refuses a contract without an amount or period, a period that ends before it starts, a disabled currency, and contract fields on a document or a note (`400`).
- **The list.** Breadcrumbs, the open folder's folders first, then its items newest first, 30 a page with "Show more". The type filter (All · Contracts · Documents · Notes) and the search (from 2 characters, without diacritics, over title, number, description and file names) list every folder flat, each result naming its folder path. A contract row shows its number, title, period ("1. 1. 2026 – 31. 12. 2026"), the amount on the right, a bell when a reminder time is ahead, **Ending soon** (the end within 60 days) or **Ended**, and "No file".
- **The item sheet.** Opening an item shows it in a sheet (also from a link, `?item=<id>`, which notifications and the dashboard use): the amount, period and number, the description, the files, and for a contract its reminders. Edit in place (a stale edit answers "Someone changed this item meanwhile" with "Load their version"), **Move to…**, **Delete** (with its files and reminders). Folders: rename, move (never into themselves), delete (the contents move one level up).
- **Reminders.** A new contract's form proposes one reminder **30 days before the end at 09:00** (it follows the end date until edited; none when that moment has passed), saved with the contract; its author gets it. Afterwards the sheet edits the times and the recipients on their own, as on a task. **Recipients can only be finance admins**: the picker lists them only and the server refuses anyone else; a recipient who loses the right gets nothing when a time fires. The notification is in the **Finance** group ("Contract ends on 31 Dec 2026"; the digest line "Contract <title> · <client>: ends on …", button "Open contract"), never with the amount, and opens the item. The upcoming reminders on the admin home list it for its recipients only. The calendar export works as everywhere.
- **Files** are uploaded as finance files from the start: readable by finance admins only, attachable to finance items only.
- **Live.** Every change refreshes the card of the other finance admins who have the client open (`finance:changed`, kind `items`).
- **Never elsewhere.** No contract, document, note or finance file shows in the knowledge tab, the global knowledge list or search, the chat's knowledge picker or the "Open in Claude" prompt (tests in `modules/finance/documents-leaks.test.ts`).

## Overview and work log

Part C (spec §6.1–6.3): not built yet. A ticket and the tasks made from it will show as one unit in the work log, totals counting every row once.

## System-wide

Part D (spec §6.2): not built yet.
