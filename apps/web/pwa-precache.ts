import { EAGER_LANGUAGES, SUPPORTED_LANGUAGES } from './src/i18n/languages';

/**
 * The languages whose texts the service worker does not precache: every language except the
 * eager ones (sk, en). Each of their locale files is its own chunk, named after the file
 * (`src/locales/<code>.json` and `src/locales/<name>/<code>.json` → `assets/<code>-<hash>.js`):
 * 140 files, 145 kB gzip of the 756 kB precache, that every device downloaded on install
 * (Phase 27). They are cached on first use instead (`lazyLanguageChunk` in vite.config.ts).
 * No other module may be named after a language code, or its chunk would be left out too.
 */
export const lazyLanguages: string[] = SUPPORTED_LANGUAGES.map((l) => l.code).filter(
  (code) => !(EAGER_LANGUAGES as readonly string[]).includes(code),
);

/** Workbox `globIgnores`: the lazy languages' chunks, relative to `dist/`. */
export const lazyLanguageGlobs: string[] = lazyLanguages.map((code) => `assets/${code}-*.js`);

/** The runtime cache's match for the same chunks, on the request URL. */
export const lazyLanguageChunk = new RegExp(`/assets/(?:${lazyLanguages.join('|')})-[\\w-]+\\.js$`);
