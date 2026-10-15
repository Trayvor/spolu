import { useState, type FormEvent } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { sendCode } from './api';
import { CodeStep } from './code-step';
import { safeRedirect } from './redirect';

/** The route component: reads `?redirect=` once and hands a safe target to the page. */
export function LoginRoute() {
  const search = useSearch({ strict: false });
  return <LoginPage redirectTo={safeRedirect((search as { redirect?: unknown }).redirect)} />;
}

/** Two steps in one card: ask for the email, then for the 6-digit code that was sent to it. */
export function LoginPage({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      await sendCode(trimmed);
      setEmail(trimmed);
      setStep('code');
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 429
          ? t('login.errors.tooMany')
          : t('errors.generic'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-[440px] gap-6 p-8">
      <h1 className="text-medium leading-tight font-semibold">{t('login.title')}</h1>

      {step === 'email' ? (
        <form noValidate onSubmit={onEmailSubmit} className="flex flex-col gap-6">
          <p>{t('login.intro')}</p>
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="login-email">{t('login.email')}</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? 'login-email-error' : undefined}
            />
            {fieldError && (
              <p id="login-email-error" className="-mt-0.5 text-micro text-error-ink">
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
          redirectTo={redirectTo}
          onResend={() => sendCode(email)}
          onChangeEmail={() => setStep('email')}
        />
      )}
    </Card>
  );
}
