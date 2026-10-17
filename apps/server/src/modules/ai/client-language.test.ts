import { describe, expect, it } from 'vitest';
import { clientLanguageOf, isSlovakInstance, languageName } from './client-language.js';

describe('isSlovakInstance', () => {
  it('is true only for a .sk host', () => {
    expect(isSlovakInstance('https://firma.egrant.sk')).toBe(true);
    expect(isSlovakInstance('https://firma.egrant.cz')).toBe(false);
    expect(isSlovakInstance('https://grants.example.eu')).toBe(false);
    expect(isSlovakInstance('https://sk.example.com')).toBe(false);
  });
});

describe('clientLanguageOf', () => {
  it('a country domain wins over the profiles', () => {
    expect(clientLanguageOf('https://a.egrant.cz', ['it', 'it'])).toBe('cs');
    expect(clientLanguageOf('https://a.example.pl', [])).toBe('pl');
    expect(clientLanguageOf('https://a.example.at', [])).toBe('de');
    expect(clientLanguageOf('https://a.example.si', [])).toBe('sl');
    expect(clientLanguageOf('https://a.example.ua', [])).toBe('uk');
  });

  it('otherwise the most common profile language, ignoring sk and en', () => {
    expect(clientLanguageOf('https://a.example.eu', ['sk', 'sk', 'sk', 'hr', 'it', 'hr'])).toBe(
      'hr',
    );
    expect(clientLanguageOf('https://a.example.com', ['sk', 'en'])).toBeNull();
    expect(clientLanguageOf('https://a.example.com', [])).toBeNull();
  });

  it('a tie goes to the language listed first (stable)', () => {
    expect(clientLanguageOf('https://a.example.eu', ['it', 'bg'])).toBe('it');
  });
});

describe('languageName', () => {
  it('names a code in English for the prompt', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('cs')).toBe('Czech');
    expect(languageName('uk')).toBe('Ukrainian');
  });
});
