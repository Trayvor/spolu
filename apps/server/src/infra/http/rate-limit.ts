/**
 * `allow(key)` counts a call; `allow.exceeded(key)` says, without counting, whether the next call
 * would be refused.
 */
export type FixedRateLimiter = ((key: string) => boolean) & { exceeded(key: string): boolean };

/**
 * In-memory fixed-window rate limiter: `allow(key)` is true for the first `max` calls per key
 * in each window. State lives in one process (ADR 0005); expired keys are dropped from the front on access.
 */
export function createRateLimiter(options: { windowMs: number; max: number }): FixedRateLimiter {
  const { windowMs, max } = options;
  const windows = new Map<string, { resetAt: number; count: number }>();

  const sweep = (now: number) => {
    // Every window has the same length and is inserted when it starts, so the Map is ordered
    // by resetAt: sweep from the front and stop at the first live window.
    for (const [k, w] of windows) {
      if (w.resetAt > now) break;
      windows.delete(k);
    }
  };

  const allow = (key: string) => {
    const now = Date.now();
    sweep(now);
    const current = windows.get(key);
    if (!current) {
      windows.set(key, { resetAt: now + windowMs, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= max;
  };
  const exceeded = (key: string) => {
    sweep(Date.now());
    return (windows.get(key)?.count ?? 0) >= max;
  };
  return Object.assign(allow, { exceeded });
}

/**
 * In-memory rolling-window rate limiter: `allow(key)` is true while the key has fewer than `max`
 * allowed calls in the last `windowMs`. Refused calls are not recorded. Keeps one timestamp per
 * allowed call, so use it for small `max`; idle keys are swept once per window. In one process
 * (ADR 0005); a restart forgets every count.
 */
export function createSlidingRateLimiter(options: {
  windowMs: number;
  max: number;
}): (key: string) => boolean {
  const { windowMs, max } = options;
  const hits = new Map<string, number[]>();
  let nextSweep = 0;

  return (key) => {
    const now = Date.now();
    const since = now - windowMs;
    if (now >= nextSweep) {
      for (const [k, times] of hits) if (times[times.length - 1]! <= since) hits.delete(k);
      nextSweep = now + windowMs;
    }
    const times = (hits.get(key) ?? []).filter((t) => t > since);
    const allowed = times.length < max;
    if (allowed) times.push(now);
    if (times.length > 0) hits.set(key, times);
    else hits.delete(key);
    return allowed;
  };
}
