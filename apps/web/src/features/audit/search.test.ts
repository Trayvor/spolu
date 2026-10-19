import { describe, expect, it } from 'vitest';
import { validateAuditSearch } from './search';

describe('validateAuditSearch', () => {
  it('keeps valid params and drops unknown ones', () => {
    expect(
      validateAuditSearch({
        entityType: 'task',
        entityId: 't1',
        group: 'g1',
        actor: 'user:u1',
        from: '2026-10-01',
        to: '2026-10-19',
        other: 'x',
      }),
    ).toEqual({
      entityType: 'task',
      entityId: 't1',
      group: 'g1',
      actor: 'user:u1',
      from: '2026-10-01',
      to: '2026-10-19',
      label: undefined,
    });
  });

  it('drops entityId without entityType, a bad actor and a bad date', () => {
    expect(
      validateAuditSearch({ entityId: 't1', actor: 'kind:nobody', from: '19.10.2026' }),
    ).toEqual({
      entityType: undefined,
      entityId: undefined,
      group: undefined,
      actor: undefined,
      from: undefined,
      to: undefined,
      label: undefined,
    });
  });
});
