import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { SheetDialog, SheetDialogTitle } from './sheet-dialog';

function Harness({ onEscape }: { onEscape: (event: KeyboardEvent) => void }) {
  const focus = useRef<HTMLButtonElement>(null);
  return (
    <SheetDialog onEscape={onEscape} initialFocus={focus} testId="sheet">
      <SheetDialogTitle>Sheet title</SheetDialogTitle>
      <button type="button">First</button>
      <button ref={focus} type="button">
        Second
      </button>
    </SheetDialog>
  );
}

describe('SheetDialog', () => {
  it('Escape calls onEscape', async () => {
    const onEscape = vi.fn();
    const user = userEvent.setup();
    render(<Harness onEscape={onEscape} />);
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
    // The sheet stays open: closing is the caller's decision.
    expect(screen.getByRole('dialog', { name: 'Sheet title' })).toBeInTheDocument();
  });

  it('a click on the backdrop does nothing, unless onOutside is given', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness onEscape={() => undefined} />);
    await user.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    unmount();

    const onOutside = vi.fn();
    render(
      <SheetDialog onEscape={() => undefined} onOutside={onOutside} testId="sheet">
        <SheetDialogTitle>Sheet title</SheetDialogTitle>
      </SheetDialog>,
    );
    await user.click(screen.getByTestId('sheet-backdrop'));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it('initialFocus receives the focus on open', () => {
    render(<Harness onEscape={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Second' })).toHaveFocus();
  });

  it('content has the phone 44 px target classes', () => {
    render(<Harness onEscape={() => undefined} />);
    const content = screen.getByTestId('sheet');
    expect(content).toBe(screen.getByRole('dialog'));
    expect(content.className).toContain(
      'touch:[&_:is(button,a,select,input:not([type=checkbox],[type=radio])):not([data-hit])]:min-h-11',
    );
    expect(content.className).toContain('touch:[&_:is(button,a,select):not([data-hit])]:min-w-11');
    // Full screen below 641 px, a centred 720 px dialog from 641 px.
    expect(content).toHaveClass('fixed', 'inset-0', 'min-[641px]:w-[720px]');
  });
});
