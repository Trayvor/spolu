import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

/** Tests only: renders `ui` on `/` and on the paths the admin home links to, so `<Link>` works. */
export async function renderWithRouter(
  ui: () => ReactNode,
  path = '/',
  wrap: (node: ReactNode) => ReactNode = (node) => node,
) {
  const rootRoute = createRootRoute();
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ui });
  const paths = [
    '/groups/$groupId/chat',
    '/groups/$groupId/tasks/$taskId',
    '/groups/$groupId/knowledge',
    '/tasks',
    '/knowledge',
    '/tickets',
    '/tickets/$ticketId',
  ];
  const routes = paths.map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: ui }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, ...routes]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(wrap(<RouterProvider router={router} />));
  await router.load();
  return { router, ...view };
}
