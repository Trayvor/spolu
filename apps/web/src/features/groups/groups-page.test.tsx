import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ADMIN = { id: 'a1', name: 'Jana', email: 'jana@example.com', role: 'admin', groupId: null };
const ACME = {
  id: 'g1',
  name: 'Acme',
  hasLogo: true,
  memberCount: 3,
  updatedAt: '2026-10-15T10:00:00.000Z',
};
const BETA = {
  id: 'g2',
  name: 'beta',
  hasLogo: false,
  memberCount: 0,
  updatedAt: '2026-10-15T11:00:00.000Z',
};

function mockApi(groups: unknown[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, ADMIN);
    if (url === '/api/groups' && (init?.method ?? 'GET') === 'GET') return reply(200, groups);
    if (url === '/api/groups' && init?.method === 'POST') {
      return reply(201, {
        id: 'g3',
        name: 'New',
        egrantUrl: 'https://new.egrant.sk',
        hasLogo: false,
        updatedAt: '2026-10-15T12:00:00.000Z',
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderGroups() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ['/groups'] }));
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

describe('groups page', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => vi.unstubAllGlobals());

  it('lists groups with logo or placeholder and member count', async () => {
    mockApi([ACME, BETA]);
    renderGroups();
    const acme = await screen.findByRole('link', { name: /Acme/ });
    expect(acme).toHaveAttribute('href', '/groups/g1');
    expect(acme).toHaveTextContent(t('groups.members', { count: 3 }));
    // Logo URL carries the version for cache-busting.
    expect(acme.querySelector('img')).toHaveAttribute(
      'src',
      '/api/groups/g1/logo?v=2026-10-15T10%3A00%3A00.000Z',
    );
    const beta = screen.getByRole('link', { name: /beta/ });
    expect(beta.querySelector('img')).toBeNull();
    expect(beta).toHaveTextContent('B'); // first-letter placeholder
  });

  it('shows the empty state', async () => {
    mockApi([]);
    renderGroups();
    expect(await screen.findByText(t('groups.empty'))).toBeInTheDocument();
  });

  it('Create group opens the inline form; saving closes it and refreshes the list', async () => {
    const fetchMock = mockApi([ACME]);
    const { user } = renderGroups();
    await user.click(await screen.findByRole('button', { name: t('groups.create') }));
    await user.type(screen.getByLabelText(t('groups.form.name')), 'New');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'https://new.egrant.sk');
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    await waitFor(() =>
      expect(screen.queryByLabelText(t('groups.form.name'))).not.toBeInTheDocument(),
    );
    const lists = fetchMock.mock.calls.filter(
      ([u, i]) => u === '/api/groups' && !(i as RequestInit | undefined)?.method,
    );
    expect(lists.length).toBeGreaterThanOrEqual(2);
  });
});
