import { useEffect } from 'react';
import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '@/components/app-header';
import { BottomNav, useBottomNav } from '@/components/bottom-nav';
import { OfflineStrip } from '@/components/offline-strip';
import { RoutePending } from '@/components/route-pending';
import { useFocusOnRouteChange } from '@/lib/use-focus-on-route-change';
import { useSwNavigate } from '@/lib/use-sw-navigate';

export function RootLayout() {
  useSwNavigate();
  useFocusOnRouteChange();
  const { t } = useTranslation();
  // Phones: the bottom bar floats over the window's foot, so the page keeps its room above it.
  const bottomNav = useBottomNav();
  // Toasts are portalled into the body, so the bar's room reaches them through `<html>`.
  const barShown = bottomNav !== null;
  useEffect(() => {
    if (!barShown) return;
    const root = document.documentElement.style;
    root.setProperty('--toast-bottom', 'calc(68px + max(12px, env(safe-area-inset-bottom)))');
    return () => {
      root.removeProperty('--toast-bottom');
    };
  }, [barShown]);
  return (
    // A column at least as tall as the window: a screen that fills the window (the chat) takes
    // the room left under the header. The bottom gap is the side gutter on phones. The app runs
    // edge to edge (`viewport-fit=cover`): the gutters grow to clear the notch in landscape and
    // the home bar at the bottom.
    <div className="flex min-h-dvh flex-col pr-[max(12px,env(safe-area-inset-right))] pl-[max(12px,env(safe-area-inset-left))] min-[641px]:pr-[max(clamp(20px,4vw,40px),env(safe-area-inset-right))] min-[641px]:pl-[max(clamp(20px,4vw,40px),env(safe-area-inset-left))]">
      {/* The first Tab stop: jumps over the header to the page. A click moves the focus without
          touching the URL (a hash would confuse the router). */}
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-tiny focus:font-semibold focus:text-primary-foreground"
      >
        {t('app.skipToContent')}
      </a>
      <RoutePending />
      <AppHeader />
      <OfflineStrip />
      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto flex w-full max-w-[1600px] flex-1 flex-col pt-3 outline-none min-[641px]:pt-4 min-[641px]:pb-[max(32px,env(safe-area-inset-bottom))] ${
          bottomNav
            ? 'pb-[calc(68px+max(12px,env(safe-area-inset-bottom)))]'
            : 'pb-[max(12px,env(safe-area-inset-bottom))]'
        }`}
      >
        <Outlet />
      </main>
      <BottomNav plan={bottomNav} />
    </div>
  );
}
