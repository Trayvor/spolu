import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { isLanguage } from './detect';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type Language } from './languages';
import { isMainLocaleLoaded, lazyFiles, loadMainLocale } from './main-locales';

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
type LocaleFile = { default: Record<string, unknown> };
type Importer = (name: string, lang: Language) => Promise<LocaleFile>;

/** The eager languages' namespace files; the others' are in `./lazy-files.ts` (a lazy chunk). */
const files = import.meta.glob<LocaleFile>(['../locales/*/sk.json', '../locales/*/en.json']);

const importFile: Importer = async (name, lang) => {
  const path = `../locales/${name}/${lang}.json`;
  const file = files[path] ?? (await lazyFiles()).namespaceFiles[path];
  if (!file) throw new Error(`Unknown locale namespace "${name}" (${lang})`);
  return file();
};
let importer: Importer = importFile;

/** Every namespace there is: one folder in `src/locales` each (every folder has `en.json`). */
export const NAMESPACES: readonly string[] = [
  ...new Set(Object.keys(files).map((path) => path.split('/')[2] ?? '')),
].sort();

/** One load per namespace and language, shared by every caller (`${lang}/${name}`). */
const loads = new Map<string, Promise<void>>();
/** Settled loads, so a loaded namespace renders at once without suspending. */
const loaded = new Set<string>();
/** Namespaces asked for so far: a language change loads them all in the new language. */
const wanted = new Set<string>();
/** Failed loads (`${lang}/${name}`): `useNamespaces` throws them until `retryFailedNamespaces`. */
const failed = new Map<string, Error>();
/** The language `changeLanguage` is switching to, while its namespaces load. */
let switchingTo: Language | null = null;
/** Bumped by every `changeLanguage`: only the latest call may switch. */
let switchSeq = 0;

function currentLanguage(): Language {
  return isLanguage(i18next.language) ? i18next.language : DEFAULT_LANGUAGE;
}

function loadFor(name: string, lang: Language): Promise<void> {
  const id = `${lang}/${name}`;
  let load = loads.get(id);
  if (load) return load;
  failed.delete(id); // a new attempt
  load = importer(name, lang).then((module) => {
    i18next.addResourceBundle(lang, 'translation', { [name]: module.default }, true, false);
    loaded.add(id);
  });
  // A failed fetch (offline, new deploy): `loadNamespace` tries again on its next call, while
  // `useNamespaces` throws the error until `retryFailedNamespaces`, so it never loops.
  load.catch((error: unknown) => {
    loads.delete(id);
    failed.set(id, error instanceof Error ? error : new Error(String(error)));
  });
  loads.set(id, load);
  return load;
}

/**
 * Loads `src/locales/<name>/<lang>.json` for the current language (and the one being switched
 * to) and merges it under `<name>`. Idempotent: concurrent and later calls share one load.
 */
function assertNamespace(name: string): void {
  if (!NAMESPACES.includes(name)) throw new Error(`Unknown locale namespace "${name}"`);
}

export async function loadNamespace(name: string): Promise<void> {
  assertNamespace(name);
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
 * An unknown name or a failed load throws the error to the nearest error boundary; a failed
 * load stays failed (no new attempt on every render) until `retryFailedNamespaces()`.
 */
export function useNamespaces(names: readonly string[]): void {
  const { i18n } = useTranslation(); // re-renders on a language change
  names.forEach(assertNamespace);
  const lang = isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
  const missing = names.filter((name) => !isNamespaceLoaded(name, lang));
  if (missing.length === 0) return;
  for (const name of missing) {
    const error = failed.get(`${lang}/${name}`);
    if (error) throw error;
  }
  for (const name of missing) wanted.add(name);
  // Suspend the way `React.lazy` does: Suspense renders the component again once it settles.
  // (Not `use()`: replaying a component that suspended on mount breaks on the hooks after it.)
  // Settled either way: Suspense renders again and then sees the load or the failure.
  throw Promise.allSettled(missing.map((name) => loadFor(name, lang)));
}

/** Forgets failed loads, so the next `useNamespaces` render tries again (an error "Retry"). */
export function retryFailedNamespaces(): void {
  failed.clear();
}

/** The language the UI shows or is switching to: what a new choice compares against. */
export function pendingLanguage(): Language {
  return switchingTo ?? currentLanguage();
}

/**
 * Switches the language once every namespace loaded so far is loaded in it too, so no text
 * switches to a raw key. Namespaces asked for while it waits load in both languages.
 * Resolves `true` once switched, or `false` when a later call superseded it (only the latest
 * choice switches). Rejects, keeping the language, when a namespace fails to load.
 */
export async function changeLanguage(lang: Language): Promise<boolean> {
  const seq = ++switchSeq;
  const latest = () => seq === switchSeq;
  const missingIn = () => [...wanted].filter((name) => !isNamespaceLoaded(name, lang));
  switchingTo = lang;
  try {
    // The shell's texts first (a lazy language's main file), then its namespaces. Awaited only
    // when missing, so a switch with everything loaded still happens in the same tick.
    if (!isMainLocaleLoaded(lang)) {
      try {
        await loadMainLocale(lang);
      } catch (error) {
        if (!latest()) return false;
        throw error;
      }
    }
    // A namespace wanted while a round loads joins the next one.
    for (let missing = missingIn(); missing.length > 0 && latest(); missing = missingIn()) {
      try {
        await Promise.all(missing.map((name) => loadFor(name, lang)));
      } catch (error) {
        if (!latest()) return false; // superseded: its failure no longer matters
        throw error;
      }
    }
    if (!latest()) return false;
    // Nothing left to load, so i18next switches at once (in the same tick when nothing was missing).
    await i18next.changeLanguage(lang);
    return true;
  } finally {
    if (latest()) switchingTo = null;
  }
}

/** Tests only: replace how a namespace file is fetched (to delay or fail it); null restores it. */
export function setNamespaceImporter(replacement: Importer | null): void {
  importer = replacement ?? importFile;
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
  failed.clear();
  switchingTo = null;
}
