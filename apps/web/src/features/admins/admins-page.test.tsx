import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

const ME = { id: 'a1', name: 'Jana Nováková', email: 'jana@example.com', role: 'admin' };
const SUPER = { id: 's1', name: 'Boss', email: 'boss@example.com', role: 'superadmin' };
const PETER = { id: 'a2', name: 'Peter Horváth', email: 'peter@example.com', role: 'admin' };

type Reply = { status: number; body?: unknown };

/** Fake `fetch` for /me and /admins; `post` and `del` answer the write calls. */
function mockApi(
  options: { me?: typeof ME | (typeof ME & { role: string }); post?: Reply; del?: Reply } = {},
) {
  const me = options.me ?? ME;
  const list = [SUPER, ME, PETER];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const reply = (r: Reply) =>
      new Response(r.body === undefined ? null : JSON.stringify(r.body), r);
    if (url === '/api/me') return reply({ status: 200, body: me });
    if (url === '/api/admins' && method === 'GET') return reply({ status: 200, body: list });
    if (url === '/api/admins' && method === 'POST') {
      return reply(
        options.post ?? {
          status: 201,
          body: { id: 'a3', name: 'Eva', email: 'eva@example.com', role: 'admin' },
        },
      );
    }
    if (url.startsWith('/api/admins/') && method === 'DELETE') {
      return reply(options.del ?? { status: 204 });
    }
    return reply({ status: 404, body: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
  const calls = (method: string, url: string) =>
    fetchMock.mock.calls.filter(
      ([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
    );
  return { calls };
}

function renderAdmins() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ['/admins'] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('admins page', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('lists admins with Superadmin and You badges', async () => {
    mockApi();
    renderAdmins();
    await screen.findByText('Peter Horváth');
    expect(within(rowOf('Boss')).getByText(t('admins.badge.superadmin'))).toBeInTheDocument();
    expect(within(rowOf('Jana Nováková')).getByText(t('admins.badge.you'))).toBeInTheDocument();
    expect(within(rowOf('Peter Horváth')).queryByText(t('admins.badge.you'))).toBeNull();
    expect(screen.getByText('peter@example.com')).toBeInTheDocument();
  });

  it('no Remove button on the superadmin or on yourself', async () => {
    mockApi();
    renderAdmins();
    await screen.findByText('Peter Horváth');
    const remove = t('admins.remove');
    expect(within(rowOf('Boss')).queryByRole('button', { name: remove })).toBeNull();
    expect(within(rowOf('Jana Nováková')).queryByRole('button', { name: remove })).toBeNull();
    expect(
      within(rowOf('Peter Horváth')).getByRole('button', { name: remove }),
    ).toBeInTheDocument();
  });

  it('add form validates name and email before sending', async () => {
    const { calls } = mockApi();
    const user = renderAdmins();
    await user.click(await screen.findByRole('button', { name: t('admins.add') }));
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));
    expect(await screen.findByText(t('admins.errors.nameRequired'))).toBeInTheDocument();

    await user.type(screen.getByLabelText(t('admins.name')), 'Eva');
    await user.type(screen.getByLabelText(t('admins.email')), 'not-an-email');
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));
    expect(await screen.findByText(t('login.errors.invalidEmail'))).toBeInTheDocument();
    expect(calls('POST', '/api/admins')).toHaveLength(0);
  });

  it('successful add shows "{name} was added." and refreshes the list', async () => {
    const { calls } = mockApi();
    const user = renderAdmins();
    await user.click(await screen.findByRole('button', { name: t('admins.add') }));
    await user.type(screen.getByLabelText(t('admins.name')), ' Eva ');
    await user.type(screen.getByLabelText(t('admins.email')), ' Eva@Example.com ');
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));

    expect(await screen.findByText(t('admins.added', { name: 'Eva' }))).toBeInTheDocument();
    const [, init] = calls('POST', '/api/admins')[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Eva', email: 'eva@example.com' });
    await waitFor(() => expect(calls('GET', '/api/admins')).toHaveLength(2));
    expect(screen.queryByLabelText(t('admins.name'))).toBeNull();
  });

  it.each([
    ['email_taken_admin', 'admins.errors.emailTakenAdmin'],
    ['email_taken_client', 'admins.errors.emailTakenClient'],
  ])('409 %s shows its message', async (code, key) => {
    mockApi({ post: { status: 409, body: { error: code } } });
    const user = renderAdmins();
    await user.click(await screen.findByRole('button', { name: t('admins.add') }));
    await user.type(screen.getByLabelText(t('admins.name')), 'Eva');
    await user.type(screen.getByLabelText(t('admins.email')), 'eva@example.com');
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));
    expect(await screen.findByText(t(key))).toBeInTheDocument();
  });

  it('Remove asks inline, Cancel restores the row, confirming calls DELETE and refreshes', async () => {
    const { calls } = mockApi();
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');

    await user.click(
      within(rowOf('Peter Horváth')).getByRole('button', { name: t('admins.remove') }),
    );
    expect(
      screen.getByText(t('admins.confirmRemove', { name: 'Peter Horváth' })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('admins.cancel') }));
    expect(screen.queryByText(t('admins.confirmRemove', { name: 'Peter Horváth' }))).toBeNull();
    expect(screen.getByText('peter@example.com')).toBeInTheDocument();

    await user.click(
      within(rowOf('Peter Horváth')).getByRole('button', { name: t('admins.remove') }),
    );
    await user.click(screen.getByRole('button', { name: t('admins.remove') }));
    await waitFor(() => expect(calls('DELETE', '/api/admins/a2')).toHaveLength(1));
    await waitFor(() => expect(calls('GET', '/api/admins')).toHaveLength(2));
  });

  it('a client visiting /admins sees the not-found page', async () => {
    mockApi({ me: { ...ME, role: 'client' } });
    renderAdmins();
    expect(await screen.findByText(t('notFound.title'))).toBeInTheDocument();
    expect(screen.queryByText(t('admins.title'))).toBeNull();
  });
});
