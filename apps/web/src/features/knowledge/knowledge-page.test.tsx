import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { KnowledgeSummary } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);
const STORAGE_KEY = 'spolu.knowledge.clients';

const ADMIN = { id: 'a1', name: 'Jana', email: 'jana@example.com', role: 'admin', groups: [] };
const CLIENT = {
  id: 'c1',
  name: 'Klient',
  email: 'k@example.com',
  role: 'client',
  groups: [{ id: 'g1', name: 'Firma', role: 'client', hasLogo: false, updatedAt: '' }],
};
const GROUPS = [
  {
    id: 'g1',
    name: 'ABC s.r.o.',
    hasLogo: false,
    memberCount: 2,
    updatedAt: '2026-10-01T00:00:00Z',
    managers: [],
    managedByMe: false,
  },
  {
    id: 'g2',
    name: 'Obec Lúčky',
    hasLogo: false,
    memberCount: 3,
    updatedAt: '2026-10-01T00:00:00Z',
    managers: [],
    managedByMe: false,
  },
  {
    id: 'g3',
    name: 'Mesto Nitra',
    hasLogo: true,
    memberCount: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    managers: [],
    managedByMe: false,
  },
];
const ROW: KnowledgeSummary = {
  id: 'k1',
  groupId: 'g1',
  type: 'link',
  visibility: 'public',
  title: 'Ministry call portal',
  excerpt: '',
  url: 'https://opvai.sk',
  file: null,
  fileCount: 0,
  nextReminderAt: null,
  upcomingCount: 0,
  lastReminderAt: null,
  createdBy: { id: 'a1', name: 'Jana' },
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
  folderId: null,
  folderPath: [],
  group: { id: 'g1', name: 'ABC s.r.o.', logoUrl: null },
};

function mockApi(
  me: typeof ADMIN | typeof CLIENT = ADMIN,
  managedGroupIds: string[] | null = null,
) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, me);
    if (url === '/api/groups') return reply(200, GROUPS);
    if (url === '/api/knowledge/scope') return reply(200, { managedGroupIds });
    if (url === '/api/groups/g1/knowledge/folders') {
      return reply(200, {
        folders: [
          {
            id: 'f1',
            groupId: 'g1',
            parentId: null,
            name: 'Grants',
            visibility: 'admins',
            updatedAt: '',
          },
        ],
      });
    }
    if (url.startsWith('/api/groups/g1/knowledge?')) {
      return reply(200, { items: url.includes('folder=root') ? [ROW] : [], nextCursor: null });
    }
    if (url === '/api/knowledge' || url.startsWith('/api/knowledge?')) {
      return reply(200, { items: [ROW], nextCursor: null });
    }
    return reply(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  const listCalls = () =>
    fetchMock.mock.calls
      .map(([url]) => url)
      .filter((url) => url === '/api/knowledge' || url.startsWith('/api/knowledge?'));
  return { listCalls };
}

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    // ignored
  }
});

describe('KnowledgePage', () => {
  it('?clients restores the selection', async () => {
    const { listCalls } = mockApi();
    renderPage('/knowledge?clients=g1,g3&q=po');
    expect(
      await screen.findByRole('button', {
        name: t('knowledge.clientFilter.pillSelected', { count: 2 }),
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(listCalls()).toContain('/api/knowledge?clients=g1%2Cg3&q=po'));
  });

  it('without parameters the stored selection is restored', async () => {
    localStorage.setItem(STORAGE_KEY, 'g3');
    const { listCalls } = mockApi();
    const { router } = renderPage('/knowledge');
    expect(
      await screen.findByRole('button', {
        name: t('knowledge.clientFilter.pillSelected', { count: 1 }),
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ clients: 'g3' }));
    // Without a search: the folder view lists the chosen clients, no flat list.
    expect(
      await screen.findByRole('button', {
        name: t('knowledge.folders.open', { name: 'Mesto Nitra' }),
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('knowledge.folders.open', { name: 'ABC s.r.o.' }) }),
    ).toBeNull();
    expect(listCalls()).toEqual([]);
  });

  it('an explicit choice is stored', async () => {
    mockApi();
    const { user } = renderPage('/knowledge');
    await user.click(
      await screen.findByRole('button', { name: t('knowledge.clientFilter.pillAll') }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Mesto Nitra' }));
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('g1,g2'));
  });

  it('storage that throws is ignored', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    mockApi();
    const { user } = renderPage('/knowledge');
    expect(
      await screen.findByRole('button', {
        name: t('knowledge.folders.open', { name: 'Mesto Nitra' }),
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('knowledge.clientFilter.pillAll') }));
    await user.click(screen.getByRole('checkbox', { name: 'Mesto Nitra' }));
    await user.click(screen.getByRole('button', { name: t('knowledge.clientFilter.done') }));
    expect(
      await screen.findByRole('button', {
        name: t('knowledge.clientFilter.pillSelected', { count: 2 }),
      }),
    ).toBeInTheDocument();
  });

  it('type menu ticks several types into ?type and stays open', async () => {
    const { listCalls } = mockApi();
    const { router, user } = renderPage('/knowledge?q=po');
    await user.click(await screen.findByRole('button', { name: t('knowledge.global.allTypes') }));
    const all = screen.getByRole('menuitemcheckbox', { name: t('knowledge.global.allTypes') });
    expect(all).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemcheckbox', { name: t('knowledge.types.links') }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ type: 'link' }));
    await waitFor(() => expect(listCalls()).toContain('/api/knowledge?type=link&q=po'));
    // The open menu hides the page from the accessibility tree, the trigger included.
    const trigger = (name: string) => screen.getByRole('button', { name, hidden: true });
    expect(trigger(t('knowledge.types.links'))).toBeInTheDocument();

    // The menu is still open: tick a second type.
    await user.click(screen.getByRole('menuitemcheckbox', { name: t('knowledge.types.notes') }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ type: 'note,link' }));
    await waitFor(() => expect(listCalls()).toContain('/api/knowledge?type=note%2Clink&q=po'));
    expect(
      screen.getByRole('menuitemcheckbox', { name: t('knowledge.types.notes') }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(all).toHaveAttribute('aria-checked', 'false');
    expect(trigger(t('knowledge.global.typesCount', { count: 2 }))).toBeInTheDocument();

    // Unticking one leaves the other; "All types" clears the rest.
    await user.click(screen.getByRole('menuitemcheckbox', { name: t('knowledge.types.links') }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ type: 'note' }));
    await user.click(all);
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('type'));
    expect(trigger(t('knowledge.global.allTypes'))).toBeInTheDocument();
    expect(all).toHaveAttribute('aria-checked', 'true');
  });

  it('reads several types and an old single type from the URL', async () => {
    const { listCalls } = mockApi();
    renderPage('/knowledge?type=reminder,bogus,file&q=po');
    expect(
      await screen.findByRole('button', { name: t('knowledge.global.typesCount', { count: 2 }) }),
    ).toBeInTheDocument();
    await waitFor(() => expect(listCalls()).toContain('/api/knowledge?type=file%2Creminder&q=po'));
  });

  it('"From chat" lists flat without a search; the tasks-and-tickets box adds chats=all', async () => {
    const { listCalls } = mockApi();
    const { router, user } = renderPage('/knowledge?type=chat_file&clients=all');
    await waitFor(() => expect(listCalls()).toContain('/api/knowledge?scope=all&type=chat_file'));
    const box = await screen.findByRole('checkbox', {
      name: t('knowledge.chat.alsoTasksTickets'),
    });
    await user.click(box);
    await waitFor(() => expect(router.state.location.search).toMatchObject({ chats: 'all' }));
    await waitFor(() =>
      expect(listCalls()).toContain('/api/knowledge?scope=all&type=chat_file&chats=all'),
    );
  });

  it('the tasks-and-tickets box is hidden without "From chat"', async () => {
    mockApi();
    renderPage('/knowledge?type=note&q=po&chats=all');
    await screen.findByRole('button', { name: t('knowledge.types.notes') });
    expect(
      screen.queryByRole('checkbox', { name: t('knowledge.chat.alsoTasksTickets') }),
    ).not.toBeInTheDocument();
  });

  it('search writes ?q from 2 characters', async () => {
    mockApi();
    const { router, user } = renderPage('/knowledge');
    const field = await screen.findByRole('searchbox', { name: t('knowledge.global.search') });
    await user.type(field, 'p');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(router.state.location.search).not.toHaveProperty('q');
    await user.type(field, 'o');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'po' }));
  });

  it('search results show the group', async () => {
    mockApi();
    renderPage('/knowledge?q=portal');
    expect(await screen.findByText('Ministry call portal')).toBeInTheDocument();
    expect(screen.getAllByText('ABC s.r.o.').length).toBeGreaterThan(0);
  });

  it('clients cannot open /knowledge', async () => {
    const { listCalls } = mockApi(CLIENT);
    renderPage('/knowledge');
    expect(await screen.findByText(t('notFound.title'))).toBeInTheDocument();
    expect(listCalls()).toEqual([]);
  });

  it('Back that removes q keeps it removed', async () => {
    mockApi();
    const { router } = renderPage('/knowledge?q=portal');
    const field = await screen.findByRole('searchbox', { name: t('knowledge.global.search') });
    expect(field).toHaveValue('portal');
    await router.navigate({ to: '/knowledge', search: {} as never });
    await waitFor(() => expect(field).toHaveValue(''));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(router.state.location.search).not.toHaveProperty('q');
  });

  it('Back restores q in the field', async () => {
    mockApi();
    const { router, user } = renderPage('/knowledge');
    const field = await screen.findByRole('searchbox', { name: t('knowledge.global.search') });
    await router.navigate({ to: '/knowledge', search: { q: 'portal' } as never });
    await waitFor(() => expect(field).toHaveValue('portal'));
    router.history.back();
    await waitFor(() => expect(field).toHaveValue(''));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(router.state.location.search).not.toHaveProperty('q');
    await user.type(field, 'ab');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'ab' }));
  });

  it('All clients writes clients=all and asks for scope=all', async () => {
    const { listCalls } = mockApi();
    const { router, user } = renderPage('/knowledge?clients=g1&q=po');
    await user.click(
      await screen.findByRole('button', {
        name: t('knowledge.clientFilter.pillSelected', { count: 1 }),
      }),
    );
    await user.click(screen.getByRole('button', { name: t('knowledge.clientFilter.allClients') }));
    await user.click(screen.getByRole('button', { name: t('knowledge.clientFilter.done') }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ clients: 'all' }));
    expect(
      screen.getByRole('button', { name: t('knowledge.clientFilter.pillAll') }),
    ).toBeInTheDocument();
    await waitFor(() => expect(listCalls().at(-1)).toBe('/api/knowledge?scope=all&q=po'));
  });

  it('clients=all with managed clients asks for scope=all, not ids', async () => {
    const { listCalls } = mockApi(ADMIN, ['g1']);
    renderPage('/knowledge?clients=all&q=po');
    expect(
      await screen.findByRole('button', { name: t('knowledge.clientFilter.pillAll') }),
    ).toBeInTheDocument();
    await waitFor(() => expect(listCalls()).toEqual(['/api/knowledge?scope=all&q=po']));
  });

  it('the client pill waits for groups and scope', async () => {
    mockApi();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = globalThis.fetch as (url: string) => Promise<Response>;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === '/api/knowledge/scope') await gate;
      return base(url);
    });
    renderPage('/knowledge');
    expect(
      await screen.findByRole('button', { name: t('knowledge.clientFilter.pillAll') }),
    ).toBeDisabled();
    release();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: t('knowledge.clientFilter.pillAll') }),
      ).toBeEnabled(),
    );
  });

  describe('folder view', () => {
    it('lists the managed clients by default, by name', async () => {
      mockApi(ADMIN, ['g3', 'g1']);
      renderPage('/knowledge');
      const first = await screen.findByRole('button', {
        name: t('knowledge.folders.open', { name: 'ABC s.r.o.' }),
      });
      const second = screen.getByRole('button', {
        name: t('knowledge.folders.open', { name: 'Mesto Nitra' }),
      });
      expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: t('knowledge.folders.open', { name: 'Obec Lúčky' }) }),
      ).toBeNull();
    });

    it('opening a client shows its folders and top-level items with breadcrumbs', async () => {
      mockApi();
      const { router, user } = renderPage('/knowledge');
      await user.click(
        await screen.findByRole('button', {
          name: t('knowledge.folders.open', { name: 'ABC s.r.o.' }),
        }),
      );
      await waitFor(() => expect(router.state.location.search).toMatchObject({ at: 'g1' }));
      expect(await screen.findByText('Ministry call portal')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: t('knowledge.folders.open', { name: 'Grants' }) }),
      ).toBeInTheDocument();
      const crumbs = screen.getByRole('navigation', { name: t('knowledge.folders.path') });
      await user.click(
        within(crumbs).getByRole('button', { name: t('knowledge.folders.allClients') }),
      );
      await waitFor(() => expect(router.state.location.search).not.toHaveProperty('at'));
    });
  });
});
