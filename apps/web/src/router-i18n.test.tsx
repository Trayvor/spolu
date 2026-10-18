import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { NAMESPACES } from '@/i18n/namespaces';

/**
 * Every lazy screen gets its texts from locale namespaces (`src/locales/<name>/<code>.json`)
 * that load with its chunk. Here each route starts as a fresh page load (fresh modules: no
 * namespace and no route chunk loaded yet) and must never
 * render a raw key: not in any render (i18next reports every missing key it is asked for) and
 * not in the DOM at any moment (a MutationObserver checks every change).
 */

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const NOW = '2026-10-16T10:00:00.000Z';
const ADMIN = {
  id: 'a1',
  name: 'Jana',
  email: 'jana@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};
const FINANCE_ADMIN = { ...ADMIN, finance: true };
const CLIENT = {
  id: 'u1',
  name: 'Eva',
  email: 'eva@acme.sk',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'Firma', role: 'client', hasLogo: false, updatedAt: '' }],
};
const GROUP = { id: 'g1', name: 'Acme', egrantUrl: 'https://acme.egrant.sk', hasLogo: false };
const PERSON = { id: 'a1', name: 'Jana' };
const MESSAGE = {
  id: 'm1',
  channelId: 'c1',
  parentId: null,
  replyToId: null,
  author: { id: 'a1', name: 'Jana', isAdmin: true },
  body: 'Send the report',
  mentions: [],
  mentionsAll: false,
  attachments: [],
  clientId: null,
  replyCount: 2,
  lastReplyAt: NOW,
  editedAt: null,
  deletedAt: null,
  createdAt: NOW,
  changeSeq: 1,
  tasks: [{ id: 't1', title: 'Send the report', completed: false }],
};
const BUCKETS = (['todo', 'egrant_review', 'client_review', 'done'] as const).map((kind, i) => ({
  id: `b-${kind}`,
  groupId: 'g1',
  kind,
  name: null,
  position: `a${i}`,
}));
const TASK = {
  id: 't1',
  groupId: 'g1',
  bucketId: 'b-todo',
  position: 'a0',
  title: 'Send the report',
  urgent: true,
  dueDate: '2026-10-20',
  completedAt: null,
  createdBy: PERSON,
  assignees: [PERSON],
  fileCount: 1,
  upcomingReminders: 0,
  knowledgeCount: 0,
  link: null,
  sourceMessageId: 'm1',
  project: null,
  event: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const TASK_DETAIL = {
  ...TASK,
  description: 'Before Friday',
  linkedKnowledge: [],
  files: [],
  sourceMessage: {
    id: 'm1',
    channelId: 'c1',
    taskId: null,
    authorName: 'Jana',
    excerpt: 'Send the report',
  },
  sourceTicket: { id: 'k1', number: 7, subject: 'Cannot submit' },
  sourceMeeting: null,
};
const CHANNEL = { lastSeq: 1, lastReadAt: null, unread: 0 };
const TICKET_ITEM = {
  id: 'k1',
  number: 7,
  groupId: 'g1',
  groupName: 'Acme',
  status: 'in_progress',
  area: 'Login',
  subject: 'Cannot submit',
  dueDate: '2026-10-10',
  createdAt: NOW,
  requesterName: 'Eva',
  excerpt: 'The form fails',
  assignees: [{ id: 'u1', name: 'Eva' }],
  project: null,
  event: null,
  unseen: false,
};
const TICKET = {
  ...TICKET_ITEM,
  source: 'api',
  linkedKnowledge: [],
  requester: { userId: 'u1', name: 'Eva', email: 'eva@acme.sk', phone: null },
  programme: null,
  body: 'The form fails',
  url: null,
  instanceUrl: 'https://acme.egrant.sk',
  files: [],
  createdBy: null,
  updatedAt: NOW,
  resolvedAt: null,
  taskCount: 2,
  tasks: [
    { id: 't1', title: 'Fix it', completed: false },
    { id: 't2', title: 'Write back', completed: true },
  ],
  channelId: 'c3',
  canAssign: true,
};
const PAGE = { messages: [MESSAGE], hasMore: false, lastSeq: 1, lastReadAt: null };

function mockApi(me: typeof ADMIN | typeof CLIENT | null) {
  const routes: Record<string, unknown> = {
    '/api/groups': [{ ...GROUP, memberCount: 2, updatedAt: NOW }],
    '/api/groups/g1': { ...GROUP, updatedAt: NOW, inviteUrl: 'https://spolu.test/join/tok' },
    '/api/groups/g1/chat': { id: 'c1', ...CHANNEL },
    '/api/groups/g1/people': [{ ...PERSON, isAdmin: true }],
    '/api/groups/g1/members': [{ id: 'u1', name: 'Eva', email: 'eva@acme.sk' }],
    '/api/groups/g1/members/removed': [],
    '/api/groups/g1/task-chats': { t1: { count: 1, unread: true } },
    '/api/groups/g1/board': { buckets: BUCKETS, tasks: [TASK], done: { total: 0, next: null } },
    '/api/tasks/t1': TASK_DETAIL,
    '/api/tasks/t1/chat': { id: 'c2', ...CHANNEL },
    '/api/channels/c1/messages': PAGE,
    '/api/channels/c2/messages': { ...PAGE, messages: [] },
    '/api/channels/c1/unread-threads': [],
    '/api/channels/c2/unread-threads': [],
    '/api/chat/unread': { g1: 2 },
    '/api/groups/g1/projects?status=active': {
      items: [
        {
          id: 'p1',
          groupId: 'g1',
          name: 'Culture 2026',
          color: 'blue',
          status: 'active',
          source: 'egrant',
          eventCount: 2,
          nextEvent: { id: 'e1', name: 'Evaluation', occursOn: '2099-11-04' },
          openTasks: 3,
          openTickets: 1,
          egrantChanges: 0,
          updatedAt: NOW,
        },
      ],
      nextCursor: null,
    },
    '/api/groups/g1/tickets': { items: [TICKET_ITEM], nextCursor: null },
    '/api/tickets/global': { items: [TICKET_ITEM], nextCursor: null },
    '/api/tickets/mine': { items: [TICKET_ITEM], nextCursor: null },
    '/api/knowledge/scope': { managedGroupIds: [] },
    '/api/tickets/k1': TICKET,
    '/api/tickets/k1/assignee-candidates': [{ id: 'u1', name: 'Eva', isAdmin: true }],
    '/api/groups/g1/ticket-watch': { watching: true },
    '/api/tickets/k1/chat': { id: 'c3', ...CHANNEL },
    '/api/channels/c3/messages': PAGE,
    '/api/channels/c3/unread-threads': [],
    '/api/channels/c3/people': [{ ...PERSON, isAdmin: true }],
    '/api/ai/status': { taskSplit: true },
    '/api/notifications/modes': {
      defaultMode: null,
      roleDefault: 'mentions',
      overrides: {},
      managerSet: [],
    },
    '/api/notifications/preferences': {
      channels: {
        chat: 'email',
        tasks: 'email',
        tickets: 'both',
        knowledge: 'email',
        meetings: 'email',
      },
      visibleCategories: ['chat', 'tasks', 'tickets', 'knowledge', 'meetings'],
      vapidPublicKey: null,
    },
    '/api/health': { status: 'ok', db: 'ok', version: '1.0.0' },
    '/api/admins': [{ id: 'a1', name: 'Jana', email: 'jana@example.com', role: 'superadmin' }],
    '/api/join/tok': { name: 'Acme', hasLogo: false, updatedAt: NOW },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const reply = (status: number, body?: unknown) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status });
      if ((init?.method ?? 'GET') !== 'GET') return reply(204);
      if (url === '/api/me') return me ? reply(200, me) : reply(401, { error: 'unauthorized' });
      return url in routes ? reply(200, routes[url]) : reply(404, { error: 'not_found' });
    }),
  );
}

const RAW_KEY = new RegExp(`\\b(${NAMESPACES.join('|')})\\.[A-Za-z_]+`);

/** Collects every raw key that reached the DOM: text and the attributes people read. */
function watchDom(found: string[]) {
  const check = (node: Node) => {
    const texts: string[] = [];
    if (node.nodeType === Node.TEXT_NODE) texts.push(node.textContent ?? '');
    if (node instanceof Element) {
      texts.push(node.textContent ?? '');
      for (const el of [node, ...node.querySelectorAll('*')]) {
        for (const name of ['aria-label', 'placeholder', 'title', 'alt']) {
          const value = el.getAttribute(name);
          if (value) texts.push(value);
        }
      }
    }
    for (const text of texts) {
      const match = RAW_KEY.exec(text);
      if (match) found.push(match[0]);
    }
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      check(record.target);
      record.addedNodes.forEach(check);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  return observer;
}

// Fresh per test (see beforeEach): the router caches its lazy route components.
let app: {
  i18n: typeof import('@/i18n').i18n;
  setLanguage: typeof import('@/i18n').setLanguage;
  isNamespaceLoaded: typeof import('@/i18n/namespaces').isNamespaceLoaded;
  createAppRouter: typeof import('@/router').createAppRouter;
};

function renderAt(path: string) {
  const { createAppRouter } = app;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

interface Case {
  path: string;
  me: typeof ADMIN | typeof CLIENT | null;
  /** A text (or a text field's name) of the screen in English, found once it has rendered. */
  shows: string | RegExp;
  field?: boolean;
  /** Namespaces the screen needs, loaded before it renders. */
  namespaces: string[];
}

const CASES: Case[] = [
  {
    path: '/tickets',
    me: ADMIN,
    shows: 'New ticket',
    namespaces: ['tickets', 'forms', 'knowledge'],
  },
  { path: '/tickets', me: CLIENT, shows: 'My tickets', namespaces: ['tickets'] },
  {
    path: '/groups/g1/tickets',
    me: CLIENT,
    shows: 'Cannot submit',
    namespaces: ['group', 'tickets', 'forms'],
  },
  {
    path: '/tickets/k1',
    me: ADMIN,
    shows: 'Assignees (1)',
    namespaces: ['tickets', 'chat', 'forms'],
  },
  { path: '/groups', me: ADMIN, shows: 'Create group', namespaces: ['groups', 'chat'] },
  {
    path: '/groups/g1/chat',
    me: ADMIN,
    shows: 'Write a message…',
    field: true,
    namespaces: ['group', 'groups', 'chat', 'tasks', 'taskSplit', 'forms'],
  },
  {
    path: '/groups/g1/chat',
    me: CLIENT,
    shows: 'Write a message…',
    field: true,
    namespaces: ['group', 'chat', 'tasks', 'taskSplit', 'forms'],
  },
  {
    path: '/groups/g1/tasks',
    me: ADMIN,
    shows: 'Add task',
    namespaces: ['group', 'chat', 'tasks', 'taskSplit'],
  },
  {
    path: '/groups/g1/tasks/t1',
    me: ADMIN,
    shows: 'Created from a message',
    namespaces: ['group', 'chat', 'tasks', 'taskSplit', 'forms'],
  },
  {
    path: '/groups/g1/tasks/new',
    me: CLIENT,
    shows: 'New task',
    namespaces: ['group', 'chat', 'tasks', 'taskSplit', 'forms'],
  },
  {
    path: '/groups/g1/overview',
    me: CLIENT,
    shows: 'Culture 2026',
    namespaces: ['group', 'projects', 'chat', 'forms'],
  },
  {
    path: '/groups/g1/members',
    me: ADMIN,
    shows: 'Invite link',
    namespaces: ['group', 'admins'],
  },
  {
    path: '/settings',
    me: CLIENT,
    shows: 'System status',
    namespaces: ['settings', 'notifications', 'system'],
  },
  { path: '/admins', me: ADMIN, shows: 'Add admin', namespaces: ['admins'] },
  {
    path: '/groups/g1/finance',
    me: FINANCE_ADMIN,
    shows: 'Work log',
    namespaces: ['group', 'finance', 'financeDocuments', 'financeLog', 'financeSystem'],
  },
  {
    path: '/finance',
    me: FINANCE_ADMIN,
    shows: 'Financial administration',
    namespaces: ['finance', 'financeDocuments', 'financeLog', 'financeSystem'],
  },
  // Without the right: the not-found screen, whose texts are in the main files.
  { path: '/groups/g1/finance', me: ADMIN, shows: 'Page not found', namespaces: [] },
  { path: '/finance', me: ADMIN, shows: 'Page not found', namespaces: [] },
  { path: '/join/tok', me: null, shows: 'Join Acme', namespaces: ['join'] },
  { path: '/login', me: null, shows: /./, namespaces: [] },
  { path: '/no-such-page', me: CLIENT, shows: /./, namespaces: [] },
];

describe('routes render no raw locale keys', () => {
  const missing: string[] = [];
  const onMissing = (_lngs: readonly string[], _ns: string, key: string) => missing.push(key);
  const inDom: string[] = [];
  let observer: MutationObserver;

  beforeEach(async () => {
    vi.resetModules();
    const [{ i18n, setLanguage }, { isNamespaceLoaded }, { createAppRouter }] = await Promise.all([
      import('@/i18n'),
      import('@/i18n/namespaces'),
      import('@/router'),
    ]);
    app = { i18n, setLanguage, isNamespaceLoaded, createAppRouter };
    await setLanguage('en');
    missing.length = 0;
    inDom.length = 0;
    i18n.options.saveMissing = true;
    i18n.on('missingKey', onMissing);
    observer = watchDom(inDom);
  });
  afterEach(() => {
    const { i18n } = app;
    observer.disconnect();
    i18n.off('missingKey', onMissing);
    i18n.options.saveMissing = false;
    vi.unstubAllGlobals();
  });

  for (const { path, me, shows, field, namespaces } of CASES) {
    it(`${path} (${me?.role ?? 'anonymous'})`, async () => {
      const { isNamespaceLoaded } = app;
      mockApi(me);
      renderAt(path);
      const found = field
        ? await screen.findAllByRole('textbox', { name: shows })
        : await screen.findAllByText(shows);
      expect(found.length).toBeGreaterThan(0);
      // Let the queries settle so loaded data renders too.
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      for (const name of namespaces)
        expect({ name, loaded: isNamespaceLoaded(name) }).toEqual({
          name,
          loaded: true,
        });
      expect(missing).toEqual([]);
      expect(inDom).toEqual([]);
    });
  }

  it('switching to Slovak on a lazy screen loads its texts before anything switches', async () => {
    const { i18n, setLanguage, isNamespaceLoaded } = app;
    mockApi(ADMIN);
    renderAt('/groups/g1/tasks/t1');
    await screen.findByText('Created from a message');
    await act(() => setLanguage('sk'));
    expect(isNamespaceLoaded('tasks', 'sk')).toBe(true);
    expect(isNamespaceLoaded('chat', 'sk')).toBe(true);
    expect(await screen.findByText(i18n.t('tasks.panel.fromMessage'))).toBeInTheDocument();
    expect(i18n.t('tasks.panel.fromMessage')).not.toBe('Created from a message');
    expect(missing).toEqual([]);
    expect(inDom).toEqual([]);
  });
});
