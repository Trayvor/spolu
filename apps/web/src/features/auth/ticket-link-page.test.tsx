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

// The ticket page's chunk starts importing the ProseMirror chat editor as soon as it runs (a
// deliberate prefetch in composer.tsx). Nothing here shows the editor, so stub it: otherwise that
// import is still running when the file's environment closes ("Vite module runner has been closed").
vi.mock('@/features/chat/editor/chat-editor', () => ({ default: () => null }));

const REQUESTER = {
  id: 'u1',
  name: '',
  email: 'jana@example.com',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'Firma', role: 'ziadatel', hasLogo: false, updatedAt: '' }],
};

type Reply = { status: number; body: unknown };
const json = (status: number, body: unknown): Reply => ({ status, body });

/** Fake `fetch`: `/api/me` is 401 until the link signs in; the ticket itself is never loaded here. */
function mockApi(link: Reply) {
  const state = { loggedIn: false, name: REQUESTER.name };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    let reply: Reply;
    if (url === '/api/me' && init?.method === 'PATCH') {
      state.name = (JSON.parse(String(init.body)) as { name: string }).name;
      reply = json(200, { ...REQUESTER, name: state.name });
    } else if (url === '/api/me') {
      reply = state.loggedIn
        ? json(200, { ...REQUESTER, name: state.name })
        : json(401, { error: 'unauthorized' });
    } else if (url === '/api/auth/ticket-link/sign-in') {
      reply = link;
      if (reply.status === 200) state.loggedIn = true;
    } else {
      reply = json(404, { error: 'not_found' });
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  const posts = () =>
    (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][])
      .filter(([url]) => url === '/api/auth/ticket-link/sign-in')
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

describe('ticket link page', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs in with the token from the fragment, asks for the name, then opens the ticket', async () => {
    const { posts } = mockApi(json(200, { ticketId: 't1' }));
    const { router, user } = renderAt('/t#tok-123');

    // The requester has no name yet: the welcome step comes first.
    const name = await screen.findByLabelText(t('welcome.name'));
    expect(posts()).toEqual([{ token: 'tok-123' }]);
    expect(router.state.location.pathname).toBe('/welcome');
    expect(router.state.location.search).toEqual({ redirect: '/tickets/t1' });

    await user.type(name, 'Jana');
    await user.click(screen.getByRole('button', { name: t('welcome.submit') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tickets/t1'));
    // The link page is not left in the history with its token.
    expect(router.history.location.hash).toBe('');
    // Let the lazy ticket screen finish loading (the fake API answers 404), so no import is still
    // in flight when the file's environment closes.
    expect(await screen.findByText(t('notFound.title'))).toBeInTheDocument();
  });

  it('an expired link goes to the login page with a notice and the email filled in', async () => {
    mockApi(json(400, { code: 'TICKET_LINK_INVALID', email: 'jana@example.com' }));
    const { router } = renderAt('/t#old');
    expect(await screen.findByText(t('login.linkExpired'))).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByLabelText(t('login.email'))).toHaveValue('jana@example.com');
  });

  it('without a token: the login page with the notice, and no request', async () => {
    const { posts } = mockApi(json(200, { ticketId: 't1' }));
    renderAt('/t');
    expect(await screen.findByText(t('login.linkExpired'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('login.email'))).toHaveValue('');
    expect(posts()).toEqual([]);
  });

  it('too many tries: says so and offers the login page', async () => {
    mockApi(json(429, { error: 'rate_limited' }));
    renderAt('/t#tok');
    expect(await screen.findByText(t('login.errors.tooMany'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('login.title') })).toHaveAttribute('href', '/login');
  });
});
