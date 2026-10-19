import { useEffect, useRef, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { WeeklySummaryUnsubscribeInfoSchema } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { setLanguage } from '@/i18n';
import { ApiError, apiGet, apiSend } from '@/lib/api';

const path = (token: string) => `/weekly-summary/unsubscribe/${encodeURIComponent(token)}`;

const infoQuery = (token: string) =>
  queryOptions({
    queryKey: ['weekly-summary-unsubscribe', token],
    queryFn: () => apiGet(path(token), WeeklySummaryUnsubscribeInfoSchema),
    retry: false,
    staleTime: Infinity,
  });

export function WeeklySummaryUnsubscribeRoute() {
  const { token } = useParams({ strict: false }) as { token: string };
  return <WeeklySummaryUnsubscribePage token={token} />;
}

type State = 'working' | 'unsubscribed' | 'subscribed' | 'failed';

/**
 * The weekly summary email's unsubscribe link (spec §12.6): no session. It unsubscribes once the
 * page runs (a link scanner that only fetches the HTML changes nothing), in the person's
 * language, and offers "Znova prihlásiť".
 */
export function WeeklySummaryUnsubscribePage({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const info = useQuery(infoQuery(token));
  const [state, setState] = useState<State>('working');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const data = info.data;

  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    if (data.language !== i18n.language) void setLanguage(data.language).catch(() => {});
    apiSend('POST', path(token)).then(
      () => setState('unsubscribed'),
      () => setState('failed'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the language is read once
  }, [data, token]);

  async function again() {
    setBusy(true);
    try {
      await apiSend('POST', `/weekly-summary/subscribe/${encodeURIComponent(token)}`);
      setState('subscribed');
    } catch {
      setState('failed');
    } finally {
      setBusy(false);
    }
  }

  if (info.isPending) return null;
  const invalid = info.error instanceof ApiError && info.error.status === 404;
  let content;
  if (invalid || !data) {
    content = <p role="alert">{t(invalid ? 'unsubscribe.weekly.invalid' : 'errors.generic')}</p>;
  } else if (state === 'failed') {
    content = <p role="alert">{t('errors.generic')}</p>;
  } else if (state === 'working') {
    content = null;
  } else {
    content = (
      <>
        <h1 className="text-medium leading-tight font-semibold">
          {t(
            state === 'unsubscribed' ? 'unsubscribe.weekly.done' : 'unsubscribe.weekly.subscribed',
            {
              group: data.groupName,
            },
          )}
        </h1>
        {state === 'unsubscribed' && (
          <Button className="self-start" disabled={busy} onClick={() => void again()}>
            {t('unsubscribe.subscribeAgain')}
          </Button>
        )}
      </>
    );
  }
  return (
    <Card className="mx-auto w-full max-w-[440px] gap-5 p-8 max-[640px]:p-6" aria-live="polite">
      {content}
    </Card>
  );
}
