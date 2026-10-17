import { describe, expect, it } from 'vitest';
import { buildSearchText, escapeLike, normalizeSearch, searchTerms } from './search.js';

describe('search helpers', () => {
  it('normalizeSearch strips diacritics', () => {
    expect(normalizeSearch('Rozpočet')).toBe('rozpocet');
    expect(normalizeSearch('  ŽLTÝ   kôň\n')).toBe('zlty kon');
  });

  it('escapeLike escapes % _ and backslash', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });

  it('at most 5 terms, none under 2 characters', () => {
    expect(searchTerms(' a Bé cd ef gh ij kl mn ')).toEqual(['be', 'cd', 'ef', 'gh', 'ij']);
    expect(searchTerms('x')).toEqual([]);
  });

  it('buildSearchText joins title, plain body, URL and file names', () => {
    const text = buildSearchText({
      title: 'Výzva',
      body: '**Rozpočet** pre <@u1>',
      url: 'https://opvai.sk/Vyzvy',
      fileNames: ['Plán.pdf'],
      nameOf: (id) => (id === 'u1' ? 'Ján' : undefined),
    });
    expect(text).toBe('vyzva **rozpocet** pre @jan https://opvai.sk/vyzvy plan.pdf');
  });
});
