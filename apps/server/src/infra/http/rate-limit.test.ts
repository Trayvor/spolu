import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from './rate-limit.js';

describe('createRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('allows 10 then blocks within the window and resets after it', () => {
    const allow = createRateLimiter({ windowMs: 60_000, max: 10 });
    for (let i = 0; i < 10; i++) expect(allow('1.1.1.1')).toBe(true);
    expect(allow('1.1.1.1')).toBe(false);
    expect(allow('2.2.2.2')).toBe(true); // keys are independent
    vi.advanceTimersByTime(60_001);
    expect(allow('1.1.1.1')).toBe(true);
  });
});
