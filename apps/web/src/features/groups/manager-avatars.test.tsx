import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n, setLanguage } from '@/i18n';
import { ManagerAvatars } from './manager-avatars';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const MANAGERS = [
  { id: 'a1', name: 'Jana' },
  { id: 'a2', name: 'Peter Novak' },
  { id: 'a3', name: 'Zora' },
  { id: 'a4', name: 'Zuzana' },
  { id: 'a5', name: 'Zdeno' },
];

const bubble = () => document.querySelector('[data-manager-tooltip]');

beforeAll(async () => {
  await setLanguage('en');
});

describe('ManagerAvatars', () => {
  it('hovering shows every name, also those behind +N', async () => {
    const user = userEvent.setup();
    render(<ManagerAvatars managers={MANAGERS} groupName="Acme" />);
    const trigger = screen.getByRole('button', {
      name: t('groups.managers.listLabel', { name: 'Acme' }),
    });
    expect(bubble()).toBeNull();
    await user.hover(trigger);
    await waitFor(() => expect(bubble()).not.toBeNull());
    const lines = [...bubble()!.querySelectorAll('li')].map((li) => li.textContent);
    expect(lines).toEqual(MANAGERS.map((m) => m.name));
    expect(bubble()).toHaveAttribute('aria-hidden', 'true');
    await user.unhover(trigger);
    await waitFor(() => expect(bubble()).toBeNull());
  });

  it('a tap toggles it, Escape closes it', async () => {
    const user = userEvent.setup();
    render(<ManagerAvatars managers={MANAGERS} groupName="Acme" />);
    const trigger = screen.getByRole('button', {
      name: t('groups.managers.listLabel', { name: 'Acme' }),
    });
    await user.pointer({ keys: '[TouchA]', target: trigger });
    await waitFor(() => expect(bubble()).not.toBeNull());
    await user.pointer({ keys: '[TouchA]', target: trigger });
    await waitFor(() => expect(bubble()).toBeNull());
    await user.pointer({ keys: '[TouchA]', target: trigger });
    await waitFor(() => expect(bubble()).not.toBeNull());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(bubble()).toBeNull());
  });

  it('keyboard focus opens it', async () => {
    const user = userEvent.setup();
    render(<ManagerAvatars managers={MANAGERS} groupName="Acme" />);
    await user.tab();
    await waitFor(() => expect(bubble()).not.toBeNull());
  });
});
