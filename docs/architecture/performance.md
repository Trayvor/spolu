# Performance

Spolu must feel instant: faster than Microsoft Teams on a cheap phone over mobile data, served from a small server. Performance is a top priority (see [product/non-functional.md](../product/non-functional.md)), but **readable code comes first**. A rule here is never a reason to write clever or obscure code.

## Why Spolu can be fast

- A plain web app (PWA), not a desktop wrapper. Code loads once, then runs from the browser cache.
- Each screen is its own lazy-loaded chunk: opening the chat never downloads the task board.
- Hashed `/assets/*` files are cached forever (`immutable`); `index.html` is always revalidated, so updates arrive at once.
- Realtime is pushed over one WebSocket. Nothing polls.
- One Node process next to PostgreSQL: a request crosses no extra services.

## Rules for every phase

### Web client

- Lazy-load every route (screen). Shared code used by one screen stays in that screen's chunk.
- Feature texts are lazy locale namespaces (`src/locales/<name>/<code>.json`), loaded with the route that renders them (`withNamespaces` in `router.tsx`, see [overview.md](overview.md), "i18n"). Only the eager shell's texts go in the main locale files.
- Before adding a dependency, check its gzip size (bundlephobia or the build output). Prefer a few lines of our own code to a large library used for one function. A new runtime dependency needs an ADR anyway.
- Lists that grow (messages, tasks, tickets, members) are paginated by cursor and virtualized when long. Never load a whole list.
- Optimistic UI for the user's own writes (a sent message appears at once, then is confirmed).
- Images: resized and compressed on upload; lists and chat show thumbnails; full size only on open.
- No fancy effects (see [design/README.md](../design/README.md), "Keep it light").

### Server and database

- Every column used to filter, join or sort has an index. Add it in the same migration as the query.
- No N+1: load related rows with one join or one `in (...)` query, not one query per row.
- Endpoints return only the fields the screen needs, and every list endpoint is paginated.
- Realtime events carry small payloads (ids and changed fields) and go only to the rooms that need them.
- Slow work (emails, file processing) runs in pg-boss jobs, never inside the request. One exception: the AI task split (`POST /api/messages/:id/task-split`) calls OpenAI inside the request, because the user waits on the review screen for the answer; the call has a 30 s timeout, no retry, and holds no database transaction or connection while it waits.

## Bundle budget

The initial JS that the browser downloads before showing the first screen: **200 kB gzip**, reported by the build. Today (Phase 3, groups and invites) it is about 193 kB: the entry chunk about 108 kB, the API client with zod and the session code about 48 kB (+3 kB: the router eagerly imports `features/groups/api` for the 404 loader), the router's shared chunks about 20 kB and 12 kB, and the i18n chunk 4 kB. `socket.io-client` (about 13 kB) stays out of it: only the lazy signed-in layout and the settings status card import it (there is no home screen).

Lazy screen chunks worth watching: the Tasks tab (`tasks-tab`, the board with drag and drop: `@dnd-kit/core`, `@dnd-kit/sortable`, `fractional-indexing`) is about 24 kB gzip (Phase 8; about 4 kB before drag and drop). dnd-kit appears in no other chunk. With the board in place the initial JS is about 194 kB gzip (entry 169.5 kB, router chunks 19.7 kB and 0.6 kB, i18n 4.1 kB); all `tasks.*` texts (English and Slovak) add about 2.2 kB gzip to the entry chunk.

Phase 5 (group chat, measured 2026-10-15): initial JS about 195 kB gzip (entry chunk 170.7 kB, router chunks 19.7 kB and 0.6 kB, i18n 4.1 kB). The chat is the lazy `chat-tab` chunk, 17.8 kB gzip (conversation, list, composer, thread panel, formatter); the Chat tab badge and the groups list count only add the small chat `api.ts` and `unread.tsx` (under 1 kB gzip) to the lazy group layout and groups list chunks.

Chat and task board together (integration of Phases 5 and 8 with main, measured 2026-10-15, gzip level 9 of the scripts `index.html` loads): initial JS about 197 kB gzip (entry chunk 119.4 kB, API client chunk 53.2 kB, router chunks 19.5 kB and 0.6 kB, i18n 4.0 kB), under the 200 kB budget, so the `chat.*` and `tasks.*` texts stay in the locale files of the entry chunk. If a later change crosses the budget, moving those texts into resource bundles loaded with the `chat-tab` and `tasks-tab` chunks (`i18next.addResourceBundle`) is the first lever.

Phase 6 with the digest, the bell and the app prompt (merge of `p6-t11`, `p6-t9` and `p6-t7`, measured 2026-10-16, gzip level 9 of the scripts `index.html` loads, the module and its modulepreloads): initial JS 198.8 kB gzip (entry chunk 114.3 kB, API client chunk 48.0 kB, router chunks 19.6 kB and 0.6 kB, a shared dependency chunk 15.7 kB, i18n 0.5 kB, `registerSW.js` 0.1 kB). Only 1.2 kB is left under the budget; the `notifications.*` texts and the eager `lib/install-prompt.ts` are in it, while `<AppPrompt>` and the bell menu ship with the lazy signed-in layout and group screens. The next growth should start with the lever above (moving feature texts into lazy resource bundles).

Phase 6 with the settings page (Task 13, measured 2026-10-16, same method): initial JS 198.9 kB gzip (entry chunk 114.1 kB, API client chunk 47.9 kB, router chunks 19.5 kB and 0.6 kB, a shared dependency chunk 16.2 kB, i18n 0.4 kB, `registerSW.js` 0.1 kB). The settings page is the lazy `settings` chunk, 6.4 kB gzip: the Profile and Notifications cards, the email change flow, the Radix switch, and their texts. Those texts are the first use of the lever above: `src/locales/settings/<code>.json`, merged into `translation` by `src/i18n/settings-copy.ts` (`addResourceBundle`) when the chunk loads, so they cost the entry chunk nothing. Only `saveLanguage` (`features/profile/api.ts`, a few hundred bytes) is eager, for the header language menu.

Phase 6 final review (measured 2026-10-16, same method: gzip -9 of the scripts `dist/index.html` loads, the module, its modulepreloads and `registerSW.js`): initial JS 197.9 kB gzip, down from 199.0 kB (entry chunk 114.1 kB, API client chunk 46.8 kB, router chunks 19.6 kB and 0.6 kB, a shared dependency chunk 16.2 kB, i18n 0.5 kB, `registerSW.js` 0.1 kB). The `notifications.*` texts (34 lines per locale) moved into the lazy bundle `src/locales/notifications/<code>.json`, merged by `src/i18n/notifications-copy.ts` (a 1.4 kB gzip chunk loaded with the signed-in layout, the groups list, the group header and the settings page, the chunks that render the bell, the mode menu and `<AppPrompt>`).

Phase 9 review dialog ("Turn into tasks", measured 2026-10-16 the same way): initial JS about 196.9 kB gzip (entry 120.2 kB, API client chunk 52.4 kB, router chunks 19.6 kB and 0.6 kB, i18n 4.1 kB), 0.4 kB less than before the dialog. `@spolu/shared` declares `"sideEffects": false` (its modules only define schemas, constants and functions), so a schema module that only lazy screens import leaves the entry chunks. Without it every module the barrel re-exports stayed eager. The AI split schemas live in their own `task-split.ts` for that reason. The dialog, the Radix `Dialog`, the review cards and the propose/create calls (`split-api.ts`) are the lazy `review-dialog` chunk, 6.4 kB gzip, loaded when a message is chosen; the chat tab only gains the small hook, toast and `ai/status` query.

Phase 9 integration (task chat, message tasks footer and AI review dialog merged, task chat wired to "Turn into tasks"; measured 2026-10-16, gzip level 9 of every script `index.html` loads): initial JS 197.1 kB gzip (entry 120.2 kB, API client chunk 52.5 kB, router chunks 19.6 kB and 0.6 kB, i18n 4.1 kB, `registerSW.js` 0.1 kB). `useMessageTaskTools` and the footer sit in the lazy `conversation` chunk that the Chat tab and the task panel share, so nothing of them is in the initial load.

Phase 9 unread tasks (measured 2026-10-16 the same way): initial JS 197.2 kB gzip, practically unchanged. The Tasks tab badge (`tasks-tab-badge.tsx`, `task-chats.ts`) is eager: it imports only the API client, the socket helper and shared types, and is about 1 kB. The board loads the cards' chat counts and unread flags with one query per board load (`GET /api/groups/:id/task-chats`, key `['tasks', groupId, 'chats']`, shared by the board, the task panel's tab and the badge) instead of one request per card; chat events update it in place.

Phase 9 final (end-to-end test added; measured 2026-10-16, gzip level 9 of every script `index.html` loads): initial JS 197.3 kB gzip (entry 120.2 kB, API client chunk 52.6 kB, router chunks 19.6 kB and 0.6 kB, i18n 4.1 kB, `registerSW.js` 0.1 kB), under the 200 kB budget. Lazy chunks: `review-dialog` 6.4 kB gzip, `tasks-tab` 22.6 kB (the board; the task panel with its chat tab loads the shared `conversation` chunk, 15.2 kB, also used by the Chat tab).

Phase 6 on top of Phase 9 (merge of main at `d4cb90a` into `phase-6`, measured 2026-10-16, gzip -9 of the scripts `dist/index.html` loads: the module, its modulepreloads and `registerSW.js`): initial JS 197.4 kB gzip (entry chunk 114.9 kB, API client chunk 45.6 kB, router chunks 19.6 kB and 0.6 kB, a shared dependency chunk 16.2 kB, i18n 0.5 kB, `registerSW.js` 0.1 kB), under the 200 kB budget. For comparison, Phase 6 alone was 197.9 kB and Phase 9 alone 197.3 kB: both keep their feature texts and screens in lazy chunks (`notifications-copy`, `settings`, `review-dialog`, `conversation`, `tasks-tab`).

Lazy locale namespaces (branch `prep-i18n`, measured 2026-10-16, gzip -9 of the scripts `dist/index.html` loads: the module, its modulepreloads and `registerSW.js`): initial JS **192.6 kB gzip, down from 197.4 kB** (before: entry chunk 114.9 kB, API client chunk 45.6 kB, router chunks 19.6 kB and 0.6 kB, a shared dependency chunk 16.2 kB, i18n 0.5 kB, `registerSW.js` 0.1 kB; after: entry 114.3 kB, API client chunk 41.3 kB, the rest unchanged). The generic `loadNamespace` (`src/i18n/namespaces.ts`) replaces `settings-copy.ts` and `notifications-copy.ts`, and the `admins`, `chat`, `group`, `groups`, `join`, `system`, `taskSplit` and `tasks` texts left the main locale files: every namespace and language is its own chunk of 0.2 to 1.7 kB gzip (largest: `tasks` sk), fetched with the route that renders it.

Budget history: 150 kB → 175 kB (2026-10-15): the Radix dropdown menu for the header language selector (about +29 kB), which later menus reuse at no extra cost. 175 kB → 200 kB (2026-10-15, Phase 2): the session guard checks `/api/me` (validated with zod) before the first screen, so zod and the API client moved into the initial load (about +26 kB); every later screen needs them anyway, and the service worker caches them after the first visit.

The budget is an **alarm, not a target to squeeze under**. When a change crosses it:

1. Find what grew (the build prints chunk sizes).
2. Fix it the normal way: lazy-load the screen or component, drop or replace a heavy dependency, or move code out of the entry chunk.
3. If the growth is justified (a real feature needs it), raise the budget in this file with a one-line reason in the same commit. That is a legitimate outcome.

Never do this to fit the budget: minify or obfuscate by hand, inline or copy library code, drop types or tests, merge unrelated code into odd places, or remove useful features. A reviewer rejects such code even when it fits.

Phase 17 Knowledge tab (Task 11, measured 2026-10-16, gzip -9 of the scripts `dist/index.html` loads): initial JS 193.9 kB gzip, 1.1 kB more than before the task (192.8 kB): the route definition with its search validation, the tab pill and its two strings. The route spells out the four types instead of importing `KnowledgeTypes`, which would pull `@spolu/shared`'s knowledge schemas into the entry (+2.4 kB). The tab, the menu, the list and the dialog are the lazy `knowledge-tab` chunk, 12.5 kB gzip.

Lazy chunks for individual screens have no hard budget. Keep them reasonable and watch for anything above about 100 kB gzip.

## How to check

- `pnpm --filter @spolu/web build` prints every chunk with its gzip size.
- Lighthouse in Chrome DevTools (mobile, throttled) on the test server: aim for Performance 90+ on the home screen.

Phase 18 client managers (end-to-end test added; measured 2026-10-16, gzip level 9 of every script `index.html` loads): initial JS 193.6 kB gzip (entry 114.5 kB, API client chunk 41.3 kB, router chunk 19.6 kB, shared dependency chunk 16.2 kB, notifications 0.7 kB, i18n 0.5 kB, small chunk 0.6 kB, `registerSW.js` 0.1 kB), under the 200 kB budget.

Phase 17 knowledge base, after merging Phase 18 (measured 2026-10-16, gzip level 9 of every script `index.html` loads): initial JS 195.5 kB gzip (entry 115.6 kB, API client chunk 42.3 kB, router chunk 19.5 kB, shared dependency chunk 16.2 kB, notifications 0.7 kB, small chunk 0.6 kB, i18n 0.4 kB, `registerSW.js` 0.1 kB), 1.9 kB above main's 193.6 kB and under the 200 kB budget. The eager part is the two routes with their search validation, the header link, the tab pill and their strings; the plan's 0.5 kB target was not met (Task 11 already measured 1.1 kB for the tab route), and the growth is accepted as the cost of two new routes. Everything else is lazy: `knowledge-tab` 2.5 kB, `knowledge-page` 5.4 kB and the shared `knowledge-list` chunk (list, rows, dialog, form, reminder parts) 11.0 kB gzip, plus the `knowledge`, `reminders` and `forms` locale chunks.

Phase 20 admin shell (Task 8, measured 2026-10-16, gzip level 9 of every script `index.html` loads): initial JS 196.9 kB gzip (entry 120.1 kB, API client chunk 42.3 kB, router chunk 19.5 kB, `useQuery` chunk 7.5 kB, `useTranslation` chunk 5.5 kB, notifications 0.7 kB, small chunk 0.6 kB, i18n 0.4 kB, `registerSW.js` 0.1 kB), 1.4 kB above the 195.5 kB before the phase and under the 200 kB budget. The new code itself is not in it: the `/` and `/tasks` routes, the header links and `nav.tasks` add about 0.2 kB; the rest is the bundler splitting the shared TanStack Query and i18next modules into their own preloaded chunks once the lazy `admin-shell` chunk imports them too, which compresses about 1.2 kB worse than one chunk (measured by building without the sidebar import: 195.7 kB). The plan's 0.6 kB target is missed by that split, accepted while under the budget. The sidebar is the lazy `admin-shell` chunk (2.5 kB gzip), imported by the lazy signed-in layout only for an admin at 1024 px or wider (`React.lazy` behind `useMediaQuery('(min-width: 1024px)')`), so clients and phones never download it; its texts are the lazy `adminHome` namespace, loaded with it (`withNamespaces`).

Phase 20 dashboard (Task 9, measured 2026-10-16 the same way): initial JS 196.9 kB gzip, unchanged by the task. The dashboard is the lazy `home-page` chunk (3.0 kB gzip: the cards, tiles, greeting and the phone client list), loaded with the `/` route for admins only, together with the lazy `adminHome` namespace (`withNamespaces`); the client list rows are shared with the `admin-shell` chunk (now 1.0 kB gzip) through a common chunk.

