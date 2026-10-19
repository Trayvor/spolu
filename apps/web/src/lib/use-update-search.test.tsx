import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  retainSearchParams,
} from '@tanstack/react-router';
import { useUpdateSearch, type SearchRecord } from './use-update-search';

/** Each button applies one change through the hook. */
const CHANGES: Record<string, (s: SearchRecord) => void> = {
  'drop event': (s) => {
    delete s.event;
  },
  'drop project and tab': (s) => {
    delete s.project;
    delete s.tab;
  },
  'set event': (s) => {
    s.event = 'e1';
  },
};

function Page() {
  const update = useUpdateSearch();
  return (
    <>
      {Object.entries(CHANGES).map(([name, change]) => (
        <button key={name} type="button" onClick={() => update(change, { replace: true })}>
          {name}
        </button>
      ))}
    </>
  );
}

/** A route that keeps `project` and `event` across navigations, as the group board does. */
function renderRetaining(path: string) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/tasks',
    validateSearch: (s: Record<string, unknown>) => ({
      project: typeof s.project === 'string' ? s.project : undefined,
      event: typeof s.event === 'string' ? s.event : undefined,
    }),
    search: { middlewares: [retainSearchParams(['project', 'event'])] },
    component: Page,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router as never} />);
  return router;
}

describe('useUpdateSearch', () => {
  it('a deleted param leaves the URL even on a route that retains it', async () => {
    const router = renderRetaining('/tasks?project=p1&event=e1&tab=chat');
    await screen.findByRole('button', { name: 'set event' });
    await act(() => fireEvent.click(screen.getByRole('button', { name: 'drop event' })));
    expect(router.state.location.search).toEqual({ project: 'p1', tab: 'chat' });
    await act(() => fireEvent.click(screen.getByRole('button', { name: 'drop project and tab' })));
    expect(router.state.location.search).toEqual({});
    expect(router.state.location.href).toBe('/tasks');
  });

  it('keeps every param the change does not touch', async () => {
    const router = renderRetaining('/tasks?project=p1&tab=chat');
    await screen.findByRole('button', { name: 'set event' });
    await act(() => fireEvent.click(screen.getByRole('button', { name: 'set event' })));
    expect(router.state.location.search).toEqual({ project: 'p1', event: 'e1', tab: 'chat' });
  });
});
