import { describe, expect, it } from 'vitest';
import { formatTypes, normalizeTypes, parseTypes, validateKnowledgeSearch } from './search';

describe('validateKnowledgeSearch', () => {
  it('sets every key, an invalid one to undefined, so raw params never leak through', () => {
    expect(validateKnowledgeSearch({ type: 'bogus', q: ' a ', k: '', clients: 3 })).toStrictEqual({
      clients: '3',
      type: undefined,
      q: undefined,
      k: undefined,
    });
  });

  it('trims the search and keeps it from 2 characters', () => {
    expect(validateKnowledgeSearch({ type: 'link', q: '  portal ', k: 'k1' })).toStrictEqual({
      clients: undefined,
      type: 'link',
      q: 'portal',
      k: 'k1',
    });
  });
});

describe('the type list in the URL', () => {
  it('keeps several types as one comma list, valid, deduplicated, in the canonical order', () => {
    expect(normalizeTypes('reminder,bogus,note,reminder')).toBe('note,reminder');
    expect(validateKnowledgeSearch({ type: 'link,file' }).type).toBe('file,link');
  });

  it('still reads an old single-value link and a JSON array', () => {
    expect(normalizeTypes('note')).toBe('note');
    expect(normalizeTypes(['link', 'note', 'x'])).toBe('note,link');
  });

  it('drops an empty or wholly invalid value', () => {
    expect(normalizeTypes('')).toBeUndefined();
    expect(normalizeTypes('bogus,')).toBeUndefined();
    expect(normalizeTypes(3)).toBeUndefined();
    expect(normalizeTypes(undefined)).toBeUndefined();
  });

  it('parses and formats', () => {
    expect(parseTypes('note,link')).toEqual(['note', 'link']);
    expect(parseTypes(undefined)).toEqual([]);
    expect(formatTypes(['link', 'note', 'link'])).toBe('note,link');
    expect(formatTypes([])).toBeUndefined();
  });
});
