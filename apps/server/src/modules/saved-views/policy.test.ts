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
  });
});
