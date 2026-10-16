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

const CLIENT = {
  id: 'u1',
  name: 'Jana',
  email: 'jana@example.com',
  role: 'client',
  groups: [{ id: 'g1', name: 'Firma', role: 'client', hasLogo: false, updatedAt: '' }],
};

type Reply = { status: number; body: unknown };
const json = (status: number, body: unknown): Reply => ({ status, body });

function mockApi(options: { info?: Reply; join?: Reply; loggedIn?: boolean; verify?: Reply } = {}) {
  const state = { loggedIn: options.loggedIn ?? false };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    let reply: Reply;
    if (url === '/api/me') {
      reply = state.loggedIn ? json(200, CLIENT) : json(401, { error: 'unauthorized' });
    } else if (url === '/api/join/tok') {
      // The info GET and the join POST share a path: tell them apart by method.
      reply =
        init?.method === 'POST'
          ? (options.join ?? json(200, { ok: true }))
          : (options.info ??
            json(200, {
              name: 'Firma s.r.o.',
              hasLogo: true,
              updatedAt: '2026-10-15T10:00:00.000Z',
            }));
    } else if (url === '/api/auth/email-otp/send-verification-otp') {
      reply = json(200, { success: true });
    } else if (url === '/api/auth/sign-in/email-otp') {
      reply = options.verify ?? json(200, { ok: true });
      if (reply.status === 200) state.loggedIn = true;
    } else {
      reply = json(404, {});
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  const posts = (path: string) =>
    (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][])
      .filter(([url, init]) => url === path && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as unknown);
  return { posts };
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

describe('join page', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('join page shows the group name and logo', async () => {
    mockApi();
    renderAt('/join/tok');
    expect(
      await screen.findByRole('heading', { name: t('join.title', { group: 'Firma s.r.o.' }) }),
    ).toBeInTheDocument();
    // Decorative (alt=""), so it has no accessible role.
    expect(document.querySelector('img[src*="/logo"]')).toHaveAttribute(
      'src',
      '/api/join/tok/logo?v=2026-10-15T10%3A00%3A00.000Z',
    );
    expect(screen.getByText(t('join.intro'))).toBeInTheDocument();
  });

  it('shows no logo when the group has none', async () => {
    mockApi({
      info: json(200, {
        name: 'Firma s.r.o.',
        hasLogo: false,
        updatedAt: '2026-10-15T10:00:00.000Z',
      }),
    });
    renderAt('/join/tok');
    await screen.findByRole('heading', { name: /Firma/ });
    expect(document.querySelector('img[src*="/logo"]')).toBeNull();
  });

  it('invalid token shows the invalid message and no form', async () => {
    mockApi({ info: json(404, { error: 'not_found' }) });
    renderAt('/join/tok');
    expect(await screen.findByText(t('join.invalid'))).toBeInTheDocument();
    expect(screen.queryByLabelText(t('login.email'))).toBeNull();
  });

  it('join sends the trimmed email, then the code step works like login', async () => {
    const api = mockApi();
    const { router, user } = renderAt('/join/tok');
    await user.type(await screen.findByLabelText(t('login.email')), '  new@example.com ');
    await user.click(screen.getByRole('button', { name: t('login.sendCode') }));
    const code = await screen.findByLabelText(t('login.code'));
    expect(api.posts('/api/join/tok')).toEqual([{ email: 'new@example.com' }]);
    expect(api.posts('/api/auth/email-otp/send-verification-otp')).toEqual([
      { email: 'new@example.com', type: 'sign-in' },
    ]);
    await user.type(code, '123456');
    expect(api.posts('/api/auth/sign-in/email-otp')).toEqual([
      { email: 'new@example.com', otp: '123456' },
    ]);
    // A client lands on their group.
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/chat'));
  });

  it('an invalid email sends nothing', async () => {
    const api = mockApi();
    const { user } = renderAt('/join/tok');
    await user.type(await screen.findByLabelText(t('login.email')), 'nope');
    await user.click(screen.getByRole('button', { name: t('login.sendCode') }));
    expect(await screen.findByText(t('login.errors.invalidEmail'))).toBeInTheDocument();
    expect(api.posts('/api/join/tok')).toEqual([]);
  });

  it('429 shows rateLimited', async () => {
    mockApi({ join: json(429, { error: 'rate_limited' }) });
    const { user } = renderAt('/join/tok');
    await user.type(await screen.findByLabelText(t('login.email')), 'new@example.com');
    await user.click(screen.getByRole('button', { name: t('login.sendCode') }));
    expect(await screen.findByText(t('join.errors.rateLimited'))).toBeInTheDocument();
    expect(screen.queryByLabelText(t('login.code'))).toBeNull();
  });

  it('a signed-in user opening the link goes to their group', async () => {
    mockApi({ loggedIn: true });
    const { router } = renderAt('/join/tok');
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/chat'));
  });
});
