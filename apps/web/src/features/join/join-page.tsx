import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { sendCode } from '@/features/auth/api';
import { CodeStep } from '@/features/auth/code-step';
import { joinGroup, joinInfoQuery, joinLogoUrl } from './api';

/** The route component: reads the invite token from the path. */
export function JoinRoute() {
  const { token } = useParams({ strict: false }) as { token: string };
  return <JoinPage token={token} />;
}

/** Public invite page: the group's name and logo, then the login card flow (email, code). */
export function JoinPage({ token }: { token: string }) {
  const { t } = useTranslation();
  const info = useQuery(joinInfoQuery(token));

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  if (info.isPending) return null;

  const invalid = expired || (info.error instanceof ApiError && info.error.status === 404);
  if (invalid) {
    return (
      <Card className="mx-auto w-full max-w-[440px] gap-6 p-8">
        <p role="alert">{t('join.invalid')}</p>
      </Card>
    );
  }
  if (!info.data) {
    return (
      <Card className="mx-auto w-full max-w-[440px] gap-6 p-8">
        <p role="alert">{t('errors.generic')}</p>
      </Card>
    );
  }

  async function onEmailSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setFieldError(t('login.errors.invalidEmail'));
      return;
    }
    setBusy(true);
    setFieldError(null);
    setFormError(null);
    try {
      await joinGroup(token, trimmed);
      await sendCode(trimmed);
      setEmail(trimmed);
      setStep('code');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setExpired(true);
      else if (error instanceof ApiError && error.status === 429) {
        setFormError(t('join.errors.rateLimited'));
      } else setFormError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-[440px] gap-6 p-8">
      {info.data.hasLogo && (
        <img
          src={joinLogoUrl(token)}
          alt=""
          width={56}
          height={56}
          className="size-14 rounded-lg object-contain"
        />
      )}
      <h1 className="text-medium leading-tight font-semibold">
        {t('join.title', { group: info.data.name })}
      </h1>

      {step === 'email' ? (
        <form noValidate onSubmit={onEmailSubmit} className="flex flex-col gap-6">
          <p>{t('join.intro')}</p>
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="join-email">{t('login.email')}</Label>
            <Input
              id="join-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? 'join-email-error' : undefined}
            />
            {fieldError && (
              <p id="join-email-error" className="-mt-0.5 text-micro text-error-ink">
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
            {t('login.sendCode')}
          </Button>
        </form>
      ) : (
        <CodeStep
          email={email}
          redirectTo="/"
          onResend={() => sendCode(email)}
          onChangeEmail={() => setStep('email')}
        />
      )}
    </Card>
  );
}
