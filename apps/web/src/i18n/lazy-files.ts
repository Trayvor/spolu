/**
 * The locale files of the languages that are not in EAGER_LANGUAGES (`./languages.ts`): their
 * main files and their namespace files, each its own small chunk. This module is itself loaded
 * on the first use of such a language, so its file map (one entry per language and namespace)
 * stays out of the entry chunk (see docs/architecture/performance.md, "Bundle budget").
 * The patterns leave out the eager languages, which `./index.ts` and `./namespaces.ts` load;
 * a test checks that both lists agree.
 */
type LocaleFile = { default: Record<string, unknown> };

export const mainFiles = import.meta.glob<LocaleFile>([
  '../locales/*.json',
  '!../locales/sk.json',
  '!../locales/en.json',
]);

export const namespaceFiles = import.meta.glob<LocaleFile>([
  '../locales/*/*.json',
  '!../locales/*/sk.json',
  '!../locales/*/en.json',
]);
