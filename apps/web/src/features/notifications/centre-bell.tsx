import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { NOTIFICATION_UNREAD_CAP } from '@spolu/shared';
import { deferredMenu } from '@/components/deferred-menu';
import { centreStateQuery } from './centre-api';
import { BellIcon, BellOffIcon } from './icons';

// The lazy `centre-bell` chunk (see `components/notification-bell.tsx`).

/** The panel's Radix part: its own chunk, loaded on the first click (`deferredMenu`). */
const CentrePanel = deferredMenu<object>(() =>
  import('./centre-panel').then((module) => module.CentrePanel),
);

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * The app icon's badge (UX review N6b): the bell's unread count where the browser has one
 * (installed apps on Chromium and iOS 16.4+), cleared at 0. A push marks it with a dot while the
 * app is closed (`push-sw.js`); opening the app puts the number back.
 */
export function useAppBadge(count: number | undefined): void {
  useEffect(() => {
    if (count === undefined) return;
    const nav = navigator as BadgeNavigator;
    const done = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
    done?.catch(() => {});
  }, [count]);
}

/** "99+" from the cap on; the plain number below it. */
export const unreadText = (count: number) =>
  count >= NOTIFICATION_UNREAD_CAP ? '99+' : String(count);

/**
 * The header's bell: a 38 px circle like the account menu, with a small ink count of unread
 * items (hidden at 0), struck through while pushes are snoozed. It opens the centre's panel.
 */
export default function CentreBell() {
  const { t } = useTranslation();
  const state = useQuery(centreStateQuery);
  const unread = state.data?.unread;
  useAppBadge(unread);
  const snoozed = Boolean(state.data?.snoozedUntil);
  const count = unread ?? 0;
  const label =
    count > 0
      ? t('notificationCentre.bell.labelUnread', { count: unreadText(count) })
      : t('notificationCentre.bell.label');
  return (
    <CentrePanel
      trigger={
        <button
          type="button"
          aria-label={label}
          className="relative inline-flex size-[38px] shrink-0 items-center justify-center rounded-full text-foreground transition-colors duration-(--duration-fast) after:absolute after:-inset-[3px] after:rounded-full hover:bg-surface-3 data-[state=open]:bg-surface-3"
        >
          {snoozed ? <BellOffIcon /> : <BellIcon />}
          {count > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-nano leading-none font-semibold text-primary-foreground tabular-nums"
            >
              {unreadText(count)}
            </span>
          )}
        </button>
      }
    />
  );
}
