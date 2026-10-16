import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { KnowledgeFolderDto, KnowledgeSummary } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import type { KnowledgeDialogTarget } from './knowledge-dialog';

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false };
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));
vi.mock('@/features/chat/chat-tab-badge', () => ({ ChatTabBadge: () => null }));
vi.mock('@/features/tasks/tasks-tab-badge', () => ({ TasksTabBadge: () => null }));

// The dialog is tested in knowledge-dialog.test.tsx; here it shows its target and its callbacks.
vi.mock('./knowledge-dialog', () => ({
  KnowledgeDialog: ({
    target,
    onClose,
    onUnavailable,
  }: {
    target: KnowledgeDialogTarget;
    onClose: (createdId?: string) => void;
    onUnavailable: () => void;
  }) => (
    <div role="dialog" aria-label="knowledge-dialog">
      <p>{target.mode === 'view' ? `view:${target.id}` : `create:${target.type}`}</p>
      <button onClick={() => onClose()}>dialog-close</button>
      <button onClick={() => onClose('k9')}>dialog-created</button>
      <button onClick={onUnavailable}>dialog-unavailable</button>
    </div>
  ),
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ADMIN = { id: 'a1', name: 'Jana', email: 'jana@example.com', role: 'admin', groups: [] };
const GROUP = {
  id: 'g1',
  name: 'Acme',
  egrantUrl: 'https://acme.egrant.sk',
  hasLogo: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  inviteUrl: 'https://spolu.test/join/x',
};

function summary(id: string, overrides: Partial<KnowledgeSummary> = {}): KnowledgeSummary {
  return {
    id,
    groupId: 'g1',
    type: 'note',
    visibility: 'public',
    title: `Item ${id}`,
    excerpt: '',
    url: null,
    file: null,
    fileCount: 0,
    nextReminderAt: null,
    upcomingCount: 0,
    lastReminderAt: null,
    createdBy: { id: 'u1', name: 'Anna' },
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    folderId: null,
    folderPath: [],
    ...overrides,
  };
}

const FOLDERS: KnowledgeFolderDto[] = [
  { id: 'f1', groupId: 'g1', parentId: null, name: 'Grants', visibility: 'public', updatedAt: '' },
  { id: 'f2', groupId: 'g1', parentId: 'f1', name: '2026', visibility: 'public', updatedAt: '' },
];

function mockApi(items: KnowledgeSummary[] = [summary('k1')], folders = FOLDERS) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, ADMIN);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url === '/api/groups/g1/knowledge/folders') {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { name: string; parentId: string | null };
        return reply(201, { ...FOLDERS[0], id: 'f9', ...body, visibility: 'public' });
      }
      return reply(200, { folders });
    }
    if (url.startsWith('/api/groups/g1/knowledge')) return reply(200, { items, nextCursor: null });
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderTab(path = '/groups/g1/knowledge') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // The validated search, without the keys it leaves undefined.
  const search = () =>
    Object.fromEntries(
      Object.entries(router.state.matches.at(-1)?.search ?? {}).filter(([, v]) => v !== undefined),
    ) as Record<string, unknown>;
  return { router, search, unmount, user: userEvent.setup() };
}

const heading = () => screen.findByRole('heading', { name: t('knowledge.tab.title') });

describe('knowledge tab', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width: 641px'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the tab pill sits between Tickets and Members', async () => {
    mockApi();
    renderTab();
    const nav = await screen.findByRole('navigation', { name: t('group.tabs.label') });
    await heading();
    const names = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual([
      t('group.tabs.chat'),
      t('group.tabs.tasks'),
      t('group.tabs.tickets'),
      t('group.tabs.knowledge'),
      t('group.tabs.members'),
    ]);
    expect(within(nav).getByRole('link', { name: t('group.tabs.knowledge') })).toHaveAttribute(
      'href',
      '/groups/g1/knowledge',
    );
  });

  it('type pills are checkboxes: tick several into ?type, All clears them', async () => {
    const fetchMock = mockApi();
    const { search, user } = renderTab();
    await heading();
    const pills = screen.getByRole('group', { name: t('knowledge.tab.filters') });
    const all = within(pills).getByRole('button', { name: t('knowledge.types.all') });
    const box = (name: string) => within(pills).getByRole('checkbox', { name: t(name) });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(box('knowledge.types.links')).toHaveAttribute('aria-checked', 'false');

    await user.click(box('knowledge.types.links'));
    await waitFor(() => expect(search().type).toBe('link'));
    expect(box('knowledge.types.links')).toHaveAttribute('aria-checked', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => u === '/api/groups/g1/knowledge?type=link&folder=root'),
      ).toBe(true),
    );

    // The keyboard ticks a second one; the URL keeps the canonical order.
    box('knowledge.types.notes').focus();
    await user.keyboard(' ');
    await waitFor(() => expect(search().type).toBe('note,link'));
    expect(box('knowledge.types.notes')).toHaveAttribute('aria-checked', 'true');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u]) => u === '/api/groups/g1/knowledge?type=note%2Clink&folder=root',
        ),
      ).toBe(true),
    );

    await user.click(box('knowledge.types.links'));
    await waitFor(() => expect(search().type).toBe('note'));
    await user.click(all);
    await waitFor(() => expect(search().type).toBeUndefined());
    expect(box('knowledge.types.notes')).toHaveAttribute('aria-checked', 'false');
  });

  it('?type drops invalid values and duplicates, and an old single value still works', async () => {
    mockApi();
    const first = renderTab('/groups/g1/knowledge?type=link,bogus,note,link');
    await heading();
    expect(first.search().type).toBe('note,link');
    first.unmount();
    const second = renderTab('/groups/g1/knowledge?type=file');
    await heading();
    expect(second.search().type).toBe('file');
    const pills = screen.getByRole('group', { name: t('knowledge.tab.filters') });
    expect(
      within(pills).getByRole('checkbox', { name: t('knowledge.types.files') }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('search writes ?q after 300 ms and only from 2 characters', async () => {
    mockApi();
    const { search } = renderTab();
    await heading();
    const box = screen.getByRole('searchbox', { name: t('knowledge.tab.search') });
    fireEvent.change(box, { target: { value: 'b' } });
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(search().q).toBeUndefined();
    fireEvent.change(box, { target: { value: 'bu' } });
    await act(() => new Promise((r) => setTimeout(r, 150)));
    expect(search().q).toBeUndefined();
    await waitFor(() => expect(search().q).toBe('bu'));
    fireEvent.change(box, { target: { value: '' } });
    await waitFor(() => expect(search().q).toBeUndefined());
  });

  it('New → Reminder opens the create dialog with ?k=new&kind=reminder', async () => {
    mockApi();
    const { search, user } = renderTab();
    await heading();
    await user.click(screen.getByRole('button', { name: t('knowledge.tab.new') }));
    await user.click(await screen.findByRole('menuitem', { name: /Reminder/ }));
    await waitFor(() => expect(search()).toMatchObject({ k: 'new', kind: 'reminder' }));
    expect(await screen.findByText('create:reminder')).toBeInTheDocument();
    // After Create the new item opens.
    await user.click(screen.getByRole('button', { name: 'dialog-created' }));
    await waitFor(() => expect(search().k).toBe('k9'));
    expect(search().kind).toBeUndefined();
  });

  it('?k=<id> opens the detail and Close removes k', async () => {
    mockApi();
    const { search, user } = renderTab('/groups/g1/knowledge?type=note&k=k1');
    expect(await screen.findByText('view:k1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'dialog-close' }));
    await waitFor(() => expect(search().k).toBeUndefined());
    expect(search().type).toBe('note');
    expect(screen.queryByText('view:k1')).not.toBeInTheDocument();
  });

  it('a bare ?k=new without a valid kind is dropped', async () => {
    mockApi();
    const { search } = renderTab('/groups/g1/knowledge?type=note&k=new&kind=bogus');
    await heading();
    await waitFor(() => expect(search()).toEqual({ type: 'note' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('?q is trimmed and needs 2 characters', async () => {
    mockApi();
    const first = renderTab('/groups/g1/knowledge?q=%20%20bu%20');
    await heading();
    expect(first.search().q).toBe('bu');
    expect(screen.getByRole('searchbox', { name: t('knowledge.tab.search') })).toHaveValue('bu');
    await act(() =>
      first.router.navigate({
        to: '/groups/$groupId/knowledge',
        params: { groupId: 'g1' },
        search: { q: ' b ' },
      }),
    );
    expect(first.search().q).toBeUndefined();
  });

  it('an unavailable item closes with the notice', async () => {
    mockApi();
    const { search, user } = renderTab('/groups/g1/knowledge?k=gone');
    await user.click(await screen.findByRole('button', { name: 'dialog-unavailable' }));
    await waitFor(() => expect(search().k).toBeUndefined());
    expect(screen.getByRole('status')).toHaveTextContent(t('knowledge.detail.unavailable'));
  });

  it('empty and no-match states', async () => {
    mockApi([], []);
    const { router } = renderTab();
    expect(await screen.findByText(t('knowledge.tab.empty'))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: t('knowledge.tab.new') })).toHaveLength(2);
    await act(() =>
      router.navigate({
        to: '/groups/$groupId/knowledge',
        params: { groupId: 'g1' },
        search: { q: 'budget', type: 'file' },
      }),
    );
    expect(
      await screen.findByText(t('knowledge.tab.noMatch', { q: 'budget' })),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('knowledge.tab.clearFilters') })).toBeVisible();
  });

  it('Clear filters removes type and q', async () => {
    mockApi([], []);
    const { search, user } = renderTab('/groups/g1/knowledge?q=budget&type=file');
    await user.click(await screen.findByRole('button', { name: t('knowledge.tab.clearFilters') }));
    await waitFor(() => expect(search()).toEqual({}));
    expect(await screen.findByText(t('knowledge.tab.empty'))).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: t('knowledge.tab.search') })).toHaveValue('');
  });

  describe('folders', () => {
    it('shows the top-level folders; opening one writes ?folder= with breadcrumbs', async () => {
      const fetchMock = mockApi();
      const { search, user } = renderTab();
      await user.click(
        await screen.findByRole('button', {
          name: t('knowledge.folders.open', { name: 'Grants' }),
        }),
      );
      await waitFor(() => expect(search().folder).toBe('f1'));
      const crumbs = await screen.findByRole('navigation', { name: t('knowledge.folders.path') });
      expect(within(crumbs).getByText('Grants')).toHaveAttribute('aria-current', 'page');
      expect(
        screen.getByRole('button', { name: t('knowledge.folders.open', { name: '2026' }) }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([u]) => u === '/api/groups/g1/knowledge?folder=f1')).toBe(
          true,
        ),
      );
      await user.click(within(crumbs).getByRole('button', { name: t('knowledge.folders.top') }));
      await waitFor(() => expect(search().folder).toBeUndefined());
    });

    it('a search hides the folders and lists every folder flat with the paths', async () => {
      const fetchMock = mockApi([
        summary('k2', {
          title: 'Deep',
          folderId: 'f2',
          folderPath: [
            { id: 'f1', name: 'Grants' },
            { id: 'f2', name: '2026' },
          ],
        }),
      ]);
      renderTab('/groups/g1/knowledge?folder=f1&q=deep');
      await screen.findByText('Grants / 2026');
      expect(
        screen.queryByRole('button', { name: t('knowledge.folders.open', { name: '2026' }) }),
      ).toBeNull();
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/groups/g1/knowledge?q=deep')).toBe(
        true,
      );
    });

    it('"+ New" → Folder creates a subfolder of the open folder', async () => {
      const fetchMock = mockApi();
      const { user } = renderTab('/groups/g1/knowledge?folder=f1');
      await screen.findByRole('navigation', { name: t('knowledge.folders.path') });
      await user.click(screen.getAllByRole('button', { name: t('knowledge.tab.new') })[0]!);
      await user.click(
        await screen.findByRole('menuitem', { name: new RegExp(t('knowledge.folders.label')) }),
      );
      await user.type(await screen.findByLabelText(t('knowledge.folders.name')), 'Reports');
      await user.click(screen.getByRole('button', { name: t('knowledge.folders.create') }));
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.find(
            ([u, init]) =>
              u === '/api/groups/g1/knowledge/folders' && (init as RequestInit)?.method === 'POST',
          )?.[1],
        ).toMatchObject({
          body: JSON.stringify({ name: 'Reports', parentId: 'f1', visibility: 'public' }),
        }),
      );
      await waitFor(() => expect(screen.queryByTestId('folder-dialog')).toBeNull());
    });

    it('a folder that is gone returns to the top level with a notice', async () => {
      mockApi();
      const { search } = renderTab('/groups/g1/knowledge?folder=missing');
      await screen.findByText(t('knowledge.folders.gone'));
      await waitFor(() => expect(search().folder).toBeUndefined());
    });
  });
});

describe('knowledge tab: files from chats', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width: 641px'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const chatFile = summary('c1', {
    type: 'chat_file',
    title: 'scan.pdf',
    file: {
      id: 'f1',
      name: 'scan.pdf',
      mime: 'application/pdf',
      size: 10,
      width: null,
      height: null,
      hasPreview: false,
    },
    chat: {
      channelId: 'ch1',
      messageId: 'm1',
      parentId: null,
      kind: 'group',
      taskId: null,
      taskTitle: null,
      ticketId: null,
      ticketNumber: null,
    },
  });

  it('"From chat" turns the list flat; the tasks-and-tickets box shows only with it', async () => {
    const fetchMock = mockApi([chatFile]);
    const { search, user } = renderTab();
    await heading();
    const pills = screen.getByRole('group', { name: t('knowledge.tab.filters') });
    const also = () =>
      within(pills).queryByRole('checkbox', { name: t('knowledge.chat.alsoTasksTickets') });
    expect(also()).not.toBeInTheDocument();
    // "+ New" never offers a chat file.
    expect(screen.queryByRole('menuitem', { name: /From chat/ })).not.toBeInTheDocument();

    await user.click(within(pills).getByRole('checkbox', { name: t('knowledge.types.fromChat') }));
    await waitFor(() => expect(search().type).toBe('chat_file'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => u === '/api/groups/g1/knowledge?type=chat_file'),
      ).toBe(true),
    );
    // Flat: no folder rows.
    expect(
      screen.queryByRole('button', { name: t('knowledge.folders.open', { name: 'Grants' }) }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'scan.pdf' })).toHaveAttribute(
      'href',
      '/api/files/f1',
    );
    expect(
      screen.getByRole('link', { name: t('knowledge.chat.open', { title: 'scan.pdf' }) }),
    ).toHaveAttribute('href', '/groups/g1/chat?message=m1&c=ch1');

    await user.click(also()!);
    await waitFor(() => expect(search().chats).toBe('all'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u]) => u === '/api/groups/g1/knowledge?type=chat_file&chats=all',
        ),
      ).toBe(true),
    );
  });
});
