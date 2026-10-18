import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter, createSlidingRateLimiter } from './rate-limit.js';

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

  it('drops expired keys so the map does not grow', () => {
    const allow = createRateLimiter({ windowMs: 1000, max: 1 });
    allow('a');
    vi.advanceTimersByTime(500);
    allow('b');
    vi.advanceTimersByTime(600); // a expired, b still live
    expect(allow('b')).toBe(false);
    expect(allow('a')).toBe(true); // fresh window for a
    vi.advanceTimersByTime(1001);
    expect(allow('b')).toBe(true);
  });

  it('exceeded() tells whether the next call is refused, without counting', () => {
    const allow = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(allow.exceeded('a')).toBe(false);
    allow('a');
    expect(allow.exceeded('a')).toBe(false);
    allow('a');
    expect(allow.exceeded('a')).toBe(true);
    expect(allow.exceeded('a')).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(allow.exceeded('a')).toBe(false);
    expect(allow('a')).toBe(true);
  });
});

describe('createSlidingRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts the last window, not a fixed one', () => {
    const allow = createSlidingRateLimiter({ windowMs: 1000, max: 2 });
    expect(allow('a')).toBe(true);
    vi.advanceTimersByTime(600);
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    vi.advanceTimersByTime(401); // the first hit is now older than the window
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    expect(allow('b')).toBe(true); // keys are independent
  });

  it('a refused call does not extend the block', () => {
    const allow = createSlidingRateLimiter({ windowMs: 1000, max: 1 });
    allow('a');
    vi.advanceTimersByTime(900);
    expect(allow('a')).toBe(false);
    vi.advanceTimersByTime(101);
    expect(allow('a')).toBe(true);
  });

  it('drops keys with no hit inside the window', () => {
    const allow = createSlidingRateLimiter({ windowMs: 1000, max: 1 });
    allow('a');
    vi.advanceTimersByTime(1001);
    allow('b'); // sweeps a
    expect(allow('a')).toBe(true);
  });
});
