import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

/** Tests only: renders `ui` on `/` and on the group chat path inside a router, so `<Link>` works. */
export async function renderWithRouter(
  ui: () => ReactNode,
  path = '/',
  wrap: (node: ReactNode) => ReactNode = (node) => node,
) {
  const rootRoute = createRootRoute();
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ui });
  const chat = createRoute({
    getParentRoute: () => rootRoute,
    path: '/groups/$groupId/chat',
    component: ui,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, chat]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(wrap(<RouterProvider router={router} />));
  await router.load();
  return { router, ...view };
}
