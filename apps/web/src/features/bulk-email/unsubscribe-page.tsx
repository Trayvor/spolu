import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { setLanguage } from '@/i18n';
import { ApiError } from '@/lib/api';
import { subscribeAgain, unsubscribe, unsubscribeInfoQuery } from './unsubscribe-api';

/** The route component: reads the token from the path. */
export function UnsubscribeRoute() {
  const { token } = useParams({ strict: false }) as { token: string };
  return <UnsubscribePage token={token} />;
}

type State = 'working' | 'unsubscribed' | 'subscribed' | 'failed' | 'rateLimited';

/**
 * Public page of a bulk email's unsubscribe link (spec §5): no session needed. It unsubscribes
 * once the page runs (a link scanner that only fetches the HTML changes nothing), in the
 * person's language, and offers "Subscribe again". A test email's link changes nothing.
 */
export function UnsubscribePage({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const info = useQuery(unsubscribeInfoQuery(token));
  // `working` only until the first answer; a later click keeps the text and disables the button.
  const [state, setState] = useState<State>('working');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const failedAs = (error: unknown): State =>
    error instanceof ApiError && error.status === 429 ? 'rateLimited' : 'failed';

  async function run(action: (token: string) => Promise<void>, done: State) {
    setBusy(true);
    try {
      await action(token);
      setState(done);
    } catch (error) {
      setState(failedAs(error));
    } finally {
      setBusy(false);
    }
  }

  // Once per page, when the link is known: the person's language, then the unsubscribe itself.
  const data = info.data;
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    if (data.language !== i18n.language) void setLanguage(data.language).catch(() => {});
    if (data.test) return;
    unsubscribe(token).then(
      () => setState('unsubscribed'),
      (error: unknown) => setState(failedAs(error)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the language is read once
  }, [data, token]);

  if (info.isPending) return null;
  const invalid = info.error instanceof ApiError && info.error.status === 404;

  let content;
  if (invalid || !data) {
    content = <p role="alert">{t(invalid ? 'unsubscribe.invalid' : 'errors.generic')}</p>;
  } else if (data.test) {
    content = <p>{t('unsubscribe.test')}</p>;
  } else if (state === 'failed' || state === 'rateLimited') {
    content = (
      <p role="alert">
        {t(state === 'rateLimited' ? 'unsubscribe.errors.rateLimited' : 'errors.generic')}
      </p>
    );
  } else if (state === 'working') {
    content = null;
  } else {
    const out = state === 'unsubscribed';
    const key = out ? 'unsubscribe.done' : 'unsubscribe.subscribed';
    content = (
      <>
        <h1 className="text-medium leading-tight font-semibold">{t(`${key}.title`)}</h1>
        <p className="text-muted-foreground">{t(`${key}.body`)}</p>
        <Button
          variant={out ? 'default' : 'outline'}
          className="self-start"
          disabled={busy}
          onClick={() =>
            void (out ? run(subscribeAgain, 'subscribed') : run(unsubscribe, 'unsubscribed'))
          }
        >
          {t(out ? 'unsubscribe.subscribeAgain' : 'unsubscribe.unsubscribeButton')}
        </Button>
      </>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-[440px] gap-5 p-8" aria-live="polite">
      {content}
    </Card>
  );
}
