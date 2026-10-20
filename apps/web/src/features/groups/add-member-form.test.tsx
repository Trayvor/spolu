import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { i18n, setLanguage } from '@/i18n';
import { renderMembers } from './members-test-api';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

beforeAll(async () => {
  await setLanguage('sk');
});
afterEach(() => vi.unstubAllGlobals());

async function openForm(user: ReturnType<typeof renderMembers>['user']) {
  await user.click(await screen.findByRole('button', { name: '+ Pridať manažéra' }));
  return screen.getByRole('form', { name: t('group.members.formLabel') });
}

async function submit(user: ReturnType<typeof renderMembers>['user'], email: string, name = '') {
  await user.type(screen.getByLabelText(t('group.members.email')), email);
  if (name) await user.type(screen.getByLabelText(t('group.members.nameOptional')), name);
  await user.click(screen.getByRole('button', { name: t('group.members.submit') }));
}

describe('AddMemberForm', () => {
  it('posts { email, name }, closes and shows the toast', async () => {
    const { user, writes } = renderMembers();
    await openForm(user);
    await submit(user, 'nova@firma.sk', 'Nová Osoba');
    expect(writes()).toEqual([
      {
        method: 'POST',
        url: '/api/groups/g1/members',
        body: { email: 'nova@firma.sk', name: 'Nová Osoba' },
      },
    ]);
    expect(await screen.findByText('Pozvánka odoslaná na nova@firma.sk.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('shows each success toast by outcome', async () => {
    for (const [outcome, text] of [
      ['added', 'a@firma.sk je teraz manažérom klienta. Poslali sme mu e-mail.'],
      ['resent', 'Pozvánku sme poslali znova na a@firma.sk.'],
    ] as const) {
      const { user } = renderMembers({
        post: () => ({
          status: outcome === 'resent' ? 200 : 201,
          body: { member: { id: 'n1', name: '', email: 'a@firma.sk' }, outcome },
        }),
      });
      await openForm(user);
      await submit(user, 'a@firma.sk');
      expect(await screen.findByText(text)).toBeInTheDocument();
      cleanup();
    }
  });

  it('a bad email is refused before sending', async () => {
    const { user, writes } = renderMembers();
    await openForm(user);
    await submit(user, 'nope');
    expect(screen.getByText(t('group.members.invalidEmail'))).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it('shows the already_member and email_taken_admin texts', async () => {
    for (const [error, text] of [
      ['already_member', 'Tento človek už je manažérom.'],
      ['email_taken_admin', 'Tento e-mail patrí administrátorovi. Pridajte ho ako garanta.'],
    ] as const) {
      const { user } = renderMembers({ post: () => ({ status: 409, body: { error } }) });
      await openForm(user);
      await submit(user, 'a@firma.sk');
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.getByLabelText(t('group.members.email'))).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      cleanup();
    }
  });

  it('removed shows Obnoviť, which posts /members/u3/restore and closes the form', async () => {
    const { user, writes } = renderMembers({
      post: () => ({ status: 409, body: { error: 'removed', userId: 'u3' } }),
    });
    await openForm(user);
    await submit(user, 'olga@firma.sk');
    expect(await screen.findByText('Tento človek bol od klienta odobraný.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Obnoviť' }));
    await waitFor(() =>
      expect(writes().at(-1)).toMatchObject({
        method: 'POST',
        url: '/api/groups/g1/members/u3/restore',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('Zrušiť closes the form without sending', async () => {
    const { user, writes } = renderMembers();
    await openForm(user);
    await user.click(screen.getByRole('button', { name: t('group.members.cancel') }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(writes()).toEqual([]);
  });
});
