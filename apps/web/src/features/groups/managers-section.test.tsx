import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GroupPerson, Me } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { groupPeopleQuery } from './api';
import { ManagersSection } from './managers-section';

const ADMIN = { id: 'a1', name: 'Eva', email: 'e@example.com', role: 'admin', groups: [] } as Me;
const CLIENT = {
  id: 'c1',
  name: 'Anna',
  email: 'a@example.com',
  role: 'client',
  groups: [{ id: 'g1', name: 'Firma', role: 'client', hasLogo: false, updatedAt: '' }],
} as Me;

const PEOPLE: GroupPerson[] = [
  { id: 'c1', name: 'Anna Nováková', isAdmin: false, isManager: false },
  { id: 'm1', name: 'Mira Kováčová', isAdmin: true, isManager: true },
  { id: 'a2', name: 'Boris Kováč', isAdmin: true, isManager: false },
  { id: 'a3', name: 'Adam Bystrý', isAdmin: true, isManager: false },
];

type Call = { method: string; url: string };

/** Renders the section with `people` loaded; manager writes answer 200 (or `status`). */
async function renderSection(people: GroupPerson[], me: Me, status = 200) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url });
      if (url.startsWith('/api/groups/g1/managers/')) {
        return new Response(JSON.stringify(status === 200 ? { managers: [] } : {}), { status });
      }
      if (url === '/api/groups/g1/people') return new Response(JSON.stringify(people));
      return new Response('{}', { status: 404 });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(groupPeopleQuery('g1').queryKey, people);
  client.setQueryData(sessionQuery.queryKey, me);
  render(
    <QueryClientProvider client={client}>
      <ManagersSection groupId="g1" />
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'eGrant managers' });
  return calls;
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

beforeAll(async () => {
  await setLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ManagersSection', () => {
  it('lists managers with avatars', async () => {
    await renderSection(PEOPLE, CLIENT);
    const list = screen.getByRole('list', { name: 'eGrant managers' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Mira Kováčová');
    expect(within(items[0]!).getByText('MK')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('Boris Kováč')).toBeNull();
    expect(screen.queryByText('Anna Nováková')).toBeNull();
  });

  it('shows No eGrant manager yet', async () => {
    await renderSection(
      PEOPLE.filter((p) => !p.isManager),
      CLIENT,
    );
    expect(screen.getByText('No eGrant manager yet.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('the Groups page link is gone', async () => {
    await renderSection(PEOPLE, ADMIN);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Change on the Groups page')).toBeNull();
  });

  it('a client sees neither Add manager nor Remove', async () => {
    await renderSection(PEOPLE, CLIENT);
    expect(screen.queryByRole('button', { name: /Add manager/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('an admin adds a manager from the admins who are not managers, by name', async () => {
    const user = userEvent.setup();
    const calls = await renderSection(PEOPLE, ADMIN);
    await user.click(screen.getByRole('button', { name: 'Add manager' }));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Adam Bystrý', 'Boris Kováč']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Boris Kováč' }));
    await waitFor(() =>
      expect(writes(calls)).toEqual([{ method: 'PUT', url: '/api/groups/g1/managers/a2' }]),
    );
  });

  it('when every admin manages the group, the menu says so', async () => {
    const user = userEvent.setup();
    await renderSection(
      PEOPLE.map((p) => (p.isAdmin ? { ...p, isManager: true } : p)),
      ADMIN,
    );
    await user.click(screen.getByRole('button', { name: 'Add manager' }));
    expect(
      await screen.findByText('Every administrator already manages this group.'),
    ).toBeInTheDocument();
  });

  it('with more than 8 candidates the menu has a search field', async () => {
    const user = userEvent.setup();
    const many: GroupPerson[] = Array.from({ length: 9 }, (_, i) => ({
      id: `x${i}`,
      name: i === 4 ? 'Lúčka Zelená' : `Admin ${i}`,
      isAdmin: true,
      isManager: false,
    }));
    await renderSection(many, ADMIN);
    await user.click(screen.getByRole('button', { name: 'Add manager' }));
    const find = await screen.findByRole('searchbox', { name: 'Find an administrator' });
    await user.type(find, 'luc');
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Lúčka Zelená']);
  });

  it('Remove on a manager row sends DELETE for that admin', async () => {
    const user = userEvent.setup();
    const calls = await renderSection(PEOPLE, ADMIN);
    await user.click(screen.getByRole('button', { name: 'Remove Mira Kováčová' }));
    await waitFor(() =>
      expect(writes(calls)).toEqual([{ method: 'DELETE', url: '/api/groups/g1/managers/m1' }]),
    );
  });

  it('a failed change shows the error', async () => {
    const user = userEvent.setup();
    await renderSection(PEOPLE, ADMIN, 500);
    await user.click(screen.getByRole('button', { name: 'Remove Mira Kováčová' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not change it. Try again.');
  });
});
