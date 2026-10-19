import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { groupSettingQuery, reminderQuery, setGroupSetting, setReminder } from './api';

/**
 * Under the editor (spec §12.3): the group's switch (its managers only) and the admin's own
 * "remind me" choice. Each checkbox saves at once.
 */
export function SettingsStrip({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setting = useQuery(groupSettingQuery(groupId));
  const reminder = useQuery(reminderQuery);
  const group = useMutation({
    mutationFn: (enabled: boolean) => setGroupSetting(groupId, enabled),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: groupSettingQuery(groupId).queryKey }),
  });
  const remind = useMutation({
    mutationFn: setReminder,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reminderQuery.queryKey }),
  });
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-secondary p-4 text-button">
      {setting.data?.canEdit && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={setting.data.enabled}
            disabled={group.isPending}
            onChange={(e) => group.mutate(e.target.checked)}
          />
          {t('weeklySummary.settings.group')}
        </label>
      )}
      {reminder.data && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={reminder.data.remind}
            disabled={remind.isPending}
            onChange={(e) => remind.mutate(e.target.checked)}
          />
          {t('weeklySummary.settings.remind')}
        </label>
      )}
      {(group.isError || remind.isError) && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}
