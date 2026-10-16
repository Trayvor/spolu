import '@/i18n/settings-copy';
import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateName } from '@/features/auth/api';
import { sessionQuery, useSession } from '@/features/auth/use-session';
import { EmailChange } from './email-change';

const NAME_MAX = 100;

/**
 * The Profile card of /settings: the name (Save, then an inline "Saved") and the email address
 * with its inline change flow (`email-change.tsx`). Both rows sit in one card, split by a hairline.
 */
export function ProfileSection() {
  const { t } = useTranslation();
  const user = useSession();
  if (!user) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('settings.profile.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col">
        <NameForm initial={user.name} />
        <div className="mt-5 border-t border-border pt-5">
          <EmailChange current={user.email} canChange={user.role !== 'superadmin'} />
        </div>
      </CardContent>
    </Card>
  );
}

function NameForm({ initial }: { initial: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const messageId = `${fieldId}-message`;
  const [name, setName] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'busy' | 'saved' | 'error' | 'empty'>('idle');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === 'busy') return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setStatus('empty');
      return;
    }
    setStatus('busy');
    try {
      const me = await updateName(trimmed);
      queryClient.setQueryData(sessionQuery.queryKey, me);
      setName(me.name);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  const failed = status === 'error' || status === 'empty';
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-2.5">
      <Label htmlFor={fieldId}>{t('settings.profile.name')}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={fieldId}
          value={name}
          maxLength={NAME_MAX}
          autoComplete="name"
          onChange={(e) => {
            setName(e.target.value);
            if (status !== 'busy') setStatus('idle');
          }}
          aria-invalid={status === 'empty' ? true : undefined}
          aria-describedby={status === 'idle' || status === 'busy' ? undefined : messageId}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" size="lg" disabled={status === 'busy'}>
          {t('settings.profile.save')}
        </Button>
      </div>
      {status === 'saved' && (
        <p id={messageId} role="status" className="text-micro font-semibold text-success">
          {t('settings.profile.saved')}
        </p>
      )}
      {failed && (
        <p id={messageId} role="alert" className="text-micro text-error-ink">
          {t(status === 'empty' ? 'settings.profile.nameRequired' : 'errors.generic')}
        </p>
      )}
    </form>
  );
}
