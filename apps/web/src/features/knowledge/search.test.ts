import { describe, expect, it } from 'vitest';
import { validateKnowledgeSearch } from './search';

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
