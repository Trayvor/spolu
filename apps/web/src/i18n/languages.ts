/**
 * The one list of UI languages. Adding a language = add `src/locales/<code>.json`,
 * one entry here, and its import in `src/i18n/index.ts` (TypeScript flags a missing one);
 * and a `<code>.json` in every namespace folder `src/locales/<name>/` (the lazy feature texts;
 * a test lists any that is missing).
 * `name` is the language's own name, shown in the language menu whatever the UI language.
 * The first entry with a matching browser language wins; DEFAULT_LANGUAGE is the fallback.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'sk', name: 'Slovenčina' },
  { code: 'en', name: 'English' },
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: Language = 'en';
