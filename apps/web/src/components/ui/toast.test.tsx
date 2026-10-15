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
    expect(screen.getByRole('status')).toHaveTextContent('3 tasks created');
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
});
