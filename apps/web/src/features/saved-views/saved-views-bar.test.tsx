import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { setLanguage } from '@/i18n';
import { loadNamespace } from '@/i18n/namespaces';
import SavedViewsBar from './saved-views-bar';
import { normalizeViewUrl, viewUrl } from './view-url';

const KEYS = ['clients', 'mine', 'due', 'q'] as const;

const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stub(views: unknown[] = []) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: url.pathname + url.search, body });
      if (method === 'GET') return json(views);
      if (method === 'POST') {
        return json({ id: 'v9', createdAt: '2026-10-18T10:00:00.000Z', ...body }, 201);
      }
      return new Response(null, { status: 204 });
    }),
  );
  return calls;
}

async function renderBar(path: string) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/tasks',
    component: () => <SavedViewsBar page="board" keys={KEYS} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await router.load();
  return { router, user: userEvent.setup() };
}

beforeAll(async () => {
  await setLanguage('en');
  await loadNamespace('savedViews');
});
afterEach(() => vi.unstubAllGlobals());

describe('viewUrl', () => {
  it('keeps only the filter keys, in a fixed order; null without filters', () => {
    expect(viewUrl('board', '?task=t1&mine=1&due=overdue', KEYS)).toBe('/tasks?due=overdue&mine=1');
    expect(viewUrl('board', '?task=t1', KEYS)).toBeNull();
    expect(normalizeViewUrl('/tasks?mine=1&due=overdue', KEYS)).toBe('/tasks?due=overdue&mine=1');
  });
});

describe('SavedViewsBar (F5)', () => {
  it('shows the starter views, the matching one pressed, and opens a view', async () => {
    stub();
    const { router, user } = await renderBar('/tasks?mine=1&due=overdue');
    const overdue = await screen.findByRole('button', { name: 'My overdue' });
    expect(overdue).toHaveAttribute('aria-current', 'true');
    // The current filters are a starter view already: nothing to save.
    expect(screen.queryByRole('button', { name: 'Save view' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'This week' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ due: 'week' }));
  });

  it('saves the current filters under a name and lists the view', async () => {
    const calls = stub();
    const { user } = await renderBar('/tasks?clients=g1&task=t1');
    await user.click(await screen.findByRole('button', { name: 'Save view' }));
    await user.type(screen.getByRole('textbox', { name: 'View name' }), 'Firma ABC');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/me/saved-views',
        body: { page: 'board', name: 'Firma ABC', url: '/tasks?clients=g1' },
      }),
    );
  });

  it('removes one of the person own views', async () => {
    const calls = stub([
      {
        id: 'v1',
        page: 'board',
        name: 'Urgent ABC',
        url: '/tasks?clients=g1',
        createdAt: '2026-10-18T09:00:00.000Z',
      },
    ]);
    const { user } = await renderBar('/tasks');
    await user.click(await screen.findByRole('button', { name: 'Remove view Urgent ABC' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'DELETE',
        path: '/api/me/saved-views/v1',
        body: undefined,
      }),
    );
    // Starter views are built in: they have no remove button.
    expect(screen.queryByRole('button', { name: /Remove view My overdue/ })).toBeNull();
  });
});
