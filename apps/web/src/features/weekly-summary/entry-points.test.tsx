import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '@/i18n';
import { ADMIN, CLIENT, mockBulkApi, renderAt, reply } from '@/features/bulk-email/test-api';

const socket = vi.hoisted(() => ({ current: null as null | { reset(): void } }));
vi.mock('@/features/chat/chat-tab-badge', () => ({ ChatTabBadge: () => null }));
vi.mock('@/features/tasks/tasks-tab-badge', () => ({ TasksTabBadge: () => null }));
vi.mock('@/lib/socket', async () => {
  const { makeSocket } = await import('@/features/bulk-email/test-api');
  const s = makeSocket();
  socket.current = s;
  return { getSocket: () => s, connectSocket: vi.fn(), disconnectSocket: vi.fn() };
});

describe('weekly summary entry points', () => {
  beforeEach(async () => {
    await setLanguage('sk');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    socket.current?.reset();
  });

  it('a client toggles the weekly summary of one group in the profile', async () => {
    const { callsTo } = mockBulkApi(CLIENT, [
      (url) =>
        url.pathname === '/api/me/weekly-summary'
          ? reply(200, {
              groups: [{ groupId: 'g1', name: 'Firma A', subscribed: true, enabled: true }],
            })
          : undefined,
      (url) =>
        url.pathname === '/api/me/weekly-summary/g1'
          ? reply(200, { subscribed: false })
          : undefined,
    ]);
    const { user } = renderAt('/settings/notifications');
    expect(await screen.findByText('Týždenný prehľad e-mailom')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Firma A' }));
    await waitFor(() => expect(callsTo('PUT', '/api/me/weekly-summary/g1')).toHaveLength(1));
    expect(callsTo('PUT', '/api/me/weekly-summary/g1')[0]!.body).toEqual({ subscribed: false });
  });

  it('an admin sees Pripomenúť mi koncepty e-mailom instead', async () => {
    mockBulkApi(ADMIN, [
      (url) =>
        url.pathname === '/api/me/weekly-summary/reminder'
          ? reply(200, { remind: true })
          : undefined,
    ]);
    renderAt('/settings/notifications');
    expect(
      await screen.findByRole('checkbox', { name: 'Pripomenúť mi koncepty e-mailom' }),
    ).toBeChecked();
  });

  it('the overview tab shows the summary line to admins only', async () => {
    const GROUP = {
      id: 'g1',
      name: 'Acme',
      egrantUrl: 'https://acme.egrant.sk',
      hasLogo: false,
      updatedAt: '2026-10-17T10:00:00.000Z',
    };
    const routes = [
      (url: URL) => (url.pathname === '/api/groups/g1' ? reply(200, GROUP) : undefined),
      (url: URL) => (url.pathname === '/api/groups/g1/people' ? reply(200, []) : undefined),
      (url: URL) =>
        url.pathname === '/api/groups/g1/weekly-summary/settings'
          ? reply(200, { enabled: false, canEdit: true })
          : undefined,
      (url: URL) =>
        url.pathname === '/api/weekly-summaries/archive'
          ? reply(200, { items: [], nextCursor: null })
          : undefined,
    ];
    mockBulkApi(ADMIN, routes);
    const admin = renderAt('/groups/g1/overview');
    expect(await screen.findByText('Týždenný prehľad:')).toBeInTheDocument();
    expect(screen.getByText('Vypnutý')).toBeInTheDocument();
    admin.queryClient.clear();
    cleanup();
    vi.unstubAllGlobals();
    const { calls } = mockBulkApi(
      {
        ...CLIENT,
        groups: [
          {
            id: 'g1',
            name: 'Acme',
            role: 'client',
            hasLogo: false,
            updatedAt: '2026-10-17T10:00:00.000Z',
          },
        ],
      },
      routes,
    );
    renderAt('/groups/g1/overview');
    await waitFor(() => expect(calls.length).toBeGreaterThan(2));
    expect(screen.queryByText('Týždenný prehľad:')).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.includes('weekly-summar'))).toBe(false);
  });
});
