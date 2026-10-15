import { describe, expect, it } from 'vitest';
import { AddAdminBodySchema, AdminListSchema, RoleSchema } from './users.js';

describe('AddAdminBodySchema', () => {
  it('trims and lower-cases the email and trims the name', () => {
    expect(AddAdminBodySchema.parse({ email: '  Jane@Example.COM ', name: ' Jane ' })).toEqual({
      email: 'jane@example.com',
      name: 'Jane',
    });
  });

  it('rejects an empty name and a bad email', () => {
    expect(AddAdminBodySchema.safeParse({ email: 'a@example.com', name: '   ' }).success).toBe(
      false,
    );
    expect(AddAdminBodySchema.safeParse({ email: 'nope', name: 'Jane' }).success).toBe(false);
  });

  it('rejects a name longer than 100 characters', () => {
    expect(
      AddAdminBodySchema.safeParse({ email: 'a@example.com', name: 'x'.repeat(101) }).success,
    ).toBe(false);
  });
});

describe('role schemas', () => {
  it('accepts only the three roles', () => {
    expect(RoleSchema.safeParse('admin').success).toBe(true);
    expect(RoleSchema.safeParse('root').success).toBe(false);
  });

  it('does not allow the client role in an admin list', () => {
    expect(
      AdminListSchema.safeParse([{ id: '1', name: 'A', email: 'a@example.com', role: 'client' }])
        .success,
    ).toBe(false);
  });
});
