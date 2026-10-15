export type EmailLanguage = 'sk' | 'en';

const SUPPORTED: readonly EmailLanguage[] = ['sk', 'en'];

const isSupported = (tag: string): tag is EmailLanguage =>
  (SUPPORTED as readonly string[]).includes(tag);

/**
 * The email language from an Accept-Language header: the first listed language whose primary
 * tag we support ("en-GB,en;q=0.9" -> en), else Slovak.
 */
export function pickLanguage(acceptLanguage: string | null | undefined): EmailLanguage {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const primary = part.split(';')[0]!.trim().split('-')[0]!.toLowerCase();
    if (isSupported(primary)) return primary;
  }
  return 'sk';
}
