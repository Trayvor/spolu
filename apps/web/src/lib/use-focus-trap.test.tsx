import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { useFocusTrap } from './use-focus-trap';

/** A trapped panel (like the task panel under 1024 px) that opens a layer in a portal. */
function Panel({ layer }: { layer: 'sheet' | 'dialog' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useFocusTrap(ref, true, false);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Panel">
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Panel end</button>
      {layer === 'sheet' ? (
        <ActionSheet open={open} label="Actions" onClose={() => setOpen(false)}>
          <ActionSheetItem icon={null} label="One" onSelect={() => undefined} />
          <ActionSheetItem icon={null} label="Two" onSelect={() => undefined} />
          <ActionSheetItem icon={null} label="Three" onSelect={() => undefined} />
        </ActionSheet>
      ) : (
        open &&
        // A dialog with its own focus handling and no useFocusTrap, as Radix renders it.
        createPortal(
          <div role="dialog" aria-label="Other">
            <button type="button">One</button>
            <button type="button">Two</button>
          </div>,
          document.body,
        )
      )}
    </div>
  );
}

describe('useFocusTrap', () => {
  it('wraps Tab inside its root and pulls outside focus in', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <Panel layer="sheet" />
      </>,
    );
    screen.getByRole('button', { name: 'Outside' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Panel end' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('leaves Tab to an action sheet opened inside the trapped panel', async () => {
    const user = userEvent.setup();
    render(<Panel layer="sheet" />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'One' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'One' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Three' })).toHaveFocus();
  });

  it('leaves Tab alone while the focus is in another dialog layer', async () => {
    const user = userEvent.setup();
    render(<Panel layer="dialog" />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    screen.getByRole('button', { name: 'One' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus();
  });

  it('works again for the panel once the sheet is closed', async () => {
    const user = userEvent.setup();
    render(<Panel layer="sheet" />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Actions' })).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Panel end' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });
});
