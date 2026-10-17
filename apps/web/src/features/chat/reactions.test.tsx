import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MessageDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { setReaction } from './api';
import { initialWindow, setReactionsInThread, windowReducer } from './channel-window';
import { ChatScopeProvider } from './chat-scope';
import { Composer } from './composer';
import { MessageItem } from './message-item';
import { toggled } from './reactions';

vi.mock('./api', () => ({
  deleteMessage: vi.fn(),
  editMessage: vi.fn(),
  setReaction: vi.fn(),
  reactionPeopleQuery: (id: string, seq: number) => ({
    queryKey: ['chat', 'reactions', id, seq],
    queryFn: () => Promise.resolve([{ emoji: '👍', people: [{ id: 'u2', name: 'Boris' }] }]),
  }),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);
const ME = 'me';
const message = (over: Partial<MessageDto> = {}): MessageDto => ({
  id: 'm1',
  channelId: 'c1',
  parentId: null,
  replyToId: null,
  author: { id: 'u2', name: 'Boris', isAdmin: false },
  body: 'Hello there',
  mentions: [],
  mentionsAll: false,
  attachments: [],
  clientId: null,
  replyCount: 0,
  lastReplyAt: null,
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-10-14T09:00:00.000Z',
  changeSeq: 4,
  tasks: [],
  reactions: [],
  knowledge: [],
  ...over,
});

function renderItem(m: MessageDto, onChanged = vi.fn(), scope = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatScopeProvider scope={scope}>
        <MessageItem
          message={m}
          groupId="g1"
          showHeader
          mentionsMe={false}
          meId={ME}
          nameOf={() => undefined}
          onChanged={onChanged}
        />
      </ChatScopeProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onChanged };
}

beforeEach(() => {
  setLanguage('en');
  vi.mocked(setReaction).mockReset();
});

describe('toggled', () => {
  const base = [{ emoji: '👍', userIds: ['a'] }];
  it('adds the reader to an emoji, adds a new emoji at the end, removes empty ones', () => {
    expect(toggled(base, ME, '👍', true)).toEqual([{ emoji: '👍', userIds: ['a', ME] }]);
    expect(toggled(base, ME, '🙏', true)).toEqual([...base, { emoji: '🙏', userIds: [ME] }]);
    expect(toggled([{ emoji: '👍', userIds: [ME] }], ME, '👍', false)).toEqual([]);
    expect(toggled(base, ME, '👍', false)).toEqual(base);
  });
});

describe('reaction chips', () => {
  it('show the count, mark mine, and a tap turns mine off at once', async () => {
    vi.mocked(setReaction).mockResolvedValue({ messageId: 'm1', changeSeq: 5, reactions: [] });
    const { user, onChanged } = renderItem(
      message({ reactions: [{ emoji: '👍', userIds: ['u2', ME] }] }),
    );
    const chip = screen.getByRole('button', {
      name: t('chat.reactions.chipMine', { emoji: '👍', count: 2 }),
    });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    expect(setReaction).toHaveBeenCalledWith('m1', '👍', false);
    expect(
      screen.getByRole('button', { name: t('chat.reactions.chip', { emoji: '👍', count: 1 }) }),
    ).toHaveAttribute('aria-pressed', 'false');
    await vi.waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'm1', changeSeq: 5, reactions: [] }),
      ),
    );
  });

  it('hovering a chip names who reacted', async () => {
    const { user } = renderItem(message({ reactions: [{ emoji: '👍', userIds: ['u2'] }] }));
    await user.hover(
      screen.getByRole('button', { name: t('chat.reactions.chip', { emoji: '👍', count: 1 }) }),
    );
    expect(await screen.findByRole('tooltip')).toHaveTextContent('👍 Boris');
  });

  it('the phone action sheet starts with the quick row', async () => {
    vi.mocked(setReaction).mockResolvedValue({
      messageId: 'm1',
      changeSeq: 5,
      reactions: [{ emoji: '🙏', userIds: [ME] }],
    });
    const { user } = renderItem(message());
    await user.click(screen.getByRole('button', { name: t('chat.actions.open') }));
    const sheet = screen.getByRole('dialog', { name: t('chat.actions.open') });
    const quick = within(sheet).getByRole('group', { name: t('chat.reactions.quick') });
    expect(
      within(quick)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['👍', '❤️', '😂', '😮', '😢', '🙏', '✅', '']);
    await user.click(
      within(quick).getByRole('button', { name: t('chat.reactions.react', { emoji: '🙏' }) }),
    );
    expect(setReaction).toHaveBeenCalledWith('m1', '🙏', true);
    expect(screen.queryByRole('dialog', { name: t('chat.actions.open') })).toBeNull();
  });

  it('a deleted message shows no chips', () => {
    renderItem(
      message({
        deletedAt: '2026-10-14T10:00:00.000Z',
        reactions: [{ emoji: '👍', userIds: ['u2'] }],
      }),
    );
    expect(screen.queryByRole('button', { name: /Reaction/ })).toBeNull();
  });
});

describe('knowledge cards', () => {
  it('show the title and folder of an item, and "unavailable" for one nobody may read', () => {
    renderItem(
      message({
        knowledge: [
          { id: 'k1', available: true, type: 'note', title: 'Postup', folderPath: ['A', 'B'] },
          { id: 'k2', available: false },
        ],
      }),
    );
    const card = screen.getByRole('button', { name: /Postup/ });
    expect(card).toHaveTextContent('A / B');
    expect(screen.getByText(t('chat.knowledge.unavailable'))).toBeInTheDocument();
  });

  it('the composer offers the knowledge picker, except to a reader through messages', () => {
    const composer = (scope: object) =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <ChatScopeProvider scope={scope}>
            <Composer mode="new" groupId="g1" onSubmit={() => undefined} />
          </ChatScopeProvider>
        </QueryClientProvider>,
      );
    const button = () => screen.queryByRole('button', { name: t('chat.knowledge.attach') });
    const first = composer({});
    expect(button()).toBeInTheDocument();
    first.unmount();
    composer({ knowledgeViaMessage: true });
    expect(button()).toBeNull();
  });
});

describe('the window and threads take reactions by changeSeq', () => {
  const loaded = windowReducer(initialWindow, {
    type: 'loadedLatest',
    page: { messages: [message()], hasMore: false, lastSeq: 4, lastReadAt: null },
  });
  const reactions = [{ emoji: '👍', userIds: ['u2'] }];

  it('applies a newer change and ignores an older one', () => {
    const next = windowReducer(loaded, {
      type: 'reactionsChanged',
      messageId: 'm1',
      reactions,
      changeSeq: 6,
    });
    expect(next.messages[0]).toMatchObject({ reactions, changeSeq: 6 });
    expect(
      windowReducer(next, {
        type: 'reactionsChanged',
        messageId: 'm1',
        reactions: [],
        changeSeq: 5,
      }),
    ).toBe(next);
  });

  it('patches a cached thread reply', () => {
    const thread = { root: message({ id: 'r' }), replies: [message({ parentId: 'r' })] };
    const next = setReactionsInThread(thread, 'm1', reactions, 6);
    expect(next.replies[0]).toMatchObject({ reactions, changeSeq: 6 });
    expect(setReactionsInThread(next, 'm1', [], 6)).toBe(next);
  });
});
