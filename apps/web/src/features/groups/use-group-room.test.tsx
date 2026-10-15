import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { GroupRoomProvider, useGroupRoom, useGroupRoomJoins } from './use-group-room';

type Ack = (r: { ok: boolean }) => void;
const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const s = {
    connected: true,
    ackWith: { ok: true } as { ok: boolean },
    deferAck: false,
    pendingAcks: [] as (() => void)[],
    emit: vi.fn((_e: string, _p: unknown, ack?: Ack) => {
      if (!ack) return;
      if (s.deferAck) s.pendingAcks.push(() => ack(s.ackWith));
      else ack(s.ackWith);
    }),
    on: vi.fn((e: string, fn: () => void) => {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e)!.add(fn);
    }),
    off: vi.fn((e: string, fn: () => void) => void listeners.get(e)?.delete(fn)),
    fire(e: string) {
      listeners.get(e)?.forEach((fn) => fn());
    },
    reset() {
      listeners.clear();
      s.connected = true;
      s.ackWith = { ok: true };
      s.deferAck = false;
      s.pendingAcks = [];
    },
  };
  return s;
});

vi.mock('@/lib/socket', () => ({ getSocket: () => fake }));

beforeEach(() => {
  fake.reset();
  fake.emit.mockClear();
});

const joinCalls = () => fake.emit.mock.calls.filter((c) => c[0] === 'group:join');
const leaveCalls = () => fake.emit.mock.calls.filter((c) => c[0] === 'group:leave');

describe('useGroupRoom', () => {
  it('joins on mount when connected', () => {
    const { result } = renderHook(() => useGroupRoom('g1'));
    expect(joinCalls()).toHaveLength(1);
    expect(joinCalls()[0]![1]).toEqual({ groupId: 'g1' });
    expect(result.current).toBe(1);
  });

  it('joins again on every connect event and counts each acknowledged join', () => {
    const { result } = renderHook(() => useGroupRoom('g1'));
    act(() => fake.fire('connect'));
    expect(joinCalls()).toHaveLength(2);
    expect(result.current).toBe(2);
    act(() => fake.fire('connect'));
    expect(result.current).toBe(3);
  });

  it('leaves on unmount', () => {
    const { unmount } = renderHook(() => useGroupRoom('g1'));
    unmount();
    expect(leaveCalls()).toEqual([['group:leave', { groupId: 'g1' }]]);
    const registered = fake.on.mock.calls.find((c) => c[0] === 'connect')![1];
    expect(fake.off).toHaveBeenCalledWith('connect', registered);
  });

  it('an ack arriving after unmount does not change the counter', () => {
    fake.deferAck = true;
    const { result, unmount } = renderHook(() => useGroupRoom('g1'));
    expect(result.current).toBe(0);
    unmount();
    act(() => fake.pendingAcks.forEach((ack) => ack()));
    expect(result.current).toBe(0);
  });

  it('an ack of the old group arriving after a group change is ignored', () => {
    fake.deferAck = true;
    const { result, rerender } = renderHook(({ id }) => useGroupRoom(id), {
      initialProps: { id: 'g1' },
    });
    rerender({ id: 'g2' });
    const [oldAck, newAck] = fake.pendingAcks;
    act(() => oldAck!());
    expect(result.current).toBe(0);
    act(() => newAck!());
    expect(result.current).toBe(1);
  });

  it('switching groupId leaves the old room and joins the new one', () => {
    const { result, rerender } = renderHook(({ id }) => useGroupRoom(id), {
      initialProps: { id: 'g1' },
    });
    rerender({ id: 'g2' });
    expect(leaveCalls()[0]![1]).toEqual({ groupId: 'g1' });
    expect(joinCalls()[1]![1]).toEqual({ groupId: 'g2' });
    expect(result.current).toBe(1);
  });

  it('does not emit while disconnected and joins on connect', () => {
    fake.connected = false;
    const { result, unmount } = renderHook(() => useGroupRoom('g1'));
    expect(fake.emit).not.toHaveBeenCalled();
    expect(result.current).toBe(0);
    fake.connected = true;
    act(() => fake.fire('connect'));
    expect(joinCalls()).toHaveLength(1);
    expect(result.current).toBe(1);
    fake.connected = false;
    unmount();
    expect(leaveCalls()).toHaveLength(0);
  });

  it('a not_found ack leaves the counter at 0 and is retried only on the next connect', () => {
    fake.ackWith = { ok: false };
    const { result } = renderHook(() => useGroupRoom('g1'));
    expect(result.current).toBe(0);
    expect(joinCalls()).toHaveLength(1);
    fake.ackWith = { ok: true };
    act(() => fake.fire('connect'));
    expect(joinCalls()).toHaveLength(2);
    expect(result.current).toBe(1);
  });
});

describe('useGroupRoomJoins', () => {
  it('is 0 outside a provider', () => {
    const { result } = renderHook(() => useGroupRoomJoins());
    expect(result.current).toBe(0);
  });

  it('follows the counter of the room: 0, then 1 after the first ack, +1 per rejoin', () => {
    fake.connected = false;
    const wrapper = ({ children }: { children: ReactNode }) => <Wrap>{children}</Wrap>;
    function Wrap({ children }: { children: ReactNode }) {
      const joins = useGroupRoom('g1');
      return <GroupRoomProvider joins={joins}>{children}</GroupRoomProvider>;
    }
    const { result } = renderHook(() => useGroupRoomJoins(), { wrapper });
    expect(result.current).toBe(0);
    fake.connected = true;
    act(() => fake.fire('connect'));
    expect(result.current).toBe(1);
    act(() => fake.fire('connect'));
    expect(result.current).toBe(2);
  });
});
