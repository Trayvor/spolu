import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useState, type ReactNode } from 'react';
import type { Changes, ChatMessageEvent, MessageDto, Thread } from '@spolu/shared';
import { GroupRoomProvider } from '@/features/groups/use-group-room';
import { groupChatQuery, threadQuery } from './api';
import { useChannelMessages } from './use-channel-messages';

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
    count: (event: string) => listeners.get(event)?.size ?? 0,
    reset: () => listeners.clear(),
  };
});
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));

function msg(n: number, over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: `m${n}`,
    channelId: 'c1',
    parentId: null,
    replyToId: null,
    author: { id: 'u2', name: 'Jana', isAdmin: false },
    body: `message ${n}`,
    mentions: [],
    mentionsAll: false,
    attachments: [],
    clientId: null,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 15, 10, 0, n)).toISOString(),
    changeSeq: n,
    ...over,
  };
}

/** What the fake server answers; tests change it between steps. */
type Server = {
  latest: MessageDto[];
  lastSeq: number;
  lastReadAt: string | null;
  changes: Changes[];
  send: (body: { clientId: string; body: string }) => Response;
};
let server: Server;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

beforeEach(() => {
  socket.reset();
  server = {
    latest: [msg(1), msg(2), msg(3)],
    lastSeq: 3,
    lastReadAt: '2026-10-15T10:00:02.000Z',
    changes: [],
    send: () => json(500, { error: 'internal' }),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/channels/c1/messages' && method === 'GET') {
      return json(200, {
        messages: [...server.latest].reverse(),
        hasMore: false,
        lastSeq: server.lastSeq,
        lastReadAt: server.lastReadAt,
      });
    }
    if (url.startsWith('/api/channels/c1/changes?afterSeq=')) {
      return json(
        200,
        server.changes.shift() ?? { messages: [], lastSeq: server.lastSeq, truncated: false },
      );
    }
    if (url === '/api/channels/c1/messages' && method === 'POST') {
      return server.send(JSON.parse(String(init!.body)) as { clientId: string; body: string });
    }
    return json(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calls = (pred: (url: string, method: string) => boolean) =>
  fetchMock.mock.calls.filter(([url, init]) =>
    pred(url as string, (init as RequestInit | undefined)?.method ?? 'GET'),
  );
const changesCalls = () => calls((url) => url.includes('/changes?')).map(([url]) => url);
const latestCalls = () =>
  calls((url, method) => url === '/api/channels/c1/messages' && method === 'GET');
const postBodies = () =>
  calls((_, method) => method === 'POST').map(
    ([, init]) => JSON.parse(String((init as RequestInit).body)) as { clientId: string },
  );

/** Renders the hook inside a query client and a group room whose join counter the test drives. */
function setup(opts: { joins?: number } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const room: { setJoins: (joins: number) => void } = { setJoins: () => undefined };
  function Wrapper({ children }: { children: ReactNode }) {
    const [joins, setJoins] = useState(opts.joins ?? 1);
    room.setJoins = setJoins;
    return (
      <QueryClientProvider client={queryClient}>
        <GroupRoomProvider joins={joins}>{children}</GroupRoomProvider>
      </QueryClientProvider>
    );
  }
  const hook = renderHook(() => useChannelMessages('c1', { groupId: 'g1' }), { wrapper: Wrapper });
  return { ...hook, queryClient, rejoin: (n: number) => act(() => room.setJoins(n)) };
}

const ids = (messages: MessageDto[]) => messages.map((m) => m.id);
const event = (message: MessageDto, over: Partial<ChatMessageEvent> = {}): ChatMessageEvent => ({
  groupId: 'g1',
  channelId: 'c1',
  message,
  isNew: true,
  ...over,
});

describe('useChannelMessages', () => {
  it('loads the latest page', async () => {
    const { result } = setup();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3']);
    expect(result.current.window).toMatchObject({
      lastSeq: 3,
      hasOlder: false,
      hasNewer: false,
      unreadAnchor: '2026-10-15T10:00:02.000Z',
    });
    expect(result.current.error).toBeNull();
  });

  it('a chat:message event appears without refetch', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    const before = fetchMock.mock.calls.length;
    act(() => socket.fire('chat:message', event(msg(4))));
    expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(result.current.window.lastSeq).toBe(4);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('ignores events of another group or another channel', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    act(() => socket.fire('chat:message', event(msg(4), { groupId: 'g2' })));
    act(() => socket.fire('chat:message', event(msg(5, { channelId: 'c2' }), { channelId: 'c2' })));
    expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3']);
    expect(result.current.window.lastSeq).toBe(3);
  });

  it('a reply event patches the cached thread', async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    const thread: Thread = { root: msg(1), replies: [] };
    queryClient.setQueryData(threadQuery('m1').queryKey, thread);
    const reply = msg(4, { parentId: 'm1' });
    act(() => socket.fire('chat:message', event(reply)));
    act(() =>
      socket.fire('chat:message', event(msg(1, { replyCount: 1, changeSeq: 4 }), { isNew: false })),
    );
    const cached = queryClient.getQueryData(threadQuery('m1').queryKey);
    expect(cached?.replies.map((r) => r.id)).toEqual(['m4']);
    expect(cached?.root.replyCount).toBe(1);
    expect(result.current.window.messages[0]!.replyCount).toBe(1);
  });

  it('reconnect fetches changes after the highest seq and applies an edit and a deletion without duplicates', async () => {
    const { result, rejoin, queryClient } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    act(() => socket.fire('chat:message', event(msg(4))));
    // A raw socket connect is not a rejoin: nothing happens until the room is joined again.
    act(() => socket.fire('connect'));
    expect(changesCalls()).toEqual([]);

    queryClient.setQueryData(groupChatQuery('g1').queryKey, {
      id: 'c1',
      lastSeq: 4,
      lastReadAt: '2026-10-15T10:00:02.000Z',
      unread: 2,
    });
    const thread: Thread = { root: msg(2), replies: [msg(5, { parentId: 'm2' })] };
    queryClient.setQueryData(threadQuery('m2').queryKey, thread);
    server.changes.push({
      messages: [
        msg(4),
        msg(2, { body: 'edited', editedAt: '2026-10-15T11:00:00.000Z', changeSeq: 5 }),
        msg(5, { parentId: 'm2', body: 'reply edited', changeSeq: 6 }),
        msg(3, { body: '', deletedAt: '2026-10-15T11:00:00.000Z', changeSeq: 7 }),
      ],
      lastSeq: 7,
      truncated: false,
    });
    rejoin(2);

    await waitFor(() => expect(result.current.window.lastSeq).toBe(7));
    expect(changesCalls()).toEqual(['/api/channels/c1/changes?afterSeq=4']);
    const messages = result.current.window.messages;
    expect(ids(messages)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(messages[1]!.body).toBe('edited');
    expect(messages[2]!.deletedAt).not.toBeNull();
    // Catch-up goes through the same path as live events: the open thread is patched too.
    const cached = queryClient.getQueryData(threadQuery('m2').queryKey);
    expect(cached?.root.body).toBe('edited');
    expect(cached?.replies[0]!.body).toBe('reply edited');
    // m3 was unread (after the read cursor): its deletion refreshes the unread count.
    expect(queryClient.getQueryState(groupChatQuery('g1').queryKey)?.isInvalidated).toBe(true);
  });

  it('does not catch up before the window is loaded, and joins at load time need none', async () => {
    const { result, rejoin } = setup({ joins: 0 });
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    // Joined after the page was requested: something may have been written in between.
    rejoin(1);
    await waitFor(() => expect(changesCalls()).toEqual(['/api/channels/c1/changes?afterSeq=3']));

    const second = setup({ joins: 1 });
    await waitFor(() => expect(second.result.current.window.loaded).toBe(true));
    expect(changesCalls()).toHaveLength(1);
  });

  it('truncated catch-up reloads the latest page', async () => {
    const { result, rejoin } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    expect(latestCalls()).toHaveLength(1);
    server.latest = [msg(600), msg(601)];
    server.lastSeq = 700;
    server.changes.push({ messages: [msg(4)], lastSeq: 4, truncated: true });
    rejoin(2);
    await waitFor(() => expect(ids(result.current.window.messages)).toEqual(['m600', 'm601']));
    expect(latestCalls()).toHaveLength(2);
    expect(result.current.window.lastSeq).toBe(700);
    // The "New messages" anchor is the one from when the chat opened.
    expect(result.current.window.unreadAnchor).toBe('2026-10-15T10:00:02.000Z');
  });

  it('send shows a pending row, failure marks it failed, retry sends the same clientId', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    let fail!: () => void;
    const gate = new Promise<void>((resolve) => (fail = resolve));
    fetchMock.mockImplementationOnce(async () => {
      await gate;
      throw new TypeError('network down');
    });

    act(() => void result.current.send({ body: 'Ahoj' }));
    expect(result.current.window.pending).toHaveLength(1);
    const [pending] = result.current.window.pending;
    expect(pending).toMatchObject({ status: 'sending', input: { body: 'Ahoj' } });
    expect(pending!.clientId).toMatch(/^[\w-]{1,64}$/);

    await act(async () => fail());
    await waitFor(() => expect(result.current.window.pending[0]!.status).toBe('failed'));

    server.send = (body) =>
      json(
        201,
        msg(4, {
          clientId: body.clientId,
          body: body.body,
          author: { id: 'me', name: 'Me', isAdmin: false },
        }),
      );
    await act(() => result.current.retry(pending!.clientId));
    expect(postBodies().map((b) => b.clientId)).toEqual([pending!.clientId, pending!.clientId]);
    // The POST answer settles the row even without its socket event.
    expect(result.current.window.pending).toEqual([]);
    expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('the socket event of my message arriving before the POST answer leaves one row', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    let answer!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    act(() => void result.current.send({ body: 'Ahoj' }));
    const clientId = result.current.window.pending[0]!.clientId;
    const mine = msg(4, { clientId, body: 'Ahoj' });
    act(() => socket.fire('chat:message', event(mine)));
    expect(result.current.window.pending).toEqual([]);
    await act(async () => answer(json(201, mine)));
    expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('an event newer than the first page makes it catch up from the page seq', async () => {
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      await gate;
      return original(url, init);
    });
    server.changes.push({
      messages: [msg(2, { body: 'edited', changeSeq: 4 })],
      lastSeq: 4,
      truncated: false,
    });
    const { result } = setup();
    // m2 is edited (seq 4) after the server read the page (seq 3) but before it answered.
    act(() => socket.fire('chat:message', event(msg(2, { body: 'edited', changeSeq: 4 }))));
    await act(async () => answer());
    await waitFor(() => expect(result.current.window.messages[1]?.body).toBe('edited'));
    expect(changesCalls()).toEqual(['/api/channels/c1/changes?afterSeq=3']);
    expect(result.current.window.lastSeq).toBe(4);
  });

  it('opens around a message, and clearing the target keeps the window', async () => {
    fetchMock.mockImplementationOnce(async () =>
      json(200, {
        messages: [msg(40), msg(41), msg(42)],
        hasOlder: true,
        hasNewer: true,
        targetId: 'm41',
        lastSeq: 3,
        lastReadAt: null,
      }),
    );
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <GroupRoomProvider joins={1}>{children}</GroupRoomProvider>
      </QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ around }: { around?: string }) =>
        useChannelMessages('c1', { groupId: 'g1', aroundMessageId: around }),
      { wrapper, initialProps: { around: 'm41' as string | undefined } },
    );
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/messages/m41/around');
    expect(ids(result.current.window.messages)).toEqual(['m40', 'm41', 'm42']);
    expect(result.current.window).toMatchObject({ hasOlder: true, hasNewer: true });
    rerender({ around: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ids(result.current.window.messages)).toEqual(['m40', 'm41', 'm42']);
    // jumpToLatest replaces the window with the newest page.
    await act(() => result.current.jumpToLatest());
    expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3']);
    expect(result.current.window.hasNewer).toBe(false);
  });

  it('catch-up starts from the seq before the disconnect, not from a live event after it', async () => {
    const { result, rejoin } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    act(() => socket.fire('disconnect'));
    // Back online: the room is joined and a live event lands before the counter reaches React.
    act(() => socket.fire('connect'));
    act(() => socket.fire('chat:message', event(msg(9))));
    rejoin(2);
    await waitFor(() => expect(changesCalls()).toEqual(['/api/channels/c1/changes?afterSeq=3']));
  });

  it('applyLocal applies an own edit or delete without moving the catch-up seq', async () => {
    const { result, rejoin, queryClient } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    const thread: Thread = { root: msg(2), replies: [] };
    queryClient.setQueryData(threadQuery('m2').queryKey, thread);
    // The delete copy carries a made-up seq (changeSeq + 1); the edit answer a real but newer one.
    act(() =>
      result.current.applyLocal(msg(3, { deletedAt: '2026-10-15T11:00:00.000Z', changeSeq: 4 })),
    );
    act(() => result.current.applyLocal(msg(2, { body: 'edited', changeSeq: 9 })));
    const messages = result.current.window.messages;
    expect(messages[2]!.deletedAt).not.toBeNull();
    expect(messages[1]!.body).toBe('edited');
    expect(queryClient.getQueryData(threadQuery('m2').queryKey)?.root.body).toBe('edited');
    expect(result.current.window.lastSeq).toBe(3);
    // Catch-up still asks from the last server seq, so the real changes arrive.
    rejoin(2);
    await waitFor(() => expect(changesCalls()).toEqual(['/api/channels/c1/changes?afterSeq=3']));
  });

  it('older pages never move the catch-up seq', async () => {
    fetchMock.mockImplementationOnce(async () =>
      json(200, { messages: [msg(3), msg(2)], hasMore: true, lastSeq: 3, lastReadAt: null }),
    );
    const { result, rejoin } = setup({ joins: 0 });
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    // The older page is read after an edit at seq 11 that this client has not seen.
    fetchMock.mockImplementationOnce(async () =>
      json(200, { messages: [msg(1)], hasMore: false, lastSeq: 11, lastReadAt: null }),
    );
    await act(() => result.current.loadOlder());
    expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3']);
    rejoin(1);
    await waitFor(() => expect(changesCalls()).toHaveLength(1));
    expect(changesCalls()[0]).toBe('/api/channels/c1/changes?afterSeq=3');
  });

  it('a page answer of the window replaced by jumpToLatest is dropped', async () => {
    let releaseOlder!: (r: Response) => void;
    fetchMock.mockImplementationOnce(async () =>
      json(200, {
        messages: [msg(40), msg(41)],
        hasOlder: true,
        hasNewer: true,
        targetId: 'm41',
        lastSeq: 3,
        lastReadAt: null,
      }),
    );
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <GroupRoomProvider joins={1}>{children}</GroupRoomProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(
      () => useChannelMessages('c1', { groupId: 'g1', aroundMessageId: 'm41' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (releaseOlder = resolve)),
    );
    let older!: Promise<void>;
    act(() => {
      older = result.current.loadOlder();
    });
    await act(() => result.current.jumpToLatest());
    expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3']);
    await act(async () => {
      releaseOlder(json(200, { messages: [msg(39)], hasMore: true, lastSeq: 3, lastReadAt: null }));
      await older;
    });
    expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3']);
    expect(result.current.window.hasOlder).toBe(false);
  });

  describe('with fake timers', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('a failed catch-up keeps its seq and retries with backoff until it succeeds', async () => {
      const { result, rejoin, unmount } = setup();
      await waitFor(() => expect(result.current.window.loaded).toBe(true));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const original = fetchMock.getMockImplementation()!;
      let failures = 2;
      fetchMock.mockImplementation(async (url, init) => {
        if (url.includes('/changes?') && failures > 0) {
          failures -= 1;
          return json(503, { error: 'unavailable' });
        }
        return original(url, init);
      });
      act(() => socket.fire('disconnect'));
      act(() => socket.fire('connect'));
      rejoin(2);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(changesCalls()).toHaveLength(1);
      // A live event while the retry waits must not move the retry's start.
      act(() => socket.fire('chat:message', event(msg(9))));
      await act(() => vi.advanceTimersByTimeAsync(999));
      expect(changesCalls()).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(changesCalls()).toHaveLength(2);
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(changesCalls()).toEqual([
        '/api/channels/c1/changes?afterSeq=3',
        '/api/channels/c1/changes?afterSeq=3',
        '/api/channels/c1/changes?afterSeq=3',
      ]);
      // Succeeded: the next rejoin starts from the window's seq again.
      rejoin(3);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(changesCalls().at(-1)).toBe('/api/channels/c1/changes?afterSeq=9');
      unmount();
    });

    it('a failed reload after a truncated catch-up retries the catch-up', async () => {
      const { result, rejoin } = setup();
      await waitFor(() => expect(result.current.window.loaded).toBe(true));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const original = fetchMock.getMockImplementation()!;
      let reloadFailures = 1;
      fetchMock.mockImplementation(async (url, init) => {
        if (url === '/api/channels/c1/messages' && reloadFailures > 0) {
          reloadFailures -= 1;
          return json(503, { error: 'unavailable' });
        }
        return original(url, init);
      });
      server.latest = [msg(600), msg(601)];
      server.lastSeq = 700;
      const truncated = { messages: [msg(4)], lastSeq: 4, truncated: true };
      server.changes.push(truncated, truncated);
      rejoin(2);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(changesCalls()).toHaveLength(1);
      expect(ids(result.current.window.messages)).toEqual(['m1', 'm2', 'm3', 'm4']);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(changesCalls()).toEqual([
        '/api/channels/c1/changes?afterSeq=3',
        '/api/channels/c1/changes?afterSeq=3',
      ]);
      expect(ids(result.current.window.messages)).toEqual(['m600', 'm601']);
    });

    it('stops retrying on unmount', async () => {
      const { result, rejoin, unmount } = setup();
      await waitFor(() => expect(result.current.window.loaded).toBe(true));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fetchMock.mockImplementation(async () => json(503, { error: 'unavailable' }));
      rejoin(2);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(changesCalls()).toHaveLength(1);
      unmount();
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(changesCalls()).toHaveLength(1);
    });
  });

  it('unsubscribes on unmount', async () => {
    const { result, unmount } = setup();
    await waitFor(() => expect(result.current.window.loaded).toBe(true));
    expect(socket.count('chat:message')).toBe(1);
    unmount();
    expect(socket.count('chat:message')).toBe(0);
  });
});
