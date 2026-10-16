import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sessionQuery } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api';
import { confirmEmailChange, requestEmailChange } from './api';

const CODE_LENGTH = 6;

type Step =
  | { kind: 'view' }
  | { kind: 'address' }
  | { kind: 'code'; newEmail: string }
  | { kind: 'done'; newEmail: string };

/**
 * The email row of the Profile card: the current address with "Change", which opens an inline
 * flow under it: the new address → the 6-digit code sent there → done. The server answers
 * `email_taken` only after a correct code, so an address cannot be probed. On success the
 * session is replaced and refetched. `canChange` is false for the superadmin, whose address
 * comes from the server configuration.
 */
export function EmailChange({ current, canChange }: { current: string; canChange: boolean }) {
  const { t } = useTranslation();
  const labelId = useId();
  const [step, setStep] = useState<Step>({ kind: 'view' });
  const open = step.kind === 'address' || step.kind === 'code';

  return (
    <div className="flex flex-col gap-2.5">
      <span id={labelId} className="text-micro font-semibold text-muted-foreground">
        {t('settings.profile.email')}
      </span>
      <div className="flex min-h-11 items-center gap-3" aria-labelledby={labelId} role="group">
        <span className="min-w-0 flex-1 text-button font-semibold break-all">{current}</span>
        {canChange && !open && (
          <Button variant="secondary" size="lg" onClick={() => setStep({ kind: 'address' })}>
            {t('settings.profile.change')}
          </Button>
        )}
      </div>
      {!canChange && (
        <p className="text-micro text-muted-foreground">{t('settings.profile.emailFixed')}</p>
      )}
      {step.kind === 'done' && (
        <p role="status" className="text-micro font-semibold text-success">
          {t('settings.profile.done', { email: step.newEmail })}
        </p>
      )}
      {step.kind === 'address' && (
        <AddressStep
          current={current}
          onSent={(newEmail) => setStep({ kind: 'code', newEmail })}
          onCancel={() => setStep({ kind: 'view' })}
        />
      )}
      {step.kind === 'code' && (
        <CodeStep
          newEmail={step.newEmail}
          onDone={() => setStep({ kind: 'done', newEmail: step.newEmail })}
          onCancel={() => setStep({ kind: 'view' })}
        />
      )}
    </div>
  );
}

/** The grey inset that holds one step of the flow. */
const inset = 'mt-1 flex flex-col gap-4 rounded-lg bg-muted p-4';

function errorText(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof ApiError)) return t('errors.generic');
  if (error.status === 429) return t('settings.profile.tooMany');
  switch (error.code) {
    case 'invalid_code':
      return t('settings.profile.invalidCode');
    case 'email_taken':
      return t('settings.profile.emailTaken');
    case 'validation_failed':
      return t('settings.profile.invalidEmail');
    default:
      return t('errors.generic');
  }
}

function AddressStep({
  current,
  onSent,
  onCancel,
}: {
  current: string;
  onSent: (newEmail: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setError(t('settings.profile.invalidEmail'));
      return;
    }
    if (trimmed === current.toLowerCase()) {
      setError(t('settings.profile.sameEmail'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestEmailChange(trimmed);
      onSent(trimmed);
    } catch (failure) {
      setError(errorText(failure, t));
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className={inset}>
      <div className="flex flex-col gap-2.5">
        <Label htmlFor={fieldId}>{t('settings.profile.newEmail')}</Label>
        <Input
          id={fieldId}
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {error && (
          <p id={errorId} role="alert" className="text-micro text-error-ink">
            {error}
          </p>
        )}
      </div>
      <StepButtons submit={t('settings.profile.sendCode')} busy={busy} onCancel={onCancel} />
    </form>
  );
}

function CodeStep({
  newEmail,
  onDone,
  onCancel,
}: {
  newEmail: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || code.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const me = await confirmEmailChange(newEmail, code);
      queryClient.setQueryData(sessionQuery.queryKey, me);
      void queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
      onDone();
    } catch (failure) {
      setCode('');
      setError(errorText(failure, t));
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className={inset}>
      <p className="text-button break-words">
        {t('settings.profile.codeSent', { email: newEmail })}
      </p>
      <div className="flex flex-col gap-2.5">
        <Label htmlFor={fieldId}>{t('settings.profile.code')}</Label>
        <Input
          id={fieldId}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={CODE_LENGTH}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="max-w-[220px] text-medium tracking-[0.4em]"
        />
        {error && (
          <p id={errorId} role="alert" className="text-micro text-error-ink">
            {error}
          </p>
        )}
      </div>
      <StepButtons
        submit={t('settings.profile.confirm')}
        busy={busy || code.length !== CODE_LENGTH}
        onCancel={onCancel}
      />
    </form>
  );
}

function StepButtons({
  submit,
  busy,
  onCancel,
}: {
  submit: string;
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="lg" disabled={busy}>
        {submit}
      </Button>
      <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
        {t('settings.profile.cancel')}
      </Button>
    </div>
  );
}
