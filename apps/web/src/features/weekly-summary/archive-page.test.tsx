import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '@/i18n';
import { ADMIN, mockBulkApi, renderAt, reply, type Route } from '@/features/bulk-email/test-api';
import { archiveItem, content } from './test-data';

const socket = vi.hoisted(() => ({ current: null as null | { reset(): void } }));
vi.mock('@/lib/socket', async () => {
  const { makeSocket } = await import('@/features/bulk-email/test-api');
  const s = makeSocket();
  socket.current = s;
  return { getSocket: () => s, connectSocket: vi.fn(), disconnectSocket: vi.fn() };
});

const archive =
  (pages: Record<string, { items: unknown[]; nextCursor: string | null }>): Route =>
  (url) =>
    url.pathname === '/api/weekly-summaries/archive'
      ? reply(200, pages[url.searchParams.get('cursor') ?? ''] ?? { items: [], nextCursor: null })
      : undefined;
const groups: Route = (url) =>
  url.pathname === '/api/weekly-summaries/groups'
    ? reply(200, {
        items: [
          { id: 'g1', name: 'Firma A', deactivated: false },
          { id: 'g2', name: 'Firma Z', deactivated: true },
        ],
      })
    : undefined;

describe('the archive of weekly summaries', () => {
  beforeEach(async () => {
    await setLanguage('sk');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    socket.current?.reset();
  });

  it('filters live in the URL', async () => {
    const { callsTo } = mockBulkApi(ADMIN, [archive({}), groups]);
    const { user, router } = renderAt('/weekly-summaries/archive');
    await user.click(await screen.findByRole('searchbox', { name: 'Klient' }));
    await user.click(await screen.findByRole('button', { name: 'Firma A' }));
    await user.type(screen.getByLabelText('Od'), '2026-03-01');
    await user.type(screen.getByLabelText('Do'), '2026-06-30');
    await user.type(screen.getByRole('searchbox', { name: 'Hľadať v texte' }), 'platbu');
    await user.click(screen.getByRole('button', { name: 'Neodoslané' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        groupId: 'g1',
        from: '2026-03-01',
        to: '2026-06-30',
        q: 'platbu',
        status: 'unsent',
      }),
    );
    await waitFor(() =>
      expect(callsTo('GET', '/api/weekly-summaries/archive').at(-1)!.path).toContain('q=platbu'),
    );
  });

  it('opening a URL restores the filters', async () => {
    const { callsTo } = mockBulkApi(ADMIN, [archive({}), groups]);
    renderAt('/weekly-summaries/archive?groupId=g1&q=platbu&status=sent');
    expect(await screen.findByRole('searchbox', { name: 'Hľadať v texte' })).toHaveValue('platbu');
    await waitFor(() =>
      expect(callsTo('GET', '/api/weekly-summaries/archive')[0]!.path).toContain('groupId=g1'),
    );
    expect(screen.getByRole('button', { name: 'Odoslané' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('a number in the URL searches as text (the router parses ?q=2026 as a number)', async () => {
    const { callsTo } = mockBulkApi(ADMIN, [archive({}), groups]);
    renderAt('/weekly-summaries/archive?q=2026&groupId=707');
    expect(await screen.findByRole('searchbox', { name: 'Hľadať v texte' })).toHaveValue('2026');
    await waitFor(() =>
      expect(callsTo('GET', '/api/weekly-summaries/archive')[0]!.path).toContain('q=2026'),
    );
    expect(callsTo('GET', '/api/weekly-summaries/archive')[0]!.path).toContain('groupId=707');
  });

  it('each report shows its week, status and full content', async () => {
    mockBulkApi(ADMIN, [archive({ '': { items: [archiveItem({ id: 'a1' })], nextCursor: null } })]);
    renderAt('/weekly-summaries/archive');
    const card = (await screen.findByRole('heading', { name: 'Firma A' })).closest('li')!;
    expect(within(card).getByText(/Odoslané 17\. 10\. 2026 · Jana Nováková/)).toBeInTheDocument();
    expect(within(card).getByText('Dobrý deň')).toBeInTheDocument();
    expect(within(card).getByText('Podali sme žiadosť o platbu')).toBeInTheDocument();
    expect(within(card).getByText('Čo sme urobili')).toBeInTheDocument();
  });

  it('matched text is marked and stored text stays text', async () => {
    const c = content();
    c.done[0]!.text = '<b>x</b>';
    mockBulkApi(ADMIN, [
      archive({ '': { items: [archiveItem({ id: 'a1', content: c })], nextCursor: null } }),
    ]);
    renderAt('/weekly-summaries/archive?q=platbu');
    const mark = await screen.findByText('platbu', { selector: 'mark' });
    expect(mark.tagName).toBe('MARK');
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
  });

  it('Načítať ďalšie loads the next page; empty filters show the empty line', async () => {
    mockBulkApi(ADMIN, [
      archive({
        '': { items: [archiveItem({ id: 'a1' })], nextCursor: 'c2' },
        c2: { items: [archiveItem({ id: 'a2', groupName: 'Firma B' })], nextCursor: null },
      }),
    ]);
    const { user } = renderAt('/weekly-summaries/archive');
    await user.click(await screen.findByRole('button', { name: 'Načítať ďalšie' }));
    expect(await screen.findByRole('heading', { name: 'Firma B' })).toBeInTheDocument();
  });

  it('empty filters show Pre tieto filtre nie je žiadny prehľad.', async () => {
    mockBulkApi(ADMIN, [archive({})]);
    renderAt('/weekly-summaries/archive');
    expect(await screen.findByText('Pre tieto filtre nie je žiadny prehľad.')).toBeInTheDocument();
  });

  it('a deactivated client is listed as (deaktivovaná) in the picker', async () => {
    mockBulkApi(ADMIN, [archive({}), groups]);
    const { user } = renderAt('/weekly-summaries/archive');
    await user.click(await screen.findByRole('searchbox', { name: 'Klient' }));
    expect(
      await screen.findByRole('button', { name: 'Firma Z (deaktivovaná)' }),
    ).toBeInTheDocument();
  });
});
