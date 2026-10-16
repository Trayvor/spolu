import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationFallback } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { canInstall, promptInstall } from '@/lib/install-prompt';
import { cn } from '@/lib/utils';
import { notificationPrefsQuery, requestEmailFallback } from './api';
import {
  STORAGE_KEYS,
  choosePrompt,
  isPhone,
  readFlag,
  readTime,
  recordDismissal,
  write,
  type Prompt,
} from './prompt-rules';
import {
  getDeviceState,
  iosVersion,
  isStandalone,
  subscribeThisDevice,
  type DeviceState,
} from './push-device';
import { ShareIcon } from './share-icon';

type Device = {
  phone: boolean;
  standalone: boolean;
  ios: number | null;
  pushManager: boolean;
  permission: NotificationPermission | 'unsupported';
};

/**
 * What the device is, read once per mount (a page load or a login). Null where the browser
 * lacks `matchMedia` (old engines, jsdom): no prompt is better than a broken layout.
 */
function readDevice(): Device | null {
  if (typeof window.matchMedia !== 'function') return null;
  return {
    phone: isPhone(),
    standalone: isStandalone(),
    ios: iosVersion(),
    pushManager: typeof PushManager !== 'undefined',
    permission:
      typeof Notification === 'undefined'
        ? ('unsupported' as const)
        : (Notification.permission as NotificationPermission),
  };
}

function readStored() {
  return {
    install: readTime(STORAGE_KEYS.install),
    enable: readTime(STORAGE_KEYS.enable),
    fallbackDone: readFlag(STORAGE_KEYS.iosFallback),
  };
}

/**
 * One bottom card for signed-in users: install the app, turn on notifications on this device,
 * or (iOS < 16.4) the email fallback notice. The rules are in `prompt-rules.ts`; dismissals
 * live in localStorage per device and expire after 6 hours. Also re-subscribes silently when
 * permission is already granted but this device lost its subscription.
 */
export function AppPrompt() {
  const [device] = useState(readDevice);
  return device ? <Prompts device={device} /> : null;
}

function Prompts({ device }: { device: Device }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: prefs } = useQuery(notificationPrefsQuery);
  const [stored, setStored] = useState(readStored);
  // The 6-hour window is judged at mount (a page load or a login) and whenever the page
  // becomes visible again, so a PWA resumed from the background prompts again (insistent).
  const [now, setNow] = useState(Date.now);
  // 'failed': the device check threw; no prompt then, and never the email fallback.
  const [deviceState, setDeviceState] = useState<DeviceState | 'failed' | null>(null);
  const [fallback, setFallback] = useState<NotificationFallback | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enableFailed, setEnableFailed] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const resubscribed = useRef(false);
  const fallbackAsked = useRef(false);

  const vapidKey = prefs?.vapidPublicKey ?? null;
  const pushOn = prefs?.pushEnabled === true && vapidKey !== null;

  useEffect(() => {
    let live = true;
    getDeviceState().then(
      (state) => live && setDeviceState(state),
      () => live && setDeviceState('failed'),
    );
    // The event can arrive after mount (install-prompt.ts keeps it); show the button then.
    const onInstallable = () => rerender();
    const onInstalled = () => setHidden(true);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      setStored(readStored());
    };
    window.addEventListener('beforeinstallprompt', onInstallable);
    window.addEventListener('appinstalled', onInstalled);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('beforeinstallprompt', onInstallable);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Permission was granted earlier but the subscription is gone: no gesture needed, no card.
  useEffect(() => {
    if (!pushOn || device.permission !== 'granted' || deviceState !== 'off') return;
    if (resubscribed.current) return;
    resubscribed.current = true;
    subscribeThisDevice(vapidKey!).then(
      (state) => state === 'on' && setDeviceState('on'),
      () => undefined,
    );
  }, [pushOn, vapidKey, device.permission, deviceState]);

  const prompt: Prompt =
    deviceState === null || deviceState === 'failed' || hidden
      ? null
      : choosePrompt({
          phone: device.phone,
          standalone: device.standalone,
          ios: device.ios,
          hasPushManager: device.pushManager && deviceState !== 'unsupported',
          pushEnabled: prefs?.pushEnabled ?? false,
          vapidKey: vapidKey !== null,
          permission: device.permission,
          subscribed: deviceState === 'on',
          installDismissedAt: stored.install,
          enableDismissedAt: stored.enable,
          fallbackDone: stored.fallbackDone,
          now,
        });

  // Once per device (until OK): the server turns email on and never again after an opt-out.
  useEffect(() => {
    if (prompt !== 'ios-unsupported' || fallbackAsked.current) return;
    fallbackAsked.current = true;
    requestEmailFallback().then(
      (next) => {
        const { pushEnabled, emailEnabled, vapidPublicKey } = next;
        queryClient.setQueryData(notificationPrefsQuery.queryKey, {
          pushEnabled,
          emailEnabled,
          vapidPublicKey,
        });
        setFallback(next);
      },
      () => undefined, // not told, not stored: asked again on the next load
    );
  }, [prompt, queryClient]);

  function dismiss(which: 'install' | 'enable') {
    const at = recordDismissal(STORAGE_KEYS[which]);
    setStored((s) => ({ ...s, [which]: at }));
  }

  function install() {
    promptInstall().then(
      (outcome) => {
        if (outcome === 'accepted') setHidden(true);
        else if (outcome === 'dismissed') dismiss('install');
        else rerender(); // the event is gone: show the menu steps
      },
      () => rerender(), // the dialog failed: the event is gone, show the menu steps
    );
  }

  function turnOn() {
    // Synchronously inside the click: the browser asks for permission only on a user gesture.
    const result = subscribeThisDevice(vapidKey!);
    setBusy(true);
    setEnableFailed(false);
    result.then(
      (state) => {
        setBusy(false);
        if (state === 'on') setDeviceState('on');
        setHidden(true); // 'blocked': the profile explains how to unblock
      },
      (error: unknown) => {
        console.error('Turning on notifications failed', error);
        setBusy(false);
        setEnableFailed(true);
      },
    );
  }

  function acknowledge() {
    write(STORAGE_KEYS.iosFallback, '1');
    setStored((s) => ({ ...s, fallbackDone: true }));
  }

  const notNow = (which: 'install' | 'enable') => (
    <Button variant="ghost" size="lg" onClick={() => dismiss(which)}>
      {t('notifications.prompt.notNow')}
    </Button>
  );

  switch (prompt) {
    case 'install-android':
      return (
        <PromptCard
          title={t('notifications.prompt.installTitle')}
          body={
            canInstall()
              ? t('notifications.prompt.installBody')
              : t('notifications.prompt.installMenu')
          }
        >
          {notNow('install')}
          {canInstall() && (
            <Button size="lg" onClick={install}>
              {t('notifications.prompt.install')}
            </Button>
          )}
        </PromptCard>
      );
    case 'install-ios':
      return (
        <PromptCard
          strong
          title={t('notifications.prompt.iosTitle')}
          body={t('notifications.prompt.iosBody')}
          extra={
            <ol
              role="list"
              className="mt-4 flex list-none flex-col gap-2 rounded-lg bg-ink-hover p-3 text-button"
            >
              <Step n={1}>
                {t('notifications.prompt.iosStepShare')}
                <span className="ml-2 inline-flex size-7 items-center justify-center rounded-md bg-card align-middle text-foreground">
                  <ShareIcon className="size-[18px]" />
                </span>
              </Step>
              <Step n={2}>{t('notifications.prompt.iosStepAdd')}</Step>
              <Step n={3}>{t('notifications.prompt.iosStepOpen')}</Step>
            </ol>
          }
        >
          <Button variant="secondary" size="lg" onClick={() => dismiss('install')}>
            {t('notifications.prompt.notNow')}
          </Button>
        </PromptCard>
      );
    case 'enable':
      return (
        <PromptCard
          title={t('notifications.prompt.enableTitle')}
          body={t('notifications.prompt.enableBody')}
          error={enableFailed ? t('notifications.prompt.enableFailed') : undefined}
        >
          {notNow('enable')}
          <Button size="lg" onClick={turnOn} disabled={busy}>
            {t('notifications.prompt.turnOn')}
          </Button>
        </PromptCard>
      );
    case 'ios-unsupported':
      if (!fallback) return null;
      return (
        <PromptCard
          title={t('notifications.prompt.iosUnsupportedTitle')}
          body={
            fallback.turnedOn
              ? t('notifications.prompt.iosUnsupportedBody')
              : fallback.emailEnabled
                ? t('notifications.prompt.iosUnsupportedEmailOn')
                : t('notifications.prompt.iosUnsupportedEmailOff')
          }
        >
          <Button size="lg" onClick={acknowledge}>
            {t('notifications.prompt.ok')}
          </Button>
        </PromptCard>
      );
    default:
      return null;
  }
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex min-h-7 items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary-foreground/40 text-tiny font-semibold"
      >
        {n}
      </span>
      <span className="flex items-center">{children}</span>
    </li>
  );
}

/**
 * The card: fixed at the bottom above the safe area, full width on a phone and a 448 px card
 * at the bottom right from 641 px. Not modal: the page stays usable. `strong` is the ink card
 * for the iPhone install step.
 */
function PromptCard({
  title,
  body,
  extra,
  error,
  strong = false,
  children,
}: {
  title: string;
  body: string;
  extra?: ReactNode;
  error?: string;
  strong?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={cn(
        'fixed inset-x-3 bottom-[max(12px,calc(env(safe-area-inset-bottom)+8px))] z-40 mx-auto max-w-md rounded-xl p-5 shadow-lift motion-safe:animate-prompt-in sm:right-4 sm:left-auto sm:w-full',
        strong ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground',
      )}
    >
      <h2
        id={titleId}
        className={cn('font-semibold', strong ? 'text-medium leading-tight' : 'text-body')}
      >
        {title}
      </h2>
      <p
        id={bodyId}
        className={cn(
          'mt-1 text-button font-medium',
          strong ? 'text-primary-foreground/80' : 'text-muted-foreground',
        )}
      >
        {body}
      </p>
      {extra}
      {error && (
        <p role="alert" className="mt-3 text-button font-medium text-error-ink">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">{children}</div>
    </div>
  );
}
