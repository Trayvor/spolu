import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canReadFile, canSetPreview } from './policy.js';

const actor = (role: Role, id = 'actor', finance = false): SessionUser => ({
  id,
  email: 'a@example.com',
  name: 'A',
  role,
  finance,
});

describe('canReadFile', () => {
  const file = { groupId: 'g1', adminsOnly: false, financeOnly: false };
  it.each([
    ['superadmin', [], true],
    ['admin', [], true],
    ['client', ['g1'], true],
    ['client', ['g2'], false],
    ['client', [], false],
    ['client', ['g2', 'g1'], true],
  ] as const)('%s in group %s -> %s', (role, actorGroupId, expected) => {
    expect(canReadFile(actor(role), file, actorGroupId)).toBe(expected);
  });
});

describe('canReadFile on admins-only files', () => {
  const file = { groupId: 'g1', adminsOnly: true, financeOnly: false };
  it("an admins-only file is unreadable to the group's client", () => {
    expect(canReadFile(actor('client'), file, ['g1'])).toBe(false);
    expect(canReadFile(actor('admin'), file, [])).toBe(true);
    expect(canReadFile(actor('superadmin'), file, [])).toBe(true);
  });
});

describe('canReadFile on files of no group', () => {
  it('only admins read a file of a ticket without a client', () => {
    const file = { groupId: null, adminsOnly: false, financeOnly: false };
    expect(canReadFile(actor('admin'), file, [])).toBe(true);
    expect(canReadFile(actor('client'), file, ['g1'])).toBe(false);
  });
});

describe('canReadFile on finance-only files (Phase 32)', () => {
  const file = { groupId: 'g1', adminsOnly: false, financeOnly: true };
  it('only a finance admin reads it, before any group rule', () => {
    expect(canReadFile(actor('superadmin', 'actor', true), file, [])).toBe(true);
    expect(canReadFile(actor('admin', 'actor', true), file, [])).toBe(true);
    expect(canReadFile(actor('admin'), file, [])).toBe(false);
    // The group's own client, even one with a forged flag.
    expect(canReadFile(actor('client'), file, ['g1'])).toBe(false);
    expect(canReadFile(actor('client', 'actor', true), file, ['g1'])).toBe(false);
  });
});

describe('canSetPreview', () => {
  it('allows the uploader only', () => {
    expect(canSetPreview(actor('client', 'u1'), { uploadedBy: 'u1' })).toBe(true);
    expect(canSetPreview(actor('admin', 'u2'), { uploadedBy: 'u1' })).toBe(false);
    expect(canSetPreview(actor('admin', 'u2'), { uploadedBy: null })).toBe(false);
  });
});
