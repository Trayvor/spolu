# What's new (Novinky)

A one-time popup about the latest update (owner request 2026-10-21, [ADR 0067](../decisions/0067-whats-new-announcements-in-code-seen-per-user.md)). Everyone who opens the app after an update sees it once, on whichever screen they land, with only the parts that concern them; once closed it never comes back, on any device.

## Behaviour

- **Once per person.** Closing the popup in any way — **×**, Escape, Back, **Rozumiem** ("Got it"), a click outside it (from 641 px; on phones it is a full-screen sheet) or a section's link — marks it seen on the server (`announcement_seen`). It is not shown again after a page change, a reload, on another device or after clearing the browser. A failed "seen" request shows it once more on the next app load.
- **When.** After login, on the first screen of the app load (also after the name step of a new client, never over it). The web asks once per app load, never per route.
- **Which.** Announcements are defined in code (`apps/server/src/modules/announcements/catalogue.ts`), newest first, each with a stable id (the day of the update, `2026-10-21`) and its sections. The person gets the newest announcement that has at least one section they can use, with only those sections; if they have seen it, nothing (an older one is never shown after a newer one). Someone none of whose sections apply sees nothing. People created later see the current announcement once too.
- **Adding the next one.** Add an entry on top of `ANNOUNCEMENTS` (a new id), any new section id to `AnnouncementSectionIds` (`packages/shared/src/announcements.ts`) with its rule in `canSeeAnnouncementSection` (`modules/announcements/policy.ts`) and its icon and link in `whats-new-dialog.tsx`, and the texts under the new id in `apps/web/src/locales/whatsNew/<code>.json` (all nine languages).

## The 2026-10-21 announcement

| section | who sees it (server-side, the feature's own policy) | link |
|---|---|---|
| **Úlohy z textu pomocou AI** — the board's "Vygenerovať úlohy z textu" ([ai-task-split.md](ai-task-split.md)) | anyone with a task board: every admin and the superadmin, a client of at least one group (`canUseBoard`); only while the server has the AI task split on (`deps.ai`). Not a žiadateľ | none (the board is wherever the person works) |
| **Uložené odpovede cez lomku** — Settings → "Uložené odpovede", inserted with `/` in a chat or ticket ([chat.md](chat.md)) | admins and the superadmin (`canUseSnippets`) | Settings, `#snippets` |
| **Kontajner v hromadných e-mailoch** — the "Kontajner" block, "Jednoduchý" / "Rozdelený", corners, background, inner space ([bulk-email.md](bulk-email.md)) | admins and the superadmin (`canUseBulkEmail`) | `/bulk-email` |
| **Mzdy a zmluvy vo Financiách** — salaries ("Mzdy") and contracts v2: master contract, amount 0, payment schedule with "Očakávané platby", linked documents ([finance.md](finance.md)) | the finance right only: the superadmin and admins who hold it (`canSeeFinance`) | `/finance` |

So: a client sees only the first section (none while the AI is off, then no popup); a žiadateľ sees no popup; an admin sees the first three; a finance admin and the superadmin all four.

## API

| route | |
|---|---|
| `GET /api/me/announcement` | `{ announcement: { id, sections } \| null }` (`CurrentAnnouncementSchema`); any signed-in person. One primary-key read, plus the client's group ids for a client |
| `POST /api/me/announcement/:id/seen` | 204, also when repeated; 404 for an id not in the catalogue |

`WHATS_NEW=off` (only the e2e server) answers no announcement, so the popup never covers the other specs; `e2e/whats-new.spec.ts` answers the GET itself.

MCP: `get_announcement` (read) and `mark_announcement_seen` (write), the same routes as the user ([mcp.md](../integrations/mcp.md)).

## Web

`features/whats-new/`: the signed-in layout lazily loads `whats-new-host` (a small chunk without zod or texts: a hand-written guard parses the answer); only when there is an announcement it loads `whats-new-dialog` with the lazy `whatsNew` namespace. The popup is the compact `SheetDialog` (480 px from 641 px, a full-screen sheet on phones; `onOutside` closes it on a backdrop click): the title "Novinky v Help", one line with the update's day, then per section a 36 px `secondary` circle with its 16 px icon (the sparkle for the task generation), the title, one or two sentences and the link, and **Rozumiem** at the foot.

## Tests

Server `modules/announcements/policy.test.ts` (every role, the žiadateľ, the finance flag on a client, the AI off), `service.test.ts` (newest first, sections filtered, seen once, unknown id), `routes.test.ts` (per role and right, nothing when no section applies, seen once across logins, `WHATS_NEW=off`, 401/404), `mcp/announcements.test.ts`; web `features/whats-new/whats-new-host.test.tsx` (only the sections sent, Rozumiem / Escape / × / a link close it and mark it seen once, one request); e2e `e2e/whats-new.spec.ts`.
