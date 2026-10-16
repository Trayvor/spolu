import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BottomSheet } from './bottom-sheet';

function renderSheet() {
  const onClose = vi.fn();
  render(
    <BottomSheet label="Menu" onClose={onClose}>
      <a href="/tasks">Tasks</a>
      <button type="button">Stay</button>
    </BottomSheet>,
  );
  return { onClose, sheet: screen.getByRole('dialog', { name: 'Menu' }) };
}

describe('BottomSheet', () => {
  it('opens as a named dialog and locks the page scroll', () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toHaveAttribute('open');
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('closes after its slide-out on a link tap, the backdrop or Escape, once', async () => {
    for (const act of ['link', 'backdrop', 'escape'] as const) {
      const { onClose, sheet } = renderSheet();
      if (act === 'link') fireEvent.click(screen.getByRole('link', { name: 'Tasks' }));
      if (act === 'backdrop') fireEvent.click(sheet);
      if (act === 'escape') fireEvent(sheet, new Event('cancel', { cancelable: true }));
      expect(sheet).toHaveAttribute('data-closing');
      fireEvent.animationEnd(sheet);
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 250)); // the fallback timer adds nothing
      expect(onClose).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it('a tap on other content keeps it open', () => {
    const { onClose, sheet } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(sheet).not.toHaveAttribute('data-closing');
    expect(onClose).not.toHaveBeenCalled();
  });
});
