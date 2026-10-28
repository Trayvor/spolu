import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false };
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

// The chat itself is tested in features/chat; here it only marks that the Chat tab rendered.
vi.mock('@/features/chat/chat-tab', () => ({ ChatTab: () => <p>chat-tab</p> }));
// Same for the Overview tab (tested in features/projects).
vi.mock('@/features/projects/overview-tab', () => ({ OverviewTab: () => <p>overview-tab</p> }));
// Same for the task board (tested in features/tasks).
vi.mock('@/features/tasks/tasks-tab', () => ({ TasksTab: () => <p>tasks-tab</p> }));

vi.mock('@/features/chat/chat-tab-badge', () => ({
  ChatTabBadge: ({ groupId }: { groupId: string }) => <span>badge-{groupId}</span>,
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ADMIN = {
  id: 'a1',
  name: 'Jana',
  email: 'jana@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};
const CLIENT = {
  id: 'u1',
  name: 'Eva',
  email: 'eva@acme.sk',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'Firma', role: 'client', hasLogo: false, updatedAt: '' }],
};
const GROUP = {
  id: 'g1',
  name: 'Acme',
  egrantUrl: 'https://acme.egrant.sk',
  hasLogo: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
};
const INVITE = 'https://spolu.test/join/old-token';
const EVA = { id: 'u1', name: 'Eva', email: 'eva@acme.sk' };
const PETR = { id: 'u2', name: 'Petr', email: 'petr@acme.sk' };
const OLGA = { id: 'u3', name: 'Olga', email: 'olga@acme.sk' };
const INVITED = { id: 'u9', name: '', email: 'nova@acme.sk' };

function mockApi(
  options: {
    me?: typeof ADMIN | typeof CLIENT;
    members?: unknown[];
    removed?: unknown[];
    invited?: unknown[];
    group?: number;
    egrantUrl?: string;
    /** The admin group "eGrant tím" (Phase 34). */
    admin?: boolean;
    taskChats?: Record<string, { count: number; unread: boolean }>;
    /** Tasks of the group with an unseen change for the viewer. */
    unseenTaskIds?: string[];
  } = {},
) {
  const me = options.me ?? ADMIN;
  const state = { members: options.members ?? [EVA, PETR], removed: options.removed ?? [OLGA] };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, me);
    if (url === '/api/groups/g1' && method === 'GET') {
      if (options.group) return reply(options.group, { error: 'not_found' });
      const group = options.admin
        ? { ...GROUP, name: 'eGrant tím', kind: 'admin', egrantUrl: null }
        : { ...GROUP, egrantUrl: options.egrantUrl ?? GROUP.egrantUrl };
      return reply(200, me.role === 'client' ? group : { ...group, inviteUrl: INVITE });
    }
    if (url === '/api/groups/g1/invite' && method === 'POST') {
      return reply(200, { inviteUrl: 'https://spolu.test/join/new-token' });
    }
    if (url === '/api/groups/g1/board/unseen')
      return reply(200, { taskIds: options.unseenTaskIds ?? [] });
    if (url === '/api/groups/g1/task-chats') return reply(200, options.taskChats ?? {});
    if (url === '/api/groups/g1/members') return reply(200, state.members);
    if (url === '/api/groups/g1/members/removed') return reply(200, state.removed);
    if (url === '/api/groups/g1/members/invited') return reply(200, options.invited ?? [INVITED]);
    const del = url.match(/^\/api\/groups\/g1\/members\/(\w+)$/);
    if (del && method === 'DELETE') {
      const gone = state.members.find((m) => (m as { id: string }).id === del[1]);
      state.members = state.members.filter((m) => m !== gone);
      state.removed = [...state.removed, gone];
      return reply(204);
    }
    const restore = url.match(/^\/api\/groups\/g1\/members\/(\w+)\/restore$/);
    if (restore && method === 'POST') {
      const back = state.removed.find((m) => (m as { id: string }).id === restore[1]);
      state.removed = state.removed.filter((m) => m !== back);
      state.members = [...state.members, back];
      return reply(204);
    }
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  const calls = (method: string, url: string) =>
    fetchMock.mock.calls.filter(
      ([u, i]) => u === url && ((i as RequestInit | undefined)?.method ?? 'GET') === method,
    );
  return { calls };
}

function renderGroup(path = '/groups/g1/members') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  const user = userEvent.setup();
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user, writeText, router };
}

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('group layout', () => {
  beforeEach(() => {
    setLanguage('en');
    socket.connected = false;
    socket.emit.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('/groups/g1 redirects to /groups/g1/overview and shows the Overview tab', async () => {
    mockApi();
    const { router } = renderGroup('/groups/g1');
    expect(await screen.findByText('overview-tab')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/groups/g1/overview');
    expect(screen.queryByText('chat-tab')).not.toBeInTheDocument();
  });

  it('the Tasks tab shows one badge: the tasks with an unseen change', async () => {
    mockApi({
      taskChats: {
        t1: { count: 2, unread: true },
        t2: { count: 1, unread: true },
        t3: { count: 4, unread: false },
      },
      unseenTaskIds: ['t1', 't3', 't9'],
    });
    renderGroup('/groups/g1/chat');
    const nav = await screen.findByRole('navigation', { name: t('group.tabs.label') });
    const tab = within(nav).getByRole('link', { name: new RegExp(`^${t('group.tabs.tasks')}`) });
    expect(await within(tab).findByText(t('tasks.unseenTasks', { count: 3 }))).toBeInTheDocument();
    expect(within(tab).getByText('3')).toBeInTheDocument();
    expect(within(tab).queryByText('2')).not.toBeInTheDocument();
  });

  it('the three tabs link to chat, tasks, members; the current one has aria-current="page"', async () => {
    mockApi();
    const { user } = renderGroup('/groups/g1/chat');
    const nav = await screen.findByRole('navigation', { name: t('group.tabs.label') });
    const link = (key: string) => within(nav).getByRole('link', { name: new RegExp(`^${t(key)}`) });
    expect(link('group.tabs.chat')).toHaveAttribute('href', '/groups/g1/chat');
    expect(link('group.tabs.tasks')).toHaveAttribute('href', '/groups/g1/tasks');
    expect(link('group.tabs.members')).toHaveAttribute('href', '/groups/g1/members');
    expect(link('group.tabs.chat')).toHaveAttribute('aria-current', 'page');
    expect(link('group.tabs.tasks')).not.toHaveAttribute('aria-current');
    // A menu, not pills: the current tab is ink and underlined, the others muted text.
    expect(link('group.tabs.chat')).toHaveClass('text-foreground', 'after:bg-foreground');
    expect(link('group.tabs.chat')).not.toHaveClass('rounded-full');
    expect(link('group.tabs.tasks')).toHaveClass('text-muted-foreground');
    expect(link('group.tabs.tasks')).not.toHaveClass('after:bg-foreground');
    expect(within(link('group.tabs.chat')).getByText('badge-g1')).toBeInTheDocument();

    await user.click(link('group.tabs.tasks'));
    expect(await screen.findByText('tasks-tab')).toBeInTheDocument();
    await waitFor(() => expect(link('group.tabs.tasks')).toHaveAttribute('aria-current', 'page'));
    expect(link('group.tabs.chat')).not.toHaveAttribute('aria-current');
    expect(link('group.tabs.tasks')).toHaveClass('after:bg-foreground');
    expect(link('group.tabs.chat')).toHaveClass('text-muted-foreground');

    await user.click(link('group.tabs.members'));
    expect(await screen.findByText('Petr')).toBeInTheDocument();
  });

  it('the admin group: Overview, Chat, Tasks, Knowledge, no Tickets or Members, no link (Phase 34)', async () => {
    mockApi({ admin: true, me: { ...ADMIN, finance: true } });
    renderGroup('/groups/g1/chat');
    const nav = await screen.findByRole('navigation', { name: t('group.tabs.label') });
    const names = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    // Its own projects too (Phase 34 spec): the Overview pill stays.
    expect(names).toEqual([
      '/groups/g1/overview',
      '/groups/g1/chat',
      '/groups/g1/tasks',
      '/groups/g1/knowledge',
      '/groups/g1/finance',
    ]);
    const title = screen.getByRole('heading', { level: 1, name: 'eGrant tím' });
    expect(within(title).queryByRole('link')).toBeNull();
    expect(document.querySelector('[data-egrant-mark]')).not.toBeNull();
  });

  it.each(['tickets', 'members'])(
    'the admin group has no %s screen: not found (Phase 34)',
    async (tab) => {
      mockApi({ admin: true });
      renderGroup(`/groups/g1/${tab}`);
      expect(await screen.findByText(t('notFound.title'))).toBeInTheDocument();
    },
  );

  it('only a finance admin has the Financie tab, last, and it opens the three cards (Phase 32)', async () => {
    mockApi();
    renderGroup('/groups/g1/chat');
    const nav = await screen.findByRole('navigation', { name: t('group.tabs.label') });
    expect(within(nav).queryByRole('link', { name: t('group.tabs.finance') })).toBeNull();
    cleanup();

    mockApi({ me: { ...ADMIN, finance: true } });
    const { user } = renderGroup('/groups/g1/chat');
    const financeNav = await screen.findByRole('navigation', { name: t('group.tabs.label') });
    const links = within(financeNav).getAllByRole('link');
    expect(links.at(-1)).toHaveAccessibleName(t('group.tabs.finance'));
    expect(links.at(-1)).toHaveAttribute('href', '/groups/g1/finance');
    await user.click(links.at(-1)!);
    expect(
      await screen.findByRole('heading', { name: t('finance.cards.workLog') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('finance.cards.overview') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('finance.cards.documents') })).toBeInTheDocument();
  });

  it('the admin group without the finance right: no Financie tab, its screen not found, no finance request (Phase 34 E)', async () => {
    mockApi({ admin: true });
    renderGroup('/groups/g1/chat');
    const nav = await screen.findByRole('navigation', { name: t('group.tabs.label') });
    expect(within(nav).queryByRole('link', { name: t('group.tabs.finance') })).toBeNull();
    cleanup();

    mockApi({ admin: true });
    renderGroup('/groups/g1/finance');
    expect(await screen.findByText(t('notFound.title'))).toBeInTheDocument();
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.includes('finance'))).toEqual([]);
  });

  it("the admin group's Financie tab is the organisation's: its items, never a store of its own (Phase 34 E)", async () => {
    mockApi({ admin: true, me: { ...ADMIN, finance: true } });
    renderGroup('/groups/g1/finance');
    expect(
      await screen.findByRole('heading', { name: t('financeOrg.card.organisation') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('finance.cards.overview') })).toBeInTheDocument();
    await waitFor(() => {
      const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.startsWith('/api/finance/org/items'))).toBe(true);
    });
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.startsWith('/api/groups/g1/finance/items'))).toBe(false);
    expect(urls.some((url) => url.startsWith('/api/groups/g1/finance/overview'))).toBe(true);
  });

  it('/ sends a client to /groups/<groupId>/chat', async () => {
    mockApi({ me: CLIENT });
    const { router } = renderGroup('/');
    expect(await screen.findByText('chat-tab')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/groups/g1/chat');
  });

  it('the header is one compact line: 32 px logo, the instance as an icon link, Edit as a gear icon button that opens the form in place', async () => {
    mockApi();
    const { user } = renderGroup('/groups/g1/chat');
    const heading = await screen.findByRole('heading', { name: 'Acme' });
    expect(screen.queryByText('https://acme.egrant.sk')).toBeNull();
    expect(within(heading).queryByRole('link')).toBeNull();
    const link = screen.getByRole('link', { name: t('group.openInstance') });
    expect(link).toHaveAttribute('href', 'https://acme.egrant.sk');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('title', 'https://acme.egrant.sk');
    expect(heading).toHaveClass('truncate');
    expect(screen.getByText('A')).toHaveStyle({ width: '32px', height: '32px' });
    const edit = screen.getByRole('button', { name: t('group.edit') });
    expect(edit).toHaveAttribute('title', t('group.edit'));
    expect(edit.querySelector('svg')).not.toBeNull();
    expect(edit).not.toHaveTextContent(t('group.edit'));
    await user.click(edit);
    expect(screen.getByLabelText(t('groups.form.name'))).toHaveValue('Acme');
  });

  it('for an admin the client name opens the edit form too', async () => {
    mockApi();
    const { user } = renderGroup('/groups/g1/chat');
    const heading = await screen.findByRole('heading', { name: 'Acme' });
    await user.click(within(heading).getByRole('button', { name: 'Acme' }));
    expect(screen.getByLabelText(t('groups.form.name'))).toHaveValue('Acme');
  });

  it('a group without a URL has a plain-text name, no link', async () => {
    mockApi({ egrantUrl: '' });
    renderGroup('/groups/g1/chat');
    const heading = await screen.findByRole('heading', { name: 'Acme' });
    expect(within(heading).queryByRole('link')).toBeNull();
    expect(heading).toHaveClass('truncate');
  });

  it('a client sees the name as the link to the instance and no Edit button', async () => {
    mockApi({ me: CLIENT });
    renderGroup('/groups/g1/chat');
    const heading = await screen.findByRole('heading', { name: 'Acme' });
    const link = within(heading).getByRole('link', { name: 'Acme' });
    expect(link).toHaveAttribute('href', 'https://acme.egrant.sk');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveClass('hover:underline');
    expect(within(heading).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: t('group.openInstance') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('group.edit') })).toBeNull();
  });

  it('the layout joins the group room', async () => {
    socket.connected = true;
    mockApi();
    renderGroup('/groups/g1/chat');
    await screen.findByText('chat-tab');
    expect(socket.emit).toHaveBeenCalledWith('group:join', { groupId: 'g1' }, expect.any(Function));
  });

  it('admin sees invite box; copy writes the URL to the clipboard and shows Link copied.', async () => {
    mockApi();
    const { user, writeText } = renderGroup();
    const field = await screen.findByDisplayValue(INVITE);
    expect(field).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: t('group.invite.copy') }));
    expect(writeText).toHaveBeenCalledWith(INVITE);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(t('group.invite.copied')),
    );
  });

  it('copy selects the field text when the clipboard is unavailable', async () => {
    mockApi();
    const { user, writeText } = renderGroup();
    writeText.mockRejectedValue(new Error('denied'));
    const field = (await screen.findByDisplayValue(INVITE)) as HTMLInputElement;
    await user.click(screen.getByRole('button', { name: t('group.invite.copy') }));
    await waitFor(() => expect(field).toHaveFocus());
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(INVITE.length);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('regenerate asks inline and replaces the URL', async () => {
    const api = mockApi();
    const { user } = renderGroup();
    await screen.findByDisplayValue(INVITE);
    await user.click(screen.getByRole('button', { name: t('group.invite.regenerate') }));
    expect(screen.getByText(t('group.invite.confirm'))).toBeInTheDocument();
    const generate = screen.getByRole('button', { name: t('group.invite.generate') });
    expect(generate).toHaveFocus();
    expect(generate).toHaveClass('bg-primary', 'text-primary-foreground');
    await user.click(screen.getByRole('button', { name: t('admins.cancel') }));
    expect(screen.queryByText(t('group.invite.confirm'))).toBeNull();
    expect(screen.getByRole('button', { name: t('group.invite.regenerate') })).toHaveFocus();
    expect(api.calls('POST', '/api/groups/g1/invite')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: t('group.invite.regenerate') }));
    await user.click(screen.getByRole('button', { name: t('group.invite.generate') }));
    expect(
      await screen.findByDisplayValue('https://spolu.test/join/new-token'),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue(INVITE)).toBeNull();
    expect(screen.queryByText(t('group.invite.confirm'))).toBeNull();
  });

  it('members list with You badge for a client', async () => {
    mockApi({ me: CLIENT });
    renderGroup();
    await screen.findByText('Petr');
    expect(within(rowOf('Eva')).getByText(t('group.members.you'))).toBeInTheDocument();
    expect(within(rowOf('Petr')).queryByText(t('group.members.you'))).toBeNull();
    expect(screen.getByText('petr@acme.sk')).toBeInTheDocument();
  });

  it('a client sees no invite box, no Edit, no Remove, no removed members', async () => {
    const api = mockApi({ me: CLIENT });
    renderGroup();
    await screen.findByText('Petr');
    expect(screen.queryByText(t('group.invite.title'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('group.edit') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('group.members.remove') })).toBeNull();
    expect(screen.queryByText(/Removed members|Odobraní/)).toBeNull();
    expect(api.calls('GET', '/api/groups/g1/members/removed')).toHaveLength(0);
  });

  it('a client sees no "+ Add member" and no invited rows', async () => {
    const api = mockApi({ me: CLIENT });
    renderGroup();
    await screen.findByText('Petr');
    expect(screen.queryByRole('button', { name: t('group.members.add') })).toBeNull();
    expect(screen.queryByText(t('group.members.invited'))).toBeNull();
    expect(api.calls('GET', '/api/groups/g1/members/invited')).toHaveLength(0);
  });

  it('an admin sees "+ Add member" and the invited rows', async () => {
    mockApi();
    renderGroup();
    expect(await screen.findByText('nova@acme.sk')).toBeInTheDocument();
    expect(within(rowOf('nova@acme.sk')).getByText(t('group.members.invited'))).toBeVisible();
    expect(screen.getByRole('button', { name: t('group.members.add') })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mockApi({ members: [], invited: [] });
    renderGroup();
    expect(await screen.findByText(t('group.members.empty'))).toBeInTheDocument();
  });

  it('remove asks inline, focus moves, confirming removes', async () => {
    const api = mockApi();
    const { user } = renderGroup();
    await screen.findByText('Petr');
    const row = rowOf('Petr'); // the same <li> stays while its content swaps
    const remove = () => within(row).getByRole('button', { name: t('group.members.remove') });
    await user.click(remove());
    expect(within(row).getByText(t('group.members.confirmRemove', { name: 'Petr' }))).toBeVisible();
    expect(remove()).toHaveFocus();
    await user.click(within(row).getByRole('button', { name: t('admins.cancel') }));
    expect(within(row).queryByText(t('group.members.confirmRemove', { name: 'Petr' }))).toBeNull();
    expect(remove()).toHaveFocus();
    expect(api.calls('DELETE', '/api/groups/g1/members/u2')).toHaveLength(0);

    await user.click(remove());
    await user.click(remove());
    await waitFor(() => expect(api.calls('DELETE', '/api/groups/g1/members/u2')).toHaveLength(1));
    // Petr moves to the removed members.
    await waitFor(() =>
      expect(screen.getByText(t('group.members.removedTitle', { count: 2 }))).toBeInTheDocument(),
    );
    expect(screen.getAllByText('Petr')).toHaveLength(1);
  });

  it('removed members section restores', async () => {
    const api = mockApi();
    const { user } = renderGroup();
    const summary = await screen.findByText(t('group.members.removedTitle', { count: 1 }));
    const details = summary.closest('details') as HTMLElement;
    expect(details).not.toHaveAttribute('open');
    await user.click(summary);
    expect(within(details).getByText('olga@acme.sk')).toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: t('group.members.restore') }));
    await waitFor(() =>
      expect(api.calls('POST', '/api/groups/g1/members/u3/restore')).toHaveLength(1),
    );
    await waitFor(() => expect(rowOf('Olga')).toBeInTheDocument());
    expect(screen.queryByText(t('group.members.removedTitle', { count: 1 }))).toBeNull();
  });

  it('Edit opens the form inline; saving closes it', async () => {
    mockApi();
    const { user } = renderGroup();
    await user.click(await screen.findByRole('button', { name: t('group.edit') }));
    expect(screen.getByLabelText(t('groups.form.name'))).toHaveValue('Acme');
    await user.click(screen.getByRole('button', { name: t('groups.form.cancel') }));
    expect(screen.queryByLabelText(t('groups.form.name'))).toBeNull();
  });

  it('API 404 shows the not-found page', async () => {
    mockApi({ group: 404 });
    renderGroup();
    expect(await screen.findByText(t('notFound.title'))).toBeInTheDocument();
  });
});
