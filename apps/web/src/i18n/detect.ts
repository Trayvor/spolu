import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type Language } from './languages';

export type { Language } from './languages';

export function isLanguage(value: string | null | undefined): value is Language {
  return SUPPORTED_LANGUAGES.some((lang) => lang.code === value);
}

// A stored choice wins; otherwise the first supported browser language, else the default.
export function detectInitialLanguage(
  stored: string | null,
  navigatorLanguages: readonly string[],
): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of navigatorLanguages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}
