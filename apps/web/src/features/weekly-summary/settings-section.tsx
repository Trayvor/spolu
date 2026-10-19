import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MyWeeklySummaryGroupsSchema } from '@spolu/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet, apiSend } from '@/lib/api';
import { z } from 'zod';

const groupsKey = ['weekly-summaries', 'me'] as const;
const reminderKey = ['weekly-summaries', 'reminder'] as const;
const ReminderSchema = z.object({ remind: z.boolean() });

/**
 * The profile's "Týždenný prehľad e-mailom" (spec §12.5): a client's checkbox per group; an
 * admin's "remind me of drafts by email" instead.
 */
export function WeeklySummarySettings({ admin }: { admin: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const groups = useQuery({
    queryKey: groupsKey,
    queryFn: () => apiGet('/me/weekly-summary', MyWeeklySummaryGroupsSchema),
    enabled: !admin,
  });
  const reminder = useQuery({
    queryKey: reminderKey,
    queryFn: () => apiGet('/me/weekly-summary/reminder', ReminderSchema),
    enabled: admin,
  });
  const subscribe = useMutation({
    mutationFn: ({ groupId, subscribed }: { groupId: string; subscribed: boolean }) =>
      apiSend('PUT', `/me/weekly-summary/${encodeURIComponent(groupId)}`, { subscribed }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: groupsKey }),
  });
  const remind = useMutation({
    mutationFn: (value: boolean) =>
      apiSend('PUT', '/me/weekly-summary/reminder', { remind: value }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: reminderKey }),
  });
  if (!admin && (groups.data?.groups.length ?? 0) === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('notifications.weeklySummary.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-button">
        {admin ? (
          reminder.data && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={reminder.data.remind}
                disabled={remind.isPending}
                onChange={(e) => remind.mutate(e.target.checked)}
              />
              {t('notifications.weeklySummary.remind')}
            </label>
          )
        ) : (
          <>
            <p className="text-muted-foreground">{t('notifications.weeklySummary.body')}</p>
            {groups.data?.groups.map((g) => (
              <label key={g.groupId} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={g.subscribed}
                  disabled={subscribe.isPending}
                  onChange={(e) =>
                    subscribe.mutate({ groupId: g.groupId, subscribed: e.target.checked })
                  }
                />
                <span>
                  {g.name}
                  {!g.enabled && (
                    <span className="text-muted-foreground">
                      {' '}
                      {t('notifications.weeklySummary.groupOff')}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </>
        )}
        {(subscribe.isError || remind.isError) && (
          <p role="alert" className="text-micro text-error-ink">
            {t('errors.generic')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
