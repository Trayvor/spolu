import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { sendCode, verifyCode } from './api';
import { safeRedirect } from './redirect';
import { sessionQuery } from './use-session';

const RESEND_SECONDS = 30;
const MAX_ATTEMPTS = 3;
const CODE_LENGTH = 6;

/** The route component: reads `?redirect=` once and hands a safe target to the page. */
export function LoginRoute() {
  const search = useSearch({ strict: false });
  return <LoginPage redirectTo={safeRedirect((search as { redirect?: unknown }).redirect)} />;
}

/** Two steps in one card: ask for the email, then for the 6-digit code that was sent to it. */
export function LoginPage({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [wrongTries, setWrongTries] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  // Count the resend lock down once per second.
  const locked = secondsLeft > 0;
  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(s - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [locked]);

  /** Send a code to the trimmed email; true when the code step should show. */
  async function request(): Promise<boolean> {
    const trimmed = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setFieldError(t('login.errors.invalidEmail'));
      return false;
    }
    setBusy(true);
    setFieldError(null);
    setFormError(null);
    try {
      await sendCode(trimmed);
      setEmail(trimmed);
      setCode('');
      setWrongTries(0);
      setSecondsLeft(RESEND_SECONDS);
      return true;
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 429
          ? t('login.errors.tooMany')
          : t('errors.generic'),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onEmailSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (await request()) setStep('code');
  }

  async function onResend() {
    // Only a failed verification marks the code field; a failed resend has its own message.
    setCodeError(false);
    if (await request()) codeRef.current?.focus();
  }

  async function submitCode(value: string) {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setCodeError(false);
    try {
      await verifyCode(email, value);
      // refetchType 'all': the session query has no observer on this page.
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey, refetchType: 'all' });
      router.history.push(redirectTo);
    } catch (error) {
      setCode('');
      setCodeError(true);
      setFormError(failureMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function failureMessage(error: unknown): string {
    if (!(error instanceof ApiError)) return t('errors.generic');
    if (error.status === 429) return t('login.errors.tooMany');
    switch (error.code) {
      case 'INVALID_OTP': {
        const tries = wrongTries + 1;
        setWrongTries(tries);
        return t('login.errors.wrongCode', { count: Math.max(MAX_ATTEMPTS - tries, 0) });
      }
      case 'OTP_EXPIRED':
      case 'TOO_MANY_ATTEMPTS':
        return t('login.errors.expired');
      case 'ACCOUNT_DISABLED':
        return t('login.errors.disabled');
      default:
        return t('errors.generic');
    }
  }

  function onCodeChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void submitCode(digits);
  }

  function onCodeSubmit(event: FormEvent) {
    event.preventDefault();
    if (code.length === CODE_LENGTH) void submitCode(code);
  }

  function changeEmail() {
    setStep('email');
    setFormError(null);
    setCode('');
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
        <form noValidate onSubmit={onCodeSubmit} className="flex flex-col gap-6">
          <p>{t('login.codeIntro', { email })}</p>
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="login-code">{t('login.code')}</Label>
            <Input
              id="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              autoFocus
              ref={codeRef}
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              aria-invalid={codeError ? true : undefined}
              aria-describedby={formError ? 'login-code-error' : undefined}
              className="text-medium tracking-[0.4em]"
            />
            {formError && (
              <p id="login-code-error" role="alert" className="-mt-0.5 text-micro text-error-ink">
                {formError}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {t('login.submit')}
          </Button>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0"
              disabled={secondsLeft > 0 || busy}
              onClick={onResend}
            >
              {secondsLeft > 0
                ? t('login.sendAgainIn', { seconds: secondsLeft })
                : t('login.sendAgain')}
            </Button>
            <Button type="button" variant="link" size="sm" className="px-0" onClick={changeEmail}>
              {t('login.changeEmail')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
