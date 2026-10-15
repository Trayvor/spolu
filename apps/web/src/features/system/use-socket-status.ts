import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SocketEvents, type PingAck } from '@spolu/shared';

const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;

export type SocketStatus = { connected: boolean; lastPingAt: Date | null };

function isPingAck(value: unknown): value is PingAck {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PingAck).pong === true &&
    typeof (value as PingAck).at === 'string'
  );
}

/**
 * Realtime health as the user sees it: `connected` only after a `system:ping` round trip
 * succeeded, `disconnected` after a failed or timed-out ping or a socket disconnect.
 * Pings on connect and then every 30 s.
 */
export function useSocketStatus(socket: Socket): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>({ connected: false, lastPingAt: null });

  useEffect(() => {
    let active = true;

    async function ping() {
      if (!socket.connected) return;
      try {
        const ack: unknown = await socket.timeout(PING_TIMEOUT_MS).emitWithAck(SocketEvents.ping);
        if (!active) return;
        setStatus(
          isPingAck(ack)
            ? { connected: true, lastPingAt: new Date(ack.at) }
            : (s) => ({ ...s, connected: false }),
        );
      } catch {
        if (active) setStatus((s) => ({ ...s, connected: false }));
      }
    }

    function onDisconnect() {
      setStatus((s) => ({ ...s, connected: false }));
    }

    socket.on('connect', ping);
    socket.on('disconnect', onDisconnect);
    void ping();
    const timer = setInterval(() => void ping(), PING_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
      socket.off('connect', ping);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  return status;
}
