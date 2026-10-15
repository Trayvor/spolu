import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import type { HealthResponse } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { apiGet } from '@/lib/api';
import { StatusCard } from './status-card';

vi.mock('@/lib/api', () => ({ apiGet: vi.fn() }));

/** A stand-in for the Socket.IO client: connected, and every ping is acknowledged. */
function fakeSocket(ack: () => Promise<unknown>) {
  const fake = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    timeout: vi.fn(() => ({ emitWithAck: vi.fn(ack) })),
  };
  return fake as unknown as Socket;
}

function renderCard(health: HealthResponse, socket: Socket) {
  vi.mocked(apiGet).mockResolvedValue(health);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StatusCard socket={socket} />
    </QueryClientProvider>,
  );
}

describe('StatusCard', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows version, database OK and realtime connected after a ping round trip', async () => {
    const socket = fakeSocket(() => Promise.resolve({ pong: true, at: '2026-10-15T10:00:00.000Z' }));
    renderCard({ status: 'ok', db: 'ok', version: 'abc1234' }, socket);

    expect(await screen.findByText(i18n.t('system.database.ok'))).toBeInTheDocument();
    expect(await screen.findByText(i18n.t('system.realtime.connected'))).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(i18n.t('system.database.ok')).toBe('Database: OK');
    expect(i18n.t('system.realtime.connected')).toBe('Realtime: connected');
  });

  it('shows database unavailable with a destructive badge when health is degraded', async () => {
    const socket = fakeSocket(() => Promise.reject(new Error('operation has timed out')));
    renderCard({ status: 'degraded', db: 'down', version: 'abc1234' }, socket);

    const badge = await screen.findByText(i18n.t('system.database.down'));
    expect(i18n.t('system.database.down')).toBe('Database: unavailable');
    expect(badge).toHaveAttribute('data-variant', 'destructive');
    expect(await screen.findByText(i18n.t('system.realtime.disconnected'))).toBeInTheDocument();
  });
});
