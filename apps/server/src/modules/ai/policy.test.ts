import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canOpenInClaude } from './policy.js';

const actor = (role: Role): SessionUser => ({ id: 'a', email: 'a@example.com', name: 'A', role });

describe('canOpenInClaude', () => {
  it.each([
    ['superadmin', true],
    ['admin', true],
    ['client', false],
  ] as const)('%s -> %s', (role, expected) => {
    expect(canOpenInClaude(actor(role))).toBe(expected);
  });
});
