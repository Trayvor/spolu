import { describe, expect, it } from 'vitest';
import { McpTokenCreateBodySchema } from './mcp.js';

describe('McpTokenCreateBodySchema', () => {
  it('takes a name, a scope and one of the offered expiries', () => {
    expect(
      McpTokenCreateBodySchema.parse({ name: ' Claude ', scope: 'read', expiresInDays: 90 }),
    ).toEqual({ name: 'Claude', scope: 'read', expiresInDays: 90 });
  });

  it.each([
    [{ name: '', scope: 'read', expiresInDays: 90 }],
    [{ name: 'x'.repeat(61), scope: 'read', expiresInDays: 90 }],
    [{ name: 'a', scope: 'admin', expiresInDays: 90 }],
    [{ name: 'a', scope: 'write', expiresInDays: 0 }],
    [{ name: 'a', scope: 'write', expiresInDays: 3650 }],
    [{ name: 'a', scope: 'write', expiresInDays: 90, extra: 1 }],
  ])('refuses %j', (body) => {
    expect(McpTokenCreateBodySchema.safeParse(body).success).toBe(false);
  });
});
