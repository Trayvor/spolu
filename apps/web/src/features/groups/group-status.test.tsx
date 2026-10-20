import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Group } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { loadNamespace } from '@/i18n/namespaces';
import { GroupHeader } from './group-header';

const GROUP: Group = {
  id: 'g1',
  kind: 'client',
  name: 'Mesto X',
  egrantUrl: 'https://mesto-x.egrant.sk',
  hasLogo: false,
  updatedAt: '2026-10-18T10:00:00.000Z',
  deactivatedAt: null,
};

beforeAll(async () => {
  await setLanguage('sk');
  await Promise.all(['group', 'groups'].map(loadNamespace));
});
afterEach(() => vi.unstubAllGlobals());

function renderHeader(group: Group, admin = true) {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      const deactivatedAt = url.endsWith('/deactivate') ? '2026-10-18T11:00:00.000Z' : null;
      return new Response(JSON.stringify({ ...group, deactivatedAt }), { status: 200 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GroupHeader group={group} admin={admin} />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

describe('group status', () => {
  it('an active group: no badge; Deactivate sits under the edit form and asks first', async () => {
    const { calls, user } = renderHeader(GROUP);
    expect(screen.queryByText('Deaktivovaná')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Upraviť' }));
    await user.click(screen.getByRole('button', { name: 'Deaktivovať' }));
    expect(screen.getByText(/Deaktivovať Mesto X\?/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Deaktivovať' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST')).toEqual([
        { method: 'POST', url: '/api/groups/g1/deactivate' },
      ]),
    );
  });

  it('a deactivated group: the badge, the notice and Reactivate (no confirmation)', async () => {
    const { calls, user } = renderHeader({ ...GROUP, deactivatedAt: '2026-10-18T11:00:00.000Z' });
    expect(screen.getByText('Deaktivovaná')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Tento klient je deaktivovaný.');
    await user.click(screen.getByRole('button', { name: 'Znova aktivovať' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST')).toEqual([
        { method: 'POST', url: '/api/groups/g1/reactivate' },
      ]),
    );
  });

  it('a client sees neither the badge actions nor the notice', () => {
    renderHeader({ ...GROUP, deactivatedAt: '2026-10-18T11:00:00.000Z' }, false);
    expect(screen.queryByRole('button', { name: 'Znova aktivovať' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
