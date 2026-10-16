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
import type { KnowledgeType } from '@spolu/shared';
import { loadNamespace, withNamespaces } from '@/i18n/namespaces';
import { ApiError } from '@/lib/api';
import { groupQuery } from '@/features/groups/api';
import { validateKnowledgeSearch } from '@/features/knowledge/search';
import { safeRedirect } from '@/features/auth/redirect';
import { isAdmin } from '@/features/auth/roles';
import { sessionQuery } from '@/features/auth/use-session';
import { RootError } from '@/routes/root-error';
import { RootLayout } from '@/routes/root';

interface RouterContext {
  queryClient: QueryClient;
}

// Code-based route tree. Every screen is lazy-loaded so it ships as its own chunk, together with
// the locale namespaces its components render (`withNamespaces`, see src/i18n/namespaces.ts):
// the component resolves only once its texts are there, so no screen shows raw keys.
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
  component: lazyRouteComponent(
    withNamespaces(['notifications'], () => import('@/features/auth/authed-layout')),
    'AuthedLayout',
  ),
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
  component: lazyRouteComponent(
    withNamespaces(['groups', 'chat'], () => import('@/features/groups/groups-page')),
    'GroupsPage',
  ),
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
  component: lazyRouteComponent(
    // The header (group form), the tabs and their unread badges.
    withNamespaces(
      ['group', 'groups', 'chat', 'tasks'],
      () => import('@/features/groups/group-layout'),
    ),
    'GroupLayout',
  ),
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
  component: lazyRouteComponent(
    // Messages show the tasks made from them and offer "Turn into tasks".
    withNamespaces(
      ['chat', 'tasks', 'taskSplit', 'forms'],
      () => import('@/features/chat/chat-tab'),
    ),
    'ChatTab',
  ),
});

const groupTasksRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'tasks',
  component: lazyRouteComponent(
    // A task panel has its own chat, with "Turn into tasks".
    withNamespaces(['tasks', 'chat', 'taskSplit'], () => import('@/features/tasks/tasks-tab')),
    'TasksTab',
  ),
});

const taskRoute = createRoute({
  getParentRoute: () => groupTasksRoute,
  path: '$taskId',
  component: lazyRouteComponent(
    withNamespaces(
      ['tasks', 'chat', 'taskSplit', 'forms', 'reminders'],
      () => import('@/features/tasks/task-panel'),
    ),
    'TaskPanelRoute',
  ),
});

// A static segment wins over `$taskId`, so "new" is never read as a task id.
const newTaskRoute = createRoute({
  getParentRoute: () => groupTasksRoute,
  path: 'new',
  validateSearch: (search: Record<string, unknown>): { bucket?: string } =>
    typeof search.bucket === 'string' ? { bucket: search.bucket } : {},
  component: lazyRouteComponent(
    withNamespaces(
      ['tasks', 'chat', 'forms', 'reminders'],
      () => import('@/features/tasks/task-create-panel'),
    ),
    'NewTaskPanelRoute',
  ),
});

const groupKnowledgeRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'knowledge',
  validateSearch: (
    search: Record<string, unknown>,
  ): { type?: KnowledgeType; q?: string; k?: string; kind?: KnowledgeType } => {
    // Spelled out: importing `KnowledgeTypes` would pull the knowledge schemas into the eager bundle.
    const isType = (v: unknown): v is KnowledgeType =>
      typeof v === 'string' && ['note', 'file', 'link', 'reminder'].includes(v);
    // A search runs from 2 characters, trimmed (the tab writes it that way too).
    const q = typeof search.q === 'string' ? search.q.trim() : '';
    // Every key is set, an invalid one to undefined: the router keeps the raw params under
    // the validated ones, so an omitted key would let the raw value through.
    return {
      type: isType(search.type) ? search.type : undefined,
      q: q.length >= 2 ? q : undefined,
      k: typeof search.k === 'string' && search.k ? search.k : undefined,
      kind: isType(search.kind) ? search.kind : undefined,
    };
  },
  loader: () =>
    Promise.all([loadNamespace('knowledge'), loadNamespace('reminders'), loadNamespace('forms')]),
  component: lazyRouteComponent(() => import('@/features/knowledge/knowledge-tab'), 'KnowledgeTab'),
});

const groupMembersRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'members',
  component: lazyRouteComponent(
    withNamespaces(['group', 'groups', 'admins'], () => import('@/features/groups/members-tab')),
    'MembersTab',
  ),
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
  component: lazyRouteComponent(
    withNamespaces(['join'], () => import('@/features/join/join-page')),
    'JoinRoute',
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: lazyRouteComponent(
    withNamespaces(['settings', 'notifications', 'system'], () => import('@/routes/settings')),
    'SettingsPage',
  ),
});

const adminsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/admins',
  // Cosmetic guard: the server answers 403 to a client anyway.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!isAdmin(user)) throw notFound();
  },
  component: lazyRouteComponent(
    withNamespaces(['admins'], () => import('@/features/admins/admins-page')),
    'AdminsPage',
  ),
});

// The admins' global knowledge list across all clients.
const knowledgeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/knowledge',
  validateSearch: validateKnowledgeSearch,
  // Cosmetic guard: the server answers 403 to a client anyway.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!isAdmin(user)) throw notFound();
  },
  // `chat` too: the detail renders bodies with the chat's renderer and formatting toolbar (the
  // group tab gets it from the group layout).
  loader: () =>
    Promise.all([
      loadNamespace('knowledge'),
      loadNamespace('reminders'),
      loadNamespace('forms'),
      loadNamespace('chat'),
    ]),
  component: lazyRouteComponent(
    () => import('@/features/knowledge/knowledge-page'),
    'KnowledgePage',
  ),
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
    knowledgeRoute,
    groupsRoute,
    groupRoute.addChildren([
      groupIndexRoute,
      groupChatRoute.addChildren([]), // Phase 5 adds its child routes here
      groupTasksRoute.addChildren([newTaskRoute, taskRoute]),
      groupKnowledgeRoute,
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
