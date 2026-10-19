import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { TicketDto, TicketRating } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import { ADMIN, CLIENT, REQUESTER, fakeSocket, mockTicketApi, reply, ticket } from './test-api';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);
const RESOLVED = '2026-10-16T10:00:00.000Z';
const UNTIL = '2026-10-30T10:00:00.000Z';

const resolved = (over: Partial<TicketDto> = {}) =>
  ticket({ status: 'resolved', resolvedAt: RESOLVED, ...over });
const canRate = (mine: TicketRating | null = null) =>
  resolved({ rating: { mine, canRate: true, editableUntil: UNTIL } });
const rated = (value: 'up' | 'down', comment: string | null = null): TicketRating => ({
  value,
  comment,
  ratedAt: RESOLVED,
});

/** The ticket page; `PUT …/rating` answers `answer(body)` and the GET serves the latest copy. */
function renderTicket(
  me: unknown,
  dto: TicketDto,
  answer?: (body: Record<string, unknown>) => Response,
  path = '/tickets/k1',
) {
  let current = dto;
  const bodies: Record<string, unknown>[] = [];
  const api = mockTicketApi(me, [
    (url, init) => {
      if (url.pathname !== '/api/tickets/k1/rating' || init?.method !== 'PUT') return undefined;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      if (answer) return answer(body);
      const comment =
        'comment' in body
          ? (body.comment as string | null) || null
          : (current.rating.mine?.comment ?? null);
      current = {
        ...current,
        rating: {
          ...current.rating,
          mine: { value: body.value as 'up' | 'down', comment, ratedAt: RESOLVED },
        },
      };
      return reply(200, current);
    },
    (url, init) =>
      url.pathname === '/api/tickets/k1' && (init?.method ?? 'GET') === 'GET'
        ? reply(200, current)
        : undefined,
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...api, bodies, router };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const button = (name: string) => screen.findByRole('button', { name });

describe('the rating card (2026-10-19)', () => {
  it('shows the question and two buttons when the viewer can rate', async () => {
    renderTicket(REQUESTER, canRate());
    expect(
      await screen.findByRole('heading', { name: t('tickets.rating.title') }),
    ).toBeInTheDocument();
    expect(screen.getByText(t('tickets.rating.intro'))).toBeInTheDocument();
    expect(await button(t('tickets.rating.up'))).toHaveAttribute('aria-pressed', 'false');
    expect(await button(t('tickets.rating.down'))).toHaveAttribute('aria-pressed', 'false');
  });

  it('a click on Nepomohlo sends PUT { value: "down" } at once and opens the comment field', async () => {
    const { bodies } = renderTicket(REQUESTER, canRate());
    await userEvent.click(await button(t('tickets.rating.down')));
    await waitFor(() => expect(bodies).toEqual([{ value: 'down' }]));
    expect(await screen.findByLabelText(t('tickets.rating.commentLabel'))).toBeInTheDocument();
    expect(screen.getByText(t('tickets.rating.commentHint'))).toBeInTheDocument();
    expect(await button(t('tickets.rating.down'))).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends the comment, then shows the thanks and the date until which it can change', async () => {
    const { bodies } = renderTicket(REQUESTER, canRate());
    await userEvent.click(await button(t('tickets.rating.up')));
    const field = await screen.findByLabelText(t('tickets.rating.commentLabel'));
    expect(await button(t('tickets.rating.send'))).toBeDisabled();
    await userEvent.type(field, 'Super');
    await userEvent.click(await button(t('tickets.rating.send')));
    await waitFor(() => expect(bodies[1]).toEqual({ value: 'up', comment: 'Super' }));
    expect(
      await screen.findByRole('heading', { name: t('tickets.rating.thanks') }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Super')).toBeInTheDocument();
    expect(screen.queryByLabelText(t('tickets.rating.commentLabel'))).toBeNull();
    expect(screen.getByText(/30/)).toHaveTextContent(/2026/);
  });

  it('Upraviť reopens the field with the stored comment; Zrušiť closes it without a request', async () => {
    const { bodies } = renderTicket(REQUESTER, canRate(rated('up', 'Fajn')));
    await userEvent.click(await button(t('tickets.rating.edit')));
    expect(await screen.findByLabelText(t('tickets.rating.commentLabel'))).toHaveValue('Fajn');
    await userEvent.click(await button(t('tickets.rating.cancel')));
    expect(screen.queryByLabelText(t('tickets.rating.commentLabel'))).toBeNull();
    expect(bodies).toEqual([]);
  });

  it('read-only after the window: "Vaše hodnotenie: Pomohlo", no buttons', async () => {
    renderTicket(
      REQUESTER,
      resolved({ rating: { mine: rated('up', 'Dobré'), canRate: false, editableUntil: null } }),
    );
    expect(
      await screen.findByText(t('tickets.rating.yours', { value: t('tickets.rating.up') })),
    ).toBeInTheDocument();
    expect(screen.getByText('Dobré')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('tickets.rating.down') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('tickets.rating.edit') })).toBeNull();
  });

  it('renders nothing for a viewer who cannot rate and has no rating', async () => {
    renderTicket(CLIENT, resolved());
    await screen.findByRole('heading', { name: 'Cannot submit the application' });
    expect(screen.queryByRole('heading', { name: t('tickets.rating.title') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('tickets.rating.up') })).toBeNull();
  });

  it('a 409 rating_closed shows the closed text and refetches the ticket', async () => {
    const { calls } = renderTicket(REQUESTER, canRate(), () =>
      reply(409, { error: 'rating_closed' }),
    );
    await screen.findByRole('heading', { name: t('tickets.rating.title') });
    const before = calls.filter((c) => c === 'GET /api/tickets/k1').length;
    await userEvent.click(await button(t('tickets.rating.up')));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('tickets.rating.closed'));
    await waitFor(() =>
      expect(calls.filter((c) => c === 'GET /api/tickets/k1').length).toBeGreaterThan(before),
    );
  });

  it('another refusal shows the save error', async () => {
    renderTicket(REQUESTER, canRate(), () => reply(500, { error: 'boom' }));
    await userEvent.click(await button(t('tickets.rating.up')));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('tickets.rating.saveFailed'));
  });

  it('a comment with <b>tags</b> and a link shows as plain text', async () => {
    const text = '<b>tags</b> https://evil.example';
    renderTicket(REQUESTER, canRate(rated('down', text)));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(document.querySelector('#ticket-rating b')).toBeNull();
    expect(document.querySelector('#ticket-rating a')).toBeNull();
  });

  it('?rate=1 scrolls to the card, focuses its first button and leaves the URL', async () => {
    const { router } = renderTicket(REQUESTER, canRate(), undefined, '/tickets/k1?rate=1');
    const up = await button(t('tickets.rating.up'));
    await waitFor(() => expect(up).toHaveFocus());
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('rate'));
  });

  it('?rate=1 does nothing for an admin', async () => {
    const { router } = renderTicket(
      ADMIN,
      resolved({ ratings: [] }),
      undefined,
      '/tickets/k1?rate=1',
    );
    await screen.findByRole('heading', { name: 'Cannot submit the application' });
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('rate'));
    expect(screen.queryByRole('button', { name: t('tickets.rating.up') })).toBeNull();
  });
});

describe('the ratings row for admins (2026-10-19)', () => {
  it('an admin sees each rating with the name, the date and the comment under Vyriešený', async () => {
    renderTicket(
      ADMIN,
      resolved({
        ratings: [{ ...rated('down', 'Riadok 1\nRiadok 2'), userId: 'z1', name: 'Žofia' }],
      }),
    );
    expect(await screen.findByText(t('tickets.rating.row'))).toBeInTheDocument();
    expect(screen.getByText(/^Žofia · /)).toBeInTheDocument();
    const comment = screen.getByText(/Riadok 1/);
    expect(comment).toHaveClass('whitespace-pre-line');
    expect(comment.textContent).toBe('Riadok 1\nRiadok 2');
  });

  it('a resolved ticket without ratings shows "Zatiaľ bez hodnotenia" to an admin', async () => {
    renderTicket(ADMIN, resolved({ ratings: [] }));
    expect(await screen.findByText(t('tickets.rating.none'))).toBeInTheDocument();
  });

  it('a client of the group never sees the row (ratings null)', async () => {
    renderTicket(CLIENT, resolved());
    await screen.findByRole('heading', { name: 'Cannot submit the application' });
    expect(screen.queryByText(t('tickets.rating.row'))).toBeNull();
  });

  it('ticket:rated refetches the open ticket', async () => {
    const { calls } = renderTicket(ADMIN, resolved({ ratings: [] }));
    await screen.findByText(t('tickets.rating.none'));
    const before = calls.filter((c) => c === 'GET /api/tickets/k1').length;
    socket.fire('ticket:rated', { ticketId: 'k1', groupId: 'g1' });
    await waitFor(() =>
      expect(calls.filter((c) => c === 'GET /api/tickets/k1').length).toBeGreaterThan(before),
    );
  });
});
