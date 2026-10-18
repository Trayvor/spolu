import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { i18n } from '@/i18n';
import { Toast } from './toast';

describe('Toast', () => {
  afterEach(() => vi.useRealTimers());

  it('shows its content as a status and closes after 6 s', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast onClose={onClose}>3 tasks created</Toast>);
    // The live region is mounted empty and filled on the next tick, so it is announced.
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(0));
    expect(status).toHaveTextContent('3 tasks created');
    act(() => vi.advanceTimersByTime(5999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on its close button', () => {
    const onClose = vi.fn();
    render(<Toast onClose={onClose}>Done</Toast>);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('toast.close') }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders straight into the body, above any positioned column of the page', () => {
    const { container } = render(
      <div style={{ position: 'sticky' }}>
        <Toast onClose={() => {}}>Done</Toast>
      </div>,
    );
    const layer = screen.getByRole('status').closest('.fixed');
    expect(container.contains(layer)).toBe(false);
    expect(layer?.parentElement).toBe(document.body);
  });

  it('shows one toast at a time: the next waits until the first closes', () => {
    vi.useFakeTimers();
    render(
      <>
        <Toast onClose={() => {}}>First</Toast>
        <Toast onClose={() => {}}>Second</Toast>
      </>,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('First');
  });

  it('shows the queued toast, with its full time, once the first unmounts', () => {
    vi.useFakeTimers();
    const second = vi.fn();
    const { rerender } = render(
      <>
        <Toast key="a" onClose={() => {}}>
          First
        </Toast>
        <Toast key="b" onClose={second}>
          Second
        </Toast>
      </>,
    );
    act(() => vi.advanceTimersByTime(5000));
    rerender(
      <>
        <Toast key="b" onClose={second}>
          Second
        </Toast>
      </>,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole('status')).toHaveTextContent('Second');
    act(() => vi.advanceTimersByTime(5999));
    expect(second).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('pauses while hovered or focused and resumes with the time left', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast onClose={onClose}>Done</Toast>);
    const bar = screen.getByRole('status').parentElement!;
    act(() => vi.advanceTimersByTime(4000));
    fireEvent.pointerEnter(bar, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(10_000));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerLeave(bar, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(1999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.focus(screen.getByRole('button', { name: i18n.t('toast.close') }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a tap does not pause it: hover from touch or pen is ignored', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast onClose={onClose}>Done</Toast>);
    const bar = screen.getByRole('status').parentElement!;
    // A tap fires pointerenter (touch) and an emulated mouseenter, but no leave until a tap elsewhere.
    fireEvent.pointerEnter(bar, { pointerType: 'touch' });
    fireEvent.mouseEnter(bar);
    fireEvent.pointerEnter(bar, { pointerType: 'pen' });
    act(() => vi.advanceTimersByTime(6000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('runs its action, then closes', () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    render(
      <Toast onClose={onClose} action={{ label: 'Undo', onAction }}>
        Removed
      </Toast>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes after a custom duration', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <Toast onClose={onClose} duration={5000}>
        Removed
      </Toast>,
    );
    act(() => vi.advanceTimersByTime(4999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
