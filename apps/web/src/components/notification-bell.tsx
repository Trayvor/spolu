import { lazy, Suspense, type ComponentType } from 'react';
import { withNamespaces } from '@/i18n/namespaces';

/**
 * The header's bell (the notification centre, UX review F2), for every signed-in role: a lazy
 * chunk (`centre-bell`) with its query, badge and the `notificationCentre` texts, so none of it
 * is in the entry chunk. Until it loads, an empty slot of the bell's size keeps the header still;
 * a failed chunk (offline, new deploy) leaves the slot empty and never breaks the header.
 */
const LazyBell = lazy((): Promise<{ default: ComponentType }> =>
  withNamespaces(
    ['notificationCentre'],
    () => import('@/features/notifications/centre-bell'),
  )().catch(() => ({ default: () => null })),
);

export function NotificationBell() {
  return (
    <Suspense fallback={<span aria-hidden="true" className="size-[38px] shrink-0" />}>
      <LazyBell />
    </Suspense>
  );
}
