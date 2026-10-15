# 0011 Installable PWA with vite-plugin-pwa

Date: 2026-10-15
Status: accepted

## Context
Spolu must be installable on phones and computers (docs/product/non-functional.md) and open fast on repeat visits. A web manifest, icons and a service worker are needed. Writing a service worker by hand is easy to get wrong (stale caches after a deploy, cached API responses).

## Decision
- `vite-plugin-pwa` (build-time dev dependency) generates the manifest and a Workbox service worker (`generateSW`, `registerType: 'autoUpdate'`). The Workbox runtime ships only inside `sw.js`; no runtime package is added to the app bundle (the plugin injects a tiny `registerSW.js`).
- Precache only the app shell, hashed assets, fonts and icons. Navigation falls back to `index.html` except `/api/*` and `/socket.io/*`. No runtime caching of API data.
- Icons are generated from the egrant mark with `sharp` (dev dependency) by `apps/web/scripts/generate-icons.mjs`; the PNGs are committed, so builds and CI do not need sharp.

## Consequences
- A deploy reaches users on their next visit without a prompt; an open tab switches to the new version on reload.
- Offline the shell and fonts load, but data needs the server; offline data is not a goal.
- Changing the mark means rerunning `pnpm --filter @spolu/web icons`.
