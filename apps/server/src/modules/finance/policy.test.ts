import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import {
  canAddManualEntry,
  canEditTimeEntry,
  canGrantFinance,
  canLogOwnTaskTime,
  canLogOwnTicketTime,
  canManageRates,
  canSeeFinance,
} from './policy.js';

const actor = (role: Role, finance = false, id = 'me'): SessionUser => ({
  id,
  email: 'a@example.com',
  name: 'A',
  role,
  finance,
});

// The superadmin's session always says finance (toSessionUser); a stale `false` must not hide it.
const people = [
  ['superadmin', actor('superadmin', true)],
  ['superadmin (flag false)', actor('superadmin', false)],
  ['finance admin', actor('admin', true)],
  ['admin', actor('admin', false)],
  ['client', actor('client', false)],
  // A client can never hold it (database CHECK); a forged flag still gives nothing.
  ['client with a forged flag', actor('client', true)],
] as const;

describe('canSeeFinance, canManageRates, canAddManualEntry', () => {
  const expected: Record<string, boolean> = {
    superadmin: true,
    'superadmin (flag false)': true,
    'finance admin': true,
    admin: false,
    client: false,
    'client with a forged flag': false,
  };
  it.each(people)('%s', (label, who) => {
    expect(canSeeFinance(who)).toBe(expected[label]);
    expect(canManageRates(who)).toBe(expected[label]);
    expect(canAddManualEntry(who)).toBe(expected[label]);
  });
});

describe('canGrantFinance', () => {
  const target = (role: Role, disabledAt: Date | null = null, id = 'target') => ({
    id,
    role,
    disabledAt,
  });

  it('only the superadmin grants, and only to an active admin', () => {
    const superadmin = actor('superadmin', true);
    expect(canGrantFinance(superadmin, target('admin'))).toBe(true);
    expect(canGrantFinance(superadmin, target('admin', new Date()))).toBe(false);
    expect(canGrantFinance(superadmin, target('client'))).toBe(false);
    expect(canGrantFinance(superadmin, target('superadmin'))).toBe(false);
    expect(canGrantFinance(superadmin, target('superadmin', null, 'me'))).toBe(false);
  });

  it.each([actor('admin', true), actor('admin'), actor('client', true)])(
    'nobody else grants (%o)',
    (who) => {
      expect(canGrantFinance(who, target('admin'))).toBe(false);
    },
  );
});

describe('canLogOwnTaskTime', () => {
  it.each([
    ['admin assignee', actor('admin'), ['me', 'x'], true],
    ['superadmin assignee', actor('superadmin', true), ['me'], true],
    ['finance admin, not an assignee', actor('admin', true), ['x'], false],
    ['admin, no assignees', actor('admin'), [], false],
    ['client assignee', actor('client'), ['me'], false],
  ] as const)('%s', (_label, who, assignees, expected) => {
    expect(canLogOwnTaskTime(who, assignees)).toBe(expected);
  });
});

describe('canLogOwnTicketTime (2026-10-17)', () => {
  it.each([
    ['admin riešiteľ of a client ticket', actor('admin'), ['me'], 'g1', true],
    ['superadmin riešiteľ', actor('superadmin', true), ['me', 'x'], 'g1', true],
    ['admin, not a riešiteľ', actor('admin', true), ['x'], 'g1', false],
    ['a ticket without a client', actor('admin'), ['me'], null, false],
    ['client riešiteľ', actor('client'), ['me'], 'g1', false],
  ] as const)('%s', (_label, who, assignees, groupId, expected) => {
    expect(canLogOwnTicketTime(who, { assigneeIds: assignees, groupId })).toBe(expected);
  });
});

describe('canEditTimeEntry', () => {
  const task = (userId: string) => ({ source: 'task' as const, userId });
  const manual = (userId: string) => ({ source: 'manual' as const, userId });

  it('a finance admin edits any entry', () => {
    for (const who of [actor('admin', true), actor('superadmin', true)]) {
      expect(canEditTimeEntry(who, task('x'))).toBe(true);
      expect(canEditTimeEntry(who, manual('x'))).toBe(true);
    }
  });

  it('another admin edits only their own task or ticket entry', () => {
    const admin = actor('admin');
    expect(canEditTimeEntry(admin, task('me'))).toBe(true);
    expect(canEditTimeEntry(admin, { source: 'ticket', userId: 'me' })).toBe(true);
    expect(canEditTimeEntry(admin, { source: 'ticket', userId: 'x' })).toBe(false);
    expect(canEditTimeEntry(admin, task('x'))).toBe(false);
    expect(canEditTimeEntry(admin, manual('me'))).toBe(false);
  });

  it('a client edits nothing, not even an entry with their id', () => {
    expect(canEditTimeEntry(actor('client'), task('me'))).toBe(false);
    expect(canEditTimeEntry(actor('client', true), manual('me'))).toBe(false);
  });
});
