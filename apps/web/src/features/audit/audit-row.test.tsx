import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { setLanguage } from '@/i18n';
import { entry, mockAuditApi, renderAudit } from './test-utils';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const page = (...items: ReturnType<typeof entry>[]) => [{ items, nextCursor: null }];
const rowOf = async (text: string) =>
  (await screen.findByText(text, { exact: false })).closest('li') as HTMLElement;

describe('audit row', () => {
  beforeEach(async () => {
    await setLanguage('sk');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('a user row shows the name and the sentence with the client', async () => {
    mockAuditApi(page(entry()));
    renderAudit();
    const row = await rowOf('Úprava úlohy');
    expect(within(row).getByRole('button', { name: 'Jana Nováková' })).toBeInTheDocument();
    expect(row).toHaveTextContent('Úprava úlohy „Pripraviť rozpočet“ · Mesto Senica');
    expect(within(row).getByRole('link', { name: 'Pripraviť rozpočet' })).toBeInTheDocument();
  });

  it('an mcp row shows "cez AI" and the token name; an egrant row eGrant and the instance', async () => {
    mockAuditApi(
      page(
        entry({
          id: 'm',
          actor: {
            kind: 'mcp',
            userId: 'a1',
            name: 'Jana Nováková',
            tokenId: 'tk',
            tokenName: 'Claude Desktop',
            deactivated: false,
          },
          action: 'created',
          entityLabel: 'Skontrolovať prílohy',
        }),
        entry({
          id: 'e',
          actor: { kind: 'egrant', source: 'groups', instance: 'https://luka.egrant.sk' },
          entityType: 'group',
          entityId: 'g2',
          action: 'deactivated',
          entityLabel: 'Obec Lúka',
          group: null,
        }),
      ),
    );
    renderAudit();
    const mcp = await rowOf('Vytvorenie úlohy');
    expect(mcp).toHaveTextContent('Jana Nováková cez AI');
    expect(mcp).toHaveTextContent('token „Claude Desktop“');
    const egrant = await rowOf('Deaktivácia skupiny');
    expect(egrant).toHaveTextContent('eGrant');
    expect(egrant).toHaveTextContent('https://luka.egrant.sk');
  });

  it('text changes show "zmenený" and never a value; refs show + and −; dates are formatted', async () => {
    mockAuditApi(
      page(
        entry({
          changes: {
            description: { changed: true },
            assignees: {
              added: [{ id: 'p', label: 'Peter Kováč' }],
              removed: [{ id: 'q', label: 'Eva' }],
            },
            dueDate: { from: '2026-10-20', to: '2026-10-24' },
          },
        }),
      ),
    );
    renderAudit();
    const row = await rowOf('Úprava úlohy');
    expect(row).toHaveTextContent('Popis: zmenený');
    expect(row).toHaveTextContent('Riešitelia: + Peter Kováč, − Eva');
    expect(row).toHaveTextContent('Termín:');
    expect(within(row).getByText(/20\. 10\. 2026/)).toBeInTheDocument();
  });

  it("a deleted record's label is not a link and says (vymazané)", async () => {
    mockAuditApi(page(entry({ action: 'deleted', linkable: false, entityLabel: 'Stará úloha' })));
    renderAudit();
    const row = await rowOf('Vymazanie úlohy');
    expect(within(row).queryByRole('link', { name: 'Stará úloha' })).toBeNull();
    expect(row).toHaveTextContent('(vymazané)');
  });

  it('more than three changes collapse behind "+ ďalšie zmeny (n)"', async () => {
    mockAuditApi(
      page(
        entry({
          changes: {
            title: { from: 'A', to: 'B' },
            urgent: { from: false, to: true },
            link: { from: null, to: 'https://x.sk' },
            dueDate: { from: null, to: '2026-10-24' },
            description: { changed: true },
          },
        }),
      ),
    );
    const { user } = renderAudit();
    const row = await rowOf('Úprava úlohy');
    expect(within(row).queryByText(/Popis:/)).toBeNull();
    await user.click(within(row).getByRole('button', { name: '+ ďalšie zmeny (2)' }));
    expect(within(row).getByText(/Popis:/)).toBeInTheDocument();
  });

  it('clicking the author sets the actor filter, also for a client author', async () => {
    const { calls } = mockAuditApi(
      page(entry({ actor: { kind: 'user', userId: 'c9', name: 'Klientka', deactivated: false } })),
    );
    const { user } = renderAudit();
    const row = await rowOf('Úprava úlohy');
    await user.click(within(row).getByRole('button', { name: 'Klientka' }));
    await waitFor(() => expect(calls.at(-1)?.get('actor')).toBe('user:c9'));
  });

  it('"Len tento záznam" sets entityType and entityId', async () => {
    const { calls } = mockAuditApi(page(entry()));
    const { user } = renderAudit();
    const row = await rowOf('Úprava úlohy');
    await user.click(within(row).getByRole('button', { name: 'Podrobnosti' }));
    await user.click(within(row).getByRole('button', { name: 'Len tento záznam' }));
    await waitFor(() => {
      expect(calls.at(-1)?.get('entityType')).toBe('task');
      expect(calls.at(-1)?.get('entityId')).toBe('t1');
    });
    expect(await screen.findByText('Záznam: Pripraviť rozpočet')).toBeInTheDocument();
  });
  it('a ticket rating row shows the thumbs, "zmenený" for the comment, and links to the ticket', async () => {
    mockAuditApi(
      page(
        entry({
          id: 'r',
          entityType: 'ticket_rating',
          entityId: 't7',
          action: 'updated',
          entityLabel: '#7 Prihlásenie',
          changes: { rating: { from: 'up', to: 'down' }, comment: { changed: true } },
        }),
      ),
    );
    renderAudit();
    const row = await rowOf('Zmena hodnotenia tiketu');
    expect(row).toHaveTextContent('Hodnotenie: 👍 Pomohlo → 👎 Nepomohlo');
    expect(row).toHaveTextContent('Komentár: zmenený');
    expect(within(row).getByRole('link', { name: '#7 Prihlásenie' })).toHaveAttribute(
      'href',
      '/tickets/t7',
    );
  });

  it('the kinds of record include the ticket ratings and the weekly summaries', async () => {
    mockAuditApi(page(entry()));
    renderAudit();
    const select = await screen.findByLabelText('Druh záznamu');
    for (const name of [
      'Hodnotenia tiketov',
      'Týždenné prehľady',
      'Nastavenie týždenných prehľadov',
    ]) {
      expect(within(select).getByRole('option', { name })).toBeInTheDocument();
    }
  });
});
