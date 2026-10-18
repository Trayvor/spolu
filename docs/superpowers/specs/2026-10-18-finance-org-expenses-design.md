# Phase 32 E — finance at organisation level: design

Date: 2026-10-18 · Status: **built** on `feat/finance-org` (plan: [2026-10-18-finance-org-expenses.md](../plans/2026-10-18-finance-org-expenses.md)). Extends [Phase 32](2026-10-17-finance-module-design.md) (parts A–D on `main`); the product description is in [finance.md](../../product/finance.md#organisation-level). The owner could not be asked while it was built: every open question was decided by the implementer and is listed under **Decisions** (E1–E22), next to the decisions the owner took with the request (O1–O7).

## Owner's request (translated)

1. **A new entity, Výdavok (expense).** Created only on `/finance`, at organisation level: money that goes out, such as an admin's salary or the server bill.
   - On create the kind is chosen: **admin salary** (a picker of admins appears) or **other expense** (a free text: a payment for something, or a fine).
   - Both have an amount with its currency and a date. The date may be in the future, with the proposed reminder and own reminders, the finance reminders reused.
2. **The other finance types on `/finance`.** At organisation level `/finance` also creates contracts, documents, notes and folders. `/finance` gets a filter by type and by client. There is **no "only my clients"** option there.
3. **Contracts of several clients.** A contract created on `/finance` picks one client, as today, or several. With several: a field **Nadradená organizácia** (the payer's name), and next to each client the part of the amount that is that client's (one organisation pays for several clients in one payment). The contract then shows in each client's Financie tab with that client's share as its amount; the detail shows the full amount too.

## Owner decisions (taken with the request)

| # | Decision |
|---|---|
| O1 | The shares must add up **exactly** to the contract's amount, in the same currency. |
| O2 | A contract of several clients is edited **only on `/finance`**; in a client's tab it is read-only with a link there. |
| O3 | Expenses count in the `/finance` Overview as **money out** (balance = paid − expenses), **never** in a client's tab. |
| O4 | An admin's salary changes **no hourly rate and no cost of work**; it is shown on its own, and nothing is counted twice in the rankings. |
| O5 | Expenses are seen **only by finance admins**: never in client tabs, search, chat, digests or notifications of anyone else. |
| O6 | Items of the organisation without a client are visible **only on `/finance`**. |
| O7 | The paid ranking splits a contract of several clients **by its shares**. |

## Decisions (taken by the implementer, 2026-10-18)

| # | Question | Decision | Why |
|---|---|---|---|
| E1 | Where an organisation item lives. | In the same tables: **`finance_items.group_id` and `finance_folders.group_id` become nullable**; null = the organisation. Expenses, organisation documents, notes and folders, and contracts of several clients have no client. | One table keeps reminders, files, search, folders, the sheet and the ledger working unchanged; no new module boundary. |
| E2 | The expense's columns. | `type = 'expense'`, `expense_kind in ('salary','other')`, `payee_id → user` (set exactly for a salary), the amount and currency columns of a contract, and its **date stored as a one-day period** (`starts_on = ends_on`). One CHECK per type keeps the columns exact. | The period columns, their overlap filter, their sorts and their cursors work for expenses as they are. |
| E3 | The expense's title. | **Other**: the title is the free text "what it is" (required, 1–200). **Salary**: an optional title (e.g. "October 2026"); the row then reads "Mzda: Eva Nováková · October 2026". The payee's name is part of the search text. | The owner's form has no title for a salary; a short note is still useful. |
| E4 | Who can be paid a salary. | An **active admin or the superadmin** (`canBePayee`, test-first); the picker lists them (`GET /api/finance/payees`). A payee deactivated later stays on the old expenses. | "A picker of admins"; clients never earn a salary here. |
| E5 | The expense's reminder. | The form proposes **one reminder the day before the date at 09:00** (none when that has passed); times and recipients are edited as on a contract, recipients finance admins only. The notification says "Expense due on 31 Dec 2026", **without the amount**, like a contract. | A payment is due on its day; a day ahead is time to pay. |
| E6 | Planned and paid-out expenses. | Like contracts (decision 12): an expense with its date today or earlier is **paid out**, a later one **planned**. The balance subtracts paid out only. | The same rule as "paid" and "to be paid". |
| E7 | How shares are stored. | `finance_contract_shares (item_id → finance_items cascade, group_id → groups cascade, amount_minor > 0, pk (item_id, group_id))` with an index on `(group_id, item_id)`. The contract keeps the total in `amount_minor` and the payer in `payer_name` (1–200), with `group_id` null. A CHECK: a contract has a client **or** a payer, never both. | One row per client share; the total stays one column for the ledger and the sorts. |
| E8 | Share validation. | 2–50 clients, each once, each share > 0 cents, **the sum equal to the amount** (O1), every client an existing group. The currency is the contract's (one column), so a share can never be in another currency. Checked in the shared schema (the form) and again in the service (400). | O1, and a share of 0 says nothing. |
| E9 | One client ↔ several on edit. | **Not convertible.** The choice is made on create; to change it, delete and create again. Shares, payer, amount, period, number, text and files of a several-clients contract are edited on `/finance`. | A conversion would move the item between the client's and the organisation's folders and files; rare enough not to build. |
| E10 | What a client's tab shows of a several-clients contract. | The row at the **top level** of the Documents card (and in its type filter and search), the **client's share as the amount**, a line "Nadradená organizácia: …". The sheet shows the share, the **full amount**, the payer, period, number, text and files, read-only, with **Upraviť vo Financiách** (`/finance?item=<id>`). **Never the other clients' names or shares**: the tab's requests (`GET /api/groups/:id/finance/items`, `GET /api/finance/items/:id?group=<id>`) answer only that client's share. No reminders in the tab. | The owner's "read-only with a link" (O2) and the suggestion to show only the payer and the own share. Every finance admin can open the whole contract on `/finance`, so the trim is the tab's context, not a permission boundary. |
| E11 | The client's money with shares. | The client's Overview (money paid / to be paid by start month), and `/finance` with chosen clients, count each **share** of the client on the contract's start date; with every client the shares add up to the contract's total, so nothing changes. | O7 and the tab's amount (E10) agree. |
| E12 | The `/finance` Documents card. | The bottom-left card becomes **Položky** with two views (a segmented control, remembered): **Prehľad** — the ledger of every item of the chosen clients (and, with every client, of the organisation), a type filter **Všetko · Zmluvy · Výdavky · Dokumenty · Poznámky** (contracts by default, as before), the search and the sorts; **Organizácia** — the organisation's own items in folders, like a client's Documents card (breadcrumbs, folders, Move, rename, delete). **+ Nový** offers Zmluva, Výdavok, Dokument, Poznámka and Priečinok in both views. | The ledger answers "filter by type and client"; folders only make sense inside one owner, so the organisation gets its own browser (as decision 16 kept folders inside a client). |
| E13 | Who owns a new item made on `/finance`. | The form's first field, **Pre koho**: a document or a note **Organizácia** (default) or one client; a contract **Jeden klient** (default) or **Viacero klientov** (a contract always has a client). An expense and a folder always belong to the organisation. A client's item is created as in its tab (`POST /api/groups/:id/finance/items`), in that client's top level, and opens in that tab after saving. | One "+ Nový" for both views; a client's folders stay in its tab. |
| E14 | The client filter and organisation items. | Organisation items (expenses, documents, notes) show when **every client** is chosen, as the time without a client does (decision 24); a contract of several clients shows when **any** chosen client has a share. The filter keeps no "my clients" option (the knowledge list's filter has none either). | O6 and the existing "Bez klienta" rule. |
| E15 | The ledger row of an organisation item. | The client column says **Organizácia**, or for a several-clients contract the payer and "3 klienti"; the amount is the full amount. The row opens the item on `/finance` (`?item=`); a client's item opens in its tab as before. | The full contract belongs to `/finance` (O2). |
| E16 | The period filter on the ledger. | Contracts: running in the period (as before). Expenses: dated in the period. All, documents, notes: no period (they have none). A search ignores the period (as before). | Documents and notes have no date to filter by. |
| E17 | The Overview with every client. | A new line **Výdavky** (paid out, with "z toho mzdy" and "ostatné", and **Plánované** for later dates) per currency; the chart adds a thin **red bar** of the money out per month; **Balance = paid − expenses paid out** per currency (O3). **Spent on work** stays as information and is not subtracted there, because the salaries already pay for that work (O4, no double counting). With chosen clients, and in a client's tab, nothing changes: no expenses, balance = paid − cost of work. | O3 and O4 together. |
| E18 | The rankings. | Paid: per client, its own contracts plus its shares (O7). Hours: unchanged. Expenses are in no ranking (they belong to no client). | O4, O7. |
| E19 | Files of organisation items. | Finance-only files with `files.group_id` null (storage key `files/finance-org/<id>`), uploaded through `POST /api/finance/org/files`; read by finance admins only (the finance-only check runs first). | The file rules of part B, without a client. |
| E20 | Reminders without a client. | `reminder_sets.group_id` becomes nullable; the admin home's upcoming list joins groups with a left join (no client name). The push and the digest open `/finance?item=<id>` for an item without a client, and the digest no longer drops a finance reminder without a client. | Expenses (E5) and several-clients contracts have reminders. |
| E21 | A client deleted. | Its shares go with it (cascade); the contract keeps its total and its other shares; an edit that changes the amount or the shares then needs shares that add up again (other edits save as they are). | A deleted client's money disappears everywhere, like its own contracts. |
| E22 | Live updates. | A write of an organisation item sends `finance:changed` with `groupId` null: every open finance screen refetches, each client's tab too (it reacts to client-less changes), which covers the shares' clients. | The existing room and debounce, no new event. |

## Data model (migration 0044)

```
finance_items
  group_id            → nullable (null: the organisation)
  type                + 'expense'
  payer_name  text null    -- a contract of several clients: the payer (1..200)
  expense_kind text null   -- 'salary' | 'other' (expenses only)
  payee_id    text null → user   -- a salary's admin
  CHECK finance_items_contract_check, rewritten per type:
    contract: amount, currency, starts_on, ends_on set; no expense columns;
              (group_id is null) = (payer_name is not null)
    expense:  amount, currency, starts_on set, ends_on = starts_on; group_id, number and
              payer null; expense_kind set; payee_id set exactly for 'salary'
    document, note: none of them
  CHECK finance_items_title_check: <= 200, and >= 1 except a salary
  idx (starts_on) where type = 'expense'             -- money out, the ledger's expense sorts
  idx (payee_id) where payee_id is not null          -- the foreign key

finance_contract_shares (item_id → finance_items cascade, group_id → groups cascade,
                         amount_minor bigint > 0, pk (item_id, group_id))
  idx (group_id, item_id)

finance_folders.group_id → nullable (the organisation's folders)
reminder_sets.group_id   → nullable (reminders of organisation items)
```

## API

| route | what |
|---|---|
| `GET /api/finance/org/items?folder=&type=&q=&after=` | The organisation's items (Organizácia view), as the client card's list. |
| `GET` / `POST /api/finance/org/folders` | The organisation's folders; `PATCH`/`DELETE /api/finance/folders/:id` as before. |
| `POST /api/finance/org/items` | A several-clients contract (`payerName`, `shares`), an expense (`expenseKind`, `payeeId`, `title`, `amount`, `spentOn`), a document or a note of the organisation. |
| `POST /api/finance/org/files` | A finance-only file of the organisation. |
| `GET /api/finance/payees` | Active admins and the superadmin (the salary picker). |
| `GET /api/finance/items/:id?group=<id>` | The detail; with `group` a several-clients contract answers that client's share only (`404` when the client has none). |
| `PATCH /api/finance/items/:id` | Also `payerName`, `shares` (several clients), `payeeId`, `spentOn` (expense). |
| `GET /api/finance/contracts?type=` | `contract` (default), `expense`, `document`, `note` or `all`. |
| `GET /api/finance/overview` | `expenses` per currency (empty unless every client is chosen). |

Every route sits behind `requireFinance` (401 / 403); an unknown id, or a client without a share, answers 404.

## Leak guarantees (tests: `modules/finance/org-leaks.test.ts`)

- A client, a requester (žiadateľ) and an admin without the right get 403 on every new route and 404/403 on every item and file id of the organisation.
- An expense, its title and its payee never appear in the knowledge search, a client's Financie tab, its Overview, the rankings or any group room event; a finance reminder of an expense never reaches a non-finance admin, and its push and digest carry no amount.
- A client's tab and `?group=` answer only that client's share: the other clients' ids, names and shares are absent from the JSON.

## Performance

Design (the `frontend-design` pass): the screens keep the egrant.sk tokens and the finance cards' quiet ledger look; the one new visual element is the shares' reconciliation line under the share rows (tabular figures, neutral while unbalanced, success-green when exact, error ink when over), and the money out is the only new chart colour (`--chart-4`, brand coral, kept apart from the cost blue and from the error red of a negative balance).

Every new list query has an `EXPLAIN` check on the seeded volume (plan always, milliseconds only with `RUN_BENCH=1`): the organisation's list, a client's list with shared contracts, the ledger of expenses, the money with shares (client, chosen clients, every client), the money out, and the paid ranking with shares. The `/finance` screens stay lazy; the new texts are in the lazy `financeOrg` namespace.

## Out of scope

Converting a contract between one and several clients (E9); recurring expenses (a salary every month is entered each month); expenses per client; exchange rates.
