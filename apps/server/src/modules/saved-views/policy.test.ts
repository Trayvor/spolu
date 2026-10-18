import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import { canUseSavedViews } from './policy.js';

const user = (role: SessionUser['role'], finance = false): SessionUser => ({
  id: role,
  email: `${role}@example.com`,
  name: role,
  role,
  finance,
});

describe('saved views policy', () => {
  it.each([
    ['superadmin', user('superadmin'), true],
    ['admin', user('admin'), true],
    ['finance admin', user('admin', true), true],
    ['client', user('client'), false],
  ] as const)('%s: %s', (_name, actor, expected) => {
    expect(canUseSavedViews(actor)).toBe(expected);
    expect(canUseSavedViews(actor, 'board')).toBe(expected);
  });

  it.each([
    ['superadmin', user('superadmin'), true],
    ['admin without the finance right', user('admin'), false],
    ['finance admin', user('admin', true), true],
    ['client with a stray finance flag', user('client', true), false],
  ] as const)('the finance page: %s: %s', (_name, actor, expected) => {
    expect(canUseSavedViews(actor, 'finance')).toBe(expected);
  });
});
