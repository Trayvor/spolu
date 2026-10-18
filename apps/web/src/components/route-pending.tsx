import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** A navigation faster than this shows no bar at all (no flash on a cached screen). */
const SHOW_AFTER_MS = 150;

/**
 * A thin ink bar along the top edge while the router is loading a screen (its lazy chunk, its
 * texts, its loader data): the old screen stays until the new one is ready, and this is the only
 * sign the tap was heard. Decorative motion only (a slice sliding across; still under reduced
 * motion); `role="progressbar"` without a value names it for screen readers.
 */
export function RoutePending() {
  const { t } = useTranslation();
  const pending = useRouterState({ select: (s) => s.status === 'pending' });
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setLate(true), SHOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [pending]);
  if (!pending || !late) return null;
  return (
    <div
      role="progressbar"
      aria-label={t('nav.loading')}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] overflow-hidden"
    >
      <div className="h-full w-1/3 animate-route-pending bg-primary" />
    </div>
  );
}
