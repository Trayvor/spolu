import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageEvent, MessageDto, TaskChatSummaries } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { setLanguage } from '@/i18n';
import { taskChatsQuery } from './task-chats';
import { TasksTabBadge } from './tasks-tab-badge';

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
    fire(event: string, payload?: unknown) {
      listeners.get(event)?.forEach((fn) => fn(payload));
    },
    reset: () => listeners.clear(),
  };
});
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));

const ME = {
  id: 'me',
  name: 'Me',
  email: 'me@example.com',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'Firma', role: 'client', hasLogo: false, updatedAt: '' }],
};

const message = (over: Partial<MessageDto> = {}): MessageDto => ({
  id: 'm1',
  channelId: 'c1',
  parentId: null,
  replyToId: null,
  author: { id: 'anna', name: 'Anna', isAdmin: false },
  body: 'hi',
  mentions: [],
  mentionsAll: false,
  attachments: [],
  clientId: null,
  replyCount: 0,
  lastReplyAt: null,
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  changeSeq: 1,
  tasks: [],
  reactions: [],
  knowledge: [],
  ...over,
});
const event = (m: MessageDto, over: Partial<ChatMessageEvent> = {}): ChatMessageEvent => ({
  groupId: 'g1',
  channelId: 'c1',
  taskId: 't1',
  message: m,
  isNew: true,
  ...over,
});

let server: TaskChatSummaries;
let fetches: number;

function renderBadge(initial?: TaskChatSummaries) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionQuery.queryKey, ME as never);
  if (initial) client.setQueryData(taskChatsQuery('g1').queryKey, initial);
  render(
    <QueryClientProvider client={client}>
      <TasksTabBadge groupId="g1" />
    </QueryClientProvider>,
  );
  return client;
}
const cached = (client: QueryClient) => client.getQueryData(taskChatsQuery('g1').queryKey);

describe('task chats', () => {
  beforeAll(async () => {
    await setLanguage('en');
  });
  beforeEach(() => {
    socket.reset();
    server = {};
    fetches = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/groups/g1/task-chats') {
          fetches += 1;
          return new Response(JSON.stringify(server), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a new top-level message by someone else makes the task unread and counts it; chat:read refetches', async () => {
    const client = renderBadge({ t1: { count: 1, unread: false } });
    expect(screen.queryByText(/unread/)).not.toBeInTheDocument();
    act(() => socket.fire('chat:message', event(message())));
    expect(cached(client)?.t1).toEqual({ count: 2, unread: true });
    expect(await screen.findByText('1')).toBeInTheDocument();

    // A first message creates the entry; my own counts but does not mark it unread.
    act(() =>
      socket.fire(
        'chat:message',
        event(message({ author: { id: 'me', name: 'Me', isAdmin: false } }), { taskId: 't2' }),
      ),
    );
    expect(cached(client)?.t2).toEqual({ count: 1, unread: false });

    // A reply marks it unread without a new count.
    act(() =>
      socket.fire('chat:thread-reply', {
        groupId: 'g1',
        channelId: 'c1',
        taskId: 't2',
        rootId: 'm0',
      }),
    );
    expect(cached(client)?.t2).toEqual({ count: 1, unread: true });

    server = { t1: { count: 2, unread: false } };
    act(() =>
      socket.fire('chat:read', {
        groupId: 'g1',
        channelId: 'c1',
        taskId: 't1',
        lastReadAt: '2026-10-15T11:00:00.000Z',
        all: true,
      }),
    );
    await waitFor(() => expect(fetches).toBe(1));
    await waitFor(() => expect(cached(client)).toEqual(server));
  });

  it('a deleted message refetches', async () => {
    renderBadge({ t1: { count: 1, unread: false } });
    act(() =>
      socket.fire(
        'chat:message',
        event(message({ deletedAt: '2026-10-15T10:05:00.000Z' }), { isNew: false }),
      ),
    );
    await waitFor(() => expect(fetches).toBe(1));
  });

  it('an event before the first fetch has landed refetches instead of being dropped', async () => {
    server = { t1: { count: 1, unread: true } };
    // Hold the first response so the event arrives while the fetch is in flight.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(fetch).mockImplementationOnce(async () => {
      fetches += 1;
      await gate;
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const client = renderBadge();
    await waitFor(() => expect(fetches).toBe(1));
    act(() => socket.fire('chat:message', event(message())));
    release();
    await waitFor(() => expect(fetches).toBe(2));
    await waitFor(() => expect(cached(client)).toEqual(server));
  });

  it('a deleted task drops out of the summaries, so the badge falls', async () => {
    const client = renderBadge({
      t1: { count: 1, unread: true },
      t2: { count: 2, unread: false },
    });
    expect(await screen.findByText('1')).toBeInTheDocument();
    act(() => socket.fire('board:task_deleted', { groupId: 'g2', taskId: 't1' }));
    expect(cached(client)?.t1).toBeDefined();
    act(() => socket.fire('board:task_deleted', { groupId: 'g1', taskId: 't1' }));
    expect(cached(client)).toEqual({ t2: { count: 2, unread: false } });
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument());
  });

  it('ignores events of the group channel and of other groups', () => {
    const client = renderBadge({ t1: { count: 1, unread: false } });
    act(() => {
      socket.fire('chat:message', event(message(), { taskId: null }));
      socket.fire('chat:message', event(message(), { groupId: 'g2' }));
      socket.fire('chat:thread-reply', {
        groupId: 'g1',
        channelId: 'c0',
        taskId: null,
        rootId: 'm0',
      });
      socket.fire('chat:thread-reply', {
        groupId: 'g2',
        channelId: 'c1',
        taskId: 't1',
        rootId: 'm0',
      });
      socket.fire('chat:read', { groupId: 'g1', channelId: 'c0', taskId: null, lastReadAt: 'x' });
    });
    expect(cached(client)).toEqual({ t1: { count: 1, unread: false } });
    expect(fetches).toBe(0);
  });
});
