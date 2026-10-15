import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { verifyCode } from './api';
import { sessionQuery } from './use-session';

export const RESEND_SECONDS = 30;
const MAX_ATTEMPTS = 3;
const CODE_LENGTH = 6;

interface CodeStepProps {
  /** The address the code was sent to. */
  email: string;
  /** Where to go after a correct code. */
  redirectTo: string;
  /** Send a new code; rejects when it fails. */
  onResend: () => Promise<void>;
  onChangeEmail: () => void;
}

/** The second step of login and of joining: ask for the 6-digit code that was emailed. */
export function CodeStep({ email, redirectTo, onResend, onChangeEmail }: CodeStepProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [wrongTries, setWrongTries] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
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

  async function resend() {
    if (busy) return;
    // Only a failed verification marks the code field; a failed resend has its own message.
    setCodeError(false);
    setFormError(null);
    setBusy(true);
    try {
      await onResend();
      setCode('');
      setWrongTries(0);
      setSecondsLeft(RESEND_SECONDS);
      codeRef.current?.focus();
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
      const wrongCode = error instanceof ApiError && error.code === 'INVALID_OTP';
      if (wrongCode) setWrongTries(wrongTries + 1);
      setFormError(failureMessage(error, wrongCode ? wrongTries + 1 : wrongTries));
    } finally {
      setBusy(false);
    }
  }

  /** `tries`: wrong codes so far, this one included. */
  function failureMessage(error: unknown, tries: number): string {
    if (!(error instanceof ApiError)) return t('errors.generic');
    if (error.status === 429) return t('login.errors.tooMany');
    switch (error.code) {
      case 'INVALID_OTP':
        // The last wrong try burns the code: say so instead of "0 attempts left".
        return tries >= MAX_ATTEMPTS
          ? t('login.errors.expired')
          : t('login.errors.wrongCode', { count: MAX_ATTEMPTS - tries });
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

  return (
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
          disabled={locked || busy}
          onClick={resend}
        >
          {locked ? t('login.sendAgainIn', { seconds: secondsLeft }) : t('login.sendAgain')}
        </Button>
        <Button type="button" variant="link" size="sm" className="px-0" onClick={onChangeEmail}>
          {t('login.changeEmail')}
        </Button>
      </div>
    </form>
  );
}
