import { useEffect, useId, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { McpAuthorizeParams, McpScope } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { decideConsent, getConsentInfo } from './api';

const PARAM_KEYS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'state',
  'scope',
  'code_challenge',
  'code_challenge_method',
  'resource',
] as const;

/**
 * The `/oauth/authorize` parameters exactly as the client sent them. Read from the address bar,
 * not from the router: its search parsing turns values that look like JSON (`state=1e5`) into
 * numbers, and the approval must carry the very same strings.
 */
export function readAuthorizeParams(search: string): McpAuthorizeParams {
  const query = new URLSearchParams(search);
  const params: McpAuthorizeParams = {};
  for (const key of PARAM_KEYS) {
    const value = query.get(key);
    if (value !== null) params[key] = value;
  }
  return params;
}

/**
 * Leaves for the client's address. The server builds it only from the client's registered
 * redirect address (https on Claude's hosts or loopback), so this is never an open redirect;
 * the scheme check is a second guard.
 */
function assignLocation(url: string) {
  window.location.assign(url);
}

export function ConsentRoute() {
  return <ConsentPage params={readAuthorizeParams(window.location.search)} />;
}

/**
 * The OAuth consent screen (ADR 0034): an AI client such as Claude asks to act as the signed-in
 * admin through MCP. Shows who asks and where the browser returns, lets the admin choose read
 * only or read and change, and sends the approval or the denial back. `navigate` (tests) replaces
 * the browser's navigation.
 */
export function ConsentPage({
  params,
  navigate = assignLocation,
}: {
  params: McpAuthorizeParams;
  navigate?: (url: string) => void;
}) {
  const leaveTo = (url: string) => {
    if (/^https?:\/\//.test(url)) navigate(url);
  };
  const { t } = useTranslation();
  const id = useId();
  const info = useQuery({
    queryKey: ['oauth', 'authorize', params],
    queryFn: () => getConsentInfo(params),
    retry: false,
    staleTime: Infinity,
  });
  const [scope, setScope] = useState<McpScope | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'leaving' | 'limit' | 'error'>('idle');

  const data = info.data;
  useEffect(() => {
    if (data?.kind === 'redirect' && /^https?:\/\//.test(data.redirectTo)) {
      navigate(data.redirectTo);
    }
  }, [data, navigate]);

  if (info.isPending) return null;

  if (info.isError || data?.kind === 'redirect') {
    const error = info.error;
    const message =
      data?.kind === 'redirect'
        ? t('mcp.consent.leaving')
        : error instanceof ApiError && error.status === 403
          ? t('mcp.consent.adminsOnly')
          : error instanceof ApiError && error.status === 400
            ? t('mcp.consent.invalid')
            : t('errors.generic');
    return (
      <Card className="mx-auto w-full max-w-[440px] gap-4 p-8 max-[640px]:p-6">
        <h1 className="text-medium leading-tight font-semibold">{t('mcp.consent.title')}</h1>
        <p role={data?.kind === 'redirect' ? 'status' : 'alert'}>{message}</p>
      </Card>
    );
  }

  const consent = data!;
  const chosen = scope ?? consent.requestedScope;
  const offered: McpScope[] = consent.requestedScope === 'write' ? ['read', 'write'] : ['read'];

  async function decide(approve: boolean) {
    if (status === 'busy' || status === 'leaving') return;
    setStatus('busy');
    try {
      const { redirectTo } = await decideConsent({
        params,
        consentToken: consent.consentToken,
        approve,
        scope: chosen,
      });
      setStatus('leaving');
      leaveTo(redirectTo);
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.code === 'mcp_connection_limit' ? 'limit' : 'error',
      );
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void decide(true);
  }

  const message = {
    idle: consent.limitReached ? t('mcp.consent.limit') : null,
    busy: null,
    leaving: t('mcp.consent.leaving'),
    limit: t('mcp.consent.limit'),
    error: t('errors.generic'),
  }[status];

  return (
    <Card className="mx-auto w-full max-w-[440px] gap-6 p-8 max-[640px]:p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-medium leading-tight font-semibold [overflow-wrap:anywhere]">
          {t('mcp.consent.heading', { name: consent.clientName })}
        </h1>
        <p className="text-tiny text-muted-foreground">
          {t('mcp.consent.returnsTo', { host: consent.redirectHost })}
        </p>
      </div>
      <p>{t('mcp.consent.asYou')}</p>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">{t('mcp.create.access')}</legend>
          {offered.map((value) => (
            <label key={value} className="flex items-start gap-3">
              <input
                type="radio"
                name={`${id}-scope`}
                value={value}
                checked={chosen === value}
                onChange={() => setScope(value)}
                className="mt-0.5 size-5 shrink-0 accent-foreground"
              />
              <span className="flex flex-col gap-0.5">
                <span>{t(`mcp.scope.${value}`)}</span>
                <span className="text-tiny text-muted-foreground">
                  {t(`mcp.scopeHint.${value}`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-tiny text-muted-foreground">{t('mcp.consent.revokeLater')}</p>
        {message && (
          <p
            role={status === 'leaving' ? 'status' : 'alert'}
            className={
              status === 'leaving'
                ? 'text-micro text-muted-foreground'
                : 'text-micro text-error-ink'
            }
          >
            {message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="lg"
            disabled={status === 'busy' || status === 'leaving' || consent.limitReached}
          >
            {t('mcp.consent.allow')}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            disabled={status === 'busy' || status === 'leaving'}
            onClick={() => void decide(false)}
          >
            {t('mcp.consent.deny')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
