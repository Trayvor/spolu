import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { CLAUDE_NEW_CHAT_URL, claudeChatUrl, type TicketDto } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import {
  ADMIN,
  CLIENT,
  fakeSocket,
  mockTicketApi,
  reply,
  ticket,
} from '@/features/tickets/test-api';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function renderTicket(me: unknown, dto: TicketDto, answer: { prompt: string; files: unknown[] }) {
  const api = mockTicketApi(me, [
    (url, init) => {
      if (url.pathname === '/api/tickets/k1' && (init?.method ?? 'GET') === 'GET') {
        return reply(200, dto);
      }
      if (url.pathname === '/api/tickets/k1/followers') return reply(200, []);
      if (url.pathname === '/api/tickets/k1/claude-prompt' && init?.method === 'POST') {
        return reply(200, answer);
      }
      return undefined;
    },
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(
    queryClient,
    createMemoryHistory({ initialEntries: ['/tickets/k1'] }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return api;
}

const open = vi.fn();
const writeText = vi.fn<(text: string) => Promise<void>>();

function stubBrowser() {
  open.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('open', open);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Solve with Claude', () => {
  it('is not there for a client', async () => {
    renderTicket(CLIENT, ticket(), { prompt: 'x', files: [] });
    expect(
      await screen.findByRole('heading', { name: 'Cannot submit the application' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('openInClaude.button') })).toBeNull();
  });

  it('generates with empty notes and opens the prefilled Claude chat', async () => {
    stubBrowser();
    const { fetchMock } = renderTicket(ADMIN, ticket(), { prompt: 'Pomôž mi', files: [] });
    await userEvent.click(await screen.findByRole('button', { name: t('openInClaude.button') }));
    const dialog = await screen.findByTestId('solve-with-claude');
    const notes = within(dialog).getByRole('textbox', { name: t('openInClaude.notesLabel') });
    expect(notes).toHaveValue('');
    expect(notes).toHaveAttribute('placeholder', t('openInClaude.notesPlaceholder'));
    expect(within(dialog).getByText(t('openInClaude.notesHint'))).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: t('openInClaude.generate') }));
    const post = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(call).toBeDefined();
      return call!;
    });
    expect(JSON.parse(post[1]!.body as string)).toEqual({ notes: '' });
    await userEvent.click(
      await within(dialog).findByRole('button', { name: t('openInClaude.open') }),
    );
    expect(open).toHaveBeenCalledWith(claudeChatUrl('Pomôž mi'), '_blank', 'noopener');
    expect(writeText).not.toHaveBeenCalled();
    expect(within(dialog).queryByText(t('openInClaude.filesReminder'))).toBeNull();
  });

  it('sends the notes, copies a long prompt, opens an empty chat and reminds of the files', async () => {
    stubBrowser();
    const long = 'ž'.repeat(3000);
    const { fetchMock } = renderTicket(ADMIN, ticket(), {
      prompt: long,
      files: [{ id: 'f1', name: 'log.txt' }],
    });
    await userEvent.click(await screen.findByRole('button', { name: t('openInClaude.button') }));
    const dialog = await screen.findByTestId('solve-with-claude');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: t('openInClaude.notesLabel') }),
      'Pozri termíny',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: t('openInClaude.generate') }));
    await userEvent.click(
      await within(dialog).findByRole('button', { name: t('openInClaude.open') }),
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ notes: 'Pozri termíny' });
    expect(writeText).toHaveBeenCalledWith(long);
    expect(open).toHaveBeenCalledWith(CLAUDE_NEW_CHAT_URL, '_blank', 'noopener');
    expect(await within(dialog).findByText(t('openInClaude.status.pasteInClaude'))).toBeVisible();
    expect(within(dialog).getByText(t('openInClaude.filesReminder'))).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'log.txt' })).toHaveAttribute(
      'href',
      '/api/files/f1',
    );

    await userEvent.click(within(dialog).getByRole('button', { name: t('openInClaude.copy') }));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(await within(dialog).findByText(t('openInClaude.status.copied'))).toBeVisible();
  });

  it('says so when the clipboard refuses', async () => {
    stubBrowser();
    writeText.mockRejectedValue(new Error('denied'));
    renderTicket(ADMIN, ticket(), { prompt: 'krátky', files: [] });
    await userEvent.click(await screen.findByRole('button', { name: t('openInClaude.button') }));
    const dialog = await screen.findByTestId('solve-with-claude');
    await userEvent.click(within(dialog).getByRole('button', { name: t('openInClaude.generate') }));
    await userEvent.click(
      await within(dialog).findByRole('button', { name: t('openInClaude.copy') }),
    );
    expect(await within(dialog).findByText(t('openInClaude.status.copyFailed'))).toBeVisible();
  });
});
