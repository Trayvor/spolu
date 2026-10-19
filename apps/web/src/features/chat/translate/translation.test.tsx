import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IncomingTranslation, MessageDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { MessageItem } from '../message-item';
import { TranslateIncomingContext } from './translation';

vi.mock('../api', () => ({ deleteMessage: vi.fn(), editMessage: vi.fn() }));

const t = (key: string, options?: Record<string, string>) => i18n.t(key, options);
const ME = 'me';
const message = (over: Partial<MessageDto> = {}): MessageDto => ({
  id: 'm1',
  channelId: 'c1',
  parentId: null,
  replyToId: null,
  author: { id: 'other', name: 'Jana Nováková', isAdmin: false },
  body: 'Dobrý den, posílám rozpočet.',
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
  attachedTasks: [],
  attachedTickets: [],
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers the translate call with `answer`; returns the requested URLs. */
function stub(answer: () => Response | Promise<Response>) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/translate')) urls.push(String(url));
      return answer();
    }),
  );
  return urls;
}

function renderItem(over: Partial<MessageDto> = {}, offered = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TranslateIncomingContext value={offered}>
        <MessageItem
          message={message(over)}
          groupId="g1"
          showHeader
          mentionsMe={false}
          meId={ME}
          nameOf={() => undefined}
          onOpenThread={vi.fn()}
        />
      </TranslateIncomingContext>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const translated: IncomingTranslation = {
  text: 'Good morning, I am sending the budget.',
  sourceLanguage: 'cs',
  targetLanguage: 'en',
  unchanged: false,
};
const translateButton = () => screen.queryByRole('button', { name: t('chat.actions.translate') });

beforeEach(() => setLanguage('en'));
afterEach(() => vi.unstubAllGlobals());

describe('Translate on a received message', () => {
  it('is offered only on messages someone else wrote, where the chat offers it', () => {
    renderItem();
    expect(translateButton()).toBeInTheDocument();
  });

  it('is not offered on my own message', () => {
    renderItem({ author: { id: ME, name: 'Me', isAdmin: false } });
    expect(translateButton()).toBeNull();
  });

  it('is not offered when the chat does not offer it', () => {
    renderItem({}, false);
    expect(translateButton()).toBeNull();
  });

  it('is not offered on a deleted message', () => {
    renderItem({ deletedAt: '2026-10-14T10:00:00.000Z', body: '' });
    expect(translateButton()).toBeNull();
  });

  it('shows the translation in place with its language, and switches to the original', async () => {
    const urls = stub(() => json(translated));
    const user = renderItem();
    await user.click(translateButton()!);
    expect(await screen.findByText(translated.text)).toBeInTheDocument();
    expect(urls).toEqual(['/api/messages/m1/translate']);
    expect(screen.getByText(t('chat.translation.from', { language: 'Czech' }))).toBeInTheDocument();
    expect(screen.queryByText('Dobrý den, posílám rozpočet.')).toBeNull();
    // Translated already: the action is gone, the note switches.
    expect(translateButton()).toBeNull();

    await user.click(screen.getByRole('button', { name: t('chat.translation.showOriginal') }));
    expect(screen.getByText('Dobrý den, posílám rozpočet.')).toBeInTheDocument();
    expect(screen.queryByText(translated.text)).toBeNull();
    await user.click(screen.getByRole('button', { name: t('chat.translation.showTranslation') }));
    expect(screen.getByText(translated.text)).toBeInTheDocument();
    // Switching asks the server nothing more.
    expect(urls).toHaveLength(1);
  });

  it('says so while translating, and keeps the original when it is already in my language', async () => {
    let answer!: (r: Response) => void;
    stub(() => new Promise<Response>((resolve) => (answer = resolve)));
    const user = renderItem({ body: 'Good morning' });
    await user.click(translateButton()!);
    expect(screen.getByText(t('chat.translation.loading'))).toBeInTheDocument();
    answer(
      json({ text: 'Good morning', sourceLanguage: 'en', targetLanguage: 'en', unchanged: true }),
    );
    expect(
      await screen.findByText(t('chat.translation.unchanged', { language: 'English' })),
    ).toBeInTheDocument();
    expect(screen.getByText('Good morning')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('chat.translation.showOriginal') })).toBeNull();
  });

  it('a failure says so and tries again; too many translations say that', async () => {
    let status = 502;
    stub(() => (status === 200 ? json(translated) : json({ error: 'x' }, status)));
    const user = renderItem();
    await user.click(translateButton()!);
    expect(await screen.findByText(t('chat.translation.failed'))).toBeInTheDocument();
    status = 429;
    await user.click(screen.getByRole('button', { name: t('chat.translation.retry') }));
    expect(await screen.findByText(t('chat.translation.rateLimited'))).toBeInTheDocument();
    status = 200;
    await user.click(screen.getByRole('button', { name: t('chat.translation.retry') }));
    await waitFor(() => expect(screen.getByText(translated.text)).toBeInTheDocument());
  });
});
