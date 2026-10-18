import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import { canCallTool, canUseMcp } from './policy.js';

const user = (role: SessionUser['role'], finance = false): SessionUser => ({
  id: 'u1',
  email: 'u@example.com',
  name: 'U',
  role,
  finance,
});

describe('canUseMcp', () => {
  it('is for admins and the superadmin (v1)', () => {
    expect(canUseMcp(user('superadmin', true))).toBe(true);
    expect(canUseMcp(user('admin'))).toBe(true);
    expect(canUseMcp(user('admin', true))).toBe(true);
  });

  it('is never for a client (a group client or a žiadateľ alike)', () => {
    expect(canUseMcp(user('client'))).toBe(false);
  });
});

describe('canCallTool', () => {
  const read = { write: false, finance: false };
  const write = { write: true, finance: false };
  const finance = { write: false, finance: true };

  it('a read tool needs any token', () => {
    expect(canCallTool(user('admin'), 'read', read)).toBe(true);
    expect(canCallTool(user('admin'), 'write', read)).toBe(true);
  });

  it('a write tool needs a write token', () => {
    expect(canCallTool(user('admin'), 'read', write)).toBe(false);
    expect(canCallTool(user('admin'), 'write', write)).toBe(true);
  });

  it('a finance documents tool needs the finance right', () => {
    expect(canCallTool(user('admin'), 'write', finance)).toBe(false);
    expect(canCallTool(user('admin', true), 'read', finance)).toBe(true);
    expect(canCallTool(user('superadmin', true), 'read', finance)).toBe(true);
    // A client never holds it, whatever the session says.
    expect(canCallTool(user('client', true), 'read', finance)).toBe(false);
  });
});
