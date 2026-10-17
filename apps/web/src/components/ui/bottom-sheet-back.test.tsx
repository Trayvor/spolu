import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { BottomSheet } from './bottom-sheet';

function Page() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Menu
      </button>
      {open && (
        <BottomSheet label="Menu" onClose={() => setOpen(false)}>
          <button type="button">Stay</button>
        </BottomSheet>
      )}
    </div>
  );
}

const index = () => (window.history.state as { __TSR_index: number }).__TSR_index;

// jsdom's own history: a step back lands later (a `popstate`), as in a browser.
async function setup() {
  window.history.replaceState(null, '', '/settings');
  const router = createRouter({
    routeTree: createRootRoute({ component: Page }),
    history: createBrowserHistory(),
  });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return router;
}

describe('BottomSheet and Back', () => {
  // The section menu's e2e flake: Back closed the sheet, but while it slid out it was still
  // active and pushed a new entry, so the next open left an extra entry behind.
  it('Back closes it for good, and opening it again gives one entry at the same place', async () => {
    await setup();
    const start = index();
    fireEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    await waitFor(() => expect(index()).toBe(start + 1));
    act(() => window.history.back());
    // The slide-out has no `animationend` in jsdom: the 200 ms fallback unmounts it.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(index()).toBe(start);
    expect(window.history.state).not.toHaveProperty('layer');

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await waitFor(() => expect(window.history.state).toHaveProperty('layer'));
    expect(index()).toBe(start + 1);
  });

  it('closed in the app, its entry goes again before the next one is pushed', async () => {
    await setup();
    const start = index();
    fireEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    await waitFor(() => expect(index()).toBe(start + 1));
    fireEvent(
      screen.getByRole('dialog', { name: 'Menu' }),
      new Event('cancel', { cancelable: true }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await waitFor(() => expect(window.history.state).toHaveProperty('layer'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(index()).toBe(start + 1);
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
  });
});
