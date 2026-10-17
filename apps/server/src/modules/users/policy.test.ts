import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canDeactivate, canManageAdmins, isAdmin } from './policy.js';

const actor = (role: Role): SessionUser => ({
  id: 'actor',
  email: 'a@example.com',
  name: 'A',
  role,
  finance: false,
});

describe('isAdmin and canManageAdmins', () => {
  it.each([
    ['superadmin', true],
    ['admin', true],
    ['client', false],
  ] as const)('%s -> %s', (role, expected) => {
    expect(isAdmin(actor(role))).toBe(expected);
    expect(canManageAdmins(actor(role))).toBe(expected);
  });
});

describe('canDeactivate', () => {
  const self = { id: 'actor' };
  const other = { id: 'other' };
  it.each([
    ['superadmin', 'self', { ...self, role: 'superadmin' }, false],
    ['superadmin', 'another admin', { ...other, role: 'admin' }, true],
    ['superadmin', 'a client', { ...other, role: 'client' }, false],
    ['admin', 'self', { ...self, role: 'admin' }, false],
    ['admin', 'the superadmin', { ...other, role: 'superadmin' }, false],
    ['admin', 'another admin', { ...other, role: 'admin' }, true],
    ['admin', 'a client', { ...other, role: 'client' }, false],
    ['client', 'self', { ...self, role: 'client' }, false],
    ['client', 'the superadmin', { ...other, role: 'superadmin' }, false],
    ['client', 'an admin', { ...other, role: 'admin' }, false],
    ['client', 'a client', { ...other, role: 'client' }, false],
  ] as const)('%s -> %s: %s', (role, _label, target, expected) => {
    expect(canDeactivate(actor(role), target)).toBe(expected);
  });
});
