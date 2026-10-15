/**
 * In-memory fixed-window rate limiter: `allow(key)` is true for the first `max` calls per key
 * in each window. State lives in one process (ADR 0005); expired keys are dropped on access.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
}): (key: string) => boolean {
  const { windowMs, max } = options;
  const windows = new Map<string, { resetAt: number; count: number }>();

  return (key) => {
    const now = Date.now();
    for (const [k, w] of windows) {
      if (w.resetAt <= now) windows.delete(k);
    }
    const current = windows.get(key);
    if (!current) {
      windows.set(key, { resetAt: now + windowMs, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= max;
  };
}
