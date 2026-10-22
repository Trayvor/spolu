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
  it('is for admins and the superadmin, whatever their memberships', () => {
    expect(canUseMcp(user('superadmin', true), 0)).toBe(true);
    expect(canUseMcp(user('admin'), 0)).toBe(true);
    expect(canUseMcp(user('admin', true), 0)).toBe(true);
  });

  it('is for a client while they are a manager of at least one client (ADR 0071)', () => {
    expect(canUseMcp(user('client'), 1)).toBe(true);
    expect(canUseMcp(user('client'), 3)).toBe(true);
  });

  it('is never for a client without an active manager membership (a pure žiadateľ)', () => {
    expect(canUseMcp(user('client'), 0)).toBe(false);
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

  it('a finance tool needs the finance right', () => {
    expect(canCallTool(user('admin'), 'write', finance)).toBe(false);
    expect(canCallTool(user('admin', true), 'read', finance)).toBe(true);
    expect(canCallTool(user('superadmin', true), 'read', finance)).toBe(true);
    // A client never holds it, whatever the session says.
    expect(canCallTool(user('client', true), 'read', finance)).toBe(false);
  });

  it('an admin tool is never a client’s, read or write (ADR 0071)', () => {
    const adminRead = { admin: true };
    const adminWrite = { admin: true, write: true };
    expect(canCallTool(user('admin'), 'read', adminRead)).toBe(true);
    expect(canCallTool(user('superadmin', true), 'write', adminWrite)).toBe(true);
    expect(canCallTool(user('client'), 'read', adminRead)).toBe(false);
    expect(canCallTool(user('client'), 'write', adminWrite)).toBe(false);
    expect(canCallTool(user('client'), 'write', write)).toBe(true);
  });
});
