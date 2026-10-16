import { describe, expect, it } from 'vitest';
import type { KnowledgeFolderDto } from '@spolu/shared';
import { childFolders, descendantIds, folderPath, treeRows } from './folder-tree';

const f = (id: string, name: string, parentId: string | null = null): KnowledgeFolderDto => ({
  id,
  groupId: 'g',
  parentId,
  name,
  visibility: 'public',
  updatedAt: '2026-10-16T10:00:00.000Z',
});

const folders = [
  f('a', 'čaj'),
  f('b', 'cesta'),
  f('c', 'Inner', 'b'),
  f('d', 'Deep', 'c'),
  f('e', 'alfa'),
];

describe('folder tree', () => {
  it('lists children by name in Slovak order', () => {
    expect(childFolders(folders, null, 'sk').map((x) => x.name)).toEqual(['alfa', 'cesta', 'čaj']);
    expect(childFolders(folders, 'b', 'sk').map((x) => x.id)).toEqual(['c']);
  });

  it('builds the path from the top level', () => {
    expect(folderPath(folders, 'd').map((x) => x.id)).toEqual(['b', 'c', 'd']);
    expect(folderPath(folders, 'missing')).toEqual([]);
  });

  it('finds every folder below one', () => {
    expect([...descendantIds(folders, 'b')].sort()).toEqual(['c', 'd']);
    expect(descendantIds(folders, 'd').size).toBe(0);
  });

  it('flattens the tree depth first with depths', () => {
    expect(treeRows(folders, 'sk').map((r) => `${r.depth}${r.folder.id}`)).toEqual([
      '0e',
      '0b',
      '1c',
      '2d',
      '0a',
    ]);
  });
});
