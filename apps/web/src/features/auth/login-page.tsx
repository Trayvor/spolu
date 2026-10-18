import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { getInviteContext, rememberInvite, sendCode } from './api';
import { InviteNote } from './invite-note';
import { CodeStep } from './code-step';
import { linkEmail, safeRedirect } from './redirect';

/**
 * The route component: reads `?redirect=` once and hands a safe target to the page, and the
 * `?email=` of an invitation link as the field's first value, with its signed `?invite=` context
 * (X19). All are checked again here: the root route passes the raw search through.
 */
export function LoginRoute() {
  const search = useSearch({ strict: false }) as {
    redirect?: unknown;
    email?: unknown;
    notice?: unknown;
    invite?: unknown;
  };
  const invite =
    typeof search.invite === 'string' && search.invite.length <= 2000 ? search.invite : undefined;
  return (
    <LoginPage
      redirectTo={safeRedirect(search.redirect)}
      initialEmail={linkEmail(search.email)}
      linkExpired={search.notice === 'linkExpired'}
      invite={invite}
    />
  );
}

/** Two steps in one card: ask for the email, then for the 6-digit code that was sent to it. */
export function LoginPage({
  redirectTo,
  initialEmail = '',
  linkExpired = false,
  invite,
}: {
  redirectTo: string;
  initialEmail?: string;
  /** Came from a refused ticket sign-in link: say so above the email field. */
  linkExpired?: boolean;
  /** The signed context of an invitation link (X19), checked by the server with the email. */
  invite?: string;
}) {
  const { t } = useTranslation();
  // Who invited the person to which group; a forged or outdated link shows the plain page.
  const context = useQuery({
    queryKey: ['invitation-context', invite, initialEmail],
    queryFn: () => getInviteContext(invite!, initialEmail),
    enabled: Boolean(invite && initialEmail),
    retry: false,
    staleTime: Infinity,
  }).data;
  // The name step after the code says it again.
  useEffect(() => {
    if (context) rememberInvite(context);
  }, [context]);

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
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
    <Card className="mx-auto w-full max-w-[440px] gap-6 p-8 max-[640px]:p-6">
      <h1 className="text-medium leading-tight font-semibold">{t('login.title')}</h1>
      {context && (
        <InviteNote
          by={t('login.invite.by', { name: context.invitedBy, group: context.groupName })}
          about={t('login.invite.about')}
        />
      )}

      {step === 'email' ? (
        <form noValidate onSubmit={onEmailSubmit} className="flex flex-col gap-6">
          {linkExpired && <p role="status">{t('login.linkExpired')}</p>}
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
