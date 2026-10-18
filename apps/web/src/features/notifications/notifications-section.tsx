import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  NotificationChannels,
  wantsPush,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPrefs,
  type NotificationPrefsPatch,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { notificationPrefsQuery, updateNotificationPrefs } from './api';
import { someWant } from './prompt-rules';
import { getDeviceState, subscribeThisDevice, type DeviceState } from './push-device';

/**
 * The channels card of /settings/notifications: this device's push state (N11: also while no group
 * uses push), a line when every group is off, then one row per notification
 * group the server lists, each with a channel select. Choosing a push channel also subscribes this
 * device when it is not set up yet; the subscription starts first, inside the change, because the
 * browser asks for permission only in a user gesture. A change updates at once and rolls back
 * with an error line when the save fails (only that group).
 */
export function NotificationsSection({ title }: { title?: string } = {}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const prefs = useQuery(notificationPrefsQuery);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceFailed, setDeviceFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getDeviceState().then(
      (state) => live && setDevice(state),
      () => live && setDevice('unsupported'),
    );
    return () => {
      live = false;
    };
  }, []);

  // Each change touches only its own group in the cache, so two quick changes never undo each
  // other: an answer carries the server's view of every group, possibly older than the other edit.
  const setGroup = (category: NotificationCategory, channel: NotificationChannel) =>
    queryClient.setQueryData<NotificationPrefs>(notificationPrefsQuery.queryKey, (current) =>
      current ? { ...current, channels: { ...current.channels, [category]: channel } } : current,
    );
  const save = useMutation({
    mutationFn: updateNotificationPrefs,
    onMutate: async (patch: NotificationPrefsPatch) => {
      await queryClient.cancelQueries({ queryKey: notificationPrefsQuery.queryKey });
      const previous = queryClient.getQueryData<NotificationPrefs>(notificationPrefsQuery.queryKey)
        ?.channels[patch.category];
      setGroup(patch.category, patch.channel);
      return { previous };
    },
    onError: (_error, patch, context) => {
      if (context?.previous) setGroup(patch.category, context.previous);
    },
    onSuccess: (next, patch) => setGroup(patch.category, next.channels[patch.category]),
  });

  async function turnOnDevice(key: string) {
    setDeviceBusy(true);
    setDeviceFailed(false);
    try {
      setDevice(await subscribeThisDevice(key));
    } catch {
      setDeviceFailed(true);
    } finally {
      setDeviceBusy(false);
    }
  }

  const data = prefs.data;
  const key = data?.vapidPublicKey ?? null;

  function onChannelChange(category: NotificationCategory, channel: NotificationChannel) {
    if (wantsPush(channel) && device === 'off' && key) void turnOnDevice(key);
    save.mutate({ category, channel });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title ?? t('settings.notifications.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col">
        {prefs.isError && (
          <p role="alert" className="text-button text-error-ink">
            {t('errors.generic')}
          </p>
        )}
        {data && (
          <>
            {!key ? (
              <p className="mb-5 text-button text-muted-foreground">
                {t('settings.notifications.pushUnavailable')}
              </p>
            ) : (
              // N11 (2026-10-18): shown even while no group uses push, so the state is never hidden.
              device && (
                <div className="mb-5">
                  <DeviceLine
                    state={device}
                    busy={deviceBusy}
                    failed={deviceFailed}
                    unused={!someWant(data, wantsPush)}
                    onTurnOn={() => void turnOnDevice(key)}
                  />
                </div>
              )
            )}
            {data.visibleCategories.every((category) => data.channels[category] === 'none') && (
              <p className="mb-5 rounded-lg bg-muted p-4 text-button">
                {t('settings.notifications.allOff')}
              </p>
            )}
            <div className="flex flex-col divide-y divide-border">
              {data.visibleCategories.map((category) => (
                <ChannelRow
                  key={category}
                  category={category}
                  value={data.channels[category]}
                  pushAvailable={key !== null}
                  onChange={(channel) => onChannelChange(category, channel)}
                />
              ))}
            </div>
            <p className="mt-4 text-micro text-muted-foreground">
              {t('settings.notifications.emailNote')}
            </p>
            {save.isError && (
              <p role="alert" className="mt-4 text-button text-error-ink">
                {t('errors.generic')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** One notification group: its name and what it covers, and the channel select on the right. */
function ChannelRow({
  category,
  value,
  pushAvailable,
  onChange,
}: {
  category: NotificationCategory;
  value: NotificationChannel;
  pushAvailable: boolean;
  onChange: (channel: NotificationChannel) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0 min-[641px]:flex-row min-[641px]:items-center min-[641px]:gap-4">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-body font-semibold">
          {t(`settings.notifications.groups.${category}`)}
        </label>
        <p id={`${id}-hint`} className="text-button text-muted-foreground">
          {t(`settings.notifications.hints.${category}`)}
        </p>
      </div>
      <Select
        id={id}
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value as NotificationChannel)}
        containerClassName="w-full min-[641px]:w-[180px] min-[641px]:shrink-0"
      >
        {NotificationChannels.map((channel) => (
          <option key={channel} value={channel} disabled={!pushAvailable && wantsPush(channel)}>
            {t(`settings.notifications.channels.${channel}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** This device, above the groups: its push state and the one thing to do about it. */
function DeviceLine({
  state,
  busy,
  failed,
  unused,
  onTurnOn,
}: {
  state: DeviceState;
  busy: boolean;
  failed: boolean;
  /** No notification group is on Push or Email and push. */
  unused: boolean;
  onTurnOn: () => void;
}) {
  const { t } = useTranslation();
  const inset = 'flex flex-col items-start gap-3 rounded-lg bg-muted p-4 text-button';

  if (state === 'needs-home-screen') {
    return <p className={inset}>{t('settings.notifications.iosHint')}</p>;
  }
  if (state === 'unsupported') {
    return <p className={inset}>{t('settings.notifications.deviceUnsupported')}</p>;
  }
  const word = {
    on: 'settings.notifications.deviceOn',
    off: 'settings.notifications.deviceOff',
    blocked: 'settings.notifications.deviceBlocked',
  }[state];
  return (
    <div className={inset}>
      <p className="font-semibold">{t('settings.notifications.device', { state: t(word) })}</p>
      {unused && (
        <p className="-mt-2 text-muted-foreground">{t('settings.notifications.pushUnused')}</p>
      )}
      {state === 'blocked' && (
        <p className="-mt-2 text-muted-foreground">{t('settings.notifications.unblock')}</p>
      )}
      {state === 'off' && (
        <Button variant="outline" size="lg" disabled={busy} onClick={onTurnOn}>
          {t('settings.notifications.turnOnDevice')}
        </Button>
      )}
      {failed && (
        <p role="alert" className="text-error-ink">
          {t('notifications.prompt.enableFailed')}
        </p>
      )}
    </div>
  );
}
