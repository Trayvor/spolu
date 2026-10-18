import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Member } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { RequestersList } from './requesters-list';

type Call = { method: string; url: string };

/** A fake server: the requesters of g1, moved between active and removed by the writes. */
function renderList(active: Member[], removed: Member[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      const json = (body: unknown) => new Response(JSON.stringify(body));
      if (url === '/api/groups/g1/requesters') return json(active);
      if (url === '/api/groups/g1/requesters/removed') return json(removed);
      const match = /^\/api\/groups\/g1\/members\/(\w+)(\/restore)?$/.exec(url);
      if (match) {
        const id = match[1];
        const from = match[2] ? removed : active;
        const to = match[2] ? active : removed;
        const index = from.findIndex((m) => m.id === id);
        if (index >= 0) to.push(...from.splice(index, 1));
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RequestersList groupId="g1" admin />
    </QueryClientProvider>,
  );
  return calls;
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

beforeAll(async () => {
  await setLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RequestersList', () => {
  it('a removal shows a toast whose Undo restores the requester', async () => {
    const user = userEvent.setup();
    const calls = renderList([{ id: 'z1', name: 'Zora', email: 'zora@example.com' }]);
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Removed from requesters: Zora.'),
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(writes(calls)).toEqual([
        { method: 'DELETE', url: '/api/groups/g1/members/z1' },
        { method: 'POST', url: '/api/groups/g1/members/z1/restore' },
      ]),
    );
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('a restore shows a toast whose Undo removes the requester again', async () => {
    const user = userEvent.setup();
    const calls = renderList([], [{ id: 'z1', name: '', email: 'zora@example.com' }]);
    await user.click(await screen.findByText(/Removed requesters/));
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Restored as a requester: zora@example.com.',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(writes(calls)).toEqual([
        { method: 'POST', url: '/api/groups/g1/members/z1/restore' },
        { method: 'DELETE', url: '/api/groups/g1/members/z1' },
      ]),
    );
  });
});
