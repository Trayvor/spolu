import i18next from 'i18next';
import { EAGER_LANGUAGES, type Language } from './languages';

/**
 * The main locale file (`src/locales/<code>.json`: the shell's texts) of a language that is not
 * in EAGER_LANGUAGES, loaded on use instead of with the entry chunk: nine languages in the
 * entry would cost every user the bundle budget for texts they never read (see
 * docs/architecture/performance.md, "Bundle budget"). The file map is in `./lazy-files.ts`, a
 * chunk of its own; the eager files are imported statically by `./index.ts`.
 */

/** The file maps of the lazy languages (`./lazy-files.ts`), one chunk loaded on first use. */
export const lazyFiles = () => import('./lazy-files');

const loaded = new Set<string>(EAGER_LANGUAGES);
const loads = new Map<string, Promise<void>>();

export function isMainLocaleLoaded(lang: Language): boolean {
  return loaded.has(lang);
}

/**
 * Loads and adds the main texts of `lang` (nothing for an eager or loaded one). Concurrent
 * calls share one load; a failed one is forgotten, so the next call tries again. The texts are
 * merged without overwriting the lazy namespaces already loaded in that language.
 */
export function loadMainLocale(lang: Language): Promise<void> {
  if (loaded.has(lang)) return Promise.resolve();
  let load = loads.get(lang);
  if (load) return load;
  load = lazyFiles().then(async ({ mainFiles }) => {
    // Every language has its file (locales.test.ts), so the lookup never misses.
    const module = await mainFiles[`../locales/${lang}.json`]!();
    i18next.addResourceBundle(lang, 'translation', module.default, true, false);
    loaded.add(lang);
  });
  load.catch(() => loads.delete(lang));
  loads.set(lang, load);
  return load;
}
