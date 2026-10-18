import { describe, expect, it } from 'vitest';
import { MeSchema } from '@spolu/shared';
import { meGuard, parseMe } from './me-guard';

const group = {
  id: 'g1',
  name: 'Obec',
  role: 'client',
  hasLogo: false,
  updatedAt: '2026-10-18T00:00:00.000Z',
};
const me = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Anna',
  role: 'client',
  finance: false,
  groups: [group],
};

const invalid: unknown[] = [
  null,
  'me',
  [],
  { ...me, id: 1 },
  { ...me, role: 'owner' },
  { ...me, finance: 'no' },
  { ...me, groups: undefined },
  { ...me, groups: [{ ...group, role: 'admin' }] },
  { ...me, groups: [{ ...group, hasLogo: 'yes' }] },
  { ...me, groups: [null] },
];

describe('meGuard', () => {
  it('keeps the phone navigation like MeSchema and ignores an unknown value', () => {
    const bottom = { ...me, phoneNav: 'bottom' };
    expect(parseMe(bottom)).toEqual(MeSchema.parse(bottom));
    expect(parseMe({ ...me, phoneNav: 'tabs' })?.phoneNav).toBeUndefined();
  });

  it('accepts what MeSchema accepts and drops unknown keys the same way', () => {
    const body = { ...me, extra: 1, groups: [{ ...group, extra: 2 }] };
    expect(parseMe(body)).toEqual(MeSchema.parse(body));
    expect(meGuard.safeParse(body)).toEqual({ success: true, data: MeSchema.parse(body) });
  });

  it('accepts an admin without groups', () => {
    const admin = { ...me, role: 'superadmin', finance: true, groups: [] };
    expect(parseMe(admin)).toEqual(MeSchema.parse(admin));
  });

  it.each(invalid)('rejects what MeSchema rejects: %j', (body) => {
    expect(MeSchema.safeParse(body).success).toBe(false);
    expect(meGuard.safeParse(body)).toEqual({ success: false });
  });
});
