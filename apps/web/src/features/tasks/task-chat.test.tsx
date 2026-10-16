import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { MessageDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import type { ConversationProps } from '@/features/chat/conversation';
import { TaskChat } from './task-chat';

const MESSAGE = {
  id: 'm1',
  body: 'Pay the invoice and send the report',
  author: { id: 'u2', name: 'Boris', isAdmin: true },
  attachments: [],
  tasks: [{ id: 't5', title: 'Pay the invoice', completed: false }],
} as unknown as MessageDto;

// What the conversation was given, render by render.
const seen: ConversationProps[] = [];
// The real conversation has its own tests; this one shows the props TaskChat wires in.
vi.mock('@/features/chat/conversation', () => ({
  Conversation: (props: ConversationProps) => {
    seen.push(props);
    return (
      <div data-testid="conversation">
        {props.messageActions
          ?.filter((a) => a.isAvailable?.(MESSAGE) ?? true)
          .map((a) => (
            <button key={a.id} type="button" onClick={() => a.onSelect(MESSAGE)}>
              {a.label}
            </button>
          ))}
        {props.renderMessageFooter?.(MESSAGE) as ReactNode}
      </div>
    );
  },
}));
vi.mock('@/features/chat/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/chat/api')>()),
  markAllRead: vi.fn(async () => undefined),
}));

beforeEach(async () => {
  seen.length = 0;
  await setLanguage('en');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url === '/api/ai/status') return reply({ taskSplit: true });
      if (url === '/api/groups/g1/people') return reply([]);
      if (url === '/api/messages/m1/task-split')
        return reply({
          tasks: [
            {
              title: 'Pay the invoice',
              description: '',
              assigneeIds: [],
              dueDate: null,
              urgent: false,
              messageFileIds: [],
            },
          ],
        });
      if (url === '/api/groups/g1/tasks/from-message' && init?.method === 'POST')
        return reply({ tasks: [] });
      if (url === '/api/tasks/t1/chat')
        return reply({ id: 'ch1', lastSeq: 1, lastReadAt: null, unread: 0 });
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderTaskChat() {
  const root = createRootRoute({ component: () => <TaskChat groupId="g1" taskId="t1" /> });
  const task = createRoute({ getParentRoute: () => root, path: '/groups/$groupId/tasks/$taskId' });
  const board = createRoute({ getParentRoute: () => root, path: '/groups/$groupId/tasks' });
  const router = createRouter({
    routeTree: root.addChildren([task, board]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('TaskChat', () => {
  it("refreshes the group's chat summaries after reading the chat", async () => {
    const { client } = renderTaskChat();
    const spy = vi.spyOn(client, 'invalidateQueries');
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks', 'g1', 'chats'], exact: true }),
    );
  });

  it('offers "Turn into tasks" and shows the "Turned into tasks" footer, like the group chat', async () => {
    renderTaskChat();
    expect(
      await screen.findByRole('button', { name: i18n.t('chat.actions.turnIntoTasks') }),
    ).toBeInTheDocument();
    expect(screen.getByText(i18n.t('chat.turnedIntoTasks'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pay the invoice' })).toHaveAttribute(
      'href',
      '/groups/g1/tasks/t5',
    );
  });

  it('passes the same actions and footer on every render', async () => {
    renderTaskChat();
    await screen.findByRole('button', { name: i18n.t('chat.actions.turnIntoTasks') });
    const last = seen.at(-1)!;
    const withAction = seen.filter((p) => p.messageActions?.length);
    expect(withAction.every((p) => p.messageActions === last.messageActions)).toBe(true);
    expect(seen.every((p) => p.renderMessageFooter === last.renderMessageFooter)).toBe(true);
  });

  it('choosing "Turn into tasks" opens the review dialog; approving posts to the task\'s group', async () => {
    const user = userEvent.setup();
    renderTaskChat();
    await user.click(
      await screen.findByRole('button', { name: i18n.t('chat.actions.turnIntoTasks') }),
    );
    await screen.findByRole('dialog', { name: i18n.t('taskSplit.title') });
    await user.click(await screen.findByRole('button', { name: i18n.t('taskSplit.approveAll') }));
    await user.click(screen.getByRole('button', { name: /^Create \d+ tasks?$/ }));

    const fetchMock = vi.mocked(fetch);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === '/api/groups/g1/tasks/from-message'),
      ).toBe(true),
    );
    const [, init] = fetchMock.mock.calls.find(
      ([url]) => url === '/api/groups/g1/tasks/from-message',
    )!;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      messageId: 'm1',
      tasks: [{ title: 'Pay the invoice' }],
    });
  });
});
