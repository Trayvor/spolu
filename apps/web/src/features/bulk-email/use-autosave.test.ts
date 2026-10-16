import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { useAutosave } from './use-autosave';

type Draft = { text: string };
type Props = { draft: Draft };

function setup(save: (draft: Draft, version: number) => Promise<{ version: number }>) {
  const isValid = (d: Draft) => d.text !== 'bad';
  return renderHook(
    ({ draft }: Props) => useAutosave({ draft, version: 3, save, isValid, delay: 1000 }),
    { initialProps: { draft: { text: 'a' } } },
  );
}

/** Lets the save promise settle inside act. */
const settle = () => act(async () => {});

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not save an unchanged draft', async () => {
    const save = vi.fn();
    const { result } = setup(save);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.state).toBe('saved');
  });

  it('PUTs once 1 s after the last change, with the version read last', async () => {
    const save = vi.fn(async () => ({ version: 4 }));
    const { result, rerender } = setup(save);
    rerender({ draft: { text: 'ab' } });
    expect(result.current.state).toBe('pending');
    await act(async () => vi.advanceTimersByTime(500));
    rerender({ draft: { text: 'abc' } });
    await act(async () => vi.advanceTimersByTime(999));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ text: 'abc' }, 3);
    expect(result.current.state).toBe('saved');
    expect(result.current.version).toBe(4);

    rerender({ draft: { text: 'abcd' } });
    await act(async () => vi.advanceTimersByTime(1000));
    await settle();
    expect(save).toHaveBeenLastCalledWith({ text: 'abcd' }, 4);
  });

  it('saves again after a save when the draft changed meanwhile', async () => {
    let finish: (v: { version: number }) => void = () => undefined;
    const save = vi
      .fn<(d: Draft, v: number) => Promise<{ version: number }>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue({ version: 5 });
    const { result, rerender } = setup(save);
    rerender({ draft: { text: 'b' } });
    await act(async () => vi.advanceTimersByTime(1000));
    expect(result.current.state).toBe('saving');
    rerender({ draft: { text: 'bc' } });
    await act(async () => vi.advanceTimersByTime(1000));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish({ version: 4 }));
    await act(async () => vi.advanceTimersByTime(1000));
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ text: 'bc' }, 4);
    expect(result.current.state).toBe('saved');
  });

  it('does not save an invalid draft', async () => {
    const save = vi.fn();
    const { result, rerender } = setup(save);
    rerender({ draft: { text: 'bad' } });
    await act(async () => vi.advanceTimersByTime(2000));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.state).toBe('invalid');
  });

  it('stops on 409 changed and never overwrites the other edit', async () => {
    const save = vi.fn(async () => {
      throw new ApiError('conflict', 409, { error: 'changed' });
    });
    const { result, rerender } = setup(save);
    rerender({ draft: { text: 'b' } });
    await act(async () => vi.advanceTimersByTime(1000));
    await settle();
    expect(result.current.state).toBe('changed');
    rerender({ draft: { text: 'bc' } });
    await act(async () => vi.advanceTimersByTime(3000));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('changed');
  });

  it('stops on 409 not_draft', async () => {
    const save = vi.fn(async () => {
      throw new ApiError('conflict', 409, { error: 'not_draft' });
    });
    const { result, rerender } = setup(save);
    rerender({ draft: { text: 'b' } });
    await act(async () => vi.advanceTimersByTime(1000));
    await settle();
    expect(result.current.state).toBe('notDraft');
  });

  it('shows an error on another failure and saves again on retry', async () => {
    const save = vi
      .fn<(d: Draft, v: number) => Promise<{ version: number }>>()
      .mockRejectedValueOnce(new ApiError('down', 500, {}))
      .mockResolvedValue({ version: 4 });
    const { result, rerender } = setup(save);
    rerender({ draft: { text: 'b' } });
    await act(async () => vi.advanceTimersByTime(1000));
    await settle();
    expect(result.current.state).toBe('error');
    await act(async () => result.current.retry());
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('saved');
  });

  it('saves a pending change at once when the editor closes', async () => {
    const save = vi.fn(async () => ({ version: 4 }));
    const { rerender, unmount } = setup(save);
    rerender({ draft: { text: 'b' } });
    unmount();
    expect(save).toHaveBeenCalledWith({ text: 'b' }, 3);
  });

  it('flush saves a pending change at once and resolves true when saved', async () => {
    const save = vi.fn(async () => ({ version: 4 }));
    const { result, rerender } = setup(save);
    rerender({ draft: { text: 'ab' } });
    let flushed: Promise<boolean> = Promise.resolve(false);
    act(() => {
      flushed = result.current.flush();
    });
    await settle();
    await expect(flushed).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ text: 'ab' }, 3);
    expect(result.current.state).toBe('saved');
  });

  it('flush with nothing to save resolves true without a PUT', async () => {
    const save = vi.fn();
    const { result } = setup(save);
    await expect(result.current.flush()).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('flush waits for a running save, then saves the newer change', async () => {
    let finish: (v: { version: number }) => void = () => undefined;
    const save = vi
      .fn<(d: Draft, v: number) => Promise<{ version: number }>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue({ version: 5 });
    const { result, rerender } = setup(save);
    rerender({ draft: { text: 'ab' } });
    await act(async () => vi.advanceTimersByTime(1000));
    rerender({ draft: { text: 'abc' } });
    let flushed: Promise<boolean> = Promise.resolve(false);
    act(() => {
      flushed = result.current.flush();
    });
    await act(async () => finish({ version: 4 }));
    await settle();
    await expect(flushed).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ text: 'abc' }, 4);
  });

  it('flush resolves false for an invalid draft or a failed save', async () => {
    const save = vi.fn(async () => {
      throw new ApiError('down', 500, {});
    });
    const { result, rerender } = setup(save);
    rerender({ draft: { text: 'bad' } });
    await expect(result.current.flush()).resolves.toBe(false);
    rerender({ draft: { text: 'good' } });
    let flushed: Promise<boolean> = Promise.resolve(true);
    act(() => {
      flushed = result.current.flush();
    });
    await settle();
    await expect(flushed).resolves.toBe(false);
    expect(result.current.state).toBe('error');
  });
});
