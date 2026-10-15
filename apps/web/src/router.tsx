import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { ApiError } from '@/lib/api';
import { groupQuery } from '@/features/groups/api';
import { safeRedirect } from '@/features/auth/redirect';
import { isAdmin } from '@/features/auth/roles';
import { sessionQuery } from '@/features/auth/use-session';
import { RootError } from '@/routes/root-error';
import { RootLayout } from '@/routes/root';

interface RouterContext {
  queryClient: QueryClient;
}

// Code-based route tree. Every screen is lazy-loaded so it ships as its own chunk.
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: lazyRouteComponent(() => import('@/routes/not-found'), 'NotFoundPage'),
});

// Pathless layout: every child needs a session, otherwise the visitor goes to /login.
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  // Lazy: it is the only eager importer of socket.io-client otherwise.
  component: lazyRouteComponent(() => import('@/features/auth/authed-layout'), 'AuthedLayout'),
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) throw redirect({ to: '/login', search: { redirect: location.href } });
    // An invited client who closed the tab on the name step gets it again before anything else.
    if (!user.name.trim() && location.pathname !== '/welcome') {
      throw redirect({ to: '/welcome', search: { redirect: location.href } });
    }
  },
});

const homeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  // No screen of its own: a client goes to their group, an admin to the groups list.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) throw redirect({ to: '/login' });
    if (isAdmin(user)) throw redirect({ to: '/groups' });
    if (user.groupId)
      throw redirect({
        to: '/groups/$groupId/chat',
        params: { groupId: user.groupId },
      });
    throw redirect({ to: '/settings' });
  },
});

const groupsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/groups',
  component: lazyRouteComponent(() => import('@/features/groups/groups-page'), 'GroupsPage'),
});

const groupRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/groups/$groupId',
  // A group the visitor may not read answers 404: show the not-found page.
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(groupQuery(params.groupId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw notFound();
      throw error;
    }
  },
  component: lazyRouteComponent(() => import('@/features/groups/group-layout'), 'GroupLayout'),
});

const groupIndexRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/groups/$groupId/chat', params });
  },
});

const groupChatRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'chat',
  component: lazyRouteComponent(() => import('@/features/chat/chat-tab'), 'ChatTab'),
});

const groupTasksRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'tasks',
  component: lazyRouteComponent(() => import('@/features/tasks/tasks-tab'), 'TasksTab'),
});

const taskRoute = createRoute({
  getParentRoute: () => groupTasksRoute,
  path: '$taskId',
  component: lazyRouteComponent(() => import('@/features/tasks/task-panel'), 'TaskPanelRoute'),
});

const groupMembersRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'members',
  component: lazyRouteComponent(() => import('@/features/groups/members-tab'), 'MembersTab'),
});

const welcomeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/welcome',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: safeRedirect(search.redirect) } : {},
  component: lazyRouteComponent(() => import('@/features/auth/welcome-page'), 'WelcomeRoute'),
});

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/$token',
  // Public, but someone already signed in has nothing to join.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (user) throw redirect({ to: '/' });
  },
  component: lazyRouteComponent(() => import('@/features/join/join-page'), 'JoinRoute'),
});

const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('@/routes/settings'), 'SettingsPage'),
});

const adminsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/admins',
  // Cosmetic guard: the server answers 403 to a client anyway.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!isAdmin(user)) throw notFound();
  },
  component: lazyRouteComponent(() => import('@/features/admins/admins-page'), 'AdminsPage'),
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
  authedRoute.addChildren([
    homeRoute,
    settingsRoute,
    adminsRoute,
    groupsRoute,
    groupRoute.addChildren([
      groupIndexRoute,
      groupChatRoute.addChildren([]), // Phase 5 adds its child routes here
      groupTasksRoute.addChildren([taskRoute]),
      groupMembersRoute,
    ]),
    welcomeRoute,
  ]),
  loginRoute,
  joinRoute,
]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({ routeTree, history, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
