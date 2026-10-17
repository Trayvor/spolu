import { describe, expect, it } from 'vitest';
import { firstJoinCheck, trackSocket } from './socket-history';

function fakeSocket(connected: boolean) {
  const listeners = new Map<string, (() => void)[]>();
  return {
    connected,
    on(event: string, fn: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    fire(event: string) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
  };
}

const fetching = { fetchStatus: 'fetching' as const, dataUpdatedAt: 0 };
const loadedAt = (at: number) => ({ fetchStatus: 'idle' as const, dataUpdatedAt: at });

describe('firstJoinCheck', () => {
  it('trusts a fetch since the mount while the app makes its first connection', () => {
    const socket = fakeSocket(false);
    trackSocket(socket);
    const stale = firstJoinCheck(socket, 1000);
    socket.connected = true;
    socket.fire('connect');
    expect(stale(fetching)).toBe(false);
    expect(stale(loadedAt(1000))).toBe(false);
    expect(stale(loadedAt(1500))).toBe(false);
  });

  it('refetches data cached before the mount', () => {
    const socket = fakeSocket(true);
    trackSocket(socket);
    socket.fire('connect');
    const stale = firstJoinCheck(socket, 1000);
    expect(stale(loadedAt(999))).toBe(true);
    expect(stale(loadedAt(1000))).toBe(false);
  });

  it('refetches everything when the screen mounted while the socket was down', () => {
    const socket = fakeSocket(true);
    trackSocket(socket);
    socket.fire('connect');
    socket.connected = false;
    socket.fire('disconnect');
    const stale = firstJoinCheck(socket, 1000);
    socket.connected = true;
    socket.fire('connect');
    expect(stale(fetching)).toBe(true);
    expect(stale(loadedAt(2000))).toBe(true);
  });

  it('refetches everything when the socket dropped after the mount', () => {
    const socket = fakeSocket(true);
    trackSocket(socket);
    socket.fire('connect');
    const stale = firstJoinCheck(socket, 1000);
    socket.fire('disconnect');
    socket.fire('connect');
    expect(stale(loadedAt(2000))).toBe(true);
  });

  it('tracks a socket once', () => {
    const socket = fakeSocket(true);
    trackSocket(socket);
    trackSocket(socket);
    socket.fire('connect');
    socket.fire('disconnect');
    socket.fire('connect');
    const stale = firstJoinCheck(socket, 1000);
    expect(stale(loadedAt(1000))).toBe(false);
  });

  it('an untracked socket counts as one that never connected', () => {
    const stale = firstJoinCheck(fakeSocket(false), 1000);
    expect(stale(fetching)).toBe(false);
    expect(stale(loadedAt(500))).toBe(true);
  });
});
