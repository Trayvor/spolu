import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { VisibilityControl } from '@/features/knowledge/visibility-control';
import { KnowledgeCardList } from './knowledge-cards';
import KnowledgePicker, { type PickedKnowledge } from './knowledge-picker';

/** Phase 34 P34-C: the admin group's knowledge in client places (web). */

const summary = (id: string, extra: object = {}) => ({
  id,
  type: 'note',
  title: `Item ${id}`,
  folderPath: [{ id: 'f1', name: 'Interné' }],
  groupId: 'g1',
  visibility: 'public',
  excerpt: '',
  url: null,
  file: null,
  fileCount: 0,
  nextReminderAt: null,
  upcomingCount: 0,
  lastReminderAt: null,
  createdBy: { id: 'u1', name: 'Ada' },
  createdAt: '2026-10-17T10:00:00.000Z',
  updatedAt: '2026-10-17T10:00:00.000Z',
  folderId: 'f1',
  ...extra,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function me(role: 'admin' | 'client') {
  return { id: 'me', email: 'me@example.com', name: 'Me', role, finance: false };
}

function client(role: 'admin' | 'client') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQuery.queryKey, me(role) as never);
  return queryClient;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the picker source switch', () => {
  function stub() {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('source=admin_group')) {
        return json({
          items: [summary('a1', { groupId: 'adm', source: 'admin_group' })],
          nextCursor: null,
        });
      }
      return json({ items: [summary('k1')], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('an admin in a client group lists the eGrant tím items, picked with the badge', async () => {
    const fetch = stub();
    const done = vi.fn<(items: PickedKnowledge[]) => void>();
    const queryClient = client('admin');
    // The group screen has the group cached already.
    queryClient.setQueryData(['groups', 'g1'], { id: 'g1', kind: 'client' });
    render(
      <QueryClientProvider client={queryClient}>
        <KnowledgePicker groupId="g1" picked={[]} onDone={done} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    const team = await screen.findByRole('radio', { name: i18n.t('chat.knowledge.adminGroup') });
    await userEvent.click(team);
    expect(await screen.findByText(i18n.t('chat.knowledge.adminGroupHint'))).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Item a1/ }));
    expect(fetch.mock.calls.some(([u]) => String(u).includes('source=admin_group'))).toBe(true);
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('chat.knowledge.attachCount', { count: 1 }) }),
    );
    expect(done).toHaveBeenCalledWith([
      {
        id: 'a1',
        available: true,
        type: 'note',
        title: 'Item a1',
        folderPath: [],
        source: 'admin_group',
      },
    ]);
  });

  it('a client gets no switch and never asks for the admin group', async () => {
    const fetch = stub();
    render(
      <QueryClientProvider client={client('client')}>
        <KnowledgePicker groupId="g1" picked={[]} onDone={vi.fn()} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('checkbox', { name: /Item k1/ })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(fetch.mock.calls.some(([u]) => String(u).includes('source='))).toBe(false);
  });
});

describe('an admin-group card', () => {
  const card = {
    id: 'a1',
    available: true as const,
    type: 'note',
    title: 'Návod',
    folderPath: [],
    source: 'admin_group' as const,
  };

  it('shows the badge; a client opens it read-only through its description', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/knowledge-links/')) return json({}, 404);
      return json([]);
    });
    vi.stubGlobal('fetch', fetch);
    render(
      <QueryClientProvider client={client('client')}>
        <KnowledgeCardList
          items={[card]}
          groupId="g1"
          via={null}
          subject={{ kind: 'task', id: 't1' }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(i18n.t('chat.knowledge.adminGroup'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Návod/ }));
    await waitFor(() =>
      expect(fetch.mock.calls.map(([u]) => String(u))).toContain(
        '/api/knowledge-links/task/t1/a1',
      ),
    );
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/api/knowledge/a1'))).toBe(false);
  });

  it('without a saved description a client gets "Item unavailable"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    render(
      <QueryClientProvider client={client('client')}>
        <KnowledgeCardList items={[card]} groupId="g1" via={null} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Návod/ }));
    expect(await screen.findByText(i18n.t('chat.knowledge.unavailable'))).toBeInTheDocument();
  });
});

describe('the visibility words in the admin group', () => {
  it('read "Only eGrant" first and "Shareable with clients" with its consequence', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <VisibilityControl value="admins" onChange={onChange} disabled={false} adminGroup />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      i18n.t('knowledge.visibility.admins'),
      i18n.t('knowledge.adminGroup.shareable'),
    ]);
    expect(screen.queryByText(i18n.t('knowledge.adminGroup.consequence'))).toBeNull();
    await userEvent.click(radios[1]!);
    expect(onChange).toHaveBeenCalledWith('public');
    rerender(<VisibilityControl value="public" onChange={onChange} disabled={false} adminGroup />);
    expect(screen.getByText(i18n.t('knowledge.adminGroup.consequence'))).toBeInTheDocument();
  });
});
