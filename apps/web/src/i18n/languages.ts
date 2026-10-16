/**
 * The one list of UI languages (the same codes as `UserLanguages` in `@spolu/shared`, which the
 * server stores and writes emails in). Adding a language = add `src/locales/<code>.json`, one
 * entry here, and a `<code>.json` in every namespace folder `src/locales/<name>/` (the lazy
 * feature texts; a test lists any that is missing); on the server its texts in
 * `apps/server/src/infra/i18n/` and a migration of the `language` checks.
 * `name` is the language's own name, shown in the language menu whatever the UI language.
 * The first entry with a matching browser language wins; DEFAULT_LANGUAGE is the fallback.
 * `EAGER_LANGUAGES` ship their main file with the entry chunk; the others load it on use.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'sk', name: 'Slovenčina' },
  { code: 'en', name: 'English' },
  { code: 'cs', name: 'Čeština' },
  { code: 'bg', name: 'Български' },
  { code: 'et', name: 'Eesti' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'it', name: 'Italiano' },
  { code: 'sl', name: 'Slovenščina' },
  { code: 'uk', name: 'Українська' },
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: Language = 'en';

/** Bundled with the entry chunk: the fallback and the team's language. */
export const EAGER_LANGUAGES = ['sk', 'en'] as const satisfies readonly Language[];
