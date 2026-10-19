/**
 * Highlights for search hits (message search, 2026-10-19): where the folded terms of a query
 * occur in the original text, as offsets into that text, so "luky" marks "Lúky".
 */

/**
 * `text` folded as `normalizeSearch` folds (NFD, combining marks removed, lower-cased), without
 * its whitespace collapse and trim, and `map[i]`: the index in `text` of the character that
 * produced `folded[i]`. Walks the text by code point, so a decomposed letter maps to its base.
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let at = 0;
  for (const ch of text) {
    const out = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let i = 0; i < out.length; i++) map.push(at);
    folded += out;
    at += ch.length;
  }
  return { folded, map };
}

/**
 * Every occurrence of every (already folded) term in `text`, as `[start, end)` offsets into
 * `text`, sorted and merged. A match ends where the next folded character starts, so the
 * combining marks of its last letter belong to it.
 */
export function findRanges(text: string, terms: string[]): [number, number][] {
  const { folded, map } = foldWithMap(text);
  const endOf = (i: number) => (i < map.length ? map[i]! : text.length);
  const found: [number, number][] = [];
  for (const term of new Set(terms)) {
    if (!term) continue;
    for (let i = folded.indexOf(term); i !== -1; i = folded.indexOf(term, i + 1)) {
      found.push([map[i]!, endOf(i + term.length)]);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of found) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
