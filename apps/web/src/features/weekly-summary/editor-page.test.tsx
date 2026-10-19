import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '@/i18n';
import { ADMIN, mockBulkApi, renderAt, reply, type Route } from '@/features/bulk-email/test-api';
import { isoWeek, shiftWeek } from './format';
import { dto } from './test-data';

const socket = vi.hoisted(() => ({ current: null as null | { reset(): void } }));
vi.mock('@/lib/socket', async () => {
  const { makeSocket } = await import('@/features/bulk-email/test-api');
  const s = makeSocket();
  socket.current = s;
  return { getSocket: () => s, connectSocket: vi.fn(), disconnectSocket: vi.fn() };
});

const PATH = '/api/weekly-summaries/s1';
const detail =
  (body: ReturnType<typeof dto>): Route =>
  (url, init) =>
    url.pathname === PATH && (init.method ?? 'GET') === 'GET' ? reply(200, body) : undefined;
const extras: Route = (url) => {
  if (url.pathname.endsWith('/weekly-summary/settings'))
    return reply(200, { enabled: true, canEdit: true });
  if (url.pathname === '/api/me/weekly-summary/reminder') return reply(200, { remind: true });
  return undefined;
};

describe('weekly summary editor', () => {
  beforeEach(async () => {
    await setLanguage('sk');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    socket.current?.reset();
  });

  it('a manager edits an item and saves with the current version', async () => {
    const { callsTo } = mockBulkApi(ADMIN, [
      detail(dto()),
      (url, init) =>
        url.pathname === PATH && init.method === 'PATCH'
          ? reply(200, dto({ version: 4 }))
          : undefined,
      extras,
    ]);
    const { user } = renderAt('/weekly-summaries/s1');
    const item = await screen.findByRole('textbox', { name: 'Čo sme urobili, bod 1' });
    await user.clear(item);
    await user.type(item, 'Nový bod');
    await user.click(screen.getByRole('button', { name: 'Uložiť' }));
    await waitFor(() => expect(callsTo('PATCH', PATH)).toHaveLength(1));
    const body = callsTo('PATCH', PATH)[0]!.body as {
      version: number;
      content: { done: { text: string }[] };
    };
    expect(body.version).toBe(3);
    expect(body.content.done[0]!.text).toBe('Nový bod');
  });

  it('a 409 stale_version shows the conflict and keeps the typed text until confirmed', async () => {
    const current = dto({ version: 5, updatedBy: { name: 'Peter Kolega' } });
    mockBulkApi(ADMIN, [
      detail(dto()),
      (url, init) =>
        url.pathname === PATH && init.method === 'PATCH'
          ? reply(409, { error: 'stale_version', current })
          : undefined,
      extras,
    ]);
    const { user } = renderAt('/weekly-summaries/s1');
    const intro = await screen.findByRole('textbox', { name: 'Úvod' });
    await user.type(intro, ' môj text');
    await user.click(screen.getByRole('button', { name: 'Uložiť' }));
    expect(
      await screen.findByText('Koncept medzitým upravil Peter Kolega. Načítať novú verziu?'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Úvod' })).toHaveValue('Dobrý deň môj text');
    await user.click(screen.getByRole('button', { name: 'Načítať novú verziu' }));
    expect(screen.getByRole('textbox', { name: 'Úvod' })).toHaveValue('Dobrý deň');
  });

  it('the aiFailed note is shown for a factual fallback', async () => {
    mockBulkApi(ADMIN, [detail(dto({ aiFailed: true })), extras]);
    renderAt('/weekly-summaries/s1');
    expect(await screen.findByText(/AI nebola dostupná/)).toBeInTheDocument();
  });

  it('a non-manager sees the read-only note and no Send button', async () => {
    mockBulkApi(ADMIN, [detail(dto({ canEdit: false, managedByMe: false })), extras]);
    renderAt('/weekly-summaries/s1');
    expect(
      await screen.findByText('Tento prehľad môže upraviť a poslať manažér skupiny.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Poslať klientom' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Úvod' })).toBeDisabled();
  });

  it('send asks Poslať prehľad 2 príjemcom? and on 409 refs_changed shows the note and the new content', async () => {
    const corrected = dto({
      version: 4,
      content: { ...dto().content, done: [dto().content.done[1]!] },
    });
    const { callsTo } = mockBulkApi(ADMIN, [
      detail(dto()),
      (url, init) =>
        url.pathname === `${PATH}/send` && init.method === 'POST'
          ? reply(409, { error: 'refs_changed', current: corrected })
          : undefined,
      extras,
    ]);
    const { user } = renderAt('/weekly-summaries/s1');
    await user.click(await screen.findByRole('button', { name: 'Poslať klientom' }));
    const dialog = await screen.findByTestId('weekly-send');
    expect(within(dialog).getByText('Poslať prehľad 2 príjemcom?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Poslať' }));
    expect(await screen.findByText(/Niektoré body už neplatia/)).toBeInTheDocument();
    expect(callsTo('POST', `${PATH}/send`)[0]!.body).toEqual({ version: 3 });
    expect(screen.queryByDisplayValue('Rozpočet')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Podali sme žiadosť o platbu')).toBeInTheDocument();
  });

  it('regenerate asks for confirmation first', async () => {
    const { callsTo } = mockBulkApi(ADMIN, [
      detail(dto()),
      (url) =>
        url.pathname === `${PATH}/regenerate` ? reply(202, { status: 'preparing' }) : undefined,
      extras,
    ]);
    const { user } = renderAt('/weekly-summaries/s1');
    await user.click(await screen.findByRole('button', { name: 'Pripraviť znova s AI' }));
    expect(
      screen.getByText(
        'Pripraviť koncept znova? Súčasný text sa uloží medzi predchádzajúce verzie.',
      ),
    ).toBeInTheDocument();
    expect(callsTo('POST', `${PATH}/regenerate`)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Pripraviť znova' }));
    await waitFor(() => expect(callsTo('POST', `${PATH}/regenerate`)).toHaveLength(1));
  });

  it('Predchádzajúce verzie (2) lists revisions and Obnoviť túto verziu restores one for the manager only', async () => {
    const revision = (id: string, version: number, text: string) => ({
      id,
      version,
      language: 'sk',
      source: 'ai',
      createdBy: { name: 'Jana Nováková' },
      createdAt: '2026-10-17T07:12:00.000Z',
      content: {
        ...dto().content,
        done: [{ id: '00000000-0000-4000-8000-000000000099', ref: null, text }],
      },
    });
    const { callsTo } = mockBulkApi(ADMIN, [
      detail(dto({ revisionCount: 2 })),
      (url) =>
        url.pathname === `${PATH}/revisions`
          ? reply(200, { items: [revision('r2', 2, 'Druhá'), revision('r1', 1, 'Prvá')] })
          : undefined,
      (url) =>
        url.pathname === `${PATH}/revisions/r1/restore`
          ? reply(200, dto({ version: 4, revisionCount: 3 }))
          : undefined,
      extras,
    ]);
    const { user } = renderAt('/weekly-summaries/s1');
    await user.click(await screen.findByRole('button', { name: 'Predchádzajúce verzie (2)' }));
    const dialog = await screen.findByTestId('weekly-revisions');
    expect(await within(dialog).findByText('Druhá')).toBeInTheDocument();
    expect(within(dialog).getByText(/Verzia 1 · AI/)).toBeInTheDocument();
    await user.click(within(dialog).getAllByRole('button', { name: 'Obnoviť túto verziu' })[1]!);
    await waitFor(() => expect(callsTo('POST', `${PATH}/revisions/r1/restore`)).toHaveLength(1));
    expect(callsTo('POST', `${PATH}/revisions/r1/restore`)[0]!.body).toEqual({ version: 3 });
  });

  it('a non-manager sees revisions without the restore button', async () => {
    mockBulkApi(ADMIN, [
      detail(dto({ revisionCount: 1, canEdit: false, managedByMe: false })),
      (url) => (url.pathname === `${PATH}/revisions` ? reply(200, { items: [] }) : undefined),
      extras,
    ]);
    const { user } = renderAt('/weekly-summaries/s1');
    await user.click(await screen.findByRole('button', { name: 'Predchádzajúce verzie (1)' }));
    await screen.findByTestId('weekly-revisions');
    expect(screen.queryByRole('button', { name: 'Obnoviť túto verziu' })).not.toBeInTheDocument();
  });

  it("an older week's draft shows the Koncept z týždňa note and can be sent", async () => {
    const week = shiftWeek(isoWeek(new Date()), -2);
    mockBulkApi(ADMIN, [detail(dto({ week })), extras]);
    renderAt('/weekly-summaries/s1');
    expect(
      await screen.findByText(new RegExp(`^Koncept z týždňa ${Number(week.slice(6))}\\.`)),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poslať klientom' })).toBeEnabled();
  });

  it('the preview iframe is sandboxed and uses srcdoc', async () => {
    mockBulkApi(ADMIN, [
      detail(dto()),
      (url) =>
        url.pathname === `${PATH}/preview`
          ? reply(200, { subject: 'Týždenný prehľad: Firma A', html: '<p>Ahoj</p>', text: 'Ahoj' })
          : undefined,
      extras,
    ]);
    const { user } = renderAt('/weekly-summaries/s1');
    await user.click(await screen.findByRole('button', { name: 'Náhľad' }));
    const frame = await screen.findByTitle('Náhľad e-mailu');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<p>Ahoj</p>');
  });

  it('moving an item down swaps it with the next one', async () => {
    mockBulkApi(ADMIN, [detail(dto()), extras]);
    renderAt('/weekly-summaries/s1');
    const first = await screen.findByRole('textbox', { name: 'Čo sme urobili, bod 1' });
    expect(first).toHaveValue('Rozpočet');
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Nižšie' })[0]!);
    });
    expect(screen.getByRole('textbox', { name: 'Čo sme urobili, bod 1' })).toHaveValue(
      'Podali sme žiadosť o platbu',
    );
    expect(screen.getByRole('textbox', { name: 'Čo sme urobili, bod 2' })).toHaveValue('Rozpočet');
  });
});
