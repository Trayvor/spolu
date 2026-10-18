import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TicketDraft as Draft } from '@spolu/shared';
import { i18n } from '@/i18n';
import { loadNamespace } from '@/i18n/namespaces';
import { sessionQuery } from '@/features/auth/use-session';
import { aiStatusQuery } from '@/features/task-split/api';
import { ADMIN, CLIENT } from '@/features/tickets/test-api';
import { TicketDraft } from './index';

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

beforeAll(async () => {
  await Promise.all([loadNamespace('ticketDraft'), loadNamespace('forms'), loadNamespace('chat')]);
});
afterEach(() => vi.unstubAllGlobals());

const DRAFT: Draft = {
  reply: 'Dobrý deň, **pani Klára**, posielame postup.',
  sources: [
    { kind: 'knowledge', id: 'n1', type: 'note', title: 'Zmena rozpočtu', fromAdminGroup: false },
    { kind: 'ticket', id: 't98', number: 98, subject: 'Predmet tiketu' },
  ],
};

type Answer = { status: number; body: unknown } | 'hang';

/** Stubs `fetch` for the draft route; records the signals it got. */
function stubDraft(answer: Answer) {
  const signals: AbortSignal[] = [];
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe('/api/tickets/k1/ai-draft');
      signals.push(init!.signal!);
      bodies.push(JSON.parse(String(init!.body)));
      if (answer === 'hang') return new Promise<Response>(() => undefined);
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return { signals, bodies };
}

function setup(me: unknown, opts: { ticketDraft?: boolean; text?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQuery.queryKey, me as never);
  queryClient.setQueryData(aiStatusQuery.queryKey, {
    taskSplit: true,
    meetingSummary: false,
    transcription: false,
    ticketDraft: opts.ticketDraft ?? true,
  });
  let text = opts.text ?? '';
  const draft = {
    getText: vi.fn(() => text),
    setText: vi.fn((next: string) => {
      text = next;
    }),
    focus: vi.fn(),
  };
  render(
    <QueryClientProvider client={queryClient}>
      <TicketDraft ticketId="k1" number={123} client="Supermesto" draft={draft} />
    </QueryClientProvider>,
  );
  return draft;
}

const button = () => screen.findByRole('button', { name: t('ticketDraft.button') });

describe('Navrhnúť odpoveď', () => {
  it('is hidden for a client', async () => {
    setup(CLIENT);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: t('ticketDraft.button') })).toBeNull();
  });

  it('is hidden when the server does not offer drafts', async () => {
    setup(ADMIN, { ticketDraft: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: t('ticketDraft.button') })).toBeNull();
  });

  it('drafts and shows the reply and its sources', async () => {
    const { bodies } = stubDraft({ status: 200, body: DRAFT });
    setup(ADMIN);
    await userEvent.click(await button());
    expect(screen.getByText(t('ticketDraft.subtitle', { number: 123, client: 'Supermesto' })));
    await userEvent.type(screen.getByLabelText(t('ticketDraft.instructions.label')), 'Stručne');
    await userEvent.click(screen.getByRole('button', { name: t('ticketDraft.generate') }));
    expect(await screen.findByText('pani Klára')).toBeInTheDocument();
    expect(bodies).toEqual([{ instructions: 'Stručne' }]);
    expect(screen.getByText(t('ticketDraft.sources.title'))).toBeInTheDocument();
    expect(screen.getByText('Zmena rozpočtu')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '#98 Predmet tiketu' });
    expect(link).toHaveAttribute('href', '/tickets/t98');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText(t('ticketDraft.note'))).toBeInTheDocument();
  });

  it('warns when the draft has no sources', async () => {
    stubDraft({ status: 200, body: { reply: 'Dobrý deň', sources: [] } });
    setup(ADMIN);
    await userEvent.click(await button());
    await userEvent.click(screen.getByRole('button', { name: t('ticketDraft.generate') }));
    expect(await screen.findByText(t('ticketDraft.sources.none'))).toBeInTheDocument();
  });

  it('inserts into an empty composer and closes the dialog', async () => {
    stubDraft({ status: 200, body: DRAFT });
    const draft = setup(ADMIN);
    await userEvent.click(await button());
    await userEvent.click(screen.getByRole('button', { name: t('ticketDraft.generate') }));
    await userEvent.click(await screen.findByRole('button', { name: t('ticketDraft.insert') }));
    expect(draft.setText).toHaveBeenCalledWith(DRAFT.reply);
    expect(screen.queryByTestId('ticket-draft')).toBeNull();
    await waitFor(() => expect(draft.focus).toHaveBeenCalled());
  });

  it('replaces a non-empty draft with the replace label', async () => {
    stubDraft({ status: 200, body: DRAFT });
    const draft = setup(ADMIN, { text: 'abc' });
    await userEvent.click(await button());
    await userEvent.click(screen.getByRole('button', { name: t('ticketDraft.generate') }));
    await userEvent.click(await screen.findByRole('button', { name: t('ticketDraft.replace') }));
    expect(draft.setText).toHaveBeenCalledWith(DRAFT.reply);
  });

  it.each([
    [429, 'ticketDraft.errors.rateLimited'],
    [503, 'ticketDraft.errors.unavailable'],
    [502, 'ticketDraft.errors.unavailable'],
    [404, 'ticketDraft.errors.notFound'],
  ])('maps %i to its message', async (status, key) => {
    stubDraft({ status, body: { error: 'x' } });
    setup(ADMIN);
    await userEvent.click(await button());
    await userEvent.click(screen.getByRole('button', { name: t('ticketDraft.generate') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t(key));
  });

  it('aborts the request when the dialog closes', async () => {
    const { signals } = stubDraft('hang');
    setup(ADMIN);
    await userEvent.click(await button());
    await userEvent.click(screen.getByRole('button', { name: t('ticketDraft.generate') }));
    expect(await screen.findByText(t('ticketDraft.generating'))).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('ticket-draft')).toBeNull());
    expect(signals[0]!.aborted).toBe(true);
  });
});
