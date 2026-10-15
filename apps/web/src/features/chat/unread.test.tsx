import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageEvent, ChatReadEvent, GroupChannel, MessageDto } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { i18n, setLanguage } from '@/i18n';
import { chatUnreadQuery, groupChatQuery } from './api';
import { ChatTabBadge } from './chat-tab-badge';
import { GroupUnreadCount } from './unread';

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

const ME = { id: 'me', name: 'Me', email: 'me@example.com', role: 'client', groupId: 'g1' };
const label = (count: number) => i18n.t('chat.unread', { count });

function message(over: Partial<MessageDto> = {}): MessageDto {
  return {
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
    ...over,
  };
}
const event = (m: MessageDto, over: Partial<ChatMessageEvent> = {}): ChatMessageEvent => ({
  groupId: 'g1',
  channelId: 'c1',
  message: m,
  isNew: true,
  ...over,
});

/** What GET /groups/g1/chat answers (after an invalidation). */
let serverChannel: GroupChannel;

function renderBadge(unread: number) {
  // Fresh cache: no refetch on mount, only the invalidations under test ask the server.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionQuery.queryKey, ME as never);
  client.setQueryData(groupChatQuery('g1').queryKey, {
    id: 'c1',
    lastSeq: 1,
    lastReadAt: null,
    unread,
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ChatTabBadge groupId="g1" />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('unread badges', () => {
  beforeAll(async () => {
    await setLanguage('en');
  });
  beforeEach(() => {
    socket.reset();
    serverChannel = { id: 'c1', lastSeq: 1, lastReadAt: null, unread: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/groups/g1/chat') {
          return new Response(JSON.stringify(serverChannel), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('badge shows the count, 99+ above 99, nothing at 0', () => {
    const { unmount } = renderBadge(5);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(label(5))).toBeInTheDocument();
    unmount();

    const big = renderBadge(120);
    expect(screen.getByText('99+')).toBeInTheDocument();
    big.unmount();

    const { container } = renderBadge(0);
    expect(container).toBeEmptyDOMElement();
  });

  it('a new message from someone else increments it, my own does not', async () => {
    const { client } = renderBadge(1);
    act(() => socket.fire('chat:message', event(message())));
    expect(await screen.findByText('2')).toBeInTheDocument();
    // Mine, a reply, an edit, another group and another channel leave it alone.
    act(() => {
      socket.fire(
        'chat:message',
        event(message({ author: { id: 'me', name: 'Me', isAdmin: false } })),
      );
      socket.fire('chat:message', event(message({ parentId: 'm0' })));
      socket.fire('chat:message', event(message(), { isNew: false }));
      socket.fire('chat:message', event(message(), { groupId: 'g2' }));
      socket.fire('chat:message', event(message({ channelId: 'c9' }), { channelId: 'c9' }));
    });
    expect(client.getQueryData(groupChatQuery('g1').queryKey)?.unread).toBe(2);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('chat:read clears it and refreshes the groups list counts', async () => {
    const { container, client } = renderBadge(3);
    client.setQueryData(chatUnreadQuery.queryKey, { g1: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
    const read: ChatReadEvent = {
      groupId: 'g1',
      channelId: 'c1',
      lastReadAt: '2026-10-15T10:00:00.000Z',
    };
    act(() => socket.fire('chat:read', read));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(client.getQueryState(chatUnreadQuery.queryKey)?.isInvalidated).toBe(true);
  });

  it('groups list count reads the unread map', () => {
    const client = new QueryClient();
    client.setQueryData(chatUnreadQuery.queryKey, { g1: 7 });
    render(
      <QueryClientProvider client={client}>
        <GroupUnreadCount groupId="g1" />
        <GroupUnreadCount groupId="g2" />
      </QueryClientProvider>,
    );
    expect(screen.getAllByText(/^\d+$/).map((el) => el.textContent)).toEqual(['7']);
  });
});
