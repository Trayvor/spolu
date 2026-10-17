import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { backOr, resetHistoryTracking, samePath, trackHistory } from './back';
import { useBackCloses } from './use-back-closes';

function Layer() {
  const [open, setOpen] = useState(false);
  useBackCloses(open, () => setOpen(false));
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <div role="dialog" aria-label="Layer">
          <button type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

async function setup(start = '/a') {
  const rootRoute = createRootRoute();
  const routes = ['/a', '/b'].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: Layer }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [start] }),
  });
  trackHistory(router);
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return router;
}

afterEach(() => resetHistoryTracking());

describe('backOr', () => {
  it('goes back to an entry this tab showed, else runs the fallback', async () => {
    const router = await setup();
    const fallback = vi.fn();
    backOr(router, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);

    await act(() => router.navigate({ to: '/b' as never, search: { k: '1' } as never }));
    backOr(router, fallback);
    await waitFor(() => expect(router.state.location.pathname).toBe('/a'));
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('samePath accepts only this path without the given params', async () => {
    const router = await setup();
    await act(() => router.navigate({ to: '/a' as never, search: { k: '1' } as never }));
    const accept = samePath(router, ['k']);
    expect(accept('/a')).toBe(true);
    expect(accept('/a?k=2')).toBe(false);
    expect(accept('/b')).toBe(false);
  });
});

describe('useBackCloses', () => {
  it('gives an open layer its own entry: Back closes it and stays on the page', async () => {
    const router = await setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(router.history.length).toBe(2));
    act(() => router.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/a');
  });

  it('a layer closed in the app takes its entry away again', async () => {
    const router = await setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(router.history.length).toBe(2));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(router.state.location.state).not.toHaveProperty('layer'));
    expect(router.state.location.pathname).toBe('/a');
  });

  it('a navigation that replaces the URL inside the layer keeps it open', async () => {
    const router = await setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(router.history.length).toBe(2));
    await act(() =>
      router.navigate({ to: '/a' as never, search: { q: 'x' } as never, replace: true }),
    );
    expect(screen.getByRole('dialog', { name: 'Layer' })).toBeInTheDocument();
  });
});
