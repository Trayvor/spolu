import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BulkSubscription } from '@spolu/shared';
import { bulkEmailSettingQuery, saveBulkEmailSetting } from './api';

/**
 * "Receive mailings" (spec §5, P4): on by default; unticking unsubscribes from bulk email,
 * ticking subscribes again. Saves at once, shows "Saved", and rolls back with an error line
 * when the save fails. Login codes and notifications are never affected (P5).
 */
export function BulkEmailSetting() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setting = useQuery(bulkEmailSettingQuery);
  const id = useId();
  const [status, setStatus] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');

  if (!setting.data) return null;
  const subscribed = setting.data.subscribed;

  async function onChange(next: boolean) {
    const key = bulkEmailSettingQuery.queryKey;
    queryClient.setQueryData<BulkSubscription>(key, { subscribed: next });
    setStatus('busy');
    try {
      await saveBulkEmailSetting(next);
      setStatus('saved');
    } catch {
      queryClient.setQueryData<BulkSubscription>(key, { subscribed: !next });
      setStatus('error');
    }
  }

  return (
    // A row of the Profile card, under its own hairline; nothing (no empty rule) until loaded.
    <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-foreground"
          checked={subscribed}
          disabled={status === 'busy'}
          aria-describedby={`${id}-hint`}
          onChange={(event) => void onChange(event.target.checked)}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="font-semibold">
            {t('settings.profile.bulkEmail.label')}
          </label>
          <p id={`${id}-hint`} className="text-tiny text-muted-foreground">
            {t('settings.profile.bulkEmail.hint')}
          </p>
        </div>
      </div>
      {status === 'saved' && (
        <p role="status" className="pl-8 text-micro font-semibold text-success">
          {t('settings.profile.saved')}
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="pl-8 text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}
