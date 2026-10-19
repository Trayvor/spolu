import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import {
  canBeManager,
  canBeSubstitute,
  canManageGroups,
  canManageSubstitutions,
  canSetManager,
  canReadGroup,
  canRemoveMember,
} from './policy.js';

const actor = (role: Role): SessionUser => ({
  id: 'actor',
  email: 'a@example.com',
  name: 'A',
  role,
  finance: false,
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

describe('canSetManager', () => {
  it('admin and superadmin yes, client no', () => {
    expect(canSetManager(actor('admin'))).toBe(true);
    expect(canSetManager(actor('superadmin'))).toBe(true);
    expect(canSetManager(actor('client'))).toBe(false);
  });
});

describe('canManageSubstitutions (2026-10-19)', () => {
  it('any admin, for themselves or a colleague; never a client', () => {
    expect(canManageSubstitutions(actor('admin'))).toBe(true);
    expect(canManageSubstitutions(actor('superadmin'))).toBe(true);
    expect(canManageSubstitutions(actor('client'))).toBe(false);
  });
});

describe('canBeSubstitute (2026-10-19)', () => {
  const candidate = (role: Role, disabled = false, id = 'b') => ({
    id,
    role,
    disabledAt: disabled ? new Date() : null,
  });
  it.each([
    ['an active admin', candidate('admin'), true],
    ['the superadmin', candidate('superadmin'), true],
    ['a client', candidate('client'), false],
    ['a deactivated admin', candidate('admin', true), false],
    ['the substituted admin themselves', candidate('admin', false, 'a'), false],
  ] as const)('%s -> %s', (_, who, expected) => {
    expect(canBeSubstitute('a', who)).toBe(expected);
  });
  it('an unknown person never', () => {
    expect(canBeSubstitute('a', undefined)).toBe(false);
  });
});
