import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '@/i18n';
import { ADMIN, mockBulkApi, renderAt, reply } from '@/features/bulk-email/test-api';
import { isoWeek, shiftWeek } from './format';
import { listItem } from './test-data';

const socket = vi.hoisted(() => ({ current: null as null | { reset(): void } }));
vi.mock('@/lib/socket', async () => {
  const { makeSocket } = await import('@/features/bulk-email/test-api');
  const s = makeSocket();
  socket.current = s;
  return { getSocket: () => s, connectSocket: vi.fn(), disconnectSocket: vi.fn() };
});

const list =
  (items: ReturnType<typeof listItem>[], olderDrafts = 0) =>
  (url: URL) =>
    url.pathname === '/api/weekly-summaries'
      ? reply(200, { items, nextCursor: null, olderDrafts })
      : undefined;

describe('weekly summaries list', () => {
  beforeEach(async () => {
    localStorage.clear();
    await setLanguage('sk');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    socket.current?.reset();
  });

  it('shows a row per group with status, source and counts', async () => {
    mockBulkApi(ADMIN, [list([listItem({ id: 'a', groupName: 'Firma A' })])]);
    renderAt('/weekly-summaries');
    const row = (await screen.findByRole('link', { name: 'Firma A' })).closest('li')!;
    expect(within(row).getByText('Koncept')).toBeInTheDocument();
    expect(within(row).getByText('Iba fakty')).toBeInTheDocument();
    expect(within(row).getByText(/8 bodov/)).toBeInTheDocument();
    expect(within(row).getByText(/4 príjemcovia/)).toBeInTheDocument();
  });

  it('the filters are remembered and put into the URL', async () => {
    const { callsTo } = mockBulkApi(ADMIN, [list([])]);
    const { user, router } = renderAt('/weekly-summaries');
    await user.click(await screen.findByRole('button', { name: 'Všetci' }));
    await user.click(screen.getByRole('button', { name: 'Odoslané' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ scope: 'all', status: 'sent' }),
    );
    await waitFor(() =>
      expect(callsTo('GET', '/api/weekly-summaries').at(-1)!.path).toContain(
        'scope=all&status=sent',
      ),
    );
    expect(localStorage.getItem('spolu.filters.a1.weeklySummaries')).toContain('"scope":"all"');
  });

  it('empty week shows Tento týždeň nie je čo kontrolovať.', async () => {
    mockBulkApi(ADMIN, [list([])]);
    renderAt('/weekly-summaries');
    expect(await screen.findByText('Tento týždeň nie je čo kontrolovať.')).toBeInTheDocument();
  });

  it('week arrows change the week param', async () => {
    mockBulkApi(ADMIN, [list([])]);
    const { user, router } = renderAt('/weekly-summaries');
    await user.click(await screen.findByRole('button', { name: 'Predchádzajúci týždeň' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        week: shiftWeek(isoWeek(new Date()), -1),
      }),
    );
  });

  it('older unsent drafts show the line and link to the archive with status=unsent', async () => {
    mockBulkApi(ADMIN, [list([], 2)]);
    renderAt('/weekly-summaries');
    expect(
      await screen.findByText(/Neodoslané koncepty z minulých týždňov: 2/),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Zobraziť' });
    expect(link.getAttribute('href')).toBe('/weekly-summaries/archive?status=unsent');
  });
});
