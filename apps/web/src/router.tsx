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
import { trackHistory } from '@/lib/back';
import {
  normalizeTypes,
  singleType,
  validateChats,
  validateFolderParam,
  validateKnowledgeSearch,
} from '@/features/knowledge/search';
import { linkEmail, safeRedirect } from '@/features/auth/redirect';
import { validateTicketsSearch } from '@/features/tickets/search';
import { clientGroups, isAdmin } from '@/features/auth/roles';
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
  // A phone's open count-tile sheet (`count-tile.tsx`): a history entry, so Back closes it.
  validateSearch: (search: Record<string, unknown>): { card?: string } =>
    typeof search.card === 'string' ? { card: search.card } : {},
  // An admin's dashboard (Phase 20); a client goes to their group, or picks one of several; a
  // requester to their tickets.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) throw redirect({ to: '/login' });
    if (isAdmin(user)) return;
    const mine = clientGroups(user);
    if (mine.length === 1)
      throw redirect({
        to: '/groups/$groupId/chat',
        params: { groupId: mine[0]!.id },
      });
    if (mine.length > 1) throw redirect({ to: '/my-groups' });
    // Only requester memberships (Phase 21): their tickets are all they have.
    if (user.groups.length > 0) throw redirect({ to: '/tickets' });
    throw redirect({ to: '/settings' });
  },
  component: lazyRouteComponent(
    withNamespaces(['adminHome'], () => import('@/features/admin-home/home-page')),
    'HomePage',
  ),
});

/** The global board's filters in the URL (Phase 20); the page validates them in detail. */
export type GlobalBoardSearch = {
  clients?: string;
  assignee?: string;
  urgent?: 1;
  mine?: 1;
  due?: 'overdue' | 'week' | 'none';
  q?: string;
  completed?: 1;
  task?: string;
};

// The router parses `?q=12` as a number: keep it as text.
const text = (v: unknown) =>
  typeof v === 'number' ? String(v) : typeof v === 'string' && v ? v : undefined;
const flag = (v: unknown) => (v === 1 || v === '1' || v === true ? (1 as const) : undefined);

// The admins' task board across clients.
const globalBoardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/tasks',
  // Spelled out: importing the shared filter schema would pull it into the eager bundle. Every
  // key is set (an invalid one to undefined) so a raw value never slips through.
  validateSearch: (search: Record<string, unknown>): GlobalBoardSearch => ({
    clients: text(search.clients),
    assignee: text(search.assignee),
    urgent: flag(search.urgent),
    mine: flag(search.mine),
    due: ['overdue', 'week', 'none'].includes(search.due as string)
      ? (search.due as GlobalBoardSearch['due'])
      : undefined,
    q: text(search.q),
    completed: flag(search.completed),
    task: text(search.task),
  }),
  // Cosmetic guard: the server answers 403 to a client anyway.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!isAdmin(user)) throw notFound();
  },
  component: lazyRouteComponent(
    withNamespaces(
      ['adminHome', 'knowledge', 'tasks', 'chat', 'taskSplit', 'forms'],
      () => import('@/features/global-board/global-board'),
    ),
    'GlobalBoardPage',
  ),
});

const groupsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/groups',
  // The manager filter: `me`, `none` or an admin id (the page drops an id that is not an admin).
  validateSearch: (search: Record<string, unknown>): { manager?: string } => {
    const manager = text(search.manager);
    return { manager: manager && manager.length <= 64 ? manager : undefined };
  },
  component: lazyRouteComponent(
    withNamespaces(['groups', 'chat'], () => import('@/features/groups/groups-page')),
    'GroupsPage',
  ),
});

/** A client's groups when they belong to more than one (Phase 21). */
const myGroupsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/my-groups',
  component: lazyRouteComponent(
    withNamespaces(['groups', 'chat'], () => import('@/features/groups/my-groups-page')),
    'MyGroupsPage',
  ),
});

const groupRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/groups/$groupId',
  // A group the visitor may not read answers 404: show the not-found page.
  loader: async ({ context, params }) => {
    // Imported here, not at the top: the groups API and its schemas stay out of the initial JS.
    const { groupQuery } = await import('@/features/groups/api');
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
  ): {
    type?: string;
    q?: string;
    chats?: 'all';
    k?: string;
    kind?: KnowledgeType;
    folder?: string;
  } => {
    // A search runs from 2 characters, trimmed (the tab writes it that way too).
    const q = typeof search.q === 'string' ? search.q.trim() : '';
    // Every key is set, an invalid one to undefined: the router keeps the raw params under
    // the validated ones, so an omitted key would let the raw value through. `type` is the
    // ticked types as one canonical comma list (see `normalizeTypes`).
    return {
      type: normalizeTypes(search.type),
      q: q.length >= 2 ? q : undefined,
      chats: validateChats(search.chats),
      k: typeof search.k === 'string' && search.k ? search.k : undefined,
      kind: singleType(search.kind),
      folder: validateFolderParam(search.folder),
    };
  },
  loader: () =>
    Promise.all([loadNamespace('knowledge'), loadNamespace('reminders'), loadNamespace('forms')]),
  component: lazyRouteComponent(() => import('@/features/knowledge/knowledge-tab'), 'KnowledgeTab'),
});

const groupTicketsRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'tickets',
  validateSearch: validateTicketsSearch,
  component: lazyRouteComponent(
    withNamespaces(['tickets', 'forms'], () => import('@/features/tickets/tickets-page')),
    'TicketsTab',
  ),
});

/**
 * The Finance namespaces (Phase 32): `finance` (shared words) and one per part. A route
 * loads all four, so a part's card never renders raw keys.
 */
const FINANCE_NAMESPACES = ['finance', 'financeDocuments', 'financeLog', 'financeSystem'];

/** Cosmetic guard: only finance admins see a Finance screen; the server answers 403 anyway. */
const financeGuard = async ({ context }: { context: RouterContext }) => {
  const user = await context.queryClient.ensureQueryData(sessionQuery);
  if (!user?.finance) throw notFound();
};

// A client's Financie tab (Phase 32), finance admins only.
const groupFinanceRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'finance',
  beforeLoad: financeGuard,
  component: lazyRouteComponent(
    withNamespaces(FINANCE_NAMESPACES, () => import('@/features/finance/finance-tab')),
    'FinanceTab',
  ),
});

const groupMembersRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'members',
  component: lazyRouteComponent(
    withNamespaces(['group', 'groups', 'admins'], () => import('@/features/groups/members-tab')),
    'MembersTab',
  ),
});

// Tickets (Phase 21): the admins' global view, or My tickets for everyone else.
const ticketsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/tickets',
  validateSearch: validateTicketsSearch,
  component: lazyRouteComponent(
    // `knowledge`: the client filter's texts.
    withNamespaces(
      ['tickets', 'forms', 'knowledge'],
      () => import('@/features/tickets/tickets-page'),
    ),
    'TicketsPage',
  ),
});

// One ticket with its chat. A ticket the visitor may not read answers 404: the not-found page.
const ticketRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/tickets/$ticketId',
  loader: async ({ context, params }) => {
    // Imported here, not at the top: the ticket schemas stay out of the entry chunk.
    const { ticketQuery } = await import('@/features/tickets/api');
    try {
      await context.queryClient.ensureQueryData(ticketQuery(params.ticketId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw notFound();
      throw error;
    }
  },
  component: lazyRouteComponent(
    withNamespaces(['tickets', 'chat', 'forms'], () => import('@/features/tickets/ticket-page')),
    'TicketPageRoute',
  ),
});

const welcomeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/welcome',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: safeRedirect(search.redirect) } : {},
  // Named already (Back or Forward to the name step): on to where it would have led.
  beforeLoad: async ({ context, search }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (user?.name.trim()) throw redirect({ href: search.redirect ?? '/' });
  },
  component: lazyRouteComponent(
    withNamespaces(['welcome'], () => import('@/features/auth/welcome-page')),
    'WelcomeRoute',
  ),
});

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/$token',
  // Public. A signed-in client may join one more group here; an admin has nothing to join.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (user && isAdmin(user)) throw redirect({ to: '/' });
  },
  component: lazyRouteComponent(
    withNamespaces(['join', 'login'], () => import('@/features/join/join-page')),
    'JoinRoute',
  ),
});

// Public: the unsubscribe link of a bulk email (Phase 23). No session, no redirect for anyone.
const unsubscribeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/unsubscribe/$token',
  component: lazyRouteComponent(
    withNamespaces(['unsubscribe'], () => import('@/features/bulk-email/unsubscribe-page')),
    'UnsubscribeRoute',
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
    withNamespaces(['admins', 'login'], () => import('@/features/admins/admins-page')),
    'AdminsPage',
  ),
});

// Bulk email (Phase 23): the campaign list and one campaign (editor for a draft). Admins only.
const bulkEmailGuard = async ({ context }: { context: RouterContext }) => {
  // Cosmetic guard: the server answers 403 to a client anyway.
  const user = await context.queryClient.ensureQueryData(sessionQuery);
  if (!isAdmin(user)) throw notFound();
};

const bulkEmailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/bulk-email',
  beforeLoad: bulkEmailGuard,
  component: lazyRouteComponent(
    withNamespaces(['bulkEmail'], () => import('@/features/bulk-email/screens')),
    'CampaignListPage',
  ),
});

const bulkCampaignRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/bulk-email/$campaignId',
  beforeLoad: bulkEmailGuard,
  component: lazyRouteComponent(
    withNamespaces(['bulkEmail'], () => import('@/features/bulk-email/screens')),
    'CampaignPageRoute',
  ),
});

// The system-wide finance page (Phase 32), finance admins only.
const financeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/finance',
  beforeLoad: financeGuard,
  component: lazyRouteComponent(
    withNamespaces(FINANCE_NAMESPACES, () => import('@/features/finance/finance-page')),
    'FinancePage',
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
  // `email`: an invitation's login link carries it to prefill the field (Phase 22b). A refused
  // ticket sign-in link adds `notice=linkExpired`, kept raw and checked by the page (ADR 0022).
  validateSearch: (search: Record<string, unknown>): { redirect?: string; email?: string } => ({
    ...(typeof search.redirect === 'string' ? { redirect: safeRedirect(search.redirect) } : {}),
    ...(linkEmail(search.email) ? { email: linkEmail(search.email) } : {}),
  }),
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (user) throw redirect({ to: '/' });
  },
  component: lazyRouteComponent(
    withNamespaces(['login'], () => import('@/features/auth/login-page')),
    'LoginRoute',
  ),
});

// Public: the one-click sign-in link of a "Ticket created" email, token in the fragment (ADR 0022).
const ticketLinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t',
  component: lazyRouteComponent(
    withNamespaces(['login'], () => import('@/features/auth/ticket-link-page')),
    'TicketLinkRoute',
  ),
});

const routeTree = rootRoute.addChildren([
  authedRoute.addChildren([
    homeRoute,
    globalBoardRoute,
    settingsRoute,
    adminsRoute,
    bulkEmailRoute,
    bulkCampaignRoute,
    knowledgeRoute,
    financeRoute,
    groupsRoute,
    myGroupsRoute,
    groupRoute.addChildren([
      groupIndexRoute,
      groupChatRoute.addChildren([]), // Phase 5 adds its child routes here
      groupTasksRoute.addChildren([newTaskRoute, taskRoute]),
      groupTicketsRoute,
      groupKnowledgeRoute,
      groupFinanceRoute,
      groupMembersRoute,
    ]),
    ticketsRoute,
    ticketRoute,
    welcomeRoute,
  ]),
  loginRoute,
  ticketLinkRoute,
  joinRoute,
  unsubscribeRoute,
]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: 'intent',
    // Back and Forward bring the page back where it was scrolled (docs/design/README.md,
    // "Navigation and Back").
    scrollRestoration: true,
  });
  trackHistory(router);
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
