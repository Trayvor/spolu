# 0014 Lazy locale namespaces

Date: 2026-10-16
Status: accepted

## Context
The initial JS budget is 200 kB gzip and we were at 197.4 kB. Both locale files were bundled into the initial JS, and most of their size was feature texts (chat, tasks, the AI split, groups, admins) that only lazy screens render. Phase 6 had already moved the settings and notifications texts out with two one-off loaders (`settings-copy.ts`, `notifications-copy.ts`, static imports plus `addResourceBundle`). Phases 17–20 add more screens and need one generic way.

## Decision
- Feature texts are namespaces: `apps/web/src/locales/<name>/<code>.json`, the keys without the `<name>` wrapper. Only the eager shell (header, menus, sign-in, errors, not found) stays in `src/locales/<code>.json`.
- `loadNamespace(name)` (`src/i18n/namespaces.ts`) loads the current language's file through `import.meta.glob` (one chunk per file) and merges it with `addResourceBundle` into the default `translation` namespace under `<name>`, so `t('<name>.x')` keys stay as they were. One shared promise per language and namespace.
- Routes load their namespaces with their lazy component (`lazyRouteComponent(withNamespaces([...], importer), ...)`); other components use `useNamespaces([...])` under `<Suspense>`. `setLanguage` loads the namespaces in use in the new language before switching. No raw key is ever rendered; `src/router-i18n.test.tsx` checks every route.
- Not i18next's own namespaces (`useTranslation('chat')`) or an HTTP backend: they would change every `t()` call or add a dependency, for no gain at this size.

## Consequences
- The initial JS dropped from 197.4 kB to 192.6 kB gzip, and new features add their texts outside it.
- A screen fetches a few small chunks (0.2–1.7 kB gzip each) with its code; switching the language waits for the new language's namespaces in use.
- A new feature adds a folder, an entry in the locale test's list and the namespaces on its route; forgetting the route part fails `router-i18n.test.tsx` once a case covers it.
