import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';
import { sessionQuery } from '@/features/auth/use-session';
import { BulkEmailSetting } from './bulk-email-setting';
import { ProfileSection } from './profile-section';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function setup(options: { subscribed?: boolean; putStatus?: number } = {}) {
  const puts: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/me/bulk-email' && (init?.method ?? 'GET') === 'GET')
      return json({ subscribed: options.subscribed ?? true });
    if (url === '/api/me/bulk-email' && init?.method === 'PUT') {
      puts.push(JSON.parse(init.body as string));
      const status = options.putStatus ?? 204;
      return new Response(status === 204 ? null : '{}', { status });
    }
    return json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { puts };
}

function renderWith(node: React.ReactNode, me?: Me) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (me) queryClient.setQueryData(sessionQuery.queryKey, me);
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  return userEvent.setup();
}

const label = () => i18n.t('settings.profile.bulkEmail.label');

describe('BulkEmailSetting', () => {
  beforeEach(async () => {
    await setLanguage('en');
    await loadAllNamespaces();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is checked by default', async () => {
    setup();
    renderWith(<BulkEmailSetting />);
    expect(await screen.findByRole('checkbox', { name: 'Receive mailings' })).toBeChecked();
    expect(screen.getByText(i18n.t('settings.profile.bulkEmail.hint'))).toBeInTheDocument();
  });

  it('shows unchecked for a person who unsubscribed', async () => {
    setup({ subscribed: false });
    renderWith(<BulkEmailSetting />);
    expect(await screen.findByRole('checkbox', { name: label() })).not.toBeChecked();
  });

  it('unchecking PUTs false, checking PUTs true', async () => {
    const { puts } = setup();
    const user = renderWith(<BulkEmailSetting />);
    const box = await screen.findByRole('checkbox', { name: label() });
    await user.click(box);
    await waitFor(() => expect(puts).toEqual([{ subscribed: false }]));
    expect(box).not.toBeChecked();
    expect(await screen.findByText(i18n.t('settings.profile.saved'))).toBeInTheDocument();
    await user.click(box);
    await waitFor(() => expect(puts).toEqual([{ subscribed: false }, { subscribed: true }]));
    expect(box).toBeChecked();
  });

  it('a failed save rolls back and says so', async () => {
    setup({ putStatus: 500 });
    const user = renderWith(<BulkEmailSetting />);
    const box = await screen.findByRole('checkbox', { name: label() });
    await user.click(box);
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('errors.generic'));
    expect(box).toBeChecked();
  });

  it.each([
    ['a client', { role: 'client', groups: [{ id: 'g1', name: 'F', role: 'client' }] }],
    ['an admin', { role: 'admin', groups: [] }],
    [
      'a ziadatel-only person',
      { role: 'client', groups: [{ id: 'g1', name: 'F', role: 'ziadatel' }] },
    ],
  ] as const)('is shown in the Profile card for %s', async (_who, extra) => {
    setup();
    const me = {
      id: 'u1',
      name: 'Eva',
      email: 'eva@example.com',
      ...extra,
      groups: extra.groups.map((g) => ({ ...g, hasLogo: false, updatedAt: '' })),
    } as Me;
    renderWith(<ProfileSection />, me);
    expect(await screen.findByRole('checkbox', { name: label() })).toBeInTheDocument();
  });
});
