import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import { INTERNAL_CALL_HEADER, internalCallUser, runAsUser } from './internal-calls.js';

const ada: SessionUser = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada',
  role: 'admin',
  finance: false,
};

describe('internal calls', () => {
  it('resolves the call id only while the call runs', async () => {
    let seen: SessionUser | null = null;
    let id = '';
    await runAsUser(ada, async (headers) => {
      id = headers[INTERNAL_CALL_HEADER]!;
      seen = internalCallUser({ [INTERNAL_CALL_HEADER]: id });
    });
    expect(seen).toEqual(ada);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(internalCallUser({ [INTERNAL_CALL_HEADER]: id })).toBeNull();
  });

  it('forgets the id when the call throws', async () => {
    let id = '';
    await expect(
      runAsUser(ada, async (headers) => {
        id = headers[INTERNAL_CALL_HEADER]!;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(internalCallUser({ [INTERNAL_CALL_HEADER]: id })).toBeNull();
  });

  it.each([
    ['no header', {}],
    ['an unknown id', { [INTERNAL_CALL_HEADER]: 'x'.repeat(43) }],
    ['a repeated header', { [INTERNAL_CALL_HEADER]: ['a', 'b'] }],
  ])('%s is no user', (_name, headers) => {
    expect(internalCallUser(headers)).toBeNull();
  });
});
