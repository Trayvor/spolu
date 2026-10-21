import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { AnnouncementSectionId } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { WhatsNewHost } from './whats-new-host';

const t = (key: string) => i18n.t(key);
let calls: { method: string; path: string }[] = [];

function setup(sections: AnnouncementSectionId[] | null) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      calls.push({ method: init?.method ?? 'GET', path });
      if (path.endsWith('/me/announcement')) {
        const announcement = sections ? { id: '2026-10-21', sections } : null;
        return new Response(JSON.stringify({ announcement }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }),
  );
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <WhatsNewHost />
        <Outlet />
      </>
    ),
  });
  const page = (path: string) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => <p>{path}</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page('/'), page('/finance')]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const seenCalls = () =>
  calls.filter((c) => c.method === 'POST' && c.path.endsWith('/me/announcement/2026-10-21/seen'));

describe('WhatsNewHost', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the sections the server sent and nothing else', async () => {
    setup(['taskSplit', 'snippets', 'bulkEmail']);
    const dialog = await screen.findByRole('dialog', { name: t('whatsNew.title') });
    expect(dialog).toHaveTextContent(t('whatsNew.2026-10-21.taskSplit.title'));
    expect(dialog).toHaveTextContent(t('whatsNew.2026-10-21.snippets.title'));
    expect(dialog).toHaveTextContent(t('whatsNew.2026-10-21.bulkEmail.title'));
    // No finance right: no finance section.
    expect(dialog).not.toHaveTextContent(t('whatsNew.2026-10-21.finance.title'));
  });

  it('"Got it" marks it seen once and closes it for good', async () => {
    const user = setup(['finance']);
    await screen.findByRole('dialog');
    expect(screen.getByRole('dialog')).toHaveTextContent(t('whatsNew.2026-10-21.finance.title'));
    await user.click(screen.getByRole('button', { name: t('whatsNew.gotIt') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(seenCalls()).toHaveLength(1);
    // One request for the announcement per app load, none per route.
    expect(calls.filter((c) => c.path.endsWith('/me/announcement'))).toHaveLength(1);
  });

  it('Escape closes it and marks it seen', async () => {
    const user = setup(['snippets']);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(seenCalls()).toHaveLength(1);
  });

  it('the × closes it and marks it seen', async () => {
    const user = setup(['bulkEmail']);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: t('whatsNew.close') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(seenCalls()).toHaveLength(1);
  });

  it('a section link closes it, marks it seen and opens the screen', async () => {
    const user = setup(['finance']);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('link', { name: t('whatsNew.2026-10-21.finance.link') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(seenCalls()).toHaveLength(1);
    expect(await screen.findByText('/finance')).toBeInTheDocument();
  });

  it('shows nothing when there is no announcement', async () => {
    setup(null);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
