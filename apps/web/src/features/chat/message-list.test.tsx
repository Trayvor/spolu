import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  { id: ME, name: 'Me Myself', isAdmin: false, isManager: false },
  { id: 'anna', name: 'Anna Nováková', isAdmin: false, isManager: false },
  { id: 'vlad', name: 'Vlad', isAdmin: true, isManager: false },
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
    tasks: [],
    reactions: [],
    knowledge: [],
    attachedTasks: [],
    attachedTickets: [],
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
  it('the scroll container leaves room above the first row for the lifted hover bar', () => {
    const { container } = renderList([msg()]);
    const scroller = container.querySelector('[data-message-id]')!.closest('.overflow-y-auto')!;
    expect(scroller).toHaveClass('pt-9');
  });

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

  it('the editing row drops content-visibility so the mention list is not clipped', async () => {
    const user = userEvent.setup();
    const own = msg({ body: 'mine', author: { id: ME, name: 'Me Myself', isAdmin: false } });
    const { container } = renderList([own]);
    const row = () => container.querySelector(`[data-message-id="${own.id}"]`) as HTMLElement;
    expect(row().className).toContain('content-visibility');
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(row().className).not.toContain('content-visibility');
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

  it('a failed row with reason invalid_mention shows the mention line', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderList(
      [msg()],
      { onRetry },
      {
        pending: [
          {
            clientId: 'c-1',
            input: { body: 'hi there', clientId: 'c-1' },
            status: 'failed',
            failReason: 'invalid_mention',
          },
        ],
      },
    );
    expect(screen.getByText('hi there')).toBeInTheDocument();
    expect(
      screen.getByText(/Someone you mentioned is no longer at this client\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Not sent\./)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('c-1');
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
    expect(image.style.width).toBe('min(100%, 320px)');
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

  it('applies the HTTP result of an edit and of a delete through onMessageChanged', async () => {
    const user = userEvent.setup();
    const onMessageChanged = vi.fn();
    const own = msg({ body: 'mine', author: { id: ME, name: 'Me Myself', isAdmin: false } });
    const updated = { ...own, body: 'better', changeSeq: own.changeSeq + 1 };
    api.editMessage.mockResolvedValue(updated);
    renderList([own], { onMessageChanged });
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const box = screen.getByRole('textbox', { name: 'Edit' });
    await user.clear(box);
    await user.type(box, 'better');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onMessageChanged).toHaveBeenCalledWith(updated);

    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onMessageChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: own.id,
        deletedAt: expect.any(String),
        changeSeq: own.changeSeq + 1,
      }),
    );
  });

  it('unsent rows get no messageActions and no footer', () => {
    renderList(
      [msg()],
      {
        messageActions: [{ id: 'task', label: 'Turn into tasks', icon: <i />, onSelect: vi.fn() }],
        renderMessageFooter: () => <span>footer</span>,
      },
      {
        pending: [
          { clientId: 'c-1', input: { body: 'later', clientId: 'c-1' }, status: 'sending' },
        ],
      },
    );
    expect(screen.getAllByRole('button', { name: 'Turn into tasks' })).toHaveLength(1);
    expect(screen.getAllByText('footer')).toHaveLength(1);
  });
});

describe('MessageList scroll anchoring', () => {
  // jsdom has no layout: every message row is 100px tall and stacked in DOM order.
  beforeAll(() => {
    const rowIndex = (el: HTMLElement) =>
      [...el.parentElement!.querySelectorAll('[data-message-id]')].indexOf(el);
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.dataset.messageId) return rowIndex(this) * 100;
        // The "new messages" line sits right at the top of the row after it.
        if (this.dataset.newMessages !== undefined) {
          return rowIndex(this.nextElementSibling as HTMLElement) * 100;
        }
        return 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.messageId ? 100 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 100,
    });
  });

  function setup(initial: MessageDto[], win: Partial<ChannelWindow> = {}) {
    const client = new QueryClient();
    client.setQueryData(groupPeopleQuery('g1').queryKey, people);
    const view = (messages: MessageDto[]) => (
      <QueryClientProvider client={client}>
        <MessageList
          window={{ ...initialWindow, loaded: true, messages, ...win }}
          meId={ME}
          groupId="g1"
          onLoadOlder={vi.fn()}
          onLoadNewer={vi.fn()}
          onJumpToLatest={vi.fn()}
        />
      </QueryClientProvider>
    );
    const utils = render(view(initial));
    const scroller = utils.container
      .querySelector<HTMLElement>('[data-message-id]')!
      .closest<HTMLElement>('.overflow-y-auto')!;
    return { scroller, rerender: (m: MessageDto[]) => utils.rerender(view(m)) };
  }

  it('keeps the first visible row in place when an older page is prepended', () => {
    const [a, b, c] = [msg(), msg(), msg()] as [MessageDto, MessageDto, MessageDto];
    const { scroller, rerender } = setup([b, c]);
    scroller.scrollTop = 50; // away from the end (scrollHeight 1000, clientHeight 100)
    fireEvent.scroll(scroller);
    rerender([a, b, c]);
    expect(scroller.scrollTop).toBe(150);
  });

  it('keeps the first visible row in place when the oldest rows are trimmed', () => {
    const [a, b, c] = [msg(), msg(), msg()] as [MessageDto, MessageDto, MessageDto];
    const { scroller, rerender } = setup([a, b, c]);
    scroller.scrollTop = 150;
    fireEvent.scroll(scroller);
    rerender([b, c]);
    expect(scroller.scrollTop).toBe(50);
  });

  it('opens at the end when nothing is unread', () => {
    const { scroller } = setup([msg(), msg(), msg()]);
    expect(scroller.scrollTop).toBe(1000);
  });

  it('opens at the first unread message, just under the "new messages" line', () => {
    const [a, b, c, d] = [msg(), msg(), msg(), msg()] as [
      MessageDto,
      MessageDto,
      MessageDto,
      MessageDto,
    ];
    const { scroller } = setup([a, b, c, d], { unreadAnchor: b.createdAt });
    // c is the first unread (row 2 at 200px); the line above it lands at the top with a gap.
    expect(scroller.scrollTop).toBe(200 - 8);
  });

  it('opens at the end in a chat never read before', () => {
    const { scroller } = setup([msg(), msg()], { unreadAnchor: null });
    expect(scroller.scrollTop).toBe(1000);
  });

  describe('when rows change height after the first layout', () => {
    let resize: () => void = () => {};
    beforeAll(() => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: () => void) {
            resize = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
    });

    it('stays at the end while the reader is at the end', () => {
      const { scroller } = setup([msg(), msg()]);
      scroller.scrollTop = 600; // rows measured taller: the end moved away, with no scroll event
      resize();
      expect(scroller.scrollTop).toBe(1000);
    });

    it('keeps the first visible row in place while the reader is away from the end', () => {
      const [a, b, c] = [msg(), msg(), msg()] as [MessageDto, MessageDto, MessageDto];
      const { scroller } = setup([a, b, c]);
      scroller.scrollTop = 150;
      fireEvent.scroll(scroller);
      scroller.scrollTop = 0; // a row above grew or shrank and the browser did not compensate
      resize();
      expect(scroller.scrollTop).toBe(150);
    });
  });
});
