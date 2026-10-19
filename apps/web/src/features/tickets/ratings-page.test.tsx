import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { TicketRatingListItem, TicketRatingSummary } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import { ADMIN, REQUESTER, fakeSocket, mockTicketApi, reply } from './test-api';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const row = (n: number, over: Partial<TicketRatingListItem> = {}): TicketRatingListItem => ({
  ticketId: `k${n}`,
  number: n,
  subject: `Subject ${n}`,
  groupId: 'g1',
  groupName: 'ABC s.r.o.',
  raterId: 'z1',
  raterName: 'Žofia',
  value: 'up',
  comment: null,
  ratedAt: '2026-10-16T10:00:00.000Z',
  ...over,
});

function renderRatings(
  me: unknown,
  opts: { summary?: TicketRatingSummary; pages?: Record<string, TicketRatingListItem[]> } = {},
  path = '/tickets/ratings',
) {
  const summary = opts.summary ?? { days: 30, up: 6, down: 2, resolved: 10, rated: 8 };
  const pages = opts.pages ?? { first: [row(1, { comment: 'Pekne' }), row(2, { value: 'down' })] };
  const api = mockTicketApi(me, [
    (url) => (url.pathname === '/api/tickets/ratings/summary' ? reply(200, summary) : undefined),
    (url) => {
      if (url.pathname !== '/api/tickets/ratings') return undefined;
      const cursor = url.searchParams.get('cursor');
      const items = pages[cursor ?? 'first'] ?? [];
      const nextCursor = cursor === null && pages.second ? 'second' : null;
      return reply(200, { items, nextCursor });
    },
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...api, router };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the ticket ratings view (2026-10-19)', () => {
  it('shows the four numbers and the list for the default 30 days', async () => {
    const { calls } = renderRatings(ADMIN);
    expect(
      await screen.findByRole('heading', { name: t('ticketRatings.title') }),
    ).toBeInTheDocument();
    const up = (await screen.findByText(t('ticketRatings.summary.up'), { selector: 'dt' }))
      .parentElement!;
    expect(up).toHaveTextContent('6');
    const satisfaction = screen.getByText(t('ticketRatings.summary.satisfaction'), {
      selector: 'dt',
    }).parentElement!;
    expect(satisfaction).toHaveTextContent('75%');
    const response = screen.getByText(t('ticketRatings.summary.response'), {
      selector: 'dt',
    }).parentElement!;
    expect(response).toHaveTextContent('80%');
    expect(await screen.findByRole('link', { name: '#1 Subject 1' })).toHaveAttribute(
      'href',
      '/tickets/k1',
    );
    expect(screen.getByText('Pekne')).toBeInTheDocument();
    expect(calls).toContain('GET /api/tickets/ratings/summary?days=30');
    expect(calls).toContain('GET /api/tickets/ratings?days=30');
  });

  it('the period, client and value filters go into the URL and refetch', async () => {
    const { calls, router } = renderRatings(ADMIN);
    await screen.findByRole('link', { name: '#1 Subject 1' });
    await userEvent.click(screen.getByRole('button', { name: t('ticketRatings.period.90') }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ days: 90 }));
    await waitFor(() => expect(calls).toContain('GET /api/tickets/ratings?days=90'));
    const values = screen.getByRole('group', { name: t('ticketRatings.value.label') });
    await userEvent.click(
      within(values).getByRole('button', { name: t('ticketRatings.value.down') }),
    );
    await waitFor(() => expect(calls).toContain('GET /api/tickets/ratings?days=90&value=down'));
    const select = screen.getByRole('combobox', { name: t('ticketRatings.client.label') });
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'ABC s.r.o.' })).toBeInTheDocument(),
    );
    await userEvent.selectOptions(select, 'g1');
    await waitFor(() =>
      expect(calls).toContain('GET /api/tickets/ratings?days=90&groupId=g1&value=down'),
    );
    expect(calls).toContain('GET /api/tickets/ratings/summary?days=90&groupId=g1');
    expect(router.state.location.search).toMatchObject({ days: 90, groupId: 'g1', value: 'down' });
  });

  it('"Zobraziť ďalšie" loads the next page', async () => {
    const first = Array.from({ length: 50 }, (_, i) => row(i + 1));
    renderRatings(ADMIN, { pages: { first, second: [row(99)] } });
    await screen.findByRole('link', { name: '#1 Subject 1' });
    await userEvent.click(screen.getByRole('button', { name: t('ticketRatings.more') }));
    expect(await screen.findByRole('link', { name: '#99 Subject 99' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('ticketRatings.more') })).toBeNull();
  });

  it('the satisfaction is "–" with no ratings, and the empty text shows', async () => {
    renderRatings(ADMIN, {
      summary: { days: 30, up: 0, down: 0, resolved: 0, rated: 0 },
      pages: { first: [] },
    });
    expect(await screen.findByText(t('ticketRatings.empty'))).toBeInTheDocument();
    const satisfaction = screen.getByText(t('ticketRatings.summary.satisfaction'), {
      selector: 'dt',
    }).parentElement!;
    await waitFor(() => expect(satisfaction).toHaveTextContent('–'));
  });

  it('a long comment expands on click', async () => {
    renderRatings(ADMIN, { pages: { first: [row(1, { comment: 'a\nb\nc\nd\ne' })] } });
    const comment = await screen.findByRole('button', { name: /^a\s+b/ });
    expect(comment).toHaveClass('line-clamp-3');
    await userEvent.click(comment);
    expect(comment).toHaveAttribute('aria-expanded', 'true');
    expect(comment).not.toHaveClass('line-clamp-3');
  });

  it('a non-admin gets the not-found page', async () => {
    const { calls } = renderRatings(REQUESTER);
    expect(await screen.findByRole('heading', { name: t('notFound.title') })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('ticketRatings.title') })).toBeNull();
    expect(calls.some((c) => c.startsWith('GET /api/tickets/ratings'))).toBe(false);
  });

  it('the global view links to Hodnotenia for admins', async () => {
    mockTicketApi(ADMIN, [
      (url) =>
        url.pathname === '/api/tickets/global'
          ? reply(200, { items: [], nextCursor: null })
          : undefined,
    ]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter(
      queryClient,
      createMemoryHistory({ initialEntries: ['/tickets'] }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('link', { name: t('tickets.global.ratingsLink') }),
    ).toHaveAttribute('href', '/tickets/ratings');
  });
});
