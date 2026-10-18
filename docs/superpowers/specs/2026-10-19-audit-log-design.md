# Audit log ("História zmien"): design

Date: 2026-10-19. Status: **draft, waiting for the owner's answers** to the open questions at the end (each has a recommended answer; the plan follows the recommendations).
Plan: [2026-10-19-audit-log.md](../plans/2026-10-19-audit-log.md). Migration placeholder `00XX_audit-log`; the decision record is `ADR-XXXX` (the orchestrator assigns both numbers).

## 1. Goal

One general audit log for administrators: **who changed what and when**, across every kind of record Help keeps, readable on one page and filterable by kind of record, by one record, by author and by date.

Today the only trail is `mcp_audit_log` (the AI's write calls, each user sees only their own last 50, kept 180 days) and the server log (not searchable by admins, no names). When a task's deadline moves, a client's member disappears, a contract's amount changes or eGrant deactivates a group, nobody can say who did it.

Non-goals (v1):

- Not an undo or restore feature. The log describes changes; it never replays them.
- Not a content archive. The text of messages, descriptions, notes, ticket replies and email campaigns is never copied into the log (§9).
- Not reads. Opening a record is not logged; neither are sign-ins (better-auth's own `session` rows) or failed authentications.
- Not a client-facing feature. Clients and requesters never see it.
- Not chat. Messages, reactions and read marks are conversation, not records; a message's edit and delete stay author-only actions with their own markers (`edited`, `deleted`).
- Personal preferences (language, notification channels and modes, phone navigation, saved views, saved replies, ticket watching) are a person's own settings, not shared records, and are not logged.

## 2. Users and roles

| who | sees the log | sees finance entries |
|---|---|---|
| superadmin | yes | yes (always has the finance right) |
| admin with the finance right | yes | yes |
| admin without the finance right | yes, without finance entries | no: they are filtered out in SQL, never counted, never hinted at |
| client, requester | no (`403`) | no |
| MCP token | no in v1 (open question Q6) | - |

Authors that appear in the log:

- **A person** (admin, superadmin, client, requester) acting in the app: `actor_kind = 'user'`.
- **A person through the AI** (an MCP token or an OAuth connection, ADR 0033 and 0034): `actor_kind = 'mcp'`, with the person and the token. The row says "Jana Nováková cez AI (token „Claude Desktop“)".
- **eGrant**: the groups webhook, the managers webhook, the ticket intake and the project feed (`actor_kind = 'egrant'`), with the eGrant instance's origin (`https://firma.egrant.sk`) as the label. No person, because eGrant signs as a system.
- **System**: jobs and automatic consequences with no person behind them (`actor_kind = 'system'`, with the job's name), for example the daily retention job, an automatic backfill or a migration seed.

A consequence of a person's change (deactivating an admin clears their finance right, revokes their tokens and stops them managing groups) is recorded **with the same author** as the change, in the same transaction, and points to it with `cause_id` (§5), so the page can show "as a consequence of …".

## 3. What is recorded

### 3.1 Entity types and actions

One row per changed record per write. `action` is one verb out of a closed list; `entity_type` + `action` together name what happened. **Finance** entries carry `category = 'finance'` (§7).

| entity_type | actions | category | where it is written (module, function) |
|---|---|---|---|
| `group` | `created`, `updated` (name, eGrant URL, logo), `invite_regenerated`, `deactivated`, `reactivated` | general | groups: `createGroup`, `updateGroup`, `renameAdminGroup`, `setLogoKey`, `regenerateInvite`, `setGroupDeactivated` (also from `PUT /api/egrant/groups`) |
| `membership` | `added` (client or requester), `invited`, `invite_cancelled`, `removed`, `restored` | general | groups: `inviteMember`, `addMembership`, `removeMembership`, `restoreMembership`, `addEgrantClient`, `removeEgrantClient` (managers webhook), `applyPendingInvite` (author: the joining person) |
| `manager` | `added`, `removed` | general | groups: `addManager`, `removeManager` |
| `admin` | `added`, `deactivated`, `renamed` | general | users: `addAdmin`, `deactivateUser`, `updateUserName` (only when the target is an admin and the actor is someone else; own rename is a preference, not logged) |
| `finance_access` | `granted`, `revoked` | **finance** | users: `setFinanceAccess` (and its clearing inside `deactivateUser`) |
| `task` | `created`, `updated`, `moved` (bucket or order across buckets, not reorder in one bucket), `completed`, `reopened`, `deleted` | general | tasks: `createTaskTimed`, `createTasksFromSource` (AI split, message to task, meeting tasks), `updateTaskTimed`, `moveTask`, `deleteTask` |
| `bucket` | `created`, `renamed`, `deleted` | general | tasks: `createBucket`, `updateBucket`, `deleteBucket` (reordering is not logged) |
| `ticket` | `created` (app, intake), `updated` (subject, status, priority, client, project), `assignee_added`, `assignee_removed`, `deleted` (if a delete exists) | general | tickets: `createTicket`, intake, `updateTicket`, `PUT /tickets/:id/group` path, `setTicketProject`, `addAssignee`, `removeAssignee` |
| `knowledge_item` | `created`, `updated` (title, visibility, folder, type, meeting time, links), `deleted`, `recording_deleted` | general | knowledge: `createItem`, `updateItem`, `deleteItem`, `deleteRecording`, `setLinkedItems`, meeting series `createSeries` / `updateFollowing` |
| `knowledge_folder` | `created`, `updated` (name, visibility, parent), `deleted` | general | knowledge: `createFolder`, `updateFolder`, `deleteFolder` |
| `project` | `created`, `updated`, `status_changed`, `merged`, `alias_removed`, `deleted` | general | projects: `createProject`, `updateProject`, `setProjectStatus`, `mergeProjects`, `removeAlias`, `deleteProject`, and the eGrant feed when it applies a change |
| `project_event` | `created`, `updated`, `deleted` | general | projects: `createEvent`, `updateEvent`, `deleteEvent` |
| `finance_item` | `created`, `updated`, `deleted` (document, contract, expense, salary; organisation or client) | **finance** | finance: `createItem`, `createOrgItem`, `updateItem`, `deleteItem` |
| `finance_folder` | `created`, `updated`, `deleted` | **finance** | finance: `createFolder`, `updateFolder`, `deleteFolder` |
| `time_entry` | `created`, `updated`, `deleted` (manual entries and the task and ticket time of others; an admin's own `PUT …/time/me` is `updated` too) | **finance** | finance: `createManualEntry`, `updateTimeEntry`, `deleteTimeEntry`, task-time and ticket-time writes |
| `rate` | `created`, `deleted` | **finance** | finance: `addRate`, `deleteRate` |
| `mcp_token` | `created`, `revoked` | general | mcp: `createToken`, `revokeToken`, `revokeAllTokens` (on deactivation, author = the deactivating admin, `cause_id` set) |
| `oauth_connection` | `approved`, `revoked` | general | mcp: the consent approval, `revokeConnection`, `revokeAllConnections`, reuse-detected revocation (`system`) |
| `passkey` | `added`, `deleted` | general | auth: `finishRegistration`, `deletePasskey` (ADR 0050) |
| `bulk_campaign` | `sent`, `cancelled` | general | bulk-email: `startSending`, `cancelSending` (drafts, their edits and their deletion are not logged; a test send is not a send) |
| `reminder_set` | not in v1 | - | reminders are personal schedules; open question Q7 |

"Settings" in the brief means the shared settings Help has: a group's name, eGrant URL, logo, invite link, active state and its managers (all above). There is no system-wide settings table today; when one is added, it gets `entity_type = 'setting'` with `updated` and the key as `entity_id`.

### 3.2 Diffs, not full snapshots

Each row holds a **field-level diff** of the fields that changed, limited to an allowlist per entity type (`AUDIT_FIELDS` in `packages/shared/src/audit.ts`). Every field has a kind that decides what is stored:

| field kind | stored | example |
|---|---|---|
| `value` | `{ from, to }`, short scalars (≤ 200 characters each, longer cut with `…`) | title, status, priority, visibility, a date, a bucket's name |
| `ref` | `{ from: { id, label }, to: { id, label } }` | the bucket, the folder, the client of a ticket, the project |
| `refs` | `{ added: [{ id, label }], removed: [{ id, label }] }` | assignees, riešitelia, linked knowledge, contract shares' clients |
| `text` | `{ changed: true }`, never the text | a task's description, a knowledge item's body, a ticket's description, a finance item's note |
| `money` | `{ from, to }` in integer minor units with the currency | a contract's amount, a rate, a salary |
| `minutes` | `{ from, to }` | a time entry's minutes |
| `secret` | never stored, not even "changed" | the invite token itself, a token's hash |

- **Created** rows store the allowlisted fields' initial values as `to` only (text fields as `{ changed: true }`), so "what did it start as" is answered without the content.
- **Deleted** rows store the label and the fields needed to recognise the record (title, client, bucket, amount for finance), never the content.
- A write that changes no allowlisted field writes **no row** (an edit that only touched the description still writes one: `description: { changed: true }`).
- Labels are **snapshots** taken at the time of the change (`entity_label`, the `label` of each `ref`): the log stays readable after a rename or a delete. The page also links to the live record when it still exists and the viewer may open it.
- The `changes` JSON of one row is at most 8 kB (checked by `recordAudit`; a bigger diff keeps the first fields and adds `{ "_truncated": true }`). `refs` lists keep at most 50 ids each.

Why not full before/after snapshots: they would copy content (descriptions, bodies, notes) into a second, long-lived table, which is the GDPR risk §9 avoids, and they would make every row as big as the record. Why not only summaries ("task updated"): the questions the owner asked ("who moved the deadline", "who changed the amount") need the field and its values.

## 4. UX

All texts below are Slovak (the source language); the other eight follow in the plan, with the `it` formal "Lei" register and the `sl` vikanje in sentences ([ADR 0019](../../decisions/0019-nine-languages-and-one-email-design.md), [wording](../../design/wording.md)).

### 4.1 Where it is reached

- **Admins page** (`/admins`): a secondary button **„História zmien“** in the page header, beside "Pridať administrátora". The header nav is full ([performance.md](../../architecture/performance.md), wide header), and the user menu's texts are eager; the Admins page and its `admins` namespace are lazy.
- **From a record**: a menu item **„História“** in the "…" menu of a task's detail, a ticket's detail, a knowledge item's detail, a project, a finance item (finance admins) and the group's Members tab (**„História skupiny“**). Each opens `/audit?entityType=<type>&entityId=<id>` (or `?group=<id>` for the group). Admins only; the item is not rendered for anyone else.
- No notification, push, email or badge (§8).

### 4.2 The page `/audit` („História zmien“)

Lazy route, admins only (cosmetic guard; the server answers `403`), lazy namespace `audit`.

```
História zmien                                                    [Obnoviť]
Kto čo zmenil a kedy. Záznamy uchovávame 2 roky.

[Druh záznamu ▾] [Klient ▾] [Autor ▾] [Od dd.mm.rrrr] [Do dd.mm.rrrr]  Zrušiť filtre
(chip when a single record is chosen:)  Úloha „Pripraviť rozpočet“ ×

19. 10. 2026
14:32  Jana Nováková            Úprava úlohy „Pripraviť rozpočet“ · Mesto Senica          ▸
         Termín: 20. 10. 2026 → 24. 10. 2026
         Riešitelia: + Peter Kováč
         Popis: zmenený
14:05  Jana Nováková cez AI     Vytvorenie úlohy „Skontrolovať prílohy“ · Mesto Senica     ▸
         (token „Claude Desktop“)
11:20  eGrant                   Deaktivácia skupiny „Obec Lúka“                            ▸
         https://luka.egrant.sk
09:02  Systém                   Odobratie práva Financie: Peter Kováč                      ▸
         ako dôsledok: Deaktivácia administrátora Peter Kováč

                                  [Načítať staršie]
```

- **Rows**, newest first, grouped by day (the day heading in the viewer's language format, the time `HH:mm` with the exact timestamp in the `title` and `<time datetime>`). Times are shown in `Europe/Bratislava`, as everywhere in Help.
- **Author column**: the person's name (a deactivated admin keeps their name, with „(deaktivovaný)“); `mcp`: "<name> cez AI" with the token name below; `egrant`: „eGrant“ with the instance origin below; `system`: „Systém“. Clicking an author sets the Author filter to them (a token sets the filter to that token).
- **What column**: the action as a verbal noun + the entity noun in the genitive + the label in „…“ (Slovak avoids a gendered past tense this way: „Úprava úlohy“, never „upravil/upravila“), then „· <client>“ when the record belongs to a client group. The label links to the live record when it exists and is readable; a deleted record's label is plain text with „(vymazané)“.
- **Diff lines** under the row (at most 3 shown, the rest behind „+ ďalšie zmeny (n)“): `<field>: <from> → <to>`; `text` fields „<field>: zmenený“; `refs` „+ name“ / „− name“; `money` formatted with the currency; created rows show nothing by default (expand ▸ shows the initial values).
- **Consequence rows** show „ako dôsledok: <cause row's sentence>“ and link to the cause row (`?around=<id>` scrolls the list to it).
- **Empty state**: „Žiadne zmeny pre tieto filtre.“ (with filters) / „Zatiaľ sa nič nezmenilo.“ (without).
- **Error**: „Históriu sa nepodarilo načítať. Skúste to znova.“ with „Skúsiť znova“.
- **Loading**: „Načítava sa…“ (impersonal, wording rule).
- **No realtime**: the page does not update by itself; „Obnoviť“ refetches the first page. (§8)
- **Phone**: the filters fold into one „Filtre (n)“ button opening a native-dialog sheet ([ADR 0020](../../decisions/0020-header-menus-on-first-use-and-native-dialog-sheets.md)); rows stack author above the sentence.

### 4.3 Filters

All filters live in the URL (`validateSearch`) and are remembered with `useRememberedFilters('audit', …)` ([performance.md](../../architecture/performance.md), web rules). The single-record filter (`entityType` + `entityId`) is never remembered: it comes from a link.

| filter | control | values |
|---|---|---|
| Druh záznamu | select | Všetko, Skupiny, Členstvo, Manažéri, Administrátori, Úlohy, Stĺpce, Tikety, Znalosti, Priečinky znalostí, Projekty, Udalosti projektov, AI prístup (tokeny a pripojenia), Prístupové kľúče, Hromadné e-maily; for finance admins also Financie (documents, folders, time, rates, finance right) |
| Záznam | chip from a link, × removes it | one `entityType` + `entityId` |
| Klient | the existing client picker of the knowledge list (single choice in v1) | a group id, „eGrant tím“ included |
| Autor | select: the active and deactivated admins by name, then „eGrant“, „Systém“, „AI (všetky tokeny)“; a client author or a token is chosen by clicking it in a row (then a chip) | `user:<id>`, `token:<id>`, `kind:egrant`, `kind:system`, `kind:mcp` |
| Od / Do | two native date inputs | `YYYY-MM-DD`, inclusive, Bratislava days |

„Zrušiť filtre“ clears every filter (and forgets the saved ones).

### 4.4 Slovak texts (source)

```
audit.title                      História zmien
audit.intro                      Kto čo zmenil a kedy. Záznamy uchovávame 2 roky.
audit.refresh                    Obnoviť
audit.loadOlder                  Načítať staršie
audit.loading                    Načítava sa…
audit.empty                      Zatiaľ sa nič nezmenilo.
audit.emptyFiltered              Žiadne zmeny pre tieto filtre.
audit.error                      Históriu sa nepodarilo načítať. Skúste to znova.
audit.retry                      Skúsiť znova
audit.filters.type               Druh záznamu
audit.filters.client             Klient
audit.filters.author             Autor
audit.filters.from               Od
audit.filters.to                 Do
audit.filters.clear              Zrušiť filtre
audit.filters.phone              Filtre ({{count}})
audit.filters.all                Všetko
audit.authors.egrant             eGrant
audit.authors.system             Systém
audit.authors.mcpAny             AI (všetky tokeny)
audit.authors.viaAi              {{name}} cez AI
audit.authors.token              token „{{name}}“
audit.authors.deactivated        (deaktivovaný)
audit.row.deleted                (vymazané)
audit.row.consequence            ako dôsledok: {{sentence}}
audit.row.more                   + ďalšie zmeny ({{count}})
audit.row.textChanged            zmenený
audit.row.empty                  prázdne
audit.entry.history              História
audit.entry.groupHistory         História skupiny
admins.auditLink                 História zmien
```

Action sentences (`audit.actions.<entity_type>.<action>`, label in `{{label}}`), for example: `task.created` „Vytvorenie úlohy „{{label}}““, `task.updated` „Úprava úlohy „{{label}}““, `task.moved` „Presun úlohy „{{label}}““, `task.completed` „Dokončenie úlohy „{{label}}““, `task.reopened` „Znovuotvorenie úlohy „{{label}}““, `task.deleted` „Vymazanie úlohy „{{label}}““, `group.deactivated` „Deaktivácia skupiny „{{label}}““, `membership.removed` „Odobratie člena {{label}}“, `manager.added` „Pridanie manažéra {{label}}“, `finance_access.granted` „Udelenie práva Financie: {{label}}“, `mcp_token.created` „Vytvorenie AI tokenu „{{label}}““, `passkey.added` „Pridanie prístupového kľúča „{{label}}““. Field names (`audit.fields.<entity_type>.<field>`) reuse each feature's own label words (Termín, Riešitelia, Stav, Priorita, Viditeľnosť, Priečinok, Suma, …), checked against [wording.md](../../design/wording.md). The full key list is in the plan (Task 9).

## 5. Data model

One table, owned by a new module `audit` (`apps/server/src/modules/audit/`), migration `00XX_audit-log`.

```
audit_log
  id             text primary key            -- randomUUID()
  created_at     timestamptz not null default now()
  actor_kind     text not null               -- 'user' | 'mcp' | 'egrant' | 'system'
  actor_user_id  text null                   -- the person ('user', 'mcp'); no FK
  actor_token_id text null                   -- the MCP token ('mcp'); no FK
  actor_label    text not null               -- snapshot: name, token name, eGrant origin or job name
  actor_detail   text null                   -- snapshot: the token's name for 'mcp'; the eGrant source ('groups', 'managers', 'intake', 'projects') for 'egrant'
  entity_type    text not null               -- §3.1
  entity_id      text not null
  entity_label   text not null               -- snapshot, ≤ 200 characters
  group_id       text null                   -- the client group the record belongs to (null: admins, tokens, passkeys, organisation finance)
  category       text not null default 'general'   -- 'general' | 'finance'
  action         text not null               -- §3.1
  changes        jsonb not null default '{}' -- §3.2, ≤ 8 kB
  cause_id       text null                   -- the row this one is a consequence of; no FK
  check audit_log_actor_kind_check   actor_kind in ('user','mcp','egrant','system')
  check audit_log_category_check     category in ('general','finance')
  check audit_log_actor_check        (actor_kind in ('user','mcp')) = (actor_user_id is not null)
  check audit_log_token_check        (actor_kind = 'mcp') = (actor_token_id is not null)
  check audit_log_changes_size_check pg_column_size(changes) <= 16384
```

- **No foreign keys**, on purpose: the log outlives the records it describes (a deleted task, a removed token), and a delete elsewhere must never cascade into it or be blocked by it. The labels are snapshots for the same reason. `infra/db/foreign-key-indexes.test.ts` has nothing to check.
- `entity_type` and `action` are checked by the shared zod enum on write (not a SQL `CHECK`, so a new entity type needs no migration). A unit test (`audit/catalogue.test.ts`) checks that every `(entity_type, action)` pair the code can write has an `audit.actions.*` key in all nine locales.
- **Append only**: a trigger `audit_log_append_only` refuses `UPDATE` always and `DELETE` of a row younger than the retention (`created_at > now() - interval '730 days'`), with SQLSTATE `SPA01`. The retention job is the only deleter. This guards against an application bug, not against someone with database access (the backups do that; §9).
- `group_id` is the record's client group at the time of the change (a task moved to another client in the same write records the new one and the old one as a `ref` change).

### 5.1 Indexes

Every filter combination the page offers is a range scan of one of these, newest first, keyset-paged by `(created_at, id)`:

| index | serves |
|---|---|
| `audit_log_created_idx` on `(created_at desc, id desc)` | the default page; the date range; the retention job (`created_at <` cutoff) |
| `audit_log_entity_idx` on `(entity_type, entity_id, created_at desc, id desc)` | one record's history (the „História“ links) |
| `audit_log_type_idx` on `(entity_type, created_at desc, id desc)` | the "Druh záznamu" filter |
| `audit_log_group_idx` on `(group_id, created_at desc, id desc) where group_id is not null` | the "Klient" filter and „História skupiny“ |
| `audit_log_actor_user_idx` on `(actor_user_id, created_at desc, id desc) where actor_user_id is not null` | Author = a person |
| `audit_log_actor_token_idx` on `(actor_token_id, created_at desc, id desc) where actor_token_id is not null` | Author = a token |
| `audit_log_actor_kind_idx` on `(actor_kind, created_at desc, id desc) where actor_kind <> 'user'` | Author = eGrant, System, AI (all) |
| `audit_log_general_created_idx` on `(created_at desc, id desc) where category = 'general'` | the default page of an admin without the finance right (no finance rows to skip) |
| `audit_log_cause_idx` on `(cause_id) where cause_id is not null` | „ako dôsledok“ lookups |

Eight indexes on an append-only table cost a few microseconds per insert each; Help's writes are human-paced (tens a minute at the busiest), and the bulk paths write one multi-row insert (§10). Combined filters (type + client + author + dates) use the most selective index and filter the rest; the EXPLAIN checks (§10) prove the planner does.

## 6. API

All under `/api`, in `modules/audit/routes.ts`. JSON shapes in `packages/shared/src/audit.ts`.

### `GET /api/audit`

`requireAdmin` (no session `401`, client or requester `403`), then `canReadAudit(actor)`.

Query (all optional, zod `AuditQuerySchema`):

| param | meaning |
|---|---|
| `entityType` | one entity type of §3.1 |
| `entityId` | needs `entityType` (`400 invalid_filter` otherwise) |
| `group` | a group id |
| `actor` | `user:<id>`, `token:<id>`, `kind:egrant`, `kind:system`, `kind:mcp` |
| `from`, `to` | `YYYY-MM-DD`, inclusive, `Europe/Bratislava` days; `from > to` is `400 invalid_filter`; a range longer than 3 years is `400 invalid_filter` |
| `cursor` | the previous answer's `nextCursor` (opaque base64url of `[created_at, id]`; a malformed one is `400 invalid_filter`) |
| `limit` | 1–100, default 50 |

Answer `200`:

```ts
type AuditEntryDto = {
  id: string;
  createdAt: string; // ISO
  actor:
    | { kind: 'user'; userId: string; name: string; deactivated: boolean }
    | { kind: 'mcp'; userId: string; name: string; tokenId: string; tokenName: string; deactivated: boolean }
    | { kind: 'egrant'; source: 'groups' | 'managers' | 'intake' | 'projects'; instance: string }
    | { kind: 'system'; job: string };
  entityType: AuditEntityType;
  entityId: string;
  entityLabel: string;
  /** The live record exists and the viewer may open it (a link is shown). */
  linkable: boolean;
  group: { id: string; name: string } | null;
  action: AuditAction;
  changes: AuditChanges; // §3.2
  cause: { id: string; entityType: AuditEntityType; action: AuditAction; entityLabel: string } | null;
};
type AuditPage = { items: AuditEntryDto[]; nextCursor: string | null };
```

- `actor.name` and `group.name` are the **current** names (one `in (…)` query each for the page), falling back to the snapshot when the person or group no longer exists. `deactivated` comes from the same query.
- `linkable` is computed for the page with one existence query per entity type present on the page (at most one per type, `id in (…)`), through each module's exported `existingIds(db, ids)` function, never by reading their tables from the audit module. Finance ids are checked only for a finance viewer.
- `cause` is one `id in (…)` query for the page.
- Without the finance right, `category = 'finance'` rows are excluded in the `where` clause (§7). An `entityType` of a finance type answers an empty page for such a viewer (not `403`: the type list is not secret, but its rows are).

### No detail route in v1

The list returns each row's full `changes` (at most 8 kB a row, typically under 300 bytes); the page shows three diff lines and expands the rest in place. A `GET /api/audit/:id` is added only if the EXPLAIN volume shows a page answer above 64 kB (Task 8 measures it).

### No write routes

Nothing in the API writes, edits or deletes audit rows. Rows are written only by `recordAudit` inside the modules' own transactions.

### MCP

No MCP tool in v1 (open question Q6). `/api/audit` is not added to `modules/mcp/allowlist.ts`, so `leaks.test.ts` keeps it unreachable from MCP.

## 7. Permissions

Policy functions in `modules/audit/policy.ts` (test-first, `policy.test.ts`):

| function | rule |
|---|---|
| `canReadAudit(actor)` | `isAdmin(actor)` (admins and the superadmin) |
| `auditCategoriesFor(actor)` | `['general', 'finance']` when `canSeeFinance(actor)` (imported from `modules/finance/policy.ts`), else `['general']` |

- **Why every admin, not only the superadmin**: every admin already reads every group, task, ticket and knowledge item, and manages members and other admins ([permissions.md](../../architecture/permissions.md)); the log shows nothing about those records that they could not see in the records themselves, except who did it, which is the point. Finance is the one sealed area ([ADR 0027](../../decisions/0027-sealed-finance-module.md)), so its rows follow `canSeeFinance`.
- **Finance seal**: `finance_access` grants are finance rows too: the Admins page shows the right only to the superadmin (`GET /api/admins`), and finance admins may see who holds it in their own area. The audit module imports nothing of finance's tables; it calls `canSeeFinance` and the finance module's `existingIds`. `modules/finance/documents-leaks.test.ts`'s "no module but finance names a finance table" stays true. A new leak test (`audit/leaks.test.ts`) checks that a non-finance admin never receives a finance row through any filter combination, the entity filter or the cursor, and that `changes` of general rows never carry a time or money field (a task row never says "time logged").
- **Admins-only knowledge and the admin group**: admins read them anyway; nothing extra.
- **Clients' authorship is visible to admins**: a client's edit of a task shows the client's name, as the task's own activity already does.
- **The log is never filtered by the group's deactivated state**: a deactivated group's history stays readable (admins read the group itself too).
- **The `x-spolu-internal-call` identity**: `runAsUser` gains an optional `via` (`{ kind: 'mcp', tokenId, tokenName }`), kept in the same in-memory map; `auditActorOf(request)` reads it. A header from outside matches nothing, as today.

## 8. Notifications and realtime

None. The log is a reference page, not a feed. No notification category, no push, no email, no digest entry, no socket event (the page has a „Obnoviť“ button). Reasons: every change already notifies the people it concerns through its own module, and an "audit" event would double every notification for admins. The owner can ask for alerts on chosen events later (open question Q8); the table and the actor model would not change.

## 9. Security and privacy (GDPR)

- **Data minimisation**: no message text, descriptions, bodies, notes, ticket replies, campaign content, file contents, file names of finance documents beyond the item's own label, IP addresses, user agents, emails (except as the label of a membership or admin row whose person has no name yet: invited by email, `entity_label` is the email until they set a name; Q4) or token values. Content fields are `{ changed: true }` only.
- **Lawful basis**: legitimate interest of eGrant (accountability and security of client data it processes, GDPR Art. 6(1)(f) and Art. 32); the privacy notice gets one paragraph (the owner updates it, open question Q5): what is logged, who sees it, 2 years.
- **Retention**: **730 days** (`AUDIT_RETENTION_DAYS`), then the daily job `audit.cleanup` deletes older rows in batches of 5 000 (`delete … where id in (select id … where created_at < $cutoff order by created_at limit 5000)`, repeated until none) so a backlog never holds a long lock. The page says „Záznamy uchovávame 2 roky.“ Backups keep deleted rows for the backup's own retention (runbooks/backup.md).
- **Erasure**: users are never deleted in Help (they are deactivated); a deactivated person's name stays in the log, which the retention ends. If a person asks for erasure, `anonymizeActor(db, userId)` (a function, no route in v1) replaces `actor_label` with „Vymazaný používateľ“ and every label equal to their name in `entity_label` and in `changes` `refs` of their own membership and admin rows. This is the one sanctioned `UPDATE` (the trigger allows it only inside a transaction that set `spolu.audit_anonymize = 'on'`). Runbook entry in `docs/runbooks/` (Task 12).
- **Access is itself not logged** (reading the log is a read). Open question Q9.
- **Integrity**: append-only trigger (§5); the retention job runs as the app's role, which is the same role that writes, so the trigger is the guard, not a second database role (a separate role is more than this single-process deployment needs, [ADR 0005](../../decisions/0005-single-process-deployment.md)).
- **No new attack surface**: one read route behind `requireAdmin`, no uploads, no HTML (labels are rendered as text by React, never `dangerouslySetInnerHTML`); the CSP ([ADR 0044](../../decisions/0044-enforced-csp-set-by-the-app.md)) needs no change.
- **The eGrant webhooks** stay as they are (HMAC, ADR 0042); the audit row names the instance origin the webhook resolved, never the key or the body.

## 10. Performance

- **Write path**: one `insert` (or one multi-row `insert` for a batch) inside the transaction that makes the change: `recordAudit(tx, actor, entries)`. A service function that ran a single statement without a transaction (for example `setGroupDeactivated`, `setFinanceAccess`, `addAdmin`) gets one. The diff is computed in memory from the `before` row the function already reads (most of them lock it `for update` already) and the `after` row it returns; where a function did not read the row before, it reads it in the same transaction with the lock it needs anyway. No query per field, no extra round trip outside the transaction. Measured target: under 1 ms added per write on the dev database.
- **Bulk writes**: the AI split, a meeting's tasks, the eGrant project feed, a project merge and the backfills write their rows with one `insert … values (…), (…)` per transaction. A migration seed or a backfill that touches thousands of rows writes **one summary row** (`entity_type` of the batch's kind, `action = 'updated'`, `changes: { _batch: { count } }`) instead of one per record, actor `system`.
- **Read path**: keyset pagination on `(created_at, id)`, 50 rows a page, one query for the page (+1 row to know whether there is a next page), then at most four `in (…)` queries for the page (current names, groups, causes, `linkable` per entity type). No count of the total. No N+1.
- **EXPLAIN checks**: a new volume `audit` in `test/setup-explain-db.ts` ([ADR 0040](../../decisions/0040-explain-volumes-from-template-databases.md)): 2 000 000 rows over two years (about 2 700 a day: a busy team's upper bound, 10x today's write rate), 3 000 groups, 60 admins, 5 % finance, 3 % eGrant, 2 % MCP. `modules/audit/explain.test.ts` checks every filter of §4.3 alone and the realistic combinations (type + client, author + dates, entity, finance and non-finance viewer, page 1 and a cursor deep in the range) for **no sequential scan on `audit_log`** and, with `RUN_BENCH=1`, under 30 ms each. The retention job's delete batch is checked too.
- **Web**: one new lazy route chunk (`audit-page`), the lazy `audit` namespace, the „História“ menu items inside already-lazy detail chunks. The eager cost is the route's `validateSearch` (a few lines, no imports) and the route entry: target ≤ +0.2 kB on the initial JS, measured as in [performance.md](../../architecture/performance.md) "How to check". The list is not virtualised (50 rows a page, „Načítať staršie“ appends; at most a few hundred rows on screen).

## 11. i18n

- New lazy namespace `audit` (`apps/web/src/locales/audit/<code>.json`, nine languages), loaded with the `/audit` route (`withNamespaces(['audit'], …)`); the „História“ menu items load it through `useNamespaces(['audit'])` inside their detail's existing `<Suspense>`, or use one key each in the detail's own namespace (the plan chooses the latter: `tasks.menu.history`, `tickets.menu.history`, `knowledge.menu.history`, `projects.menu.history`, `financeDocuments.menu.history`, `group.members.history`, and `admins.auditLink`), so a detail never loads the `audit` namespace just for a menu label.
- Server texts: none (no email, no push). `infra/i18n` is unchanged.
- Registers: `it` formal "Lei" in sentences (`audit.error` „Non è stato possibile caricare la cronologia. Riprovi.“), bare imperative on buttons („Aggiorna“); `sl` vikanje in sentences („Zgodovine ni bilo mogoče naložiti. Poskusite znova.“), singular imperative on buttons („Osveži“). Terms from [wording.md](../../design/wording.md): manažér / upravitelj, Financie / Finance, Vymazať (destroy) vs Odobrať (detach) in the action nouns (`deleted` → „Vymazanie“, `removed` → „Odobratie“).
- Dates and money use the existing formatters (`Intl.DateTimeFormat` in the viewer's language, `formatMoney` from `packages/shared/src/money.ts`).
- The locale tests (every key in all nine languages) cover the new namespace; `audit/catalogue.test.ts` (server) cross-checks the action and field catalogue against the `audit` namespace's keys.

## 12. How the write path fits the codebase

- **Module pattern**: `modules/audit/` with `schema.ts`, `service.ts` (`recordAudit`, `listAudit`, `deleteOldAudit`, `anonymizeActor`), `diff.ts` (pure `diffFields`), `actor.ts` (`AuditActor`, `auditActorOf(request)`, `systemActor(job)`, `egrantActor(source, origin)`), `policy.ts`, `routes.ts`, `jobs.ts`, `test-volume.ts`, tests. Other modules import only `recordAudit`, `diffFields` and the actor helpers; they never touch `audit_log`. The audit module reads other modules only through their exported `existingIds` / name functions.
- **Passing the author**: explicit, not ambient. Every audited service function gets the author as a parameter: those that already take `actor: SessionUser` get `by: AuditActor` beside it (or instead, where `actor` was only used for its id); the others get `by: AuditActor` as a new parameter. Routes build it with `auditActorOf(request)`; webhooks with `egrantActor(…)`; jobs with `systemActor(name)`. Rejected alternative: `AsyncLocalStorage` holding the request's author, read inside `recordAudit`: less churn, but invisible at the call sites, easy to lose across `setImmediate` / job hand-offs, and a service function called from a job would silently record the wrong or no author. ADR-XXXX records this choice.
- **Same transaction, always**: `recordAudit(tx, by, entries)` takes the transaction handle (`Tx`); a failed insert rolls the change back. A change that is committed without its audit row is a bug, and every audited function has a test that asserts the row (and one that asserts no row when nothing changed).
- **After-commit work is unchanged**: socket pushes and notifications still run after the commit; the audit row is not an event and does not trigger anything.
- **Coverage guard**: `audit/coverage.test.ts` drives every write route of the catalogue once through `buildTestApp` (admin, a finance admin, a client, an MCP token, the eGrant webhooks with a signed body) and asserts exactly one row per changed record with the right actor, entity, group, category and action. A new write route that forgets its audit row fails no test by itself; the `new-module` skill and `permissions.md` get one line each saying that a shared record's write route records an audit row (Task 12).

## 13. Open questions (with recommended answers)

| # | question | recommendation |
|---|---|---|
| Q1 | Who may see the log: every admin, or only the superadmin? | **Every admin**, finance rows only with the finance right (§7). Admins already see every record and manage each other; hiding the log from them protects nothing and removes its use (an admin checking who moved a client's deadline). |
| Q2 | Retention: how long? | **2 years** (730 days), the same for all categories. Long enough for a yearly review and a grant period; finance's legal archive is the documents themselves, not this log. If the accountant wants longer for finance rows, make `AUDIT_RETENTION_DAYS` per category (one line in the job). |
| Q3 | Diffs with values, or only "which fields changed"? | **Values for short fields, "changed" for text** (§3.2). Values are what answer "from when to when did the deadline move"; text stays out for privacy and size. |
| Q4 | May an invited person's email be the label when they have no name yet? | **Yes**, only for `membership` and `admin` rows, because without it an invite row is unreadable; admins see the email on the Members tab anyway. Retention removes it. |
| Q5 | Does the privacy notice need an update before launch? | **Yes**, one paragraph (what, who sees it, 2 years, legitimate interest), updated by the owner before the deploy that ships the feature. No feature flag: recording starts with the deploy. |
| Q6 | An MCP tool `list_audit_log` for the AI? | **Not in v1.** Later as a read-only tool under the same rules (finance rows only for finance holders), allowlisted, if the owner asks. |
| Q7 | Log reminders (who set, changed, deleted a reminder)? | **No.** Reminders are personal schedules (and the reminders module already shows their author). Revisit if a client complains about a reminder they did not set. |
| Q8 | Alerts on chosen events (for example "an admin was added", "a token was created")? | **Not in v1.** The new-token and new-passkey emails to the owner of the account exist already (ADR 0033, 0050). A later "Upozorniť ma" per filter could reuse saved views. |
| Q9 | Log who read the log, or exports? | **No** in v1 (there is no export). If an export (CSV) is added later, log the export as an `audit_export` row. |
| Q10 | Backfill history from what exists (task `created_at`, `mcp_audit_log`)? | **No.** The log starts empty on the deploy day; `mcp_audit_log` stays as the per-user AI call list (it also holds refused calls, which are not changes). The page's intro could say since when it records; recommended: no extra text. |
| Q11 | Record a task reorder inside one column? | **No**, it is noise (dozens a day). A move to another column, completion and reopening are recorded. |
| Q12 | Record a client's own edits (clients edit tasks)? | **Yes**: the log is about records, not about admins. Clients never see the log. |
