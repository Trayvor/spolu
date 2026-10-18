import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { useFocusOnRouteChange } from './use-focus-on-route-change';

function Shell() {
  useFocusOnRouteChange();
  return (
    <main id="main" tabIndex={-1}>
      <Outlet />
    </main>
  );
}

function setup() {
  const root = createRootRoute({ component: Shell });
  const layout = createRoute({ getParentRoute: () => root, id: 'layout', component: Outlet });
  const a = createRoute({ getParentRoute: () => layout, path: '/a', component: () => <h1>A</h1> });
  const b = createRoute({ getParentRoute: () => layout, path: '/b', component: () => <h1>B</h1> });
  const c = createRoute({ getParentRoute: () => layout, path: '/c', component: () => <p>C</p> });
  return createRouter({
    routeTree: root.addChildren([layout.addChildren([a, b, c])]),
    history: createMemoryHistory({ initialEntries: ['/a'] }),
  });
}

describe('useFocusOnRouteChange', () => {
  it('leaves the focus alone at first, then focuses the new heading or main', async () => {
    const router = setup();
    render(<RouterProvider router={router} />);
    await act(async () => {
      await router.load();
    });
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      await router.navigate({ to: '/b' as never });
    });
    expect(document.activeElement?.textContent).toBe('B');
    await act(async () => {
      await router.navigate({ to: '/c' as never });
    });
    expect(document.activeElement?.id).toBe('main');
  });
});
