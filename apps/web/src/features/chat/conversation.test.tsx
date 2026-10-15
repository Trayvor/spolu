import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ChatMessageEvent, GroupPerson, MessageDto, Thread } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { groupPeopleQuery } from '@/features/groups/api';
import { GroupRoomProvider } from '@/features/groups/use-group-room';
import { i18n, setLanguage } from '@/i18n';
import { ChatTab } from './chat-tab';
import { Conversation, type ConversationProps } from './conversation';

const socket = vi.hoisted(() => {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  return {
    connected: true,
    on(event: string, fn: (payload?: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: (payload?: unknown) => void) {
      listeners.get(event)?.delete(fn);
    },
    emit: () => undefined,
    fire(event: string, payload?: unknown) {
      listeners.get(event)?.forEach((fn) => fn(payload));
    },
    reset: () => listeners.clear(),
  };
});
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const ME = { id: 'me', name: 'Me Myself', email: 'me@example.com', role: 'client', groupId: 'g1' };
const people: GroupPerson[] = [
  { id: 'me', name: 'Me Myself', isAdmin: false },
  { id: 'anna', name: 'Anna Nováková', isAdmin: false },
];

function msg(id: string, n: number, over: Partial<MessageDto> = {}): MessageDto {
  return {
    id,
    channelId: 'c1',
    parentId: null,
    replyToId: null,
    author: { id: 'anna', name: 'Anna Nováková', isAdmin: false },
    body: `text of ${id}`,
    mentions: [],
    mentionsAll: false,
    attachments: [],
    clientId: null,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 15, 9, n)).toISOString(),
    changeSeq: n,
    ...over,
  };
}

const M1 = msg('m1', 1);
const M2 = msg('m2', 2, { replyCount: 2 });
const M3 = msg('m3', 3);
const R1 = msg('r1', 4, { parentId: 'm2' });
const R2 = msg('r2', 5, { parentId: 'm2', replyToId: 'r1', author: people[0]! });

/** What GET /channels/c1/unread-threads answers. */
let unreadRoots: string[];
/** While set, POST thread/read waits for it before answering. */
let holdThreadRead: Promise<void> | null;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

beforeAll(async () => {
  await setLanguage('en');
});

beforeEach(() => {
  socket.reset();
  unreadRoots = [];
  holdThreadRead = null;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/channels/c1/unread-threads') return json(200, unreadRoots);
    if (url === '/api/channels/c2/unread-threads') return json(200, []);
    if (url === '/api/messages/m2/thread/read' && method === 'POST') {
      unreadRoots = unreadRoots.filter((id) => id !== 'm2');
      if (holdThreadRead) await holdThreadRead;
      return json(204);
    }
    if (url === '/api/channels/c1/messages' && method === 'GET') {
      return json(200, {
        messages: [M3, M2, M1],
        hasMore: false,
        lastSeq: 5,
        lastReadAt: M1.createdAt,
      });
    }
    if (url === '/api/messages/m2/around' || url === '/api/messages/r1/around') {
      return json(200, {
        messages: [M1, M2],
        hasOlder: false,
        hasNewer: true,
        targetId: 'm2',
        lastSeq: 5,
        lastReadAt: M1.createdAt,
      });
    }
    if (url === '/api/messages/m2/thread') {
      const thread: Thread = { root: M2, replies: [R1, R2] };
      return json(200, thread);
    }
    if (url === '/api/channels/c1/read' && method === 'POST') return json(204);
    if (url === '/api/groups/g1/chat') {
      return json(200, { id: 'c1', lastSeq: 5, lastReadAt: M1.createdAt, unread: 2 });
    }
    if (url === '/api/channels/c2/messages' && method === 'GET') {
      const task = msg('x1', 1, { channelId: 'c2', body: 'task chat' });
      return json(200, { messages: [task], hasMore: false, lastSeq: 1, lastReadAt: null });
    }
    if (url === '/api/channels/c1/messages' && method === 'POST') {
      const input = JSON.parse(String(init!.body)) as Record<string, string>;
      return json(
        201,
        msg('new', 9, {
          ...input,
          parentId: input.parentId ?? null,
          replyToId: input.replyToId ?? null,
          author: people[0]!,
        }),
      );
    }
    return json(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const calls = (pred: (url: string, method: string) => boolean) =>
  fetchMock.mock.calls.filter(([url, init]) =>
    pred(url as string, (init as RequestInit | undefined)?.method ?? 'GET'),
  );
const readCalls = () => calls((url) => url === '/api/channels/c1/read');
const threadReadCalls = () => calls((url) => url.endsWith('/thread/read'));
const postBodies = () =>
  calls((url, method) => url === '/api/channels/c1/messages' && method === 'POST').map(
    ([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
  );

type Page = 'one' | 'two' | 'tab';

function renderAt(path: string, props: Partial<ConversationProps> = {}, page: Page = 'one') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQuery.queryKey, ME as never);
  client.setQueryData(groupPeopleQuery('g1').queryKey, people);
  const root = createRootRoute({ component: Outlet });
  const chat = createRoute({
    getParentRoute: () => root,
    path: '/groups/$groupId/chat',
    component: () => (
      <GroupRoomProvider joins={1}>
        {page === 'tab' ? (
          <ChatTab />
        ) : (
          <div data-chat="c1">
            <Conversation channelId="c1" groupId="g1" {...props} />
          </div>
        )}
        {page === 'two' && (
          <div data-chat="c2">
            <Conversation channelId="c2" groupId="g1" />
          </div>
        )}
      </GroupRoomProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([chat]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, user: userEvent.setup() };
}

const row = (scope: HTMLElement, id: string) =>
  scope.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
const panel = () => screen.findByRole('region', { name: t('chat.thread.title') });
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe('Conversation', () => {
  it('opens at the newest page and marks read at the bottom', async () => {
    const { container } = renderAt('/groups/g1/chat');
    expect(await screen.findByText('text of m3')).toBeInTheDocument();
    expect(row(container, 'm1')).not.toBeNull();
    await waitFor(() => expect(readCalls()).toHaveLength(1), { timeout: 2500 });
    const [, init] = readCalls()[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ at: M3.createdAt });
  });

  it('does not mark read while scrolled up', async () => {
    const { container } = renderAt('/groups/g1/chat');
    await screen.findByText('text of m3');
    const scroller = container.querySelector<HTMLElement>('.overflow-y-auto')!;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 });
    scroller.scrollTop = 200;
    fireEvent.scroll(scroller);
    await wait(1300);
    expect(readCalls()).toHaveLength(0);
  });

  it('?thread=<id> opens the thread panel and survives remount', async () => {
    const first = renderAt('/groups/g1/chat');
    await screen.findByText('text of m2');
    const m2 = row(first.container, 'm2')!;
    await first.user.click(
      within(m2).getByRole('button', { name: t('chat.actions.replyInThread') }),
    );
    const opened = await panel();
    await waitFor(() => expect(row(opened, 'r1')).toHaveTextContent('text of r1'));
    expect(within(opened).getByText(t('chat.thread.replies', { count: 2 }))).toBeInTheDocument();
    expect(first.router.state.location.search).toEqual({ thread: 'm2', c: 'c1' });
    const href = first.router.state.location.href;
    first.unmount();

    renderAt(href);
    expect(await within(await panel()).findByText('text of r2')).toBeInTheDocument();
  });

  it('Reply in a thread shows the strip and the sent reply carries replyToId', async () => {
    const { user } = renderAt('/groups/g1/chat?thread=m2&c=c1');
    const thread = await panel();
    const r1 = await waitFor(() => row(thread, 'r1')!);
    await user.click(within(r1).getByRole('button', { name: t('chat.actions.quote') }));
    expect(
      within(thread).getByText(
        t('chat.composer.replyingTo', { name: 'Anna Nováková', excerpt: 'text of r1' }),
      ),
    ).toBeInTheDocument();
    await user.type(within(thread).getByRole('textbox'), 'agreed{Enter}');
    await waitFor(() => expect(postBodies()).toHaveLength(1));
    expect(postBodies()[0]).toMatchObject({ body: 'agreed', parentId: 'm2', replyToId: 'r1' });
  });

  it('clicking a quote highlights the quoted reply', async () => {
    const { user } = renderAt('/groups/g1/chat?thread=m2&c=c1');
    const thread = await panel();
    const r2 = await waitFor(() => row(thread, 'r2')!);
    expect(row(thread, 'r1')).not.toHaveClass('bg-accent');
    // The quote above r2's text names r1's author and starts with its text.
    await user.click(within(r2).getByRole('button', { name: /text of r1/ }));
    expect(row(thread, 'r1')).toHaveClass('bg-accent');
  });

  it('?message=<id> loads around it and highlights it', async () => {
    const { container, router } = renderAt('/groups/g1/chat?message=m2&c=c1');
    await screen.findByText('text of m2');
    expect(calls((url) => url === '/api/messages/m2/around')).toHaveLength(1);
    expect(calls((url) => url === '/api/channels/c1/messages')).toHaveLength(0);
    expect(row(container, 'm2')).toHaveClass('bg-accent');
    // After 2 s the highlight goes and the link leaves the URL.
    await waitFor(() => expect(router.state.location.search).toEqual({}), { timeout: 3000 });
    expect(row(container, 'm2')).not.toHaveClass('bg-accent');
  });

  it('messageActions and renderMessageFooter reach the thread panel messages too', async () => {
    const onSelect = vi.fn();
    const { user } = renderAt('/groups/g1/chat?thread=m2&c=c1', {
      messageActions: [{ id: 'task', label: 'Turn into task', icon: null, onSelect }],
      renderMessageFooter: (m) => <span>footer {m.id}</span>,
    });
    const thread = await panel();
    await waitFor(() => expect(row(thread, 'r1')).not.toBeNull());
    for (const id of ['m2', 'r1', 'r2']) {
      expect(within(row(thread, id)!).getByText(`footer ${id}`)).toBeInTheDocument();
    }
    await user.click(within(row(thread, 'r1')!).getByRole('button', { name: 'Turn into task' }));
    expect(onSelect).toHaveBeenCalledWith(R1);
    // The main list has them as well.
    expect(screen.getByText('footer m1')).toBeInTheDocument();
  });

  it('a message deleted while its thread is open shows Message deleted and keeps replies', async () => {
    renderAt('/groups/g1/chat?thread=m2&c=c1');
    const thread = await panel();
    await waitFor(() => expect(row(thread, 'r1')).not.toBeNull());
    const event: ChatMessageEvent = {
      groupId: 'g1',
      channelId: 'c1',
      message: { ...M2, body: '', deletedAt: '2026-10-15T10:00:00.000Z', changeSeq: 6 },
      isNew: false,
    };
    act(() => socket.fire('chat:message', event));
    await waitFor(() =>
      expect(within(row(thread, 'm2')!).getByText(t('chat.deleted'))).toBeInTheDocument(),
    );
    expect(row(thread, 'r1')).toHaveTextContent('text of r1');
    expect(row(thread, 'r2')).toHaveTextContent('text of r2');
  });
  it('old links without a channel still open the group chat (the Chat tab adopts them)', async () => {
    const { router } = renderAt('/groups/g1/chat?thread=m2', {}, 'tab');
    const thread = await panel();
    await waitFor(() => expect(row(thread, 'r1')).not.toBeNull());
    expect(router.state.location.search).toEqual({ thread: 'm2', c: 'c1' });
    // The window loaded once, already with the params claimed.
    expect(calls((url) => url === '/api/channels/c1/messages')).toHaveLength(1);
  });

  it('two conversations on one page react only to their own params', async () => {
    const { container, router, user } = renderAt(
      '/groups/g1/chat?thread=m2&message=r1&c=c1',
      {},
      'two',
    );
    await screen.findByText('task chat');
    const c1 = container.querySelector<HTMLElement>('[data-chat="c1"]')!;
    const c2 = container.querySelector<HTMLElement>('[data-chat="c2"]')!;
    await waitFor(() => expect(within(c1).getAllByRole('region')).toHaveLength(1));
    expect(within(c2).queryByRole('region')).toBeNull();
    // Only c1 loads around the linked message; c2 opens at its own newest page.
    expect(calls((url) => url.endsWith('/around'))).toHaveLength(1);
    expect(calls((url) => url === '/api/channels/c2/messages')).toHaveLength(1);

    // Opening a thread in c2 takes the params over; c1's panel closes.
    await waitFor(() => expect(router.state.location.search).toEqual({ thread: 'm2', c: 'c1' }), {
      timeout: 3000,
    });
    const x1 = row(c2, 'x1')!;
    await user.click(within(x1).getByRole('button', { name: t('chat.actions.replyInThread') }));
    expect(router.state.location.search).toEqual({ thread: 'x1', c: 'c2' });
    await waitFor(() => expect(within(c1).queryByRole('region')).toBeNull());
  });

  it('a thread of another channel is never shown', async () => {
    // c1's link names a root that belongs to c2 (e.g. a stale or hand-made link).
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) =>
      url === '/api/messages/x9/thread'
        ? json(200, { root: msg('x9', 1, { channelId: 'c2' }), replies: [] })
        : original(url, init),
    );
    const { router } = renderAt('/groups/g1/chat?thread=x9&c=c1');
    await screen.findByText('text of m3');
    await wait(50);
    expect(screen.queryByRole('region')).toBeNull();
    // The link is dropped, so a narrow screen never keeps the list covered (inert) by nothing.
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('opening a thread focuses it, Esc drops the quote then closes, focus returns to the opener', async () => {
    const { container, user } = renderAt('/groups/g1/chat');
    await screen.findByText('text of m2');
    const opener = within(row(container, 'm2')!).getByRole('button', {
      name: t('chat.actions.replyInThread'),
    });
    await user.click(opener);
    const thread = await panel();
    expect(within(thread).getByRole('heading', { name: t('chat.thread.title') })).toHaveFocus();
    const r1 = await waitFor(() => row(thread, 'r1')!);
    await user.click(within(r1).getByRole('button', { name: t('chat.actions.quote') }));
    expect(within(thread).getByRole('textbox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(within(thread).queryByText(/Replying to/)).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('below 1024 px the open thread makes the list inert and the chat is not marked read', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { container } = renderAt('/groups/g1/chat?thread=m2&c=c1');
    await panel();
    await screen.findAllByText('text of m3');
    const column = container.querySelector<HTMLElement>('[data-chat="c1"] > div > div')!;
    expect(column).toHaveAttribute('inert');
    await wait(1300);
    expect(readCalls()).toHaveLength(0);
  });

  it('a hidden tab is not marked read', async () => {
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      renderAt('/groups/g1/chat');
      await screen.findByText('text of m3');
      await wait(1300);
      expect(readCalls()).toHaveLength(0);
    } finally {
      state.mockRestore();
    }
  });

  describe('unread thread replies', () => {
    const summary = (scope: HTMLElement) =>
      within(row(scope, 'm2')!).getByRole('button', { name: /2 replies/ });
    const dot = () => t('chat.thread.unreadReplies');

    it('a thread with unread replies shows a dot on its replies link', async () => {
      unreadRoots = ['m2'];
      const { container } = renderAt('/groups/g1/chat');
      await screen.findByText('text of m2');
      await waitFor(() => expect(within(summary(container)).getByText(dot())).toBeInTheDocument());
      expect(within(row(container, 'm1')!).queryByText(dot())).toBeNull();
    });

    it('a reply announced live adds the dot', async () => {
      const { container } = renderAt('/groups/g1/chat');
      await screen.findByText('text of m2');
      await waitFor(() => expect(calls((u) => u.endsWith('/unread-threads'))).toHaveLength(1));
      expect(within(summary(container)).queryByText(dot())).toBeNull();
      unreadRoots = ['m2'];
      act(() => socket.fire('chat:thread-reply', { groupId: 'g1', channelId: 'c1', rootId: 'm2' }));
      await waitFor(() => expect(within(summary(container)).getByText(dot())).toBeInTheDocument());
      // Another channel's thread is not this chat's.
      act(() => socket.fire('chat:thread-reply', { groupId: 'g1', channelId: 'c2', rootId: 'm1' }));
      expect(within(row(container, 'm1')!).queryByText(dot())).toBeNull();
    });

    it('opening the thread marks it read and the dot goes away', async () => {
      unreadRoots = ['m2'];
      const { container, user } = renderAt('/groups/g1/chat');
      await screen.findByText('text of m2');
      await waitFor(() => expect(within(summary(container)).getByText(dot())).toBeInTheDocument());
      await user.click(summary(container));
      await panel();
      await waitFor(() => expect(threadReadCalls()).toHaveLength(1));
      expect(threadReadCalls()[0]![0]).toBe('/api/messages/m2/thread/read');
      await waitFor(() => expect(within(summary(container)).queryByText(dot())).toBeNull());
    });

    it('a reply announced while the open thread is being marked read is marked read too', async () => {
      unreadRoots = ['m2'];
      let release!: () => void;
      holdThreadRead = new Promise((resolve) => (release = resolve));
      renderAt('/groups/g1/chat?thread=m2&c=c1');
      await panel();
      await waitFor(() => expect(threadReadCalls()).toHaveLength(1));
      // The server has stored the mark; then a new reply arrives before the answer.
      unreadRoots = ['m2'];
      act(() => socket.fire('chat:thread-reply', { groupId: 'g1', channelId: 'c1', rootId: 'm2' }));
      holdThreadRead = null;
      await act(async () => release());
      await waitFor(() => expect(threadReadCalls()).toHaveLength(2));
      await waitFor(() => expect(unreadRoots).toEqual([]));
    });

    it('a thread without unread replies is not marked read again', async () => {
      renderAt('/groups/g1/chat?thread=m2&c=c1');
      await panel();
      await waitFor(() => expect(calls((u) => u.endsWith('/unread-threads'))).toHaveLength(1));
      await wait(50);
      expect(threadReadCalls()).toHaveLength(0);
    });
  });
});
