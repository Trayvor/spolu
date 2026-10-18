import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ActionSheet, ActionSheetItem } from './action-sheet';

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <ActionSheet
        open={open}
        label="Actions"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        <ActionSheetItem icon={null} label="One" onSelect={() => undefined} />
        <ActionSheetItem icon={null} label="Two" onSelect={() => undefined} />
      </ActionSheet>
    </>
  );
}

describe('ActionSheet', () => {
  it('is a modal dialog with the focus on its first action', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Opener' }));
    expect(screen.getByRole('dialog', { name: 'Actions' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'One' })).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside the sheet', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Opener' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'One' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus();
  });

  it('Escape closes it and the focus returns to the opener', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
