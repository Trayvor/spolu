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
  tasks: [],
  reactions: [],
  knowledge: [],
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
/** The sheet's action rows, without the quick reactions above them (Phase 28). */
const sheetRows = () =>
  within(sheet())
    .getAllByRole('button')
    .filter((b) => !b.closest('[role=group]'))
    .map((b) => b.textContent);

beforeEach(() => setLanguage('en'));
afterEach(() => vi.useRealTimers());

describe('message actions: touch and desktop', () => {
  it('switches with one media query: a hidden actions button on touch, the hover bar on desktop', () => {
    renderItem();
    const touchOnly = '[@media(hover:hover)_and_(min-width:641px)]:hidden';
    // No visible "⋯" on touch: the button is for screen readers and keyboards only.
    expect(touchButton()).toHaveClass(touchOnly, 'sr-only');
    const bar = screen.getByRole('toolbar', { name: t('chat.actions.label') });
    expect(bar).toHaveClass('hidden', '[@media(hover:hover)_and_(min-width:641px)]:flex');
    // The desktop bar sits just above the message, so it never reaches the name or time.
    expect(bar).toHaveClass('bottom-full');
    expect(bar).not.toHaveClass('-top-4');
  });

  it('the actions button opens a sheet with the menu actions and Copy, in order; Delete is red', async () => {
    const { user } = renderItem();
    await user.click(touchButton());
    expect(sheetRows()).toEqual([
      t('chat.actions.replyInThread'),
      t('chat.actions.copy'),
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
    expect(sheetRows()).toEqual([t('chat.actions.quote'), t('chat.actions.copy')]);
  });

  it('puts an inMenu action behind "More" on desktop and in the phone sheet', async () => {
    const onSelect = vi.fn();
    const action = {
      id: 'tasks',
      label: 'Turn into tasks',
      icon: <span />,
      inMenu: true,
      onSelect,
    };
    const { user } = renderItem({ message: message({ body: 'Do it' }), messageActions: [action] });
    const bar = screen.getByRole('toolbar', { name: t('chat.actions.label') });
    expect(within(bar).queryByRole('button', { name: 'Turn into tasks' })).toBeNull();
    await user.click(within(bar).getByRole('button', { name: t('chat.actions.more') }));
    await user.click(await screen.findByRole('menuitem', { name: 'Turn into tasks' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ body: 'Do it' }));
    await user.click(touchButton());
    expect(sheetRows()).toContain('Turn into tasks');
  });

  it('lists inMenu extras before Edit and Delete behind "More"', async () => {
    const action = {
      id: 'tasks',
      label: 'Turn into tasks',
      icon: <span />,
      inMenu: true,
      onSelect: vi.fn(),
    };
    const { user } = renderItem({ messageActions: [action] });
    const bar = screen.getByRole('toolbar', { name: t('chat.actions.label') });
    await user.click(within(bar).getByRole('button', { name: t('chat.actions.more') }));
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent);
    expect(items).toEqual(['Turn into tasks', t('chat.actions.edit'), t('chat.actions.delete')]);
  });

  it('hides an action whose isAvailable says no, in the bar, the menu and the sheet', async () => {
    const action = {
      id: 'tasks',
      label: 'Turn into tasks',
      icon: <span />,
      inMenu: true,
      isAvailable: (m: MessageDto) => m.body.trim() !== '',
      onSelect: vi.fn(),
    };
    const { user } = renderItem({
      message: message({
        body: '',
        attachments: [
          {
            id: 'a1',
            name: 'a.pdf',
            mime: 'application/pdf',
            size: 1,
            width: null,
            height: null,
            hasPreview: false,
          },
        ],
      }),
      messageActions: [action],
    });
    await user.click(touchButton());
    expect(within(sheet()).queryByRole('button', { name: 'Turn into tasks' })).toBeNull();
    const bar = screen.getByRole('toolbar', { name: t('chat.actions.label') });
    expect(within(bar).queryByRole('button', { name: 'Turn into tasks' })).toBeNull();
    await user.click(within(bar).getByRole('button', { name: t('chat.actions.more') }));
    await screen.findAllByRole('menuitem');
    expect(screen.queryByRole('menuitem', { name: 'Turn into tasks' })).toBeNull();
  });

  it('extra actions (Phase 9) come after the reply, on both layouts', async () => {
    const onSelect = vi.fn();
    const { user } = renderItem({
      messageActions: [{ id: 'tasks', label: 'Turn into tasks', icon: null, onSelect }],
    });
    const bar = screen.getByRole('toolbar', { name: t('chat.actions.label') });
    expect(within(bar).getByRole('button', { name: 'Turn into tasks' })).toBeInTheDocument();
    await user.click(touchButton());
    expect(sheetRows()[2]).toBe('Turn into tasks');
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

  it('closes on Escape and on a tap outside, and gives the focus back to the actions button', async () => {
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

  // jsdom drops `-webkit-touch-callout`, set beside `user-select`; only the latter is checked.
  it('a held finger turns off text selection and shows the press; lifting restores them', () => {
    vi.useFakeTimers();
    renderItem();
    fireEvent.touchStart(row(), { touches: [{ clientX: 10, clientY: 10 }] });
    expect(row().style.getPropertyValue('user-select')).toBe('none');
    expect(row()).not.toHaveAttribute('data-pressed');
    act(() => vi.advanceTimersByTime(150));
    expect(row()).toHaveAttribute('data-pressed');
    fireEvent.touchEnd(row(), { touches: [] });
    expect(row()).not.toHaveAttribute('data-pressed');
    expect(row().style.getPropertyValue('user-select')).toBe('');
    expect(row()).toHaveClass('touch-manipulation');
  });

  it('a long press vibrates lightly where the device can', () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    renderItem();
    fireEvent.touchStart(row(), { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => vi.advanceTimersByTime(450));
    expect(vibrate).toHaveBeenCalledWith(10);
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  function tap(target: Element, x = 10, y = 10) {
    fireEvent.touchStart(target, { touches: [{ clientX: x, clientY: y }] });
    return fireEvent.touchEnd(target, { touches: [] });
  }

  it('a double tap on the text opens the sheet and cancels the click of the second tap', () => {
    vi.useFakeTimers();
    renderItem();
    const text = screen.getByText('Hello there');
    expect(tap(text)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => vi.advanceTimersByTime(100));
    // `false`: the second touchend was prevented, so no click lands on the new backdrop.
    expect(tap(text, 14, 12)).toBe(false);
    expect(screen.getByRole('dialog', { name: t('chat.actions.open') })).toBeInTheDocument();
  });

  it('two slow taps, or two taps far apart, are no double tap', () => {
    vi.useFakeTimers();
    renderItem();
    const text = screen.getByText('Hello there');
    tap(text);
    act(() => vi.advanceTimersByTime(400));
    tap(text);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    tap(text, 10, 10);
    act(() => vi.advanceTimersByTime(100));
    tap(text, 10, 80);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('taps on a link keep their single-tap meaning: a double tap there opens nothing', () => {
    vi.useFakeTimers();
    renderItem({ message: message({ body: 'See https://egrant.sk now' }) });
    const link = screen.getByRole('link');
    expect(tap(link)).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    expect(tap(link)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Copy (touch sheet only) puts the message text on the clipboard and says so', async () => {
    const { user } = renderItem({
      message: message({ author: { id: 'anna', name: 'Anna', isAdmin: false } }),
    });
    // After `userEvent.setup()`, which installs its own clipboard.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    // Not on the desktop bar, and others' messages still have no "More".
    const bar = screen.getByRole('toolbar', { name: t('chat.actions.label') });
    expect(within(bar).queryByRole('button', { name: t('chat.actions.copy') })).toBeNull();
    expect(within(bar).queryByRole('button', { name: t('chat.actions.more') })).toBeNull();
    await user.click(touchButton());
    await user.click(within(sheet()).getByRole('button', { name: t('chat.actions.copy') }));
    expect(writeText).toHaveBeenCalledWith('Hello there');
    expect(await screen.findByText(t('chat.copied'))).toBeInTheDocument();
  });
});
