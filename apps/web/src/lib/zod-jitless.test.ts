import { describe, expect, it } from 'vitest';
import './zod-jitless';
import { z } from 'zod';

describe('zod-jitless', () => {
  it('turns zod JIT off (no new Function under the CSP) and schemas still parse', () => {
    expect(z.config().jitless).toBe(true);
    const schema = z.object({ id: z.string(), n: z.number() });
    expect(schema.parse({ id: 'a', n: 1, extra: true })).toEqual({ id: 'a', n: 1 });
  });
});
