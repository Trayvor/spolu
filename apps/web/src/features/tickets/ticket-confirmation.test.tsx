import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { TicketEvents, type TicketConfirmation, type TicketDto } from '@spolu/shared';
import { formatCreated } from '@/features/tasks/dates';
import { clearTimeAsks, useTimeAsk } from '@/features/tasks/time-queue';
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
const DONE_AT = '2026-11-01T10:00:00.000Z';
const RESOLVES_AT = '2026-11-06T10:00:00.000Z';

const inProgress = (
  confirmation: Partial<TicketConfirmation> = {},
  over: Partial<TicketDto> = {},
) =>
  ticket({
    status: 'in_progress',
    ratings: [],
    ...over,
    confirmation: {
      adminDoneAt: null,
      resolvesAt: null,
      canMarkDone: false,
      canConfirm: false,
      canDecline: false,
      ...confirmation,
    },
  });
const MARK = { adminDoneAt: DONE_AT, resolvesAt: RESOLVES_AT };
const forAdmin = () => inProgress({ canMarkDone: true });
const awaitingAdmin = () => inProgress(MARK);
const forAuthor = () => inProgress({ canConfirm: true });
const awaitingAuthor = () => inProgress({ ...MARK, canConfirm: true, canDecline: true });

type Answer = (action: string) => Response | Promise<Response>;

/** The ticket page. Each `POST …/k1/<action>` answers `answer`; the GET serves `current.dto`. */
function renderTicket(me: unknown, dto: TicketDto, answer?: Answer, path = '/tickets/k1') {
  const current = { dto };
  const api = mockTicketApi(me, [
    (url, init) => {
      const action = /^\/api\/tickets\/k1\/(admin-done|confirm|decline)$/.exec(url.pathname)?.[1];
      if (!action || init?.method !== 'POST') return undefined;
      return answer ? answer(action) : reply(200, current.dto);
    },
    (url, init) =>
      url.pathname === '/api/tickets/k1' && (init?.method ?? 'GET') === 'GET'
        ? reply(200, current.dto)
        : undefined,
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const posts = () =>
    api.calls.filter((call) => /^POST .*\/(admin-done|confirm|decline)$/.test(call));
  return { ...api, current, posts, router };
}

const page = () => screen.findByRole('heading', { name: 'Cannot submit the application' });
const button = (name: string) => screen.findByRole('button', { name });
const noButton = (name: string) => expect(screen.queryByRole('button', { name })).toBeNull();
const date = () => formatCreated(RESOLVES_AT, i18n.language);
const waiting = () => t('tickets.confirmation.waiting', { date: date() });

afterEach(() => {
  cleanup();
  clearTimeAsks();
  vi.unstubAllGlobals();
});

describe('the confirmation bar for an admin (design 5.5)', () => {
  it('in progress with no mark: "Solved on our side", which marks the ticket', async () => {
    const { posts } = renderTicket(ADMIN, forAdmin(), () => reply(200, awaitingAdmin()));
    await userEvent.click(await button(t('tickets.confirmation.markDone')));
    await waitFor(() => expect(posts()).toEqual(['POST /api/tickets/k1/admin-done']));
    expect(await screen.findByText(waiting())).toBeInTheDocument();
    noButton(t('tickets.confirmation.markDone'));
  });

  it('the answer saying askTime asks for the time, as a resolve does', async () => {
    renderTicket(ADMIN, forAdmin(), () => reply(200, { ...awaitingAdmin(), askTime: true }));
    const queue = renderHook(() => useTimeAsk());
    await userEvent.click(await button(t('tickets.confirmation.markDone')));
    await waitFor(() =>
      expect(queue.result.current).toEqual({
        kind: 'ticket',
        id: 'k1',
        groupId: 'g1',
        title: '#123 Cannot submit the application',
      }),
    );
  });

  it('an answer without askTime asks nothing', async () => {
    renderTicket(ADMIN, forAdmin(), () => reply(200, { ...awaitingAdmin(), askTime: false }));
    const queue = renderHook(() => useTimeAsk());
    await userEvent.click(await button(t('tickets.confirmation.markDone')));
    await screen.findByText(waiting());
    expect(queue.result.current).toBeUndefined();
  });

  it('awaiting confirmation: the line with the date and no button', async () => {
    renderTicket(ADMIN, awaitingAdmin());
    expect(await screen.findByText(waiting())).toBeInTheDocument();
    noButton(t('tickets.confirmation.markDone'));
    noButton(t('tickets.confirmation.yes'));
  });

  it('sits outside the folded details, so a phone shows it', async () => {
    renderTicket(ADMIN, forAdmin());
    const mark = await button(t('tickets.confirmation.markDone'));
    expect(mark.closest('details')).toBeNull();
    expect(mark.closest('aside')).toBeNull();
  });
});

describe('the confirmation bar for the author (design 5.5)', () => {
  it('in progress with no mark: "Solved", which confirms', async () => {
    const { posts } = renderTicket(REQUESTER, forAuthor());
    await userEvent.click(await button(t('tickets.confirmation.solved')));
    await waitFor(() => expect(posts()).toEqual(['POST /api/tickets/k1/confirm']));
    noButton(t('tickets.confirmation.yes'));
  });

  it('awaiting confirmation: the card with both answers and the automatic end', async () => {
    renderTicket(REQUESTER, awaitingAuthor());
    expect(
      await screen.findByRole('heading', { name: t('tickets.confirmation.title') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('tickets.confirmation.yes') })).toBeEnabled();
    expect(screen.getByRole('button', { name: t('tickets.confirmation.no') })).toBeEnabled();
    expect(screen.getByText(t('tickets.confirmation.hint', { date: date() }))).toBeInTheDocument();
    expect(screen.queryByText(waiting())).toBeNull();
    noButton(t('tickets.confirmation.solved'));
  });

  it('"Yes, solved" confirms', async () => {
    const { posts } = renderTicket(REQUESTER, awaitingAuthor());
    await userEvent.click(await button(t('tickets.confirmation.yes')));
    await waitFor(() => expect(posts()).toEqual(['POST /api/tickets/k1/confirm']));
  });

  it('"Not solved yet" declines', async () => {
    const { posts } = renderTicket(REQUESTER, awaitingAuthor());
    await userEvent.click(await button(t('tickets.confirmation.no')));
    await waitFor(() => expect(posts()).toEqual(['POST /api/tickets/k1/decline']));
  });
});

describe('who sees nothing', () => {
  it('another client of the group, with or without a mark', async () => {
    renderTicket(CLIENT, inProgress(MARK));
    await page();
    expect(screen.queryByText(waiting())).toBeNull();
    expect(screen.queryByRole('heading', { name: t('tickets.confirmation.title') })).toBeNull();
    noButton(t('tickets.confirmation.solved'));
    noButton(t('tickets.confirmation.markDone'));
  });

  it('nobody on a resolved ticket; the rating card stays', async () => {
    renderTicket(
      REQUESTER,
      ticket({
        status: 'resolved',
        resolvedAt: DONE_AT,
        rating: { mine: null, canRate: true, editableUntil: RESOLVES_AT },
      }),
    );
    expect(await button(t('tickets.rating.up'))).toBeInTheDocument();
    noButton(t('tickets.confirmation.solved'));
    noButton(t('tickets.confirmation.yes'));
  });
});

describe('?confirm=1 (design 5.5)', () => {
  it('scrolls to the card, focuses its first button, leaves the URL and sends nothing', async () => {
    const { posts, router } = renderTicket(
      REQUESTER,
      awaitingAuthor(),
      undefined,
      '/tickets/k1?confirm=1',
    );
    const yes = await button(t('tickets.confirmation.yes'));
    await waitFor(() => expect(yes).toHaveFocus());
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('confirm'));
    expect(posts()).toEqual([]);
  });

  it('for someone with no card it only leaves the URL', async () => {
    const { posts, router } = renderTicket(
      ADMIN,
      awaitingAdmin(),
      undefined,
      '/tickets/k1?confirm=1',
    );
    await screen.findByText(waiting());
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('confirm'));
    expect(posts()).toEqual([]);
  });
});

describe('a failed action', () => {
  it('shows the generic error and the button comes back', async () => {
    renderTicket(REQUESTER, awaitingAuthor(), () => reply(500, { error: 'boom' }));
    await userEvent.click(await button(t('tickets.confirmation.yes')));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.generic'));
    expect(screen.getByRole('button', { name: t('tickets.confirmation.yes') })).toBeEnabled();
  });

  it('a 409 refetches the ticket and says it changed', async () => {
    const view = renderTicket(ADMIN, forAdmin(), () => {
      view.current.dto = awaitingAdmin();
      return reply(409, { error: 'invalid_ticket_state' });
    });
    await userEvent.click(await button(t('tickets.confirmation.markDone')));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('tickets.confirmation.changed'));
    expect(await screen.findByText(waiting())).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(t('tickets.confirmation.changed'));
  });

  it('a 409 stays readable when the ticket has nothing left to show here', async () => {
    const view = renderTicket(REQUESTER, awaitingAuthor(), () => {
      view.current.dto = ticket({ status: 'resolved', resolvedAt: DONE_AT });
      return reply(409, { error: 'invalid_ticket_state' });
    });
    await userEvent.click(await button(t('tickets.confirmation.yes')));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: t('tickets.confirmation.title') })).toBeNull(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(t('tickets.confirmation.changed'));
  });
});

describe('while an action is out', () => {
  /** An answer the test releases, so the action stays out as long as it needs. */
  function held(dto: TicketDto) {
    let finish = () => {};
    const answer = new Promise<Response>((resolve) => {
      finish = () => resolve(reply(200, dto));
    });
    return { answer: () => answer, finish: () => finish() };
  }

  it('a double click sends one request', async () => {
    const dto = awaitingAuthor();
    const response = held(dto);
    const { posts } = renderTicket(REQUESTER, dto, response.answer);
    const yes = await button(t('tickets.confirmation.yes'));
    act(() => {
      yes.click();
      yes.click();
    });
    await waitFor(() => expect(posts()).toHaveLength(1));
    await act(async () => response.finish());
    await waitFor(() => expect(yes).toBeEnabled());
    expect(posts()).toHaveLength(1);
  });

  it('both answers are disabled', async () => {
    const dto = awaitingAuthor();
    const response = held(dto);
    renderTicket(REQUESTER, dto, response.answer);
    await userEvent.click(await button(t('tickets.confirmation.yes')));
    expect(screen.getByRole('button', { name: t('tickets.confirmation.yes') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('tickets.confirmation.no') })).toBeDisabled();
    await act(async () => response.finish());
  });
});

describe('live updates', () => {
  it('ticket:updated moves the bar without a reload', async () => {
    const view = renderTicket(ADMIN, forAdmin());
    await button(t('tickets.confirmation.markDone'));
    view.current.dto = awaitingAdmin();
    act(() => socket.fire(TicketEvents.updated, { ticketId: 'k1', groupId: 'g1' }));
    expect(await screen.findByText(waiting())).toBeInTheDocument();
    noButton(t('tickets.confirmation.markDone'));
  });

  it('the card goes when the mark is cleared elsewhere', async () => {
    const view = renderTicket(REQUESTER, awaitingAuthor());
    await button(t('tickets.confirmation.yes'));
    view.current.dto = forAuthor();
    act(() => socket.fire(TicketEvents.updated, { ticketId: 'k1', groupId: 'g1' }));
    expect(await button(t('tickets.confirmation.solved'))).toBeInTheDocument();
    noButton(t('tickets.confirmation.yes'));
  });
});
