import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
// Same for the task board (tested in features/tasks).
vi.mock('@/features/tasks/tasks-tab', () => ({ TasksTab: () => <p>tasks-tab</p> }));

vi.mock('@/features/chat/chat-tab-badge', () => ({
  ChatTabBadge: ({ groupId }: { groupId: string }) => <span>badge-{groupId}</span>,
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ADMIN = { id: 'a1', name: 'Jana', email: 'jana@example.com', role: 'admin', groupId: null };
const CLIENT = { id: 'u1', name: 'Eva', email: 'eva@acme.sk', role: 'client', groupId: 'g1' };
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

function mockApi(
  options: {
    me?: typeof ADMIN | typeof CLIENT;
    members?: unknown[];
    removed?: unknown[];
    group?: number;
    egrantUrl?: string;
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
      const group = { ...GROUP, egrantUrl: options.egrantUrl ?? GROUP.egrantUrl };
      return reply(200, me.role === 'client' ? group : { ...group, inviteUrl: INVITE });
    }
    if (url === '/api/groups/g1/invite' && method === 'POST') {
      return reply(200, { inviteUrl: 'https://spolu.test/join/new-token' });
    }
    if (url === '/api/groups/g1/members') return reply(200, state.members);
    if (url === '/api/groups/g1/members/removed') return reply(200, state.removed);
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

  it('/groups/g1 redirects to /groups/g1/chat and shows the chat', async () => {
    mockApi();
    const { router } = renderGroup('/groups/g1');
    expect(await screen.findByText('chat-tab')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/groups/g1/chat');
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
    expect(link('group.tabs.chat')).toHaveClass('bg-primary', 'text-primary-foreground');
    expect(link('group.tabs.chat')).not.toHaveClass('bg-secondary');
    expect(link('group.tabs.tasks')).toHaveClass('bg-secondary');
    expect(link('group.tabs.tasks')).not.toHaveClass('bg-primary');
    expect(within(link('group.tabs.chat')).getByText('badge-g1')).toBeInTheDocument();

    await user.click(link('group.tabs.tasks'));
    expect(await screen.findByText('tasks-tab')).toBeInTheDocument();
    await waitFor(() => expect(link('group.tabs.tasks')).toHaveAttribute('aria-current', 'page'));
    expect(link('group.tabs.chat')).not.toHaveAttribute('aria-current');
    expect(link('group.tabs.tasks')).toHaveClass('bg-primary');
    expect(link('group.tabs.chat')).toHaveClass('bg-secondary');

    await user.click(link('group.tabs.members'));
    expect(await screen.findByText('Petr')).toBeInTheDocument();
  });

  it('/ sends a client to /groups/<groupId>/chat', async () => {
    mockApi({ me: CLIENT });
    const { router } = renderGroup('/');
    expect(await screen.findByText('chat-tab')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/groups/g1/chat');
  });

  it('the header is one compact line: 32 px logo, the name as a link to the instance, Edit opens the form in place', async () => {
    mockApi();
    const { user } = renderGroup('/groups/g1/chat');
    const heading = await screen.findByRole('heading', { name: 'Acme' });
    expect(screen.queryByText('https://acme.egrant.sk')).toBeNull();
    const link = within(heading).getByRole('link', { name: 'Acme' });
    expect(link).toHaveAttribute('href', 'https://acme.egrant.sk');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('title', 'https://acme.egrant.sk');
    expect(link).toHaveClass('hover:underline');
    expect(heading).toHaveClass('truncate');
    expect(screen.getByText('A')).toHaveStyle({ width: '32px', height: '32px' });
    await user.click(screen.getByRole('button', { name: t('group.edit') }));
    expect(screen.getByLabelText(t('groups.form.name'))).toHaveValue('Acme');
  });

  it('a group without a URL has a plain-text name, no link', async () => {
    mockApi({ egrantUrl: '' });
    renderGroup('/groups/g1/chat');
    const heading = await screen.findByRole('heading', { name: 'Acme' });
    expect(within(heading).queryByRole('link')).toBeNull();
    expect(heading).toHaveClass('truncate');
  });

  it('a client sees the same header link and no Edit button', async () => {
    mockApi({ me: CLIENT });
    renderGroup('/groups/g1/chat');
    const heading = await screen.findByRole('heading', { name: 'Acme' });
    expect(within(heading).getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      'https://acme.egrant.sk',
    );
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

  it('shows the empty state', async () => {
    mockApi({ members: [] });
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
