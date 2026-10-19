import { describe, expect, it } from 'vitest';
import {
  AUDIT_CATALOGUE,
  AUDIT_ENTITY_TYPES,
  AUDIT_FIELDS,
  AuditActorFilterSchema,
  AuditQuerySchema,
  auditCategoryOf,
  isAuditAction,
} from './audit.js';

describe('AUDIT_CATALOGUE', () => {
  it('every entity type has a category and at least one action', () => {
    for (const type of AUDIT_ENTITY_TYPES) {
      expect(['general', 'finance']).toContain(AUDIT_CATALOGUE[type].category);
      expect(AUDIT_CATALOGUE[type].actions.length).toBeGreaterThan(0);
    }
  });

  it('finance types are exactly finance_access, finance_item, finance_folder, time_entry, rate', () => {
    const finance = AUDIT_ENTITY_TYPES.filter((t) => auditCategoryOf(t) === 'finance').sort();
    expect(finance).toEqual(
      ['finance_access', 'finance_folder', 'finance_item', 'rate', 'time_entry'].sort(),
    );
  });

  it('AUDIT_FIELDS has an entry for every entity type', () => {
    for (const type of AUDIT_ENTITY_TYPES) expect(AUDIT_FIELDS[type]).toBeDefined();
    expect(Object.keys(AUDIT_FIELDS).sort()).toEqual([...AUDIT_ENTITY_TYPES].sort());
  });

  it('no finance-only field kind (money, minutes) is on a general entity type', () => {
    for (const type of AUDIT_ENTITY_TYPES) {
      if (auditCategoryOf(type) === 'finance') continue;
      for (const kind of Object.values(AUDIT_FIELDS[type])) {
        expect(['money', 'minutes']).not.toContain(kind);
      }
    }
  });

  it("isAuditAction('task', 'granted') is false", () => {
    expect(isAuditAction('task', 'granted')).toBe(false);
    expect(isAuditAction('task', 'moved')).toBe(true);
  });
});

describe('AuditActorFilterSchema', () => {
  it('parses user:, token:, kind: and refuses kind:other and user:', () => {
    expect(AuditActorFilterSchema.parse('user:u1')).toEqual({ kind: 'user', id: 'u1' });
    expect(AuditActorFilterSchema.parse('token:t1')).toEqual({ kind: 'token', id: 't1' });
    expect(AuditActorFilterSchema.parse('kind:egrant')).toEqual({ kind: 'egrant' });
    expect(AuditActorFilterSchema.parse('kind:system')).toEqual({ kind: 'system' });
    expect(AuditActorFilterSchema.parse('kind:mcp')).toEqual({ kind: 'mcp' });
    expect(AuditActorFilterSchema.safeParse('kind:other').success).toBe(false);
    expect(AuditActorFilterSchema.safeParse('user:').success).toBe(false);
    expect(AuditActorFilterSchema.safeParse('nobody').success).toBe(false);
  });
});

describe('AuditQuerySchema', () => {
  it('refuses entityId without entityType', () => {
    expect(AuditQuerySchema.safeParse({ entityId: 'x' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ entityType: 'task', entityId: 'x' }).success).toBe(true);
  });

  it('refuses from after to', () => {
    expect(AuditQuerySchema.safeParse({ from: '2026-10-20', to: '2026-10-19' }).success).toBe(
      false,
    );
    expect(AuditQuerySchema.safeParse({ from: '2026-10-19', to: '2026-10-19' }).success).toBe(true);
  });

  it('refuses a range over 1096 days', () => {
    expect(AuditQuerySchema.safeParse({ from: '2020-01-01', to: '2026-01-01' }).success).toBe(
      false,
    );
    expect(AuditQuerySchema.safeParse({ from: '2024-01-01', to: '2026-01-01' }).success).toBe(true);
  });

  it('defaults limit to 50 and caps at 100', () => {
    expect(AuditQuerySchema.parse({}).limit).toBe(50);
    expect(AuditQuerySchema.parse({ limit: '20' }).limit).toBe(20);
    expect(AuditQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('refuses a malformed date', () => {
    expect(AuditQuerySchema.safeParse({ from: '19.10.2026' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ to: '2026-02-30' }).success).toBe(false);
  });

  it('refuses an unknown entity type and parses the actor', () => {
    expect(AuditQuerySchema.safeParse({ entityType: 'nope' }).success).toBe(false);
    expect(AuditQuerySchema.parse({ actor: 'token:t' }).actor).toEqual({ kind: 'token', id: 't' });
  });
});
