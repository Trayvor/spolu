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

Built in part C (spec §6.1–6.3).

- **Overview card** (top left). A **Money · Hours** switch and a period filter (last 12 and next 12 months by default, this year, last year, all time, a custom month range), both remembered per person (the custom range is not).
  - **Money:** a bar chart by month — the contracts **paid** (start date today or earlier in Bratislava, solid ink) stacked under those **to be paid** (later start, hatched), and next to them a thinner blue bar of what the work **cost** that month (hours × rates). On the right the totals per currency: **Paid**, **To be paid**, **Spent on work** (EUR) and **Balance** (EUR paid − spent, green or red). Currencies are never added together: with UAH contracts a currency switch appears and the cost bar shows only for EUR. "N h without an hourly rate" opens the rates dialog.
  - **Hours:** the total line (hours · tasks · tickets · cost), then one small chart per admin who worked for the client in the period, all on one scale, ordered by hours, each with the admin's hours and cost; the first 6, then "Show all (n)".
  - Every chart has **Show as table**; each month is a focusable column with a tooltip. The charts are our own SVG ([ADR 0028](../decisions/0028-finance-charts-own-svg.md)).
- **Work log card** (right). On top the period filter (all time by default) and the summary: total hours · tasks · tickets · cost and a line per admin ("Eva 12 h 30 min · 8 tasks · 625 €"; collapsed to one line on phones). Below, the chronology **oldest at the top, newest at the bottom**, opening scrolled to the bottom; **Show earlier** loads the previous 200 entries and keeps the scroll position. Each month starts with its full totals (also when only part of the month is on the page) and, with more than one admin, a line per admin; then the days, each entry with the admin, the task (a link to its panel), the ticket or the manual note, the duration and its cost. Requests not answered yet show as **Waiting for time** and count in no total. A ticket and the tasks made from it are **one unit**: the ticket's row (#number and live subject, a link to the ticket) with its own entries and the linked tasks indented under it, on the day of the ticket's entry (or the unit's first entry that month); a ticket answered "covered by the tasks" shows that and adds 0. Every total sums each row once. A deleted task or ticket keeps its stored title, marked "deleted".
- **Entry menu.** Edit (a manual entry: day, duration, note; a task or ticket entry: the duration only), **Fill in time** for a request, **Reset to 0** for a filled task or ticket entry (never deleted: the work was done), **Delete** for a manual entry or a request.
- **Add time** (manual entry, spec §6.3): admin (every active admin, and a removed one who has a rate), day (today by default, never in the future), duration (`1:30`, `1,5`, `90m`, `2h 15m`; 0 allowed), note (up to 500 characters). Finance admins only.
- **Hourly rates** (from the work log's header): every admin with the rate that applies today and **Change**; a new rate applies from the day chosen (default the first of this month; an admin's first rate **from the start**, which covers all their earlier work); entering a rate for a day that already has one corrects it. The history per admin shows each row's day, rate and who set it, with Delete for a mistaken row. Rates are EUR. An entry's cost uses the rate of its day; a past cost changes only when someone changes a past rate.
- **Cost rounding.** Each shown total is `round(sum(minutes × rate) / 60)` cents, rounded once per total, never per entry; minutes without an applicable rate count in the hours but not in the cost, and the totals say how many.
- **Live.** Every write (entry, rate) pushes `finance:changed` to the finance admins; the open cards refetch.
- **Entries without a client** (owner decision 24, time on a ticket that has no client, part A2) never appear in a client's overview or work log; only the system-wide page (part D) shows them.

## System-wide

Part D (spec §6.2): not built yet.
