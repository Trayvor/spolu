import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FileInfo, GroupPerson, MessageDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { groupPeopleQuery } from '@/features/groups/api';
import { initialWindow, type ChannelWindow } from './channel-window';
import { MessageList, type MessageListProps } from './message-list';

const api = vi.hoisted(() => ({ deleteMessage: vi.fn(), editMessage: vi.fn() }));
vi.mock('./api', () => api);

const ME = 'me';
const people: GroupPerson[] = [
  { id: ME, name: 'Me Myself', isAdmin: false },
  { id: 'anna', name: 'Anna Nováková', isAdmin: false },
  { id: 'vlad', name: 'Vlad', isAdmin: true },
];
let n = 0;
function msg(over: Partial<MessageDto> = {}): MessageDto {
  n += 1;
  return {
    id: `m${n}`,
    channelId: 'c1',
    parentId: null,
    replyToId: null,
    author: { id: 'anna', name: 'Anna Nováková', isAdmin: false },
    body: `text ${n}`,
    mentions: [],
    mentionsAll: false,
    attachments: [],
    clientId: null,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(2026, 9, 14, 9, n).toISOString(),
    changeSeq: n,
    ...over,
  };
}
const file = (over: Partial<FileInfo>): FileInfo => ({
  id: 'f1',
  name: 'budget.xlsx',
  mime: 'application/vnd.ms-excel',
  size: 48_000,
  width: null,
  height: null,
  hasPreview: false,
  ...over,
});

function renderList(messages: MessageDto[], props: Partial<MessageListProps> = {}, win = {}) {
  const client = new QueryClient();
  client.setQueryData(groupPeopleQuery('g1').queryKey, people);
  const window: ChannelWindow = { ...initialWindow, loaded: true, messages, ...win };
  return render(
    <QueryClientProvider client={client}>
      <MessageList
        window={window}
        meId={ME}
        groupId="g1"
        onLoadOlder={vi.fn()}
        onLoadNewer={vi.fn()}
        onJumpToLatest={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('MessageList', () => {
  beforeAll(async () => {
    await setLanguage('en');
  });
  beforeEach(() => {
    api.deleteMessage.mockReset().mockResolvedValue(undefined);
    api.editMessage.mockReset();
  });

  it('shows the empty state', () => {
    renderList([]);
    expect(screen.getByText(i18n.t('chat.empty'))).toBeInTheDocument();
  });

  it('eGrant pill only on admins', () => {
    renderList([
      msg(),
      msg({
        author: { id: 'vlad', name: 'Vlad', isAdmin: true },
        createdAt: new Date(2026, 9, 14, 11).toISOString(),
      }),
    ]);
    expect(screen.getAllByText('eGrant')).toHaveLength(1);
    expect(within(screen.getByText('Vlad').parentElement!).getByText('eGrant')).toBeInTheDocument();
  });

  it('deleted message shows Message deleted', () => {
    renderList([msg({ body: 'secret', deletedAt: new Date().toISOString() })], {
      renderMessageFooter: () => <span>footer</span>,
    });
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.queryByText('footer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply in thread' })).toBeNull();
  });

  it("own message offers Edit and Delete in More, others' do not", async () => {
    const user = userEvent.setup();
    renderList(
      [
        msg({ body: 'theirs' }),
        msg({ body: 'mine', author: { id: ME, name: 'Me Myself', isAdmin: false } }),
      ],
      { onOpenThread: vi.fn() },
    );
    expect(screen.getAllByRole('button', { name: 'More' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('delete asks inline and calls the API on confirm', async () => {
    const user = userEvent.setup();
    const own = msg({ body: 'mine', author: { id: ME, name: 'Me Myself', isAdmin: false } });
    renderList([own]);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText('Delete this message?')).toBeInTheDocument();
    expect(api.deleteMessage).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteMessage).toHaveBeenCalledWith(own.id);
  });

  it('messageActions entries render with labels and call onSelect with the message', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const m = msg();
    renderList([m], {
      messageActions: [{ id: 'task', label: 'Turn into tasks', icon: <i />, onSelect }],
    });
    const button = screen.getByRole('button', { name: 'Turn into tasks' });
    expect(button).toHaveAttribute('title', 'Turn into tasks');
    await user.click(button);
    expect(onSelect).toHaveBeenCalledWith(m);
  });

  it('renderMessageFooter output appears under the message', () => {
    renderList([msg({ body: 'hello' })], {
      renderMessageFooter: (m) => <span>footer {m.body}</span>,
    });
    expect(screen.getByText('footer hello')).toBeInTheDocument();
  });

  it('pending failed row shows Not sent. Retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderList(
      [msg()],
      { onRetry },
      {
        pending: [
          { clientId: 'c-1', input: { body: 'later', clientId: 'c-1' }, status: 'failed' },
          { clientId: 'c-2', input: { body: 'now', clientId: 'c-2' }, status: 'sending' },
        ],
      },
    );
    expect(screen.getByText('later')).toBeInTheDocument();
    expect(screen.getByText(/Not sent\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('c-1');
    expect(screen.getAllByText(/Not sent\./)).toHaveLength(1);
  });

  it('images render ImagePreview, other files FileChip', () => {
    renderList([
      msg({
        attachments: [
          file({
            id: 'img',
            name: 'photo.jpg',
            mime: 'image/jpeg',
            width: 1600,
            height: 900,
            hasPreview: true,
          }),
          file({}),
        ],
      }),
    ]);
    const image = screen.getByRole('link', { name: 'Open photo.jpg' });
    expect(image.style.maxWidth).toBe('min(100%, 320px)');
    expect(screen.getByRole('link', { name: 'Download budget.xlsx' })).toHaveAttribute('download');
  });

  it('thread summary opens the thread; mention rows get the brand edge; a new line is shown', async () => {
    const user = userEvent.setup();
    const onOpenThread = vi.fn();
    const m = msg({
      replyCount: 3,
      lastReplyAt: new Date(2026, 9, 14, 15, 10).toISOString(),
      mentionsAll: true,
    });
    const { container } = renderList(
      [m],
      { onOpenThread },
      { unreadAnchor: new Date(2026, 9, 1).toISOString() },
    );
    await user.click(screen.getByRole('button', { name: /3 replies, last at/ }));
    expect(onOpenThread).toHaveBeenCalledWith(m);
    expect(container.querySelector('[data-message-id]')).toHaveClass(
      'border-brand-purple',
      'bg-muted',
    );
    expect(screen.getByText('New messages')).toBeInTheDocument();
  });
});
