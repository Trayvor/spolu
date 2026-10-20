import { UserLanguages, type UserLanguage } from '@spolu/shared';

export type EmailLanguage = UserLanguage;

const isSupported = (tag: string): tag is EmailLanguage =>
  (UserLanguages as readonly string[]).includes(tag);

/**
 * The first listed language of an Accept-Language header whose primary tag we support
 * ("en-GB,en;q=0.9" -> en, "cs-CZ" -> cs), else null.
 */
export function supportedLanguageOf(
  acceptLanguage: string | null | undefined,
): EmailLanguage | null {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const primary = part.split(';')[0]!.trim().split('-')[0]!.toLowerCase();
    if (isSupported(primary)) return primary;
  }
  return null;
}

/** The email language from an Accept-Language header (see `supportedLanguageOf`), else Slovak. */
export function pickLanguage(acceptLanguage: string | null | undefined): EmailLanguage {
  return supportedLanguageOf(acceptLanguage) ?? 'sk';
}
