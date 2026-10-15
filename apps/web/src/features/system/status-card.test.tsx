import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import type { HealthResponse } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { apiGet } from '@/lib/api';
import { StatusCard } from './status-card';

vi.mock('@/lib/api', () => ({ apiGet: vi.fn() }));

const ACK_AT = '2026-10-15T10:00:00.000Z';

/**
 * A stand-in for the Socket.IO client: connected, every ping answered by `ack`.
 * `fire(event)` calls the handlers the hook registered with `on`.
 */
function fakeSocket(ack: () => Promise<unknown>) {
  const handlers = new Map<string, Set<() => void>>();
  const emitWithAck = vi.fn(ack);
  const fake = {
    connected: true,
    on: vi.fn((event: string, fn: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(fn);
    }),
    off: vi.fn((event: string, fn: () => void) => handlers.get(event)?.delete(fn)),
    timeout: vi.fn(() => ({ emitWithAck })),
  };
  const fire = (event: string) => handlers.get(event)?.forEach((fn) => fn());
  return { socket: fake as unknown as Socket, emitWithAck, fire };
}

function renderCard(health: HealthResponse, socket: Socket) {
  vi.mocked(apiGet).mockResolvedValue(health);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StatusCard socket={socket} />
    </QueryClientProvider>,
  );
  return client;
}

const OK: HealthResponse = { status: 'ok', db: 'ok', version: 'abc1234' };

describe('StatusCard', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows version, database OK, realtime connected and the last ping time after a round trip', async () => {
    const { socket } = fakeSocket(() => Promise.resolve({ pong: true, at: ACK_AT }));
    renderCard(OK, socket);

    expect(await screen.findByText(i18n.t('system.database.ok'))).toBeInTheDocument();
    expect(await screen.findByText(i18n.t('system.realtime.connected'))).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    const time = new Intl.DateTimeFormat('en', { timeStyle: 'medium' }).format(new Date(ACK_AT));
    expect(screen.getByText(time)).toBeInTheDocument();
    expect(i18n.t('system.database.ok')).toBe('Database: OK');
    expect(i18n.t('system.realtime.connected')).toBe('Realtime: connected');
  });

  it('shows database unavailable with a destructive badge when health is degraded', async () => {
    const { socket } = fakeSocket(() => Promise.reject(new Error('operation has timed out')));
    renderCard({ status: 'degraded', db: 'down', version: 'abc1234' }, socket);

    const badge = await screen.findByText(i18n.t('system.database.down'));
    expect(i18n.t('system.database.down')).toBe('Database: unavailable');
    expect(badge).toHaveAttribute('data-variant', 'destructive');
    expect(await screen.findByText(i18n.t('system.realtime.disconnected'))).toBeInTheDocument();
  });

  it('shows server unreachable, not the old OK, when a refetch fails after a good fetch', async () => {
    const { socket } = fakeSocket(() => Promise.resolve({ pong: true, at: ACK_AT }));
    const client = renderCard(OK, socket);
    expect(await screen.findByText(i18n.t('system.database.ok'))).toBeInTheDocument();

    vi.mocked(apiGet).mockRejectedValue(new Error('Failed to fetch'));
    await act(() => client.refetchQueries({ queryKey: ['health'] }));

    const badge = await screen.findByText(i18n.t('system.unreachable'));
    expect(badge).toHaveAttribute('data-variant', 'destructive');
    expect(screen.queryByText(i18n.t('system.database.ok'))).not.toBeInTheDocument();
  });

  it('turns realtime disconnected when the socket disconnects after a good ping', async () => {
    const { socket, fire } = fakeSocket(() => Promise.resolve({ pong: true, at: ACK_AT }));
    renderCard(OK, socket);
    expect(await screen.findByText(i18n.t('system.realtime.connected'))).toBeInTheDocument();

    act(() => fire('disconnect'));

    expect(screen.getByText(i18n.t('system.realtime.disconnected'))).toBeInTheDocument();
  });

  it('stays disconnected when the ping ack is not a valid pong', async () => {
    const { socket, emitWithAck } = fakeSocket(() => Promise.resolve({ pong: false }));
    renderCard(OK, socket);
    await waitFor(() => expect(emitWithAck).toHaveBeenCalled());
    await act(async () => {}); // let the ack promise settle

    expect(screen.getByText(i18n.t('system.realtime.disconnected'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('system.never'))).toBeInTheDocument();
  });
});
