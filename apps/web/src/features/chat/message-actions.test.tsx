import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MessageDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { MessageItem, type MessageItemProps } from './message-item';

vi.mock('./api', () => ({ deleteMessage: vi.fn(), editMessage: vi.fn() }));

const t = (key: string) => i18n.t(key);
const ME = 'me';
const message = (over: Partial<MessageDto> = {}): MessageDto => ({
  id: 'm1',
  channelId: 'c1',
  parentId: null,
  replyToId: null,
  author: { id: ME, name: 'Me Myself', isAdmin: false },
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
  changeSeq: 1,
  ...over,
});

function renderItem(props: Partial<MessageItemProps> = {}) {
  const client = new QueryClient();
  const onOpenThread = vi.fn();
  const onReply = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MessageItem
        message={message()}
        groupId="g1"
        showHeader
        mentionsMe={false}
        meId={ME}
        nameOf={() => undefined}
        onOpenThread={onOpenThread}
        onReply={onReply}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onOpenThread, onReply };
}

const row = () => document.querySelector<HTMLElement>('[data-message-id="m1"]')!;
const touchButton = () => screen.getByRole('button', { name: t('chat.actions.open') });
const sheet = () => screen.getByRole('dialog', { name: t('chat.actions.open') });
const sheetRows = () =>
  within(sheet())
    .getAllByRole('button')
    .map((b) => b.textContent);

beforeEach(() => setLanguage('en'));
afterEach(() => vi.useRealTimers());

describe('message actions: touch and desktop', () => {
  it('switches with one media query: the "⋯" button on touch, the hover bar on desktop', () => {
    renderItem();
    const touchOnly = '[@media(hover:hover)_and_(min-width:641px)]:hidden';
    expect(touchButton()).toHaveClass(touchOnly);
    const bar = screen.getByRole('toolbar', { name: t('chat.actions.label') });
    expect(bar).toHaveClass('hidden', '[@media(hover:hover)_and_(min-width:641px)]:flex');
    // The desktop bar sits on the boundary above the message, not over the name and time.
    expect(bar).toHaveClass('-top-4');
  });

  it('"⋯" opens a sheet with the same actions as the menu, in order; Delete is red', async () => {
    const { user } = renderItem();
    await user.click(touchButton());
    expect(sheetRows()).toEqual([
      t('chat.actions.replyInThread'),
      t('chat.actions.edit'),
      t('chat.actions.delete'),
    ]);
    expect(within(sheet()).getByRole('button', { name: t('chat.actions.delete') })).toHaveClass(
      'text-error-ink',
    );
    expect(row()).toHaveClass('bg-accent');
  });

  it('inside a thread the first action is Quote; others see no Edit or Delete', async () => {
    const { user } = renderItem({
      inThread: true,
      message: message({ author: { id: 'anna', name: 'Anna', isAdmin: false } }),
    });
    await user.click(touchButton());
    expect(sheetRows()).toEqual([t('chat.actions.quote')]);
  });

  it('extra actions (Phase 9) come after the reply, on both layouts', async () => {
    const onSelect = vi.fn();
    const { user } = renderItem({
      messageActions: [{ id: 'tasks', label: 'Turn into tasks', icon: null, onSelect }],
    });
    const bar = screen.getByRole('toolbar', { name: t('chat.actions.label') });
    expect(within(bar).getByRole('button', { name: 'Turn into tasks' })).toBeInTheDocument();
    await user.click(touchButton());
    expect(sheetRows()[1]).toBe('Turn into tasks');
    await user.click(within(sheet()).getByRole('button', { name: 'Turn into tasks' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a row runs its action and closes the sheet', async () => {
    const { user, onOpenThread } = renderItem();
    await user.click(touchButton());
    await user.click(
      within(sheet()).getByRole('button', { name: t('chat.actions.replyInThread') }),
    );
    expect(onOpenThread).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(row()).not.toHaveClass('bg-accent');
  });

  it('Edit from the sheet opens the editor', async () => {
    const { user } = renderItem();
    await user.click(touchButton());
    await user.click(within(sheet()).getByRole('button', { name: t('chat.actions.edit') }));
    expect(screen.getByRole('textbox', { name: t('chat.actions.edit') })).toBeInTheDocument();
  });

  it('closes on Escape and on a tap outside, and gives the focus back to "⋯"', async () => {
    const { user } = renderItem();
    await user.click(touchButton());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(touchButton()).toHaveFocus();
    await user.click(touchButton());
    await user.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a long press (450 ms) opens the sheet; moving the finger cancels it', () => {
    vi.useFakeTimers();
    renderItem();
    fireEvent.touchStart(row(), { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(row(), { touches: [{ clientX: 10, clientY: 40 }] });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.touchStart(row(), { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole('dialog', { name: t('chat.actions.open') })).toBeInTheDocument();
  });
});
