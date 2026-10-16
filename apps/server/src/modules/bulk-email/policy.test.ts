import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canUseBulkEmail } from './policy.js';

const actor = (role: Role): SessionUser => ({ id: 'me', email: 'a@x.sk', name: 'A', role });

describe('canUseBulkEmail', () => {
  it.each([
    ['admin may', 'admin', true],
    ['superadmin may', 'superadmin', true],
    ['client may not', 'client', false],
  ] as const)('%s', (_, role, expected) => {
    expect(canUseBulkEmail(actor(role))).toBe(expected);
  });
});
