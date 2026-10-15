import { describe, expect, it } from 'vitest';
import { detectInitialLanguage } from './detect';

describe('detectInitialLanguage', () => {
  it('prefers a valid stored choice over the browser language', () => {
    expect(detectInitialLanguage('en', ['sk-SK'])).toBe('en');
  });
  it('picks sk when the first matching browser language is Slovak', () => {
    expect(detectInitialLanguage(null, ['sk-SK', 'en'])).toBe('sk');
  });
  it('falls back to en for other languages', () => {
    expect(detectInitialLanguage(null, ['de-DE'])).toBe('en');
    expect(detectInitialLanguage(null, [])).toBe('en');
  });
  it('ignores an invalid stored value', () => {
    expect(detectInitialLanguage('xx', ['sk'])).toBe('sk');
  });
});
