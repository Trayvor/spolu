import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { safeRedirect } from '@/features/auth/redirect';
import { sessionQuery } from '@/features/auth/use-session';
import { RootLayout } from '@/routes/root';

interface RouterContext {
  queryClient: QueryClient;
}

// Code-based route tree. Every screen is lazy-loaded so it ships as its own chunk.
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: lazyRouteComponent(() => import('@/routes/not-found'), 'NotFoundPage'),
});

// Pathless layout: every child needs a session, otherwise the visitor goes to /login.
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  component: Outlet,
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
});

const homeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: lazyRouteComponent(() => import('@/routes/home'), 'HomePage'),
});

const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('@/routes/settings'), 'SettingsPage'),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: safeRedirect(search.redirect) } : {},
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (user) throw redirect({ to: '/' });
  },
  component: lazyRouteComponent(() => import('@/features/auth/login-page'), 'LoginRoute'),
});

const routeTree = rootRoute.addChildren([
  authedRoute.addChildren([homeRoute, settingsRoute]),
  loginRoute,
]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({ routeTree, history, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
