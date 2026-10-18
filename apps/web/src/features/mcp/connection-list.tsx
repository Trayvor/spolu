import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { McpConnection } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { mcpConnectionsQuery, revokeMcpConnection } from './api';

/**
 * The AI clients connected through OAuth (Claude custom connectors, ADR 0034), with how to add
 * one: in Claude, a custom connector with just this server's `/mcp` address.
 */
export function ConnectionList() {
  const { t } = useTranslation();
  const connections = useQuery(mcpConnectionsQuery);
  const url = `${window.location.origin}/mcp`;
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5">
      <h3 className="font-semibold">{t('mcp.connections.title')}</h3>
      <p className="text-tiny text-muted-foreground">
        {t('mcp.connections.howTo')}{' '}
        <span className="font-semibold text-foreground [overflow-wrap:anywhere]">{url}</span>
      </p>
      {connections.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
      {connections.data?.length === 0 && (
        <p className="text-tiny text-muted-foreground">{t('mcp.connections.empty')}</p>
      )}
      {connections.data && connections.data.length > 0 && (
        <ul role="list" className="flex flex-col divide-y divide-border">
          {connections.data.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionRow({ connection }: { connection: McpConnection }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const date = (iso: string) => format.format(new Date(iso));
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');

  async function revoke() {
    setStatus('busy');
    try {
      await revokeMcpConnection(connection.id);
      await queryClient.invalidateQueries({ queryKey: mcpConnectionsQuery.queryKey });
    } catch {
      setStatus('error');
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold [overflow-wrap:anywhere]">{connection.clientName}</span>
          <span className="text-tiny text-muted-foreground">
            {t(`mcp.scope.${connection.scope}`)}, {connection.redirectHost}
          </span>
          <span className="text-tiny text-muted-foreground">
            {t('mcp.connections.since', { date: date(connection.createdAt) })}
          </span>
          <span className="text-tiny text-muted-foreground">
            {connection.lastUsedAt
              ? t('mcp.tokens.lastUsed', { date: date(connection.lastUsedAt) })
              : t('mcp.tokens.neverUsed')}
          </span>
        </div>
        {!confirming && (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            {t('mcp.connections.disconnect')}
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2" role="group">
          <span className="text-tiny">{t('mcp.connections.confirm')}</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={status === 'busy'}
            onClick={() => void revoke()}
          >
            {t('mcp.connections.disconnectConfirm')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            {t('mcp.tokens.keep')}
          </Button>
        </div>
      )}
      {status === 'error' && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </li>
  );
}
