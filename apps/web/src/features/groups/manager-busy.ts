/**
 * Groups whose manager toggle has a burst of clicks in flight (from the first click to the last
 * answer). `useManagerEvents` leaves those groups' cached `managers` and the modes alone, so an
 * event about an earlier click cannot flip the toggle; the toggle reconciles with the last
 * answer. Its own tiny module so the authed layout does not pull in the toggle.
 */
export const busyGroups = new Set<string>();
