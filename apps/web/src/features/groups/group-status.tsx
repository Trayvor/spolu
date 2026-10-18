import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Group } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { setGroupActive } from './api';

/**
 * Admins, client groups only: "Deactivate" with an inline confirmation (like removing a member),
 * or, on a deactivated group, the notice with "Reactivate" (no confirmation: it only brings
 * things back). Both refresh every group query.
 */
export function GroupStatus({ group }: { group: Group }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deactivated = Boolean(group.deactivatedAt);

  const change = useMutation({
    mutationFn: (active: boolean) => setGroupActive(group.id, active),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['home', 'sidebar'] });
    },
  });

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const error = change.isError && (
    <p role="alert" className="text-micro text-error-ink">
      {t('errors.generic')}
    </p>
  );

  if (deactivated) {
    return (
      <div
        role="status"
        className="flex flex-col items-start gap-3 rounded-md border-2 border-input bg-card p-4 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between"
      >
        <p className="text-body">{t('group.status.notice')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={change.isPending}
          onClick={() => change.mutate(true)}
        >
          {t('group.status.reactivate')}
        </Button>
        {error}
      </div>
    );
  }
  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setConfirming(true)}>
        {t('group.status.deactivate')}
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-button">{t('group.status.confirm', { name: group.name })}</p>
      <div className="flex gap-2">
        <Button
          ref={confirmRef}
          variant="destructive"
          size="sm"
          disabled={change.isPending}
          onClick={() => change.mutate(false)}
        >
          {t('group.status.deactivate')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setConfirming(false);
            change.reset();
          }}
        >
          {t('group.members.cancel')}
        </Button>
      </div>
      {error}
    </div>
  );
}
