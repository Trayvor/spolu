import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Me, PhoneNav } from '@spolu/shared';
import { sessionQuery, useSession } from '@/features/auth/use-session';
import { savePhoneNav } from './api';

const CHOICES: PhoneNav[] = ['classic', 'bottom'];

/**
 * "Navigation on phones": Classic (the default; sections in the header's select) or the bottom
 * bar. Always listed, with a note that it applies on phones only, so it can be found and set from
 * a laptop. The choice goes into the cached session first, so the header and the bar change at
 * once without a reload; a failed save rolls it back and shows an error line.
 */
export function PhoneNavSetting() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useSession();
  const id = useId();
  const [status, setStatus] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  if (!user) return null;
  const current: PhoneNav = user.phoneNav ?? 'classic';

  async function choose(next: PhoneNav) {
    if (next === current || status === 'busy') return;
    const put = (phoneNav: PhoneNav) =>
      queryClient.setQueryData<Me | null>(sessionQuery.queryKey, (me) =>
        me ? { ...me, phoneNav } : me,
      );
    put(next);
    setStatus('busy');
    try {
      await savePhoneNav(next);
      setStatus('saved');
    } catch {
      put(current);
      setStatus('error');
    }
  }

  return (
    <fieldset
      className="mt-5 flex flex-col gap-2 border-t border-border pt-5"
      aria-describedby={`${id}-hint`}
    >
      <legend className="float-left w-full font-semibold">
        {t('settings.profile.phoneNav.label')}
      </legend>
      <p id={`${id}-hint`} className="text-tiny text-muted-foreground">
        {t('settings.profile.phoneNav.hint')}
      </p>
      {CHOICES.map((choice) => (
        <label key={choice} className="flex items-center gap-3">
          <input
            type="radio"
            name={`${id}-phone-nav`}
            className="size-5 shrink-0 accent-foreground"
            checked={current === choice}
            disabled={status === 'busy'}
            onChange={() => void choose(choice)}
          />
          <span>{t(`settings.profile.phoneNav.${choice}`)}</span>
        </label>
      ))}
      {status === 'saved' && (
        <p role="status" className="text-micro font-semibold text-success">
          {t('settings.profile.saved')}
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </fieldset>
  );
}
