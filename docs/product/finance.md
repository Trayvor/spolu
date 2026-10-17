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

Part B (spec §6.1): not built yet.

## Overview and work log

Part C (spec §6.1–6.3): not built yet. A ticket and the tasks made from it will show as one unit in the work log, totals counting every row once.

## System-wide

Part D (spec §6.2): not built yet.
