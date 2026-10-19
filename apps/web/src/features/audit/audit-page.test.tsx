import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { setLanguage } from '@/i18n';
import { rememberedFiltersKey } from '@/lib/use-remembered-filters';
import { ADMIN, entry, mockAuditApi, renderAudit } from './test-utils';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

describe('audit page', () => {
  beforeEach(async () => {
    await setLanguage('sk');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('loads the first page and appends the next on "Načítať staršie"', async () => {
    mockAuditApi([
      { items: [entry({ id: '1', entityLabel: 'Prvá' })], nextCursor: 'c1' },
      {
        items: [entry({ id: '2', entityLabel: 'Druhá', createdAt: '2026-10-18T09:00:00.000Z' })],
        nextCursor: null,
      },
    ]);
    const { user } = renderAudit();
    expect(await screen.findByText('Prvá')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Načítať staršie' }));
    expect(await screen.findByText('Druhá')).toBeInTheDocument();
    expect(screen.getByText('Prvá')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Načítať staršie' })).toBeNull();
    // Grouped by day.
    expect(screen.getByRole('heading', { name: /19\. októbra 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /18\. októbra 2026/ })).toBeInTheDocument();
  });

  it('filters write the URL and combine in one request', async () => {
    const { calls } = mockAuditApi([{ items: [entry()], nextCursor: null }]);
    const { user, router } = renderAudit();
    await screen.findByText('Pripraviť rozpočet');
    await user.selectOptions(screen.getByLabelText('Druh záznamu'), 'task');
    await user.selectOptions(screen.getByLabelText('Autor'), 'user:a1');
    await user.selectOptions(screen.getByLabelText('Klient'), 'g1');
    await waitFor(() => {
      const last = calls.at(-1)!;
      expect(last.get('entityType')).toBe('task');
      expect(last.get('actor')).toBe('user:a1');
      expect(last.get('group')).toBe('g1');
    });
    expect(router.state.location.search).toMatchObject({
      entityType: 'task',
      actor: 'user:a1',
      group: 'g1',
    });
  });

  it('remembered filters are applied on the first request', async () => {
    localStorage.setItem(
      rememberedFiltersKey(ADMIN.id, 'audit'),
      JSON.stringify({ entityType: 'ticket' }),
    );
    const { calls } = mockAuditApi([{ items: [], nextCursor: null }]);
    renderAudit();
    await screen.findByText('Žiadne zmeny pre tieto filtre.');
    expect(calls[0]?.get('entityType')).toBe('ticket');
    expect(calls.every((c) => c.get('entityType') === 'ticket')).toBe(true);
  });

  it('a non-finance admin has no finance types in the select; a finance admin has', async () => {
    mockAuditApi([{ items: [], nextCursor: null }]);
    renderAudit();
    const select = await screen.findByLabelText('Druh záznamu');
    expect(within(select).queryByRole('option', { name: 'Finančné položky' })).toBeNull();
    expect(within(select).getByRole('option', { name: 'Úlohy' })).toBeInTheDocument();
  });

  it('a finance admin sees the finance types', async () => {
    mockAuditApi([{ items: [], nextCursor: null }], { ...ADMIN, finance: true });
    renderAudit();
    const select = await screen.findByLabelText('Druh záznamu');
    expect(within(select).getByRole('option', { name: 'Finančné položky' })).toBeInTheDocument();
  });

  it('shows the empty states', async () => {
    mockAuditApi([{ items: [], nextCursor: null }]);
    renderAudit();
    expect(await screen.findByText('Zatiaľ sa nič nezmenilo.')).toBeInTheDocument();
  });

  it('shows the error with retry', async () => {
    let fail = true;
    mockAuditApi(() => (fail ? 500 : { items: [entry()], nextCursor: null }));
    const { user } = renderAudit();
    expect(
      await screen.findByText('Históriu sa nepodarilo načítať. Skúste to znova.'),
    ).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Skúsiť znova' }));
    expect(await screen.findByText('Pripraviť rozpočet')).toBeInTheDocument();
  });

  it('a record link opens with its chip and "Zrušiť filtre" clears everything', async () => {
    const { calls } = mockAuditApi([{ items: [entry()], nextCursor: null }]);
    const { user } = renderAudit('/audit?entityType=task&entityId=t1&label=Pripravi%C5%A5');
    expect(await screen.findByText('Záznam: Pripraviť')).toBeInTheDocument();
    expect(calls[0]?.get('entityId')).toBe('t1');
    await user.click(screen.getByRole('button', { name: 'Zrušiť filtre' }));
    await waitFor(() => expect(calls.at(-1)?.toString()).toBe(''));
  });
});
