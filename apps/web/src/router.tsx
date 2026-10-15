import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@tanstack/react-router';
import { RootLayout } from '@/routes/root';

// Code-based route tree. Every screen is lazy-loaded so it ships as its own chunk.
const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: lazyRouteComponent(() => import('@/routes/not-found'), 'NotFoundPage'),
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('@/routes/home'), 'HomePage'),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('@/routes/settings'), 'SettingsPage'),
});

const routeTree = rootRoute.addChildren([homeRoute, settingsRoute]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
