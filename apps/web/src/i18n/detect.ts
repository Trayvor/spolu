export const LANGUAGES = ['sk', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: string | null): value is Language {
  return LANGUAGES.some((lang) => lang === value);
}

// A stored choice wins; otherwise Slovak if the browser prefers it, else English.
export function detectInitialLanguage(
  stored: string | null,
  navigatorLanguages: readonly string[],
): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of navigatorLanguages) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'sk') return 'sk';
    if (base === 'en') return 'en';
  }
  return 'en';
}
