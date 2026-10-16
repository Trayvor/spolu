import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { TicketDto } from '@spolu/shared';
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

function renderTicket(
  me: unknown,
  dto: TicketDto,
  extra: Parameters<typeof mockTicketApi>[1] = [],
) {
  const api = mockTicketApi(me, [
    ...extra,
    (url, init) => {
      if (url.pathname === '/api/tickets/k1' && (init?.method ?? 'GET') === 'GET') {
        return reply(200, dto);
      }
      if (url.pathname === '/api/tickets/k1/followers')
        return reply(200, [{ id: 'z1', name: 'Žofia' }]);
      if (url.pathname === '/api/tickets/k1/follow') return reply(204);
      return undefined;
    },
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(
    queryClient,
    createMemoryHistory({ initialEntries: ['/tickets/k1'] }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return api;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ticket page', () => {
  it('admin edits status in place', async () => {
    const { calls, fetchMock } = renderTicket(ADMIN, ticket(), [
      (url, init) =>
        url.pathname === '/api/tickets/k1' && init?.method === 'PATCH'
          ? reply(200, ticket({ status: 'in_progress' }))
          : undefined,
    ]);
    const select = await screen.findByRole('combobox', { name: t('tickets.fields.status') });
    await userEvent.selectOptions(select, 'in_progress');
    await waitFor(() => expect(calls).toContain('PATCH /api/tickets/k1'));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ status: 'in_progress' });
    await waitFor(() => expect(select).toHaveValue('in_progress'));
    expect(screen.getByRole('button', { name: t('tickets.page.edit') })).toBeInTheDocument();
  });

  it('client sees fields read-only and can follow', async () => {
    const { calls } = renderTicket(CLIENT, ticket());
    expect(
      await screen.findByRole('heading', { name: 'Cannot submit the application' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: t('tickets.fields.status') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('tickets.page.edit') })).toBeNull();
    expect(screen.getAllByText(t('tickets.status.new')).length).toBeGreaterThan(0);
    const follow = screen.getByRole('button', { name: t('tickets.followers.follow') });
    expect(follow).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(follow);
    await waitFor(() => expect(calls).toContain('PUT /api/tickets/k1/follow'));
    expect(
      await screen.findByRole('button', { name: t('tickets.followers.following') }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('ziadatel sees no "Turn into tasks" and "Turned into N tasks" without links', async () => {
    renderTicket(REQUESTER, ticket({ taskCount: 2 }));
    const line = await screen.findByText(t('tickets.page.turnedInto', { count: 2 }));
    expect(within(line).queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /turn into tasks/i })).toBeNull();
    // A requester cannot open the group: the client's name is plain text.
    expect(screen.queryByRole('link', { name: 'ABC s.r.o.' })).toBeNull();
  });

  it('without client: "No client yet" + Assign client, no chat', async () => {
    const { calls } = renderTicket(
      ADMIN,
      ticket({ groupId: null, groupName: null, channelId: null }),
      [
        (url, init) =>
          url.pathname === '/api/tickets/k1/group' && init?.method === 'PUT'
            ? reply(200, ticket())
            : undefined,
      ],
    );
    expect(
      await screen.findByRole('heading', { name: t('tickets.noClient.title') }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('ticket-chat')).toBeNull();
    const choose = screen.getByRole('combobox', { name: t('tickets.assign.label') });
    await waitFor(() => expect(within(choose).getByText('Obec Lúky')).toBeInTheDocument());
    await userEvent.selectOptions(choose, 'g2');
    await userEvent.click(screen.getByRole('button', { name: t('tickets.assign.assign') }));
    await waitFor(() => expect(calls).toContain('PUT /api/tickets/k1/group'));
  });

  it('chat column hidden while channelId is null', async () => {
    renderTicket(CLIENT, ticket({ channelId: null }));
    await screen.findByRole('heading', { name: 'Cannot submit the application' });
    expect(screen.queryByTestId('ticket-chat')).toBeNull();
    expect(screen.queryByRole('heading', { name: t('tickets.noClient.title') })).toBeNull();
  });

  it('shows the chat with the ticket channel people when the ticket has a chat', async () => {
    const { calls } = renderTicket(REQUESTER, ticket({ channelId: 'ch1' }), [
      (url) =>
        url.pathname === '/api/tickets/k1/chat'
          ? reply(200, { id: 'ch1', lastSeq: 0, lastReadAt: null, unread: 0 })
          : undefined,
      (url) =>
        url.pathname === '/api/channels/ch1/messages'
          ? reply(200, { messages: [], hasMore: false, lastSeq: 0, lastReadAt: null })
          : undefined,
      (url) =>
        url.pathname === '/api/channels/ch1/people'
          ? reply(200, [{ id: 'z1', name: 'Žofia', isAdmin: false, isManager: false }])
          : undefined,
      (url) => (url.pathname === '/api/channels/ch1/unread-threads' ? reply(200, []) : undefined),
    ]);
    expect(await screen.findByTestId('ticket-chat')).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain('GET /api/channels/ch1/people'));
    expect(calls.some((c) => c.includes('/api/groups/g1/people'))).toBe(false);
  });
});
