import { describe, expect, it } from 'vitest';
import type { Me } from '@spolu/shared';
import { currentSection, navSections } from './nav-sections';

const group = (id: string, role: 'client' | 'ziadatel') => ({
  id,
  name: `G ${id}`,
  role,
  hasLogo: false,
  updatedAt: '',
});
const me = (role: Me['role'], groups: Me['groups'] = []): Me => ({
  id: 'u1',
  name: 'Eva',
  email: 'eva@example.com',
  role,
  finance: false,
  groups,
});
const keys = (user: Me) => navSections(user).map((section) => section.key);

describe('navSections', () => {
  it('gives admins their seven sections in header order', () => {
    expect(keys(me('admin'))).toEqual([
      'home',
      'tasks',
      'tickets',
      'knowledge',
      'groups',
      'admins',
      'bulkEmail',
    ]);
  });

  it('adds Financie after Knowledge for a finance admin (Phase 32)', () => {
    expect(keys({ ...me('admin'), finance: true })).toEqual([
      'home',
      'tasks',
      'tickets',
      'knowledge',
      'finance',
      'groups',
      'admins',
      'bulkEmail',
    ]);
    expect(keys({ ...me('superadmin'), finance: true })).toContain('finance');
    expect(currentSection(navSections({ ...me('admin'), finance: true }), '/finance')?.key).toBe(
      'finance',
    );
  });

  it('gives clients and requesters only what they can open', () => {
    expect(keys(me('client', [group('a', 'client')]))).toEqual([]);
    expect(keys(me('client', [group('a', 'client'), group('b', 'client')]))).toEqual(['myGroups']);
    expect(keys(me('client', [group('a', 'client'), group('b', 'ziadatel')]))).toEqual([
      'group',
      'tickets',
    ]);
    const requester = navSections(me('client', [group('b', 'ziadatel')]));
    expect(requester.map((section) => section.label)).toEqual(['nav.tickets']);
  });
});

describe('currentSection', () => {
  const admin = navSections(me('admin'));
  it.each([
    ['/', 'home'],
    ['/tasks', 'tasks'],
    ['/tickets/t1', 'tickets'],
    ['/groups/g1/chat', 'groups'],
    ['/bulk-email/c1', 'bulkEmail'],
  ])('%s belongs to %s', (path, key) => {
    expect(currentSection(admin, path)?.key).toBe(key);
  });

  it('a page of no section (Settings) or a look-alike prefix matches none', () => {
    expect(currentSection(admin, '/settings')).toBeUndefined();
    expect(currentSection(admin, '/tasksx')).toBeUndefined();
  });
});
