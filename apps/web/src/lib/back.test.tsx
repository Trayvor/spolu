import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RouterProvider,
  createBrowserHistory,
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

/** Like `BottomSheet`: it slides out for a while after closing, inactive for Back meanwhile. */
function AnimatedLayer() {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    setLeaving(true);
    setTimeout(() => {
      setOpen(false);
      setLeaving(false);
    }, 50);
  };
  useBackCloses(open && !leaving, close);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <div role="dialog" aria-label="Layer">
          <button type="button" onClick={close}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

const indexOf = (router: { history: { location: { state: unknown } } }) =>
  (router.history.location.state as { __TSR_index: number }).__TSR_index;

/**
 * `browser`: jsdom's own history, where a step back lands later (a `popstate`), as in a browser;
 * the memory history steps back at once.
 */
async function setup(start = '/a', component = Layer, browser = false) {
  const rootRoute = createRootRoute();
  const routes = ['/a', '/b'].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: browser
      ? (window.history.replaceState(null, '', start), createBrowserHistory())
      : createMemoryHistory({ initialEntries: [start] }),
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

  it('Back on a layer that animates out does not give it a new entry', async () => {
    const router = await setup('/a', AnimatedLayer, true);
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(indexOf(router)).toBe(1));
    act(() => router.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(indexOf(router)).toBe(0);
    expect(router.state.location.state).not.toHaveProperty('layer');
  });

  it('closed in the app and opened again at once: one entry, open, at the right place', async () => {
    const router = await setup('/a', AnimatedLayer, true);
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(indexOf(router)).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(router.state.location.state).toHaveProperty('layer'));
    expect(indexOf(router)).toBe(1);
    // Back closes it and lands on the page itself.
    act(() => router.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(indexOf(router)).toBe(0);
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
