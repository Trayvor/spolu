import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { setLanguage } from '@/i18n';
import { renderMembers } from './members-test-api';

const EVA = { id: 'u1', name: 'Eva', email: 'eva@acme.sk' };
const OLGA = { id: 'u3', name: 'Olga Nová', email: 'olga@acme.sk' };
const NONAME = { id: 'u4', name: '', email: 'bez@acme.sk' };

beforeAll(async () => {
  await setLanguage('sk');
});
afterEach(() => vi.unstubAllGlobals());

const rowOf = (text: string) => screen.getByText(text).closest('li') as HTMLElement;

describe('invited members', () => {
  it('an invited row shows Pozvaný, Poslať znova and Odobrať, above the members', async () => {
    renderMembers({ members: [EVA], invited: [OLGA, NONAME] });
    await screen.findByText('Olga Nová');
    const row = rowOf('Olga Nová');
    expect(within(row).getByText('olga@acme.sk')).toBeInTheDocument();
    expect(within(row).getByText('Pozvaný')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Poslať znova' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Odobrať' })).toBeInTheDocument();
    expect(within(rowOf('bez@acme.sk')).getByText('Pozvaný')).toBeInTheDocument();
    expect(within(rowOf('Eva')).queryByText('Pozvaný')).toBeNull();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items.findIndex((x) => x?.includes('Olga'))).toBeLessThan(
      items.findIndex((x) => x?.includes('Eva')),
    );
  });

  it('with only invited people there is no empty text', async () => {
    renderMembers({ invited: [OLGA] });
    await screen.findByText('Olga Nová');
    expect(screen.queryByText(/Zatiaľ žiadni manažéri/)).toBeNull();
  });

  it('Poslať znova posts the email again and shows the resent toast', async () => {
    const { user, writes } = renderMembers({
      invited: [OLGA],
      post: () => ({ status: 200, body: { member: OLGA, outcome: 'resent' } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Poslať znova' }));
    expect(writes()).toEqual([
      { method: 'POST', url: '/api/groups/g1/members', body: { email: 'olga@acme.sk' } },
    ]);
    expect(
      await screen.findByText('Pozvánku sme poslali znova na olga@acme.sk.'),
    ).toBeInTheDocument();
  });

  it('Odobrať confirms, then sends DELETE /groups/g1/members/invited/u3', async () => {
    const { user, writes } = renderMembers({ invited: [OLGA] });
    await user.click(await screen.findByRole('button', { name: 'Odobrať' }));
    expect(screen.getByText('Zrušiť pozvánku pre olga@acme.sk?')).toBeInTheDocument();
    expect(writes()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Odobrať' }));
    await waitFor(() =>
      expect(writes()).toEqual([
        { method: 'DELETE', url: '/api/groups/g1/members/invited/u3', body: undefined },
      ]),
    );
  });
});
