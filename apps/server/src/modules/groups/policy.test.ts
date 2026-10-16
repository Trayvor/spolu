import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canBeManager, canManageGroups, canReadGroup, canRemoveMember } from './policy.js';

const actor = (role: Role): SessionUser => ({
  id: 'actor',
  email: 'a@example.com',
  name: 'A',
  role,
});

describe('canManageGroups', () => {
  it.each([
    ['superadmin', true],
    ['admin', true],
    ['client', false],
  ] as const)('%s -> %s', (role, expected) => {
    expect(canManageGroups(actor(role))).toBe(expected);
  });
});

describe('canReadGroup', () => {
  it.each([
    ['superadmin', [], true],
    ['admin', [], true],
    ['client', ['g1'], true],
    ['client', ['g2'], false],
    ['client', [], false],
    ['client', ['g2', 'g1'], true],
  ] as const)('%s with membership %s -> %s', (role, membership, expected) => {
    expect(canReadGroup(actor(role), 'g1', membership)).toBe(expected);
  });
});

describe('canRemoveMember', () => {
  it.each([
    ['superadmin', 'client', true],
    ['admin', 'client', true],
    ['admin', 'admin', false],
    ['admin', 'superadmin', false],
    ['superadmin', 'admin', false],
    ['client', 'client', false],
    ['client', 'admin', false],
  ] as const)('%s removing a %s -> %s', (role, targetRole, expected) => {
    expect(canRemoveMember(actor(role), { role: targetRole })).toBe(expected);
  });
});

describe('canBeManager', () => {
  it('admin and superadmin yes, client no', () => {
    expect(canBeManager(actor('admin'))).toBe(true);
    expect(canBeManager(actor('superadmin'))).toBe(true);
    expect(canBeManager(actor('client'))).toBe(false);
  });
});
