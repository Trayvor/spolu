import { describe, expect, it } from 'vitest';
import { findRanges, foldWithMap } from './highlight.js';
import { normalizeSearch } from './search.js';

describe('foldWithMap', () => {
  it('folds like normalizeSearch (without the whitespace collapse) and maps back', () => {
    const { folded, map } = foldWithMap('Ľubica  Lúky');
    expect(folded).toBe('lubica  luky');
    expect(normalizeSearch('Ľubica  Lúky')).toBe('lubica luky');
    expect(map).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('maps a decomposed character to its base letter', () => {
    const { folded, map } = foldWithMap('Lúky');
    expect(folded).toBe('luky');
    expect(map).toEqual([0, 1, 3, 4]);
  });
});

describe('findRanges', () => {
  it('highlights the original characters of a folded match', () => {
    expect(findRanges('Obec Lúky a Ľubica', ['luky', 'lubica'])).toEqual([
      [5, 9],
      [12, 18],
    ]);
    // NFD-decomposed input keeps the original offsets, the combining mark included.
    expect(findRanges('Lúky', ['luky'])).toEqual([[0, 5]]);
    expect(findRanges('Lú', ['lu'])).toEqual([[0, 3]]);
    expect(findRanges('ôsmy Ôsmy', ['osmy'])).toEqual([
      [0, 4],
      [5, 9],
    ]);
  });

  it('merges overlapping ranges', () => {
    expect(findRanges('rozpocet', ['rozpo', 'pocet'])).toEqual([[0, 8]]);
  });

  it('finds every occurrence, nothing for no terms or no match', () => {
    expect(findRanges('ab ab ab', ['ab'])).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
    expect(findRanges('text', [])).toEqual([]);
    expect(findRanges('text', ['xyz'])).toEqual([]);
  });

  it('treats % and _ as text', () => {
    expect(findRanges('zľava 50% a a_b', ['50%', 'a_b'])).toEqual([
      [6, 9],
      [12, 15],
    ]);
  });
});
