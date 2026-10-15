import { describe, expect, it } from 'vitest';
import { detectInitialLanguage, isLanguage } from './detect';
import { SUPPORTED_LANGUAGES } from './languages';

describe('detectInitialLanguage', () => {
  it('prefers a valid stored choice over the browser language', () => {
    expect(detectInitialLanguage('en', ['sk-SK'])).toBe('en');
  });
  it('picks sk when the first matching browser language is Slovak', () => {
    expect(detectInitialLanguage(null, ['sk-SK', 'en'])).toBe('sk');
  });
  it('skips unsupported browser languages until one matches', () => {
    expect(detectInitialLanguage(null, ['de-DE', 'en-GB', 'sk'])).toBe('en');
  });
  it('falls back to en for other languages', () => {
    expect(detectInitialLanguage(null, ['de-DE'])).toBe('en');
    expect(detectInitialLanguage(null, [])).toBe('en');
  });
  it('ignores an invalid stored value', () => {
    expect(detectInitialLanguage('xx', ['sk'])).toBe('sk');
  });
  it('detects every supported language from the list', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(detectInitialLanguage(null, [`${code.toUpperCase()}-XX`])).toBe(code);
      expect(detectInitialLanguage(code, [])).toBe(code);
    }
  });
});

describe('isLanguage', () => {
  it('accepts exactly the codes in SUPPORTED_LANGUAGES', () => {
    for (const { code } of SUPPORTED_LANGUAGES) expect(isLanguage(code)).toBe(true);
    expect(isLanguage('xx')).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});
