import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n, setLanguage } from '@/i18n';
import {
  ADMIN,
  CLIENT,
  campaign,
  listItem,
  makeSocket,
  mockBulkApi,
  renderAt,
  reply,
} from './test-api';

const socket = vi.hoisted(() => ({ current: null as null | ReturnType<typeof makeSocket> }));
vi.mock('@/lib/socket', async () => {
  const { makeSocket: make } = await import('./test-api');
  socket.current = make();
  return {
    getSocket: () => socket.current,
    connectSocket: vi.fn(),
    disconnectSocket: vi.fn(),
  };
});

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ITEMS = [
  listItem({ id: 'k1', name: 'October news', status: 'draft' }),
  listItem({
    id: 'k2',
    name: 'Call for projects',
    status: 'sent',
    counts: {
      queued: 0,
      sending: 0,
      sent: 248,
      failed: 2,
      skipped: 0,
      cancelled: 0,
      unsubscribed: 1,
    },
  }),
];

describe('bulk email list', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    socket.current?.reset();
  });

  it('shows status badges and counts', async () => {
    mockBulkApi(ADMIN, [
      (url) =>
        url.pathname === '/api/bulk-email/campaigns'
          ? reply(200, { items: ITEMS, nextCursor: null })
          : undefined,
    ]);
    renderAt('/bulk-email');
    const sent = (await screen.findByRole('link', { name: 'Call for projects' })).closest('li')!;
    expect(within(sent).getByText('Sent')).toBeInTheDocument();
    expect(within(sent).getByText(/248 sent, 2 failed/)).toBeInTheDocument();
    const draft = screen.getByRole('link', { name: 'October news' }).closest('li')!;
    expect(within(draft).getByText('Draft')).toBeInTheDocument();
    expect(within(draft).queryByText(/sent,/)).not.toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mockBulkApi(ADMIN, [
      (url) =>
        url.pathname === '/api/bulk-email/campaigns'
          ? reply(200, { items: [], nextCursor: null })
          : undefined,
    ]);
    renderAt('/bulk-email');
    expect(await screen.findByText(t('bulkEmail.list.empty'))).toBeInTheDocument();
  });

  it('New email creates a draft and opens it', async () => {
    const { callsTo } = mockBulkApi(ADMIN, [
      (url, init) => {
        if (url.pathname !== '/api/bulk-email/campaigns') return undefined;
        if (init.method === 'POST') return reply(201, campaign({ id: 'new1', name: 'Email' }));
        return reply(200, { items: [], nextCursor: null });
      },
      (url) =>
        url.pathname === '/api/bulk-email/campaigns/new1'
          ? reply(200, campaign({ id: 'new1', name: 'Fresh email' }))
          : undefined,
    ]);
    const { user, router } = renderAt('/bulk-email');
    await user.click(await screen.findByRole('button', { name: 'New email' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/bulk-email/new1'));
    expect(await screen.findByRole('heading', { name: 'Fresh email' })).toBeInTheDocument();
    const [post] = callsTo('POST', '/api/bulk-email/campaigns');
    expect((post!.body as { name: string }).name).toMatch(/^Email of /);
  });

  it('bulk:updated refetches the list', async () => {
    const { callsTo } = mockBulkApi(ADMIN, [
      (url) =>
        url.pathname === '/api/bulk-email/campaigns'
          ? reply(200, { items: ITEMS, nextCursor: null })
          : undefined,
    ]);
    renderAt('/bulk-email');
    await screen.findByRole('link', { name: 'October news' });
    const before = callsTo('GET', '/api/bulk-email/campaigns').length;
    act(() => socket.current!.fire('bulk:updated', { campaignId: 'k1' }));
    await waitFor(() =>
      expect(callsTo('GET', '/api/bulk-email/campaigns').length).toBeGreaterThan(before),
    );
  });

  it('the first connect keeps the list just loaded; a reconnect refetches it', async () => {
    const { callsTo } = mockBulkApi(ADMIN, [
      (url) =>
        url.pathname === '/api/bulk-email/campaigns'
          ? reply(200, { items: ITEMS, nextCursor: null })
          : undefined,
    ]);
    const s = socket.current!;
    s.connected = false; // a cold load: the socket connects after the screen mounted
    try {
      renderAt('/bulk-email');
      await screen.findByRole('link', { name: 'October news' });
      const listCalls = () => callsTo('GET', '/api/bulk-email/campaigns').length;
      const loaded = listCalls();
      s.connected = true;
      act(() => s.fire('connect'));
      await new Promise((r) => setTimeout(r, 20));
      expect(listCalls()).toBe(loaded);
      act(() => s.fire('disconnect'));
      act(() => s.fire('connect'));
      await waitFor(() => expect(listCalls()).toBe(loaded + 1));
    } finally {
      s.connected = true;
    }
  });

  it('shows the header link to admins only', async () => {
    mockBulkApi(ADMIN, [
      (url) =>
        url.pathname === '/api/bulk-email/campaigns'
          ? reply(200, { items: [], nextCursor: null })
          : undefined,
    ]);
    renderAt('/bulk-email');
    expect(await screen.findByRole('link', { name: t('nav.bulkEmail') })).toHaveAttribute(
      'href',
      '/bulk-email',
    );
  });

  it('a client gets the not-found page and no header link', async () => {
    const { callsTo } = mockBulkApi(CLIENT);
    renderAt('/bulk-email');
    expect(await screen.findByText(t('notFound.title'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t('nav.bulkEmail') })).not.toBeInTheDocument();
    expect(callsTo('GET', '/api/bulk-email')).toHaveLength(0);
  });
});
