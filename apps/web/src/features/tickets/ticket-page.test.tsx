import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
    renderTicket(REQUESTER, ticket({ taskCount: 2, tasks: null }));
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

  it('shows the not-found page once the ticket moves out of reach', async () => {
    let gone = false;
    renderTicket(CLIENT, ticket(), [
      (url) =>
        gone && url.pathname === '/api/tickets/k1' ? reply(404, { error: 'not_found' }) : undefined,
    ]);
    await screen.findByRole('heading', { name: 'Cannot submit the application' });
    gone = true;
    act(() => socket.fire('ticket:moved', { ticketId: 'k1', groupId: 'g1' }));
    expect(await screen.findByRole('heading', { name: t('notFound.title') })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cannot submit the application' })).toBeNull();
  });

  it('a client change refreshes the chat people of the ticket', async () => {
    const { calls } = renderTicket(ADMIN, ticket({ channelId: 'ch1' }), [
      (url) =>
        url.pathname === '/api/tickets/k1/chat'
          ? reply(200, { id: 'ch1', lastSeq: 0, lastReadAt: null, unread: 0 })
          : undefined,
      (url) =>
        url.pathname === '/api/channels/ch1/messages'
          ? reply(200, { messages: [], hasMore: false, lastSeq: 0, lastReadAt: null })
          : undefined,
      (url) => (url.pathname === '/api/channels/ch1/people' ? reply(200, []) : undefined),
      (url) => (url.pathname === '/api/channels/ch1/unread-threads' ? reply(200, []) : undefined),
      (url, init) =>
        url.pathname === '/api/tickets/k1/group' && init?.method === 'PUT'
          ? reply(200, ticket({ channelId: 'ch1', groupId: 'g2', groupName: 'Obec Lúky' }))
          : undefined,
    ]);
    await screen.findByTestId('ticket-chat');
    await waitFor(() => expect(calls).toContain('GET /api/channels/ch1/people'));
    const peopleCalls = () => calls.filter((c) => c === 'GET /api/channels/ch1/people').length;
    const before = peopleCalls();
    await userEvent.click(screen.getByRole('button', { name: t('tickets.assign.change') }));
    const choose = screen.getByRole('combobox', { name: t('tickets.assign.moveLabel') });
    await waitFor(() => expect(within(choose).getByText('Obec Lúky')).toBeInTheDocument());
    await userEvent.selectOptions(choose, 'g2');
    await userEvent.click(screen.getByRole('button', { name: t('tickets.assign.move') }));
    await waitFor(() => expect(peopleCalls()).toBeGreaterThan(before));
  });

  describe('turn into tasks', () => {
    const aiOn: Parameters<typeof mockTicketApi>[1] = [
      (url) => (url.pathname === '/api/ai/status' ? reply(200, { taskSplit: true }) : undefined),
    ];
    const turnInto = () => screen.queryByRole('button', { name: t('chat.actions.turnIntoTasks') });

    it('the button is absent for ziadatel and for a ticket without client', async () => {
      renderTicket(REQUESTER, ticket({ taskCount: 1, tasks: null }), aiOn);
      await screen.findByText(t('tickets.page.turnedInto', { count: 1 }));
      expect(turnInto()).toBeNull();
      cleanup();

      renderTicket(ADMIN, ticket({ groupId: null, groupName: null }), aiOn);
      await screen.findByRole('heading', { name: t('tickets.noClient.title') });
      expect(turnInto()).toBeNull();
    });

    it('a client sees the linked tasks with links to the board', async () => {
      renderTicket(
        CLIENT,
        ticket({
          taskCount: 2,
          tasks: [
            { id: 't1', title: 'Fix the budget step', completed: false },
            { id: 't2', title: 'Write back', completed: true },
          ],
        }),
        aiOn,
      );
      const link = await screen.findByRole('link', { name: 'Fix the budget step' });
      expect(link).toHaveAttribute('href', '/groups/g1/tasks/t1');
      expect(screen.getByRole('link', { name: /Write back/ })).toBeInTheDocument();
      expect(
        await screen.findByRole('button', { name: t('chat.actions.turnIntoTasks') }),
      ).toBeEnabled();
    });

    it('after create the ticket lists the new tasks', async () => {
      let created = false;
      const { calls } = renderTicket(CLIENT, ticket(), [
        ...aiOn,
        (url, init) => {
          if (url.pathname === '/api/tickets/k1' && (init?.method ?? 'GET') === 'GET' && created) {
            return reply(
              200,
              ticket({ taskCount: 1, tasks: [{ id: 't9', title: 'Fix it', completed: false }] }),
            );
          }
          if (url.pathname === '/api/tickets/k1/task-split') {
            return reply(200, {
              tasks: [
                {
                  title: 'Fix it',
                  description: '',
                  assigneeIds: [],
                  dueDate: null,
                  urgent: false,
                  messageFileIds: [],
                },
              ],
            });
          }
          if (url.pathname === '/api/groups/g1/people') return reply(200, []);
          if (url.pathname === '/api/groups/g1/tasks/from-ticket' && init?.method === 'POST') {
            created = true;
            return reply(201, { tasks: [] });
          }
          return undefined;
        },
      ]);
      await userEvent.click(
        await screen.findByRole('button', { name: t('chat.actions.turnIntoTasks') }),
      );
      const dialog = await screen.findByRole('dialog', { name: t('taskSplit.title') });
      await within(dialog).findByRole('article', { name: 'Fix it' });
      await userEvent.click(
        within(dialog).getByRole('button', { name: t('taskSplit.approveAll') }),
      );
      await userEvent.click(
        within(dialog).getByRole('button', { name: t('taskSplit.create', { count: 1 }) }),
      );
      await waitFor(() => expect(calls).toContain('POST /api/groups/g1/tasks/from-ticket'));
      expect(await screen.findByRole('link', { name: 'Fix it' })).toHaveAttribute(
        'href',
        '/groups/g1/tasks/t9',
      );
      expect(screen.queryByRole('dialog', { name: t('taskSplit.title') })).toBeNull();
    });

    it('the ticket chat links a message to its tasks for a client, never for a requester', async () => {
      const message = {
        id: 'm1',
        channelId: 'ch1',
        parentId: null,
        replyToId: null,
        author: { id: 'z1', name: 'Žofia', isAdmin: false },
        body: 'Please fix the budget step',
        mentions: [],
        mentionsAll: false,
        attachments: [],
        clientId: null,
        replyCount: 0,
        lastReplyAt: null,
        editedAt: null,
        deletedAt: null,
        createdAt: '2026-10-16T09:00:00.000Z',
        changeSeq: 1,
        tasks: [{ id: 't1', title: 'Fix the budget step', completed: false }],
      };
      const chat: Parameters<typeof mockTicketApi>[1] = [
        ...aiOn,
        (url) =>
          url.pathname === '/api/tickets/k1/chat'
            ? reply(200, { id: 'ch1', lastSeq: 1, lastReadAt: null, unread: 0 })
            : undefined,
        (url) =>
          url.pathname === '/api/channels/ch1/messages'
            ? reply(200, { messages: [message], hasMore: false, lastSeq: 1, lastReadAt: null })
            : undefined,
        (url) => (url.pathname === '/api/channels/ch1/people' ? reply(200, []) : undefined),
        (url) => (url.pathname === '/api/channels/ch1/unread-threads' ? reply(200, []) : undefined),
      ];
      renderTicket(CLIENT, ticket({ channelId: 'ch1' }), chat);
      const chatColumn = await screen.findByTestId('ticket-chat');
      await within(chatColumn).findByText('Please fix the budget step');
      expect(
        await within(chatColumn).findByRole('link', { name: 'Fix the budget step' }),
      ).toHaveAttribute('href', '/groups/g1/tasks/t1');
      cleanup();

      renderTicket(REQUESTER, ticket({ channelId: 'ch1', tasks: null }), chat);
      const requesterChat = await screen.findByTestId('ticket-chat');
      await within(requesterChat).findByText('Please fix the budget step');
      expect(within(requesterChat).queryByRole('link', { name: 'Fix the budget step' })).toBeNull();
    });
  });
});
