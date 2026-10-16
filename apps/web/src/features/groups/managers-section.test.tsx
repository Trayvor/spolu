import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { GroupPerson, Me } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { groupPeopleQuery } from './api';
import { ManagersSection } from './managers-section';

const ADMIN = { id: 'a1', name: 'Eva', email: 'e@example.com', role: 'admin', groupId: null } as Me;
const CLIENT = {
  id: 'c1',
  name: 'Anna',
  email: 'a@example.com',
  role: 'client',
  groupId: 'g1',
} as Me;

const PEOPLE: GroupPerson[] = [
  { id: 'c1', name: 'Anna Nováková', isAdmin: false, isManager: false },
  { id: 'm1', name: 'Mira Kováčová', isAdmin: true, isManager: true },
  { id: 'a2', name: 'Boris Kováč', isAdmin: true, isManager: false },
];

async function renderSection(people: GroupPerson[], me: Me) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(groupPeopleQuery('g1').queryKey, people);
  client.setQueryData(sessionQuery.queryKey, me);
  const root = createRootRoute({ component: () => <ManagersSection groupId="g1" /> });
  const groups = createRoute({ getParentRoute: () => root, path: '/groups' });
  const router = createRouter({
    routeTree: root.addChildren([groups]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(router.state.status).toBe('idle'));
  await screen.findByRole('heading', { name: 'eGrant managers' });
}

beforeAll(async () => {
  await setLanguage('en');
});

describe('ManagersSection', () => {
  it('lists managers with avatars', async () => {
    await renderSection(PEOPLE, CLIENT);
    const items = screen.getAllByRole('listitem');
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

  it('admins see the Groups page link, clients do not', async () => {
    await renderSection(PEOPLE, ADMIN);
    expect(screen.getByRole('link', { name: 'Change on the Groups page' })).toHaveAttribute(
      'href',
      '/groups',
    );
  });

  it('clients do not see the Groups page link', async () => {
    await renderSection(PEOPLE, CLIENT);
    expect(screen.queryByRole('link', { name: 'Change on the Groups page' })).toBeNull();
  });
});
