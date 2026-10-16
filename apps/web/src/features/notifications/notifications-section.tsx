import { useEffect, useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { NotificationPrefs, NotificationPrefsPatch } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { notificationPrefsQuery, updateNotificationPrefs } from './api';
import { getDeviceState, subscribeThisDevice, type DeviceState } from './push-device';

/**
 * The Notifications card of /settings: the Push switch with this device's state under it, and
 * the Email switch. Turning push on also subscribes this device when it is not set up yet; the
 * subscription starts first, inside the click, because the browser asks for permission only in
 * a user gesture. Switches update at once and roll back with an error line when the save fails.
 */
export function NotificationsSection() {
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

  const save = useMutation({
    mutationFn: updateNotificationPrefs,
    onMutate: async (patch: NotificationPrefsPatch) => {
      await queryClient.cancelQueries({ queryKey: notificationPrefsQuery.queryKey });
      const previous = queryClient.getQueryData<NotificationPrefs>(notificationPrefsQuery.queryKey);
      if (previous) {
        queryClient.setQueryData(notificationPrefsQuery.queryKey, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(notificationPrefsQuery.queryKey, context.previous);
      }
    },
    onSuccess: (next) => queryClient.setQueryData(notificationPrefsQuery.queryKey, next),
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

  function onPushChange(on: boolean) {
    if (on && device === 'off' && key) void turnOnDevice(key);
    save.mutate({ pushEnabled: on });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('settings.notifications.title')}</h2>
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
            {key ? (
              <SwitchRow
                label={t('settings.notifications.push')}
                hint={t('settings.notifications.pushHint')}
                checked={data.pushEnabled}
                onChange={onPushChange}
              >
                {data.pushEnabled && device && (
                  <DeviceLine
                    state={device}
                    busy={deviceBusy}
                    failed={deviceFailed}
                    onTurnOn={() => void turnOnDevice(key)}
                  />
                )}
              </SwitchRow>
            ) : (
              <div>
                <p className="text-body font-semibold">{t('settings.notifications.push')}</p>
                <p className="text-button text-muted-foreground">
                  {t('settings.notifications.pushUnavailable')}
                </p>
              </div>
            )}
            <div className="mt-5 border-t border-border pt-5">
              <SwitchRow
                label={t('settings.notifications.email')}
                hint={t('settings.notifications.emailHint')}
                checked={data.emailEnabled}
                onChange={(on) => save.mutate({ emailEnabled: on })}
              />
            </div>
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

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  children,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block text-body font-semibold">
            {label}
          </label>
          <p id={`${id}-hint`} className="text-button text-muted-foreground">
            {hint}
          </p>
        </div>
        {/* 3px down lines the 26px switch up with the label's first line. */}
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          aria-describedby={`${id}-hint`}
          className="mt-[3px]"
        />
      </div>
      {children}
    </div>
  );
}

/** This device under the Push switch: its state and the one thing to do about it. */
function DeviceLine({
  state,
  busy,
  failed,
  onTurnOn,
}: {
  state: DeviceState;
  busy: boolean;
  failed: boolean;
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
