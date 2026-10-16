import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { isLanguage } from './detect';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type Language } from './languages';

/**
 * Lazy locale namespaces: the texts of one feature in `src/locales/<name>/<code>.json`,
 * loaded with the lazy chunks that render them instead of with the entry chunk (see
 * docs/architecture/performance.md, "Bundle budget"). `import.meta.glob` without `eager` turns
 * every file into its own small chunk, fetched on first use.
 *
 * A file holds the keys under its name without the wrapper: `chat/en.json` has `composer.send`,
 * and `loadNamespace('chat')` merges it into the default `translation` namespace as
 * `chat.composer.send`, so components keep calling `t('chat.composer.send')`.
 *
 * A screen must not render before its namespaces are loaded, or it shows raw keys:
 * - a route wraps its lazy component: `lazyRouteComponent(withNamespaces(['chat'], () => import(…)), 'ChatTab')`;
 * - a component rendered elsewhere calls `useNamespaces(['chat'])` under a `<Suspense>`.
 */
const files = import.meta.glob<{ default: Record<string, unknown> }>('../locales/*/*.json');

const fileOf = (name: string, lang: Language) => `../locales/${name}/${lang}.json`;

/** Every namespace there is: one folder in `src/locales` each. */
export const NAMESPACES: readonly string[] = [
  ...new Set(Object.keys(files).map((path) => path.split('/')[2] ?? '')),
].sort();

/** One load per namespace and language, shared by every caller (`${lang}/${name}`). */
const loads = new Map<string, Promise<void>>();
/** Settled loads, so a loaded namespace renders at once without suspending. */
const loaded = new Set<string>();
/** Namespaces asked for so far: a language change loads them all in the new language. */
const wanted = new Set<string>();
/** The language `changeLanguage` is switching to, while its namespaces load. */
let switchingTo: Language | null = null;

function currentLanguage(): Language {
  return isLanguage(i18next.language) ? i18next.language : DEFAULT_LANGUAGE;
}

function loadFor(name: string, lang: Language): Promise<void> {
  const id = `${lang}/${name}`;
  let load = loads.get(id);
  if (load) return load;
  const file = files[fileOf(name, lang)];
  if (!file) return Promise.reject(new Error(`Unknown locale namespace "${name}" (${lang})`));
  load = file().then((module) => {
    i18next.addResourceBundle(lang, 'translation', { [name]: module.default }, true, false);
    loaded.add(id);
  });
  // A failed fetch (offline, new deploy) may be retried by the next caller.
  load.catch(() => loads.delete(id));
  loads.set(id, load);
  return load;
}

/**
 * Loads `src/locales/<name>/<lang>.json` for the current language (and the one being switched
 * to) and merges it under `<name>`. Idempotent: concurrent and later calls share one load.
 */
export async function loadNamespace(name: string): Promise<void> {
  if (!NAMESPACES.includes(name)) throw new Error(`Unknown locale namespace "${name}"`);
  wanted.add(name);
  const languages = new Set([currentLanguage(), switchingTo ?? currentLanguage()]);
  await Promise.all([...languages].map((lang) => loadFor(name, lang)));
}

export async function loadNamespaces(names: readonly string[]): Promise<void> {
  await Promise.all(names.map(loadNamespace));
}

export function isNamespaceLoaded(name: string, lang: Language = currentLanguage()): boolean {
  return loaded.has(`${lang}/${name}`);
}

/**
 * Wraps a lazy import so it resolves only once its namespaces are loaded, both fetched in
 * parallel. For `lazyRouteComponent` and `React.lazy`; route preloading (on hover) loads both.
 */
export function withNamespaces<T>(
  names: readonly string[],
  importer: () => Promise<T>,
): () => Promise<T> {
  return async () => (await Promise.all([importer(), loadNamespaces(names)]))[0];
}

/**
 * Suspends the component until its namespaces are loaded in the current language. For a
 * component that is not behind a `withNamespaces` import; it needs a `<Suspense>` above it.
 */
export function useNamespaces(names: readonly string[]): void {
  const { i18n } = useTranslation(); // re-renders on a language change
  const lang = isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
  const missing = names.filter((name) => !isNamespaceLoaded(name, lang));
  if (missing.length === 0) return;
  for (const name of missing) wanted.add(name);
  // Suspend the way `React.lazy` does: Suspense renders the component again once it settles.
  // (Not `use()`: replaying a component that suspended on mount breaks on the hooks after it.)
  throw Promise.all(missing.map((name) => loadFor(name, lang)));
}

/**
 * Switches the language once every namespace loaded so far is loaded in it too, so no text
 * switches to a raw key. Namespaces asked for while it waits load in both languages.
 */
export function changeLanguage(lang: Language): Promise<void> {
  const missingIn = () => [...wanted].filter((name) => !isNamespaceLoaded(name, lang));
  // Nothing to load: switch at once, in the same tick, as with eager texts.
  if (missingIn().length === 0) return i18next.changeLanguage(lang).then(() => undefined);
  switchingTo = lang;
  return (async () => {
    try {
      // A namespace wanted while a round loads joins the next one.
      for (let missing = missingIn(); missing.length > 0; missing = missingIn()) {
        await Promise.all(missing.map((name) => loadFor(name, lang)));
      }
      await i18next.changeLanguage(lang);
    } finally {
      if (switchingTo === lang) switchingTo = null;
    }
  })();
}

/** Tests only: every namespace in every language, for tests that render screens in parts. */
export async function loadAllNamespaces(): Promise<void> {
  for (const name of NAMESPACES) wanted.add(name);
  await Promise.all(
    NAMESPACES.flatMap((name) => SUPPORTED_LANGUAGES.map(({ code }) => loadFor(name, code))),
  );
}

/** Tests only: forget every loaded namespace, as on a fresh page load. */
export function resetNamespaces(): void {
  for (const id of loaded) {
    const [lang, name] = id.split('/') as [string, string];
    const bundle = i18next.store.data[lang]?.translation as Record<string, unknown> | undefined;
    delete bundle?.[name];
  }
  loads.clear();
  loaded.clear();
  wanted.clear();
  switchingTo = null;
}
