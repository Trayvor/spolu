// Phase 28: the language "Translate to the client's language" translates into. See the design
// (docs/superpowers/specs/2026-10-17-phase-28-ai-text-tools-and-voice-design.md).

/** Country domains and their main language (ISO 639-1); the model translates into any of them. */
const TLD_LANGUAGE: Record<string, string> = {
  cz: 'cs',
  si: 'sl',
  hr: 'hr',
  bg: 'bg',
  ee: 'et',
  it: 'it',
  ua: 'uk',
  pl: 'pl',
  hu: 'hu',
  at: 'de',
  de: 'de',
  ro: 'ro',
  rs: 'sr',
  lt: 'lt',
  lv: 'lv',
  fi: 'fi',
  fr: 'fr',
  es: 'es',
  pt: 'pt',
  nl: 'nl',
  gr: 'el',
};

const tldOf = (egrantUrl: string): string => {
  try {
    return new URL(egrantUrl).hostname.split('.').pop()!.toLowerCase();
  } catch {
    return '';
  }
};

/** Translate is offered only where the group's eGrant instance is not on a `.sk` domain. */
export function isSlovakInstance(egrantUrl: string): boolean {
  return tldOf(egrantUrl) === 'sk';
}

/**
 * The client's language: the instance's country domain, else the most common profile language
 * of the group's clients other than `sk` (the default nobody chose) and `en` (its own option),
 * else null (only English is offered).
 */
export function clientLanguageOf(egrantUrl: string, profileLanguages: string[]): string | null {
  const fromDomain = TLD_LANGUAGE[tldOf(egrantUrl)];
  if (fromDomain) return fromDomain;
  const counts = new Map<string, number>();
  for (const language of profileLanguages) {
    if (language === 'sk' || language === 'en') continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [language, count] of counts) {
    if (best === null || count > counts.get(best)!) best = language;
  }
  return best;
}

const names = new Intl.DisplayNames(['en'], { type: 'language' });

/** The English name of a language code, for the prompt ("Czech"). */
export function languageName(code: string): string {
  return names.of(code) ?? code;
}
