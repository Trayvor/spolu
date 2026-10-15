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
- Slow work (emails, file processing, AI calls) runs in pg-boss jobs, never inside the request.

## Bundle budget

The initial JS that the browser downloads before showing the first screen: **175 kB gzip**, reported by the build. Today (Phase 1, shell page) it is about 158 kB: the entry chunk 152 kB plus two small shared chunks (the `useTranslation` chunk 5.6 kB and the runtime 0.4 kB).

Budget history: 150 kB → 175 kB (2026-10-15): the Radix dropdown menu for the header language selector (about +29 kB), which later menus reuse at no extra cost.

The budget is an **alarm, not a target to squeeze under**. When a change crosses it:

1. Find what grew (the build prints chunk sizes).
2. Fix it the normal way: lazy-load the screen or component, drop or replace a heavy dependency, or move code out of the entry chunk.
3. If the growth is justified (a real feature needs it), raise the budget in this file with a one-line reason in the same commit. That is a legitimate outcome.

Never do this to fit the budget: minify or obfuscate by hand, inline or copy library code, drop types or tests, merge unrelated code into odd places, or remove useful features. A reviewer rejects such code even when it fits.

Lazy chunks for individual screens have no hard budget. Keep them reasonable and watch for anything above about 100 kB gzip.

## How to check

- `pnpm --filter @spolu/web build` prints every chunk with its gzip size.
- Lighthouse in Chrome DevTools (mobile, throttled) on the test server: aim for Performance 90+ on the home screen.
