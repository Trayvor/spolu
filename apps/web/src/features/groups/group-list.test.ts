import { describe, expect, it } from 'vitest';
import type { GroupSummary } from '@spolu/shared';
import { filterByManager, filterByName, sortMineFirst } from './group-list';

const group = (id: string, managers: string[], managedByMe = false): GroupSummary => ({
  id,
  kind: 'client',
  name: id,
  hasLogo: false,
  memberCount: 0,
  updatedAt: '2026-10-16T00:00:00.000Z',
  managers: managers.map((m) => ({ id: m, name: m })),
  managedByMe,
});

// In the server's name order.
const A = group('a', ['peter']);
const B = group('b', ['me', 'peter'], true);
const C = group('c', []);
const D = group('d', ['me'], true);
const ALL = [A, B, C, D];
const ids = (list: GroupSummary[]) => list.map((g) => g.id);

describe('sortMineFirst', () => {
  it('puts managed groups first and keeps the name order inside each part', () => {
    expect(ids(sortMineFirst(ALL))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('does not change the input', () => {
    sortMineFirst(ALL);
    expect(ids(ALL)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('filterByManager', () => {
  const admins = new Set(['me', 'peter', 'zora']);

  it('undefined gives every group', () => {
    expect(ids(filterByManager(ALL, undefined, admins))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('me gives the groups I manage', () => {
    expect(ids(filterByManager(ALL, 'me', admins))).toEqual(['b', 'd']);
  });

  it('none gives the groups without a manager', () => {
    expect(ids(filterByManager(ALL, 'none', admins))).toEqual(['c']);
  });

  it('an admin id gives the groups that admin manages', () => {
    expect(ids(filterByManager(ALL, 'peter', admins))).toEqual(['a', 'b']);
    expect(filterByManager(ALL, 'zora', admins)).toEqual([]);
  });

  it('an unknown id, or any id before the admins load, gives every group', () => {
    expect(ids(filterByManager(ALL, 'gone', admins))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(filterByManager(ALL, 'peter', null))).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('filterByName', () => {
  const named = (name: string) => ({ ...A, id: name, name });
  const list = [named('Obec Lúky'), named('Mesto Senec'), named('LUKOIL')];

  it('matches part of the name, ignoring case and diacritics', () => {
    expect(ids(filterByName(list, ' luk '))).toEqual(['Obec Lúky', 'LUKOIL']);
    expect(ids(filterByName(list, 'SENEC'))).toEqual(['Mesto Senec']);
  });

  it('a blank query keeps every group', () => {
    expect(filterByName(list, '  ')).toBe(list);
  });
});
