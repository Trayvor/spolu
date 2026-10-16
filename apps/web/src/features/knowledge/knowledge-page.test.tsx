import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

const ADMIN = { id: 'a1', name: 'Jana', email: 'jana@example.com', role: 'admin', groupId: null };
const CLIENT = { id: 'c1', name: 'Klient', email: 'k@example.com', role: 'client', groupId: 'g1' };
const GROUPS = [
  {
    id: 'g1',
    name: 'ABC s.r.o.',
    hasLogo: false,
    memberCount: 2,
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'g2',
    name: 'Obec Lúčky',
    hasLogo: false,
    memberCount: 3,
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'g3',
    name: 'Mesto Nitra',
    hasLogo: true,
    memberCount: 1,
    updatedAt: '2026-10-01T00:00:00Z',
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
  group: { id: 'g1', name: 'ABC s.r.o.', logoUrl: null },
};

function mockApi(me: typeof ADMIN | typeof CLIENT = ADMIN) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, me);
    if (url === '/api/groups') return reply(200, GROUPS);
    if (url === '/api/knowledge/scope') return reply(200, { managedGroupIds: null });
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
    renderPage('/knowledge?clients=g1,g3');
    expect(
      await screen.findByRole('button', {
        name: t('knowledge.clientFilter.pillSelected', { count: 2 }),
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(listCalls()).toContain('/api/knowledge?clients=g1%2Cg3'));
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
    await waitFor(() => expect(listCalls()).toContain('/api/knowledge?clients=g3'));
    expect(listCalls()).not.toContain('/api/knowledge');
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
    const { listCalls } = mockApi();
    const { user } = renderPage('/knowledge');
    expect(await screen.findByText('Ministry call portal')).toBeInTheDocument();
    expect(listCalls()).toContain('/api/knowledge');
    await user.click(screen.getByRole('button', { name: t('knowledge.clientFilter.pillAll') }));
    await user.click(screen.getByRole('checkbox', { name: 'Mesto Nitra' }));
    await user.click(screen.getByRole('button', { name: t('knowledge.clientFilter.done') }));
    expect(
      await screen.findByRole('button', {
        name: t('knowledge.clientFilter.pillSelected', { count: 2 }),
      }),
    ).toBeInTheDocument();
  });

  it('type menu writes ?type', async () => {
    const { listCalls } = mockApi();
    const { router, user } = renderPage('/knowledge');
    await user.click(await screen.findByRole('button', { name: t('knowledge.global.allTypes') }));
    await user.click(screen.getByRole('menuitemradio', { name: t('knowledge.types.links') }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ type: 'link' }));
    await waitFor(() => expect(listCalls()).toContain('/api/knowledge?type=link'));
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

  it('rows show the group', async () => {
    mockApi();
    renderPage('/knowledge');
    expect(await screen.findByText('Ministry call portal')).toBeInTheDocument();
    expect(screen.getAllByText('ABC s.r.o.').length).toBeGreaterThan(0);
  });

  it('clients cannot open /knowledge', async () => {
    const { listCalls } = mockApi(CLIENT);
    renderPage('/knowledge');
    expect(await screen.findByText(t('notFound.title'))).toBeInTheDocument();
    expect(listCalls()).toEqual([]);
  });
});
