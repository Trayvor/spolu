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

type Me = { id: string; name: string; email: string; role: string; groupId: string | null };
const client = (name: string): Me => ({
  id: 'u1',
  name,
  email: 'jana@example.com',
  role: 'client',
  groupId: 'g1',
});
const admin: Me = { id: 'a1', name: 'Eva', email: 'eva@example.com', role: 'admin', groupId: null };

function mockApi(me: Me | null, patchStatus = 200) {
  const patches: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/me' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { name: string };
        patches.push(body);
        return new Response(JSON.stringify({ ...me, name: body.name }), { status: patchStatus });
      }
      if (url === '/api/me') {
        return me
          ? new Response(JSON.stringify(me), { status: 200 })
          : new Response('{}', { status: 401 });
      }
      if (url === '/api/groups/g1') {
        const group = { id: 'g1', name: 'Acme', egrantUrl: 'https://a.egrant.sk', hasLogo: false };
        return new Response(JSON.stringify({ ...group, updatedAt: 'x' }), { status: 200 });
      }
      if (url === '/api/groups/g1/members') return new Response('[]', { status: 200 });
      return new Response('{}', { status: 404 });
    }),
  );
  return { patches };
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, user: userEvent.setup() };
}

const t = (key: string) => i18n.t(key);

describe('name step', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('a session with an empty name is sent to /welcome', async () => {
    mockApi(client('  '));
    const { router } = renderAt('/settings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'));
    expect(router.state.location.search).toEqual({ redirect: '/settings' });
    expect(await screen.findByLabelText(t('welcome.name'))).toBeInTheDocument();
  });

  it('name step saves the trimmed name and continues to the redirect', async () => {
    const api = mockApi(client(''));
    const { router, queryClient, user } = renderAt('/welcome?redirect=%2Fsettings');
    await user.type(await screen.findByLabelText(t('welcome.name')), '  Jana Nováková ');
    await user.click(screen.getByRole('button', { name: t('welcome.submit') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(api.patches).toEqual([{ name: 'Jana Nováková' }]);
    expect((queryClient.getQueryData(['session']) as Me).name).toBe('Jana Nováková');
  });

  it('a blank name shows the error and saves nothing', async () => {
    const api = mockApi(client(''));
    const { router, user } = renderAt('/welcome');
    await user.type(await screen.findByLabelText(t('welcome.name')), '   ');
    await user.click(screen.getByRole('button', { name: t('welcome.submit') }));
    expect(await screen.findByText(t('welcome.errors.nameRequired'))).toBeInTheDocument();
    expect(api.patches).toEqual([]);
    expect(router.state.location.pathname).toBe('/welcome');
  });

  it('a failed save shows the generic error', async () => {
    mockApi(client(''), 500);
    const { user } = renderAt('/welcome');
    await user.type(await screen.findByLabelText(t('welcome.name')), 'Jana');
    await user.click(screen.getByRole('button', { name: t('welcome.submit') }));
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument();
  });

  it('a foreign redirect target continues to /', async () => {
    mockApi(client(''));
    const { router, user } = renderAt('/welcome?redirect=%2F%2Fevil.example');
    await user.type(await screen.findByLabelText(t('welcome.name')), 'Jana');
    await user.click(screen.getByRole('button', { name: t('welcome.submit') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'));
  });

  it('an anonymous visitor to /welcome goes to login', async () => {
    mockApi(null);
    const { router } = renderAt('/welcome');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});

describe('home redirect', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('/ redirects a client to its group and an admin to /groups', async () => {
    mockApi(client('Jana'));
    const first = renderAt('/');
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/groups/g1'));
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument();

    mockApi(admin);
    const second = renderAt('/');
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/groups'));
  });

  it('a client without a group goes to /settings', async () => {
    mockApi({ ...client('Jana'), groupId: null });
    const { router } = renderAt('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });
});
