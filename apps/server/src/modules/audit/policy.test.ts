import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { auditCategoriesFor, canReadAudit } from './policy.js';

const as = (role: Role, finance = false): SessionUser => ({
  id: 'u',
  email: 'u@example.com',
  name: 'U',
  role,
  finance,
});

describe('audit policy', () => {
  it('every admin (not only the superadmin) reads the log, a client and a requester do not', () => {
    expect(canReadAudit(as('superadmin'))).toBe(true);
    expect(canReadAudit(as('admin'))).toBe(true);
    expect(canReadAudit(as('admin', true))).toBe(true);
    expect(canReadAudit(as('client'))).toBe(false);
  });

  it('finance categories only with the finance right', () => {
    expect(auditCategoriesFor(as('admin'))).toEqual(['general']);
    expect(auditCategoriesFor(as('admin', true))).toEqual(['general', 'finance']);
    expect(auditCategoriesFor(as('client', true))).toEqual(['general']);
  });

  it('the superadmin always gets the finance category', () => {
    expect(auditCategoriesFor(as('superadmin', false))).toEqual(['general', 'finance']);
  });
});
