/**
 * The ratings view's filters in the URL (2026-10-19), read by the lazy page itself (the route
 * has no `validateSearch`, so the entry chunk does not grow). `days` is absent for 30;
 * `groupId` one client; `value` `up` or `down`.
 */
export type RatingsSearch = {
  days?: 90 | 365;
  groupId?: string;
  value?: 'up' | 'down';
};

/** Every key is set (an invalid one to undefined), so a raw value never slips through. */
export function validateRatingsSearch(search: Record<string, unknown>): RatingsSearch {
  const days = Number(search.days);
  const groupId = typeof search.groupId === 'string' ? search.groupId.trim() : '';
  return {
    days: days === 90 || days === 365 ? days : undefined,
    groupId: groupId ? groupId.slice(0, 100) : undefined,
    value: search.value === 'up' || search.value === 'down' ? search.value : undefined,
  };
}
