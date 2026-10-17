import { describe, expect, it } from 'vitest';
import { byName, chainTo, descendantIds } from './tree.js';

const folders = [
  { id: 'a', parentId: null, name: 'Zmluvy' },
  { id: 'b', parentId: 'a', name: 'Číslo 2' },
  { id: 'c', parentId: 'b', name: 'archív' },
  { id: 'd', parentId: null, name: 'Účty' },
];

describe('folder tree helpers', () => {
  it('descendantIds finds every folder below, not the folder itself', () => {
    expect([...descendantIds(folders, 'a')].sort()).toEqual(['b', 'c']);
    expect(descendantIds(folders, 'c').size).toBe(0);
  });

  it('descendantIds survives a cycle', () => {
    const loop = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ];
    expect([...descendantIds(loop, 'x')].sort()).toEqual(['x', 'y']);
  });

  it('byName sorts in Slovak order, case-insensitive, numbers by value', () => {
    expect([...folders].sort(byName).map((f) => f.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('chainTo walks from the top down to the folder and stops at a cycle', () => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    expect(chainTo(byId, 'c', (f) => f.parentId).map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(chainTo(byId, 'missing', (f) => f.parentId)).toEqual([]);
    const loop = new Map([
      ['x', { id: 'x', parentId: 'y' }],
      ['y', { id: 'y', parentId: 'x' }],
    ]);
    expect(chainTo(loop, 'x', (f) => f.parentId).map((f) => f.id)).toEqual(['y', 'x']);
  });
});
