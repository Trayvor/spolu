import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canReadFile, canSetPreview } from './policy.js';

const actor = (role: Role, id = 'actor'): SessionUser => ({
  id,
  email: 'a@example.com',
  name: 'A',
  role,
});

describe('canReadFile', () => {
  const file = { groupId: 'g1', adminsOnly: false };
  it.each([
    ['superadmin', null, true],
    ['admin', null, true],
    ['client', 'g1', true],
    ['client', 'g2', false],
    ['client', null, false],
  ] as const)('%s in group %s -> %s', (role, actorGroupId, expected) => {
    expect(canReadFile(actor(role), file, actorGroupId)).toBe(expected);
  });
});

describe('canReadFile on admins-only files', () => {
  const file = { groupId: 'g1', adminsOnly: true };
  it("an admins-only file is unreadable to the group's client", () => {
    expect(canReadFile(actor('client'), file, 'g1')).toBe(false);
    expect(canReadFile(actor('admin'), file, null)).toBe(true);
    expect(canReadFile(actor('superadmin'), file, null)).toBe(true);
  });
});

describe('canSetPreview', () => {
  it('allows the uploader only', () => {
    expect(canSetPreview(actor('client', 'u1'), { uploadedBy: 'u1' })).toBe(true);
    expect(canSetPreview(actor('admin', 'u2'), { uploadedBy: 'u1' })).toBe(false);
  });
});
