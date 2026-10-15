import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateName } from './api';
import { safeRedirect } from './redirect';
import { sessionQuery } from './use-session';

/** The route component: reads `?redirect=` once and hands a safe target to the page. */
export function WelcomeRoute() {
  const search = useSearch({ strict: false });
  return <WelcomePage redirectTo={safeRedirect((search as { redirect?: unknown }).redirect)} />;
}

/** First login of an invited client: ask for the display name before anything else. */
export function WelcomePage({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setFieldError(t('welcome.errors.nameRequired'));
      return;
    }
    setBusy(true);
    setFieldError(null);
    setFormError(null);
    try {
      const me = await updateName(trimmed);
      // The guard reads the cached session: store the named user before navigating.
      queryClient.setQueryData(sessionQuery.queryKey, me);
      router.history.push(redirectTo);
    } catch {
      setFormError(t('errors.generic'));
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-[440px] gap-6 p-8">
      <h1 className="text-medium leading-tight font-semibold">{t('welcome.title')}</h1>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="welcome-name">{t('welcome.name')}</Label>
          <Input
            id="welcome-name"
            autoComplete="name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'welcome-name-error' : undefined}
          />
          {fieldError && (
            <p id="welcome-name-error" className="-mt-0.5 text-micro text-error-ink">
              {fieldError}
            </p>
          )}
        </div>
        {formError && (
          <p role="alert" className="text-micro text-error-ink">
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {t('welcome.submit')}
        </Button>
      </form>
    </Card>
  );
}
