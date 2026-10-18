import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GroupPerson } from '@spolu/shared';
import { setLanguage, i18n } from '@/i18n';
import { groupPeopleQuery } from '@/features/groups/api';
import { Composer, type ComposerProps } from './composer';
import { ChatScopeProvider, type ChatScope } from './chat-scope';

vi.mock('@/features/files/upload', () => ({ uploadFile: vi.fn() }));
// The picker is a lazy chunk with its own tests: here only the tab it is told to open on matters.
vi.mock('./attach-picker', () => ({
  default: ({ initialTab }: { initialTab?: string }) => (
    <div data-testid="picker-stub">{initialTab}</div>
  ),
}));

const people: GroupPerson[] = [
  { id: 'jana', name: 'Jana Nováková', isAdmin: false, isManager: false },
];
const t = (key: string) => i18n.t(key);

async function renderComposer(scope: ChatScope = {}, props: Partial<ComposerProps> = {}) {
  const client = new QueryClient();
  client.setQueryData(groupPeopleQuery('g1').queryKey, people);
  const view = render(
    <QueryClientProvider client={client}>
      <ChatScopeProvider scope={scope}>
        <Composer mode="new" groupId="g1" onSubmit={vi.fn()} {...props} />
      </ChatScopeProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole('textbox');
  return view;
}

beforeAll(async () => {
  await setLanguage('en');
});

describe('the composer plus menu', () => {
  it('offers knowledge, tasks, ticket and a file upload under one Add button', async () => {
    const user = userEvent.setup();
    await renderComposer();
    expect(screen.queryByRole('button', { name: t('chat.composer.attach') })).toBeNull();
    await user.click(screen.getByRole('button', { name: t('chat.composer.add') }));
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual([
      t('chat.work.tabs.knowledge'),
      t('chat.work.tabs.tasks'),
      t('chat.composer.addTicket'),
      t('chat.composer.addUpload'),
    ]);
  });

  it('puts a decorative icon before each label', async () => {
    const user = userEvent.setup();
    await renderComposer();
    await user.click(screen.getByRole('button', { name: t('chat.composer.add') }));
    for (const item of screen.getAllByRole('menuitem')) {
      const svg = item.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(item.firstElementChild).toBe(svg);
    }
  });

  it.each([
    ['chat.work.tabs.knowledge', 'knowledge'],
    ['chat.work.tabs.tasks', 'tasks'],
    ['chat.composer.addTicket', 'tickets'],
  ])('%s opens the picker on its tab', async (key, tab) => {
    const user = userEvent.setup();
    await renderComposer();
    await user.click(screen.getByRole('button', { name: t('chat.composer.add') }));
    await user.click(screen.getByRole('menuitem', { name: t(key) }));
    expect(await screen.findByTestId('picker-stub')).toHaveTextContent(tab);
  });

  it('the upload item opens the file chooser', async () => {
    const user = userEvent.setup();
    const { container } = await renderComposer();
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: t('chat.composer.add') }));
    await user.click(screen.getByRole('menuitem', { name: t('chat.composer.addUpload') }));
    expect(click).toHaveBeenCalledOnce();
  });

  it('is keyboard operable', async () => {
    const user = userEvent.setup();
    await renderComposer();
    screen.getByRole('button', { name: t('chat.composer.add') }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByTestId('picker-stub')).toBeInTheDocument();
  });

  it('without knowledge access the button goes straight to the file chooser', async () => {
    const user = userEvent.setup();
    const { container } = await renderComposer({ knowledgeViaMessage: true });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    expect(screen.queryByRole('button', { name: t('chat.composer.add') })).toBeNull();
    await user.click(screen.getByRole('button', { name: t('chat.composer.attach') }));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('edit mode has no plus button', async () => {
    await renderComposer({}, { mode: 'edit', initialBody: 'a' });
    expect(screen.queryByRole('button', { name: t('chat.composer.add') })).toBeNull();
  });
});
