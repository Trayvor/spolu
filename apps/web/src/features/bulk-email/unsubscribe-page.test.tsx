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

const TOKEN = 'u1.c1.sig-_x';
type Reply = { status: number; body?: unknown };

function mockApi(options: { info?: Reply; unsubscribe?: Reply; subscribe?: Reply } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    let reply: Reply;
    if (url === '/api/me') reply = { status: 401, body: { error: 'unauthorized' } };
    else if (url === `/api/bulk-email/unsubscribe/${TOKEN}` && method === 'GET')
      reply = options.info ?? {
        status: 200,
        body: { language: 'en', subscribed: true, test: false },
      };
    else if (url === `/api/bulk-email/unsubscribe/${TOKEN}` && method === 'POST')
      reply = options.unsubscribe ?? { status: 204 };
    else if (url === `/api/bulk-email/subscribe/${TOKEN}` && method === 'POST')
      reply = options.subscribe ?? { status: 204 };
    else reply = { status: 404, body: {} };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const posts = (path: string) =>
    (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).filter(
      ([url, init]) => url === path && init?.method === 'POST',
    ).length;
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
  return { user: userEvent.setup() };
}

const t = (key: string) => i18n.t(key);

describe('unsubscribe page', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('posts unsubscribe once on load and shows the done text with Subscribe again', async () => {
    const api = mockApi();
    renderAt(`/unsubscribe/${TOKEN}`);
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.done.title') }),
    ).toBeInTheDocument();
    expect(screen.getByText(t('unsubscribe.done.body'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('unsubscribe.subscribeAgain') })).toBeVisible();
    expect(api.posts(`/api/bulk-email/unsubscribe/${TOKEN}`)).toBe(1);
  });

  it('Subscribe again posts subscribe and shows the subscribed text', async () => {
    const api = mockApi();
    const { user } = renderAt(`/unsubscribe/${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: t('unsubscribe.subscribeAgain') }));
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.subscribed.title') }),
    ).toBeInTheDocument();
    expect(api.posts(`/api/bulk-email/subscribe/${TOKEN}`)).toBe(1);
    // And back again, without reloading the page.
    await user.click(screen.getByRole('button', { name: t('unsubscribe.unsubscribeButton') }));
    expect(
      await screen.findByRole('heading', { name: t('unsubscribe.done.title') }),
    ).toBeInTheDocument();
    expect(api.posts(`/api/bulk-email/unsubscribe/${TOKEN}`)).toBe(2);
  });

  it('a test token shows the test text and posts nothing', async () => {
    const api = mockApi({
      info: { status: 200, body: { language: 'en', subscribed: true, test: true } },
    });
    renderAt(`/unsubscribe/${TOKEN}`);
    expect(await screen.findByText(t('unsubscribe.test'))).toBeInTheDocument();
    expect(api.posts(`/api/bulk-email/unsubscribe/${TOKEN}`)).toBe(0);
    expect(screen.queryByRole('button', { name: t('unsubscribe.subscribeAgain') })).toBeNull();
  });

  it('an invalid token shows the invalid text', async () => {
    const api = mockApi({ info: { status: 404, body: { error: 'not_found' } } });
    renderAt(`/unsubscribe/${TOKEN}`);
    expect(await screen.findByText(t('unsubscribe.invalid'))).toBeInTheDocument();
    expect(api.posts(`/api/bulk-email/unsubscribe/${TOKEN}`)).toBe(0);
  });

  it('a failed unsubscribe shows an error, not the done text', async () => {
    mockApi({ unsubscribe: { status: 429, body: { error: 'rate_limited' } } });
    renderAt(`/unsubscribe/${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('unsubscribe.errors.rateLimited'));
    expect(screen.queryByRole('heading', { name: t('unsubscribe.done.title') })).toBeNull();
  });

  it('switches to the language the API returns', async () => {
    mockApi({ info: { status: 200, body: { language: 'sk', subscribed: true, test: false } } });
    renderAt(`/unsubscribe/${TOKEN}`);
    await waitFor(() => expect(i18n.language).toBe('sk'));
    expect(
      await screen.findByRole('heading', { name: i18n.t('unsubscribe.done.title', { lng: 'sk' }) }),
    ).toBeInTheDocument();
  });
});
