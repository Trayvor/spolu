import { useId, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PASSKEY_LIMITS, type Passkey } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSession } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api';
import { addPasskey, deletePasskey, passkeysQuery, sendPasskeyCode } from './api';
import { canCreatePasskeys, isPasskeyCancel } from './webauthn';

/**
 * "Passkeys" on /settings, admins only (ADR 0050): add a named passkey (a stale session first
 * confirms an emailed code), see the list with when each was added and last used, delete one.
 * The email code login stays. A lazy chunk with its own namespace `passkeys`.
 */
export function PasskeysSection() {
  const { t } = useTranslation();
  const [supported] = useState(canCreatePasskeys);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('passkeys.title')}</h2>
        </CardTitle>
        <p className="text-tiny text-muted-foreground">{t('passkeys.intro')}</p>
      </CardHeader>
      <CardContent className="flex flex-col">
        {supported ? <AddForm /> : <p className="text-tiny">{t('passkeys.add.unsupported')}</p>}
        <PasskeyList />
      </CardContent>
    </Card>
  );
}

type Status = 'idle' | 'busy' | 'code' | 'added';
type Problem = 'empty' | 'limit' | 'wrongCode' | 'failed' | null;

function AddForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const email = useSession()?.email ?? '';
  const id = useId();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [problem, setProblem] = useState<Problem>(null);

  async function add(withCode?: string) {
    setProblem(null);
    const before = status === 'code' ? 'code' : 'idle';
    setStatus('busy');
    try {
      await addPasskey(name.trim(), withCode);
      await queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey });
      setName('');
      setCode('');
      setStatus('added');
    } catch (error) {
      if (isPasskeyCancel(error)) {
        // The code was used up by the options: a cancelled dialog starts over.
        setStatus('idle');
        setCode('');
        return;
      }
      if (error instanceof ApiError && error.code === 'reauth_required') {
        await askForCode();
        return;
      }
      setStatus(error instanceof ApiError && error.code === 'invalid_code' ? before : 'idle');
      setProblem(problemOf(error));
    }
  }

  async function askForCode() {
    setStatus('busy');
    try {
      await sendPasskeyCode();
      setCode('');
      setStatus('code');
    } catch (error) {
      setStatus('idle');
      setProblem(problemOf(error));
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === 'busy') return;
    if (name.trim() === '') {
      setProblem('empty');
      return;
    }
    void add();
  }

  function onCodeSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === 'busy' || !/^\d{6}$/.test(code)) return;
    void add(code);
  }

  const message =
    problem &&
    {
      empty: t('passkeys.add.nameRequired'),
      limit: t('passkeys.add.limit', { count: PASSKEY_LIMITS.perUser }),
      wrongCode: t('passkeys.reauth.wrong'),
      failed: t('passkeys.add.failed'),
    }[problem];
  const alert = message && (
    <p role="alert" className="text-micro text-error-ink">
      {message}
    </p>
  );

  if (status === 'code' || (status === 'busy' && code !== '')) {
    return (
      <form noValidate onSubmit={onCodeSubmit} className="flex flex-col gap-4">
        <h3 className="font-semibold">{t('passkeys.add.title')}</h3>
        <p className="text-tiny [overflow-wrap:anywhere]">
          {t('passkeys.reauth.intro', { email })}
        </p>
        <div className="flex flex-col gap-2.5">
          <Label htmlFor={`${id}-code`}>{t('passkeys.reauth.code')}</Label>
          <Input
            id={`${id}-code`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            aria-invalid={problem === 'wrongCode' ? true : undefined}
            className="max-w-[12rem] tracking-[0.3em]"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={status === 'busy'}>
              {t('passkeys.reauth.submit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStatus('idle');
                setProblem(null);
                setCode('');
              }}
            >
              {t('passkeys.reauth.cancel')}
            </Button>
          </div>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="self-start px-0"
            disabled={status === 'busy'}
            onClick={() => void askForCode()}
          >
            {t('passkeys.reauth.sendAgain')}
          </Button>
          {alert}
        </div>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <h3 className="font-semibold">{t('passkeys.add.title')}</h3>
      <div className="flex flex-col gap-2.5">
        <Label htmlFor={`${id}-name`}>{t('passkeys.add.name')}</Label>
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={PASSKEY_LIMITS.name}
          placeholder={t('passkeys.add.namePlaceholder')}
          onChange={(e) => {
            setName(e.target.value);
            if (status === 'added') setStatus('idle');
            if (problem === 'empty') setProblem(null);
          }}
          aria-invalid={problem === 'empty' ? true : undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" className="self-start" disabled={status === 'busy'}>
          {t('passkeys.add.submit')}
        </Button>
        {alert}
        {status === 'added' && (
          <p role="status" className="text-micro">
            {t('passkeys.add.added')}
          </p>
        )}
      </div>
    </form>
  );
}

function problemOf(error: unknown): Problem {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.code === 'passkey_limit') return 'limit';
  if (error.code === 'invalid_code') return 'wrongCode';
  return 'failed';
}

function useDate() {
  const { i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  return (iso: string) => format.format(new Date(iso));
}

function PasskeyList() {
  const { t } = useTranslation();
  const list = useQuery(passkeysQuery);
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5">
      <h3 className="font-semibold">{t('passkeys.list.title')}</h3>
      {list.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
      {list.data?.length === 0 && (
        <p className="text-tiny text-muted-foreground">{t('passkeys.list.empty')}</p>
      )}
      {list.data && list.data.length > 0 && (
        <ul role="list" className="flex flex-col divide-y divide-border">
          {list.data.map((item) => (
            <PasskeyRow key={item.id} passkey={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PasskeyRow({ passkey }: { passkey: Passkey }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const date = useDate();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');

  async function remove() {
    setStatus('busy');
    try {
      await deletePasskey(passkey.id);
      await queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey });
    } catch {
      setStatus('error');
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold [overflow-wrap:anywhere]">{passkey.name}</span>
          <span className="text-tiny text-muted-foreground">
            {t('passkeys.list.created', { date: date(passkey.createdAt) })}
          </span>
          <span className="text-tiny text-muted-foreground">
            {passkey.lastUsedAt
              ? t('passkeys.list.lastUsed', { date: date(passkey.lastUsedAt) })
              : t('passkeys.list.neverUsed')}
          </span>
        </div>
        {!confirming && (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            {t('passkeys.list.delete')}
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2" role="group">
          <span className="text-tiny">{t('passkeys.list.confirm')}</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={status === 'busy'}
            onClick={() => void remove()}
          >
            {t('passkeys.list.deleteConfirm')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            {t('passkeys.list.keep')}
          </Button>
        </div>
      )}
      {status === 'error' && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </li>
  );
}
