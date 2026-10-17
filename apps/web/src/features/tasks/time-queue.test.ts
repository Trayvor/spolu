import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { askForTime, clearTimeAsks, finishTimeAsk, useTimeAsk } from './time-queue';

const task = (id: string) => ({ kind: 'task', id, groupId: 'g1', title: id }) as const;

describe('the time dialog queue', () => {
  afterEach(() => clearTimeAsks());

  it('opens one dialog at a time, in order, and skips what is already queued', () => {
    const { result } = renderHook(() => useTimeAsk());
    expect(result.current).toBeUndefined();
    act(() => {
      askForTime(task('a'));
      askForTime(task('b'));
      askForTime(task('a'));
    });
    expect(result.current?.id).toBe('a');
    act(() => finishTimeAsk());
    expect(result.current?.id).toBe('b');
    act(() => finishTimeAsk());
    expect(result.current).toBeUndefined();
  });

  it('a task and a ticket with the same id are different asks', () => {
    const { result } = renderHook(() => useTimeAsk());
    act(() => {
      askForTime(task('x'));
      askForTime({ kind: 'ticket', id: 'x', groupId: 'g1', title: '#3 T' });
      finishTimeAsk();
    });
    expect(result.current?.kind).toBe('ticket');
  });
});
