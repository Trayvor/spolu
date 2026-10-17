/**
 * The connection history of the shared socket, so a screen can tell its first room join (or
 * `connect`) from a real rejoin after the socket was down. Kept apart from `socket.ts`, which
 * tests replace with a fake.
 */

interface Trackable {
  connected: boolean;
  on(event: 'connect' | 'disconnect', listener: () => void): unknown;
}

/** The state a cached query is judged by (a subset of TanStack Query's `QueryState`). */
interface LoadState {
  fetchStatus: 'fetching' | 'paused' | 'idle';
  dataUpdatedAt: number;
}

const history = new WeakMap<object, { connects: number; disconnects: number }>();

/** Counts the socket's connects and disconnects. Call once, before anyone else listens. */
export function trackSocket(socket: Trackable): void {
  if (history.has(socket)) return;
  const counts = { connects: 0, disconnects: 0 };
  history.set(socket, counts);
  socket.on('connect', () => void counts.connects++);
  socket.on('disconnect', () => void counts.disconnects++);
}

/**
 * Taken when a screen mounts (`now` = the mount time). The returned `stale(state)` tells, on the
 * screen's first join or `connect`, whether a cached query must refetch to catch up on events
 * it may have missed. It need not when the socket was up (or making the app's first connection)
 * at the mount, has not dropped since, and the query was fetched, or is being fetched, since the
 * mount: that fetch ran while the socket was joining. Anything else refetches: data cached
 * before the mount, and everything after the socket was down. An untracked socket counts as one
 * that never connected.
 */
export function firstJoinCheck(
  socket: Trackable,
  now: number = Date.now(),
): (state: LoadState) => boolean {
  const atMount = history.get(socket);
  const live = socket.connected || !atMount || atMount.connects === 0;
  const disconnects = atMount?.disconnects ?? 0;
  return (state) => {
    const unbroken = live && (history.get(socket)?.disconnects ?? 0) === disconnects;
    const loadedSinceMount = state.fetchStatus === 'fetching' || state.dataUpdatedAt >= now;
    return !(unbroken && loadedSinceMount);
  };
}
