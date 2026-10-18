import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { withNamespaces } from '@/i18n/namespaces';
import { useSession } from '@/features/auth/use-session';
import { useMediaQuery } from '@/lib/use-media-query';
import { bottomNavPlan, type BottomNavPlan } from './bottom-nav-plan';

/** The keyboard takes at least this much of the visual viewport (px); the bar steps aside. */
const KEYBOARD_PX = 120;

/** True while the on-screen keyboard is open: the visual viewport is much shorter than the window. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setOpen(window.innerHeight - viewport.height > KEYBOARD_PX);
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);
  return open;
}

/**
 * The plan of the phone bottom bar, or null where there is none: wider than a phone (the header
 * has the sections), the person kept the "Classic" phone navigation (the default: the section
 * select in the header, `me.phoneNav`), no bar for this role (see `bottomNavPlan`) or a
 * full-screen screen. The header hides its section pill on a phone where this is not null.
 */
export function useBottomNavPlan(): BottomNavPlan | null {
  const user = useSession();
  const phone = useMediaQuery('(max-width: 640px)');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!phone || !user || user.phoneNav !== 'bottom') return null;
  return bottomNavPlan(user, pathname);
}

/**
 * The plan of the bar to draw now: `useBottomNavPlan`, but null while the keyboard is open.
 * Sheets and dialogs need no check: the bar is `z-30`, full-screen layers `z-40` and `z-50`,
 * modal dialogs sit in the top layer, so they cover it (and the bar must stay mounted under its
 * own "More" sheet). The root layout reserves room for the bar where this is not null.
 */
export function useBottomNav(): BottomNavPlan | null {
  const plan = useBottomNavPlan();
  const keyboard = useKeyboardOpen();
  return keyboard ? null : plan;
}

// A lazy chunk with its own texts: the bar is for phones only, so desktop never downloads it. A
// chunk that fails to load (offline, new deploy) leaves the page without the bar, not broken.
const LazyBar = lazy((): Promise<{ default: ComponentType<{ plan: BottomNavPlan }> }> =>
  withNamespaces(['bottomNav', 'group'], () => import('./bottom-nav-bar'))().catch(() => ({
    default: () => null,
  })),
);

export function BottomNav({ plan }: { plan: BottomNavPlan | null }) {
  if (!plan) return null;
  return (
    <Suspense fallback={null}>
      <LazyBar plan={plan} />
    </Suspense>
  );
}
