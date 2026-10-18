import { useId, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MCP_DEFAULT_EXPIRY_DAYS,
  MCP_EXPIRY_DAYS,
  MCP_LIMITS,
  type McpScope,
  type McpToken,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { createMcpToken, mcpAuditQuery, mcpTokensQuery, revokeMcpToken } from './api';
import { ConnectionList } from './connection-list';

/**
 * "AI access (MCP)" on /settings, admins only (MCP spec §3.3): the admin's personal tokens for an
 * AI client, a form for a new one (shown once, with the Claude Code command), and the last
 * changes the AI made. A lazy chunk with its own namespace `mcp`.
 */
export function McpSection() {
  const { t } = useTranslation();
  const [created, setCreated] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('mcp.title')}</h2>
        </CardTitle>
        <p className="text-tiny text-muted-foreground">{t('mcp.intro')}</p>
      </CardHeader>
      <CardContent className="flex flex-col">
        {created ? (
          <NewToken token={created} onDone={() => setCreated(null)} />
        ) : (
          <CreateForm onCreated={setCreated} />
        )}
        <ConnectionList />
        <TokenList />
        <AuditList />
      </CardContent>
    </Card>
  );
}

function useDate() {
  const { i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  return (iso: string) => format.format(new Date(iso));
}

function CreateForm({ onCreated }: { onCreated: (token: string) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const id = useId();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<McpScope>('read');
  const [days, setDays] = useState<number>(MCP_DEFAULT_EXPIRY_DAYS);
  const [status, setStatus] = useState<'idle' | 'busy' | 'empty' | 'limit' | 'error'>('idle');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === 'busy') return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setStatus('empty');
      return;
    }
    setStatus('busy');
    try {
      const { token } = await createMcpToken({ name: trimmed, scope, expiresInDays: days });
      await queryClient.invalidateQueries({ queryKey: mcpTokensQuery.queryKey });
      setName('');
      setStatus('idle');
      onCreated(token);
    } catch (error) {
      setStatus(error instanceof ApiError && error.code === 'mcp_token_limit' ? 'limit' : 'error');
    }
  }

  const message = {
    idle: null,
    busy: null,
    empty: t('mcp.create.nameRequired'),
    limit: t('mcp.create.limit', { count: MCP_LIMITS.activeTokens }),
    error: t('errors.generic'),
  }[status];

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <h3 className="font-semibold">{t('mcp.create.title')}</h3>
      <div className="flex flex-col gap-2.5">
        <Label htmlFor={`${id}-name`}>{t('mcp.create.name')}</Label>
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={MCP_LIMITS.name}
          placeholder={t('mcp.create.namePlaceholder')}
          onChange={(e) => {
            setName(e.target.value);
            if (status !== 'busy') setStatus('idle');
          }}
          aria-invalid={status === 'empty' ? true : undefined}
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t('mcp.create.access')}</legend>
        {(['read', 'write'] as const).map((value) => (
          <label key={value} className="flex items-start gap-3">
            <input
              type="radio"
              name={`${id}-scope`}
              value={value}
              checked={scope === value}
              onChange={() => setScope(value)}
              className="mt-0.5 size-5 shrink-0 accent-foreground"
            />
            <span className="flex flex-col gap-0.5">
              <span>{t(`mcp.scope.${value}`)}</span>
              <span className="text-tiny text-muted-foreground">{t(`mcp.scopeHint.${value}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2.5">
        <Label htmlFor={`${id}-days`}>{t('mcp.create.validity')}</Label>
        <Select
          id={`${id}-days`}
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
          containerClassName="self-start"
        >
          {MCP_EXPIRY_DAYS.map((value) => (
            <option key={value} value={value}>
              {t(`mcp.days.${value}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" className="self-start" disabled={status === 'busy'}>
          {t('mcp.create.submit')}
        </Button>
        {message && (
          <p role="alert" className="text-micro text-error-ink">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}

/** The new token, once: copy it now. The one emphasised block of the card. */
function NewToken({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [copied, setCopied] = useState<'token' | 'command' | null>(null);
  const command = `claude mcp add --transport http help ${window.location.origin}/mcp --header "Authorization: Bearer ${token}"`;

  async function copy(text: string, what: 'token' | 'command') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-lg border-2 border-foreground p-4"
    >
      <h3 id={`${id}-title`} className="font-semibold">
        {t('mcp.created.title')}
      </h3>
      <p className="text-tiny">{t('mcp.created.once')}</p>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={token}
          aria-label={t('mcp.created.tokenLabel')}
          className="min-w-0 flex-1 font-mono text-tiny"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button type="button" variant="secondary" onClick={() => void copy(token, 'token')}>
          {copied === 'token' ? t('mcp.created.copied') : t('mcp.created.copy')}
        </Button>
      </div>
      <p className="text-tiny text-muted-foreground">{t('mcp.created.claudeCode')}</p>
      <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-micro leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">
        {command}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copy(command, 'command')}>
          {copied === 'command' ? t('mcp.created.copied') : t('mcp.created.copyCommand')}
        </Button>
        <Button type="button" onClick={onDone}>
          {t('mcp.created.done')}
        </Button>
      </div>
    </section>
  );
}

function TokenList() {
  const { t } = useTranslation();
  const tokens = useQuery(mcpTokensQuery);
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5">
      <h3 className="font-semibold">{t('mcp.tokens.title')}</h3>
      {tokens.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
      {tokens.data?.length === 0 && (
        <p className="text-tiny text-muted-foreground">{t('mcp.tokens.empty')}</p>
      )}
      {tokens.data && tokens.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {tokens.data.map((token) => (
            <TokenRow key={token.id} token={token} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TokenRow({ token }: { token: McpToken }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const date = useDate();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');

  async function revoke() {
    setStatus('busy');
    try {
      await revokeMcpToken(token.id);
      await queryClient.invalidateQueries({ queryKey: mcpTokensQuery.queryKey });
    } catch {
      setStatus('error');
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold [overflow-wrap:anywhere]">{token.name}</span>
          <span className="text-tiny text-muted-foreground">
            {t(`mcp.scope.${token.scope}`)}, {token.prefix}…
          </span>
          <span
            className={
              token.expired ? 'text-tiny text-error-ink' : 'text-tiny text-muted-foreground'
            }
          >
            {token.expired
              ? t('mcp.tokens.expired', { date: date(token.expiresAt) })
              : t('mcp.tokens.expires', { date: date(token.expiresAt) })}
          </span>
          <span className="text-tiny text-muted-foreground">
            {token.lastUsedAt
              ? t('mcp.tokens.lastUsed', { date: date(token.lastUsedAt) })
              : t('mcp.tokens.neverUsed')}
          </span>
        </div>
        {!confirming && (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            {t('mcp.tokens.revoke')}
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2" role="group">
          <span className="text-tiny">{t('mcp.tokens.confirm')}</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={status === 'busy'}
            onClick={() => void revoke()}
          >
            {t('mcp.tokens.revokeConfirm')}
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

function AuditList() {
  const { t, i18n } = useTranslation();
  const audit = useQuery(mcpAuditQuery);
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5">
      <h3 className="font-semibold">{t('mcp.audit.title')}</h3>
      {audit.data?.length === 0 && (
        <p className="text-tiny text-muted-foreground">{t('mcp.audit.empty')}</p>
      )}
      {audit.data && audit.data.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {audit.data.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 text-tiny">
              <code className="rounded-sm bg-muted px-1 font-mono">{entry.tool}</code>
              {!entry.ok && <span className="text-error-ink">{t('mcp.audit.refused')}</span>}
              <span className="text-muted-foreground">
                {format.format(new Date(entry.createdAt))}
                {entry.tokenName ? `, ${entry.tokenName}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
