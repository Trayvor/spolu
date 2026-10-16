import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { HealthResponseSchema } from '@spolu/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useSocketStatus } from './use-socket-status';

const HEALTH_REFETCH_MS = 30_000;

type StatusCardProps = {
  /** Injected in tests; the app uses the shared connection. */
  socket?: Socket;
};

/** Server version, database and realtime status: proves the whole stack works end to end. */
export function StatusCard({ socket = getSocket() }: StatusCardProps) {
  const { t, i18n } = useTranslation();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/health', HealthResponseSchema),
    refetchInterval: HEALTH_REFETCH_MS,
  });
  const realtime = useSocketStatus(socket);
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'medium' });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('system.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          {/* Error first: after a failed refetch TanStack Query still holds the last good data. */}
          {health.isError ? (
            <Badge variant="destructive">{t('system.unreachable')}</Badge>
          ) : health.data ? (
            <Badge variant={health.data.db === 'ok' ? 'success' : 'destructive'}>
              {t(health.data.db === 'ok' ? 'system.database.ok' : 'system.database.down')}
            </Badge>
          ) : (
            <Badge variant="secondary">{t('system.checking')}</Badge>
          )}
          <Badge variant={realtime.connected ? 'success' : 'secondary'}>
            {t(realtime.connected ? 'system.realtime.connected' : 'system.realtime.disconnected')}
          </Badge>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] [&_dd]:[overflow-wrap:anywhere] gap-x-6 gap-y-2 text-button">
          <dt className="text-muted-foreground">{t('system.version')}</dt>
          <dd>{health.isError ? '–' : (health.data?.version ?? '–')}</dd>
          <dt className="text-muted-foreground">{t('system.lastPing')}</dt>
          <dd>{realtime.lastPingAt ? time.format(realtime.lastPingAt) : t('system.never')}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
