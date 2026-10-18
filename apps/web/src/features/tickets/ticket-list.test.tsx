import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import { ADMIN, CLIENT, fakeSocket, item, mockTicketApi, reply, ticket } from './test-api';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const groupRoutes = (items = [item({ id: 'k1' })]) => [
  (url: URL) =>
    url.pathname === '/api/groups/g1'
      ? reply(200, { id: 'g1', name: 'ABC s.r.o.', egrantUrl: '', hasLogo: false, updatedAt: '' })
      : undefined,
  (url: URL) =>
    url.pathname === '/api/groups/g1/tickets' ? reply(200, { items, nextCursor: null }) : undefined,
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ticket lists', () => {
  it('default filter shows Open (new + in_progress)', async () => {
    const { calls } = mockTicketApi(CLIENT, groupRoutes());
    renderAt('/groups/g1/tickets');
    expect(await screen.findByText('Ticket k1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('tickets.filters.open') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // No status parameter: the server's default is Open.
    expect(calls).toContain('GET /api/groups/g1/tickets');
    await userEvent.click(screen.getByRole('button', { name: t('tickets.filters.resolved') }));
    await waitFor(() => expect(calls).toContain('GET /api/groups/g1/tickets?status=resolved'));
  });

  it('a row with an unseen change: a bold title and a yellow marker beside its link (2026-10-18)', async () => {
    mockTicketApi(
      CLIENT,
      groupRoutes([
        item({ id: 'new', subject: 'Changed', unseen: 'change' }),
        item({ id: 'msg', subject: 'Answered', unseen: 'message' }),
        item({ id: 'old', subject: 'Quiet' }),
      ]),
    );
    renderAt('/groups/g1/tickets');
    const changed = (await screen.findByText('Changed')).closest('li')!;
    const answered = screen.getByText('Answered').closest('li')!;
    const quiet = screen.getByText('Quiet').closest('li')!;
    expect(screen.getByText('Changed')).toHaveClass('font-bold');
    const marker = within(changed).getByRole('button', { name: t('unseen.mark.change') });
    // A sibling of the link, never inside it.
    expect(marker.closest('a')).toBeNull();
    expect(within(marker).getByTestId('unseen-dot')).toBeInTheDocument();
    expect(
      within(within(answered).getByRole('button', { name: t('unseen.mark.message') })).getByTestId(
        'unseen-ring',
      ),
    ).toBeInTheDocument();
    expect(within(quiet).queryByRole('button')).toBeNull();
  });

  it('overdue due date is red only when not resolved', async () => {
    mockTicketApi(
      CLIENT,
      groupRoutes([
        item({ id: 'late', subject: 'Late', dueDate: '2020-01-01', status: 'in_progress' }),
        item({ id: 'done', subject: 'Done', dueDate: '2020-01-01', status: 'resolved' }),
      ]),
    );
    renderAt('/groups/g1/tickets');
    const late = (await screen.findByText('Late')).closest('a')!;
    const done = screen.getByText('Done').closest('a')!;
    expect(within(late).getAllByText(/Overdue since/).length).toBeGreaterThan(0);
    expect(late.querySelector('.text-error-ink')).not.toBeNull();
    expect(done.querySelector('.text-error-ink')).toBeNull();
    expect(within(done).queryByText(/Overdue since/)).toBeNull();
  });

  it('has no "Following" filter and drops an old following param from the URL', async () => {
    const { calls } = mockTicketApi(CLIENT, groupRoutes());
    renderAt('/groups/g1/tickets?following=1');
    await screen.findByText('Ticket k1');
    expect(screen.queryByRole('button', { name: 'Following' })).toBeNull();
    expect(calls.filter((c) => c.startsWith('GET /api/groups/g1/tickets'))).toEqual([
      'GET /api/groups/g1/tickets',
    ]);
  });

  it('a group tab remembers its filters for the next visit; Clear filters forgets them', async () => {
    const first = mockTicketApi(CLIENT, groupRoutes());
    renderAt('/groups/g1/tickets');
    await screen.findByText('Ticket k1');
    expect(screen.queryByRole('button', { name: t('tickets.filters.clear') })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: t('tickets.filters.resolved') }));
    await waitFor(() =>
      expect(first.calls).toContain('GET /api/groups/g1/tickets?status=resolved'),
    );
    cleanup();

    const second = mockTicketApi(CLIENT, groupRoutes());
    const router = renderAt('/groups/g1/tickets');
    await screen.findByText('Ticket k1');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ status: 'resolved' }));
    // The first request already had the remembered filter.
    expect(second.calls.filter((c) => c.startsWith('GET /api/groups/g1/tickets'))).toEqual([
      'GET /api/groups/g1/tickets?status=resolved',
    ]);
    await userEvent.click(screen.getByRole('button', { name: t('tickets.filters.clear') }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    cleanup();

    const third = mockTicketApi(CLIENT, groupRoutes());
    renderAt('/groups/g1/tickets');
    await screen.findByText('Ticket k1');
    expect(third.calls.filter((c) => c.startsWith('GET /api/groups/g1/tickets'))).toEqual([
      'GET /api/groups/g1/tickets',
    ]);
  });

  it('the riešiteľ filter sends assignee=me and the rows show the riešitelia', async () => {
    const { calls } = mockTicketApi(
      CLIENT,
      groupRoutes([item({ id: 'k1', assignees: [{ id: 'a1', name: 'Ada Admin' }] })]),
    );
    renderAt('/groups/g1/tickets');
    await screen.findByText('Ticket k1');
    expect(
      screen.getByText(t('tickets.row.assignees', { names: 'Ada Admin' })),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: t('tickets.filters.assignee', { name: t('tickets.filters.assignees.anyone') }),
      }),
    );
    await userEvent.click(
      await screen.findByRole('menuitemradio', { name: t('tickets.filters.assignees.me') }),
    );
    await waitFor(() => expect(calls).toContain('GET /api/groups/g1/tickets?assignee=me'));
  });

  it('the Tickets tab has "Watch tickets", saved at once', async () => {
    const { calls, fetchMock } = mockTicketApi(CLIENT, [
      ...groupRoutes(),
      (url, init) =>
        url.pathname === '/api/groups/g1/ticket-watch'
          ? reply(200, init?.method === 'PUT' ? { watching: false } : { watching: true })
          : undefined,
    ]);
    renderAt('/groups/g1/tickets');
    const box = await screen.findByRole('checkbox', { name: t('tickets.watch.label') });
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByText(t('tickets.watch.on'))).toBeInTheDocument();
    await userEvent.click(box);
    await waitFor(() => expect(calls).toContain('PUT /api/groups/g1/ticket-watch'));
    const put = fetchMock.mock.calls.find(
      ([url, init]) => init?.method === 'PUT' && url.endsWith('/ticket-watch'),
    )!;
    expect(JSON.parse(put[1]!.body as string)).toEqual({ watching: false });
    await waitFor(() => expect(box).not.toBeChecked());
    expect(screen.getByText(t('tickets.watch.off'))).toBeInTheDocument();
  });

  it('global view has the client filter with "Without client"', async () => {
    const { calls } = mockTicketApi(ADMIN, [
      (url) =>
        url.pathname === '/api/tickets/global'
          ? reply(200, {
              items: [item({ id: 'k1', groupId: null, groupName: null })],
              nextCursor: null,
            })
          : undefined,
    ]);
    renderAt('/tickets');
    expect(await screen.findByRole('heading', { name: t('tickets.global.title') })).toBeVisible();
    expect(await screen.findByText(t('tickets.row.noClient'))).toBeInTheDocument();
    expect(calls).toContain('GET /api/tickets/global');
    await userEvent.click(screen.getByRole('button', { name: t('tickets.filters.noClient') }));
    await waitFor(() => expect(calls).toContain('GET /api/tickets/global?scope=none'));
    expect(screen.getByRole('button', { name: t('tickets.filters.noClient') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('rows update on ticket:updated without refetching the page', async () => {
    const { calls } = mockTicketApi(CLIENT, [
      ...groupRoutes([item({ id: 'k1', subject: 'Before' })]),
      (url) =>
        url.pathname === '/api/tickets/k1'
          ? reply(200, ticket({ id: 'k1', subject: 'After', status: 'in_progress' }))
          : undefined,
    ]);
    renderAt('/groups/g1/tickets');
    await screen.findByText('Before');
    const listCalls = () => calls.filter((c) => c.startsWith('GET /api/groups/g1/tickets')).length;
    const before = listCalls();
    act(() => socket.fire('ticket:updated', { ticketId: 'k1', groupId: 'g1' }));
    expect(await screen.findByText('After')).toBeInTheDocument();
    expect(screen.getByText(t('tickets.status.in_progress'))).toBeInTheDocument();
    expect(listCalls()).toBe(before);
  });

  it('a ticket changed while nobody views it gets its unseen mark by a coalesced list refetch', async () => {
    let unseen = false;
    const { calls } = mockTicketApi(CLIENT, [
      (url: URL) =>
        url.pathname === '/api/groups/g1'
          ? reply(200, {
              id: 'g1',
              name: 'ABC s.r.o.',
              egrantUrl: '',
              hasLogo: false,
              updatedAt: '',
            })
          : undefined,
      (url: URL) =>
        url.pathname === '/api/groups/g1/tickets'
          ? reply(200, {
              items: [item({ id: 'k1', unseen: unseen ? 'change' : null })],
              nextCursor: null,
            })
          : undefined,
      (url: URL) =>
        url.pathname === '/api/tickets/k1' ? reply(200, ticket({ id: 'k1' })) : undefined,
    ]);
    renderAt('/groups/g1/tickets');
    await screen.findByText('Ticket k1');
    expect(screen.queryByTestId('unseen-dot')).toBeNull();
    const listCalls = () => calls.filter((c) => c.startsWith('GET /api/groups/g1/tickets')).length;
    const before = listCalls();
    unseen = true;
    act(() => socket.fire('ticket:updated', { ticketId: 'k1', groupId: 'g1' }));
    act(() => socket.fire('ticket:updated', { ticketId: 'k1', groupId: 'g1' }));
    expect(listCalls()).toBe(before);
    expect(await screen.findByTestId('unseen-dot', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(listCalls()).toBe(before + 1);
  });

  it('the first connect keeps the lists just loaded; a reconnect refetches them', async () => {
    const { calls } = mockTicketApi(CLIENT, groupRoutes());
    socket.connected = false; // a cold load: the socket connects after the screen mounted
    try {
      renderAt('/groups/g1/tickets');
      await screen.findByText('Ticket k1');
      const listCalls = () =>
        calls.filter((c) => c.startsWith('GET /api/groups/g1/tickets')).length;
      expect(listCalls()).toBe(1);
      socket.connected = true;
      act(() => socket.fire('connect'));
      await new Promise((r) => setTimeout(r, 20));
      expect(listCalls()).toBe(1);
      socket.connected = false;
      act(() => socket.fire('disconnect'));
      socket.connected = true;
      act(() => socket.fire('connect'));
      await waitFor(() => expect(listCalls()).toBe(2));
    } finally {
      socket.connected = true;
    }
  });

  it("My tickets of a client ignores the group's other tickets", async () => {
    const BOTH = {
      ...CLIENT,
      groups: [
        ...CLIENT.groups,
        { id: 'g2', name: 'Obec Lúky', role: 'ziadatel', hasLogo: false, updatedAt: '' },
      ],
    };
    const { calls } = mockTicketApi(BOTH, [
      (url) =>
        url.pathname === '/api/tickets/mine'
          ? reply(200, { items: [item({ id: 'k1', subject: 'Mine' })], nextCursor: null })
          : undefined,
      (url) =>
        url.pathname === '/api/tickets/k9'
          ? reply(
              200,
              ticket({
                id: 'k9',
                requester: { userId: 'someone', name: 'X', email: null, phone: null },
              }),
            )
          : undefined,
    ]);
    renderAt('/tickets');
    await screen.findByText('Mine');
    const listCalls = () => calls.filter((c) => c.startsWith('GET /api/tickets/mine')).length;
    const before = listCalls();
    act(() => socket.fire('ticket:created', { ticketId: 'k9', groupId: 'g1' }));
    act(() => socket.fire('ticket:updated', { ticketId: 'k9', groupId: 'g1' }));
    act(() => socket.fire('ticket:moved', { ticketId: 'k9', groupId: 'g1' }));
    await waitFor(() =>
      expect(calls.filter((c) => c === 'GET /api/tickets/k9').length).toBeGreaterThan(0),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(listCalls()).toBe(before);
  });
});
