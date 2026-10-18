import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '@/components/app-header';
import { useSwNavigate } from '@/lib/use-sw-navigate';

export function RootLayout() {
  useSwNavigate();
  const { t } = useTranslation();
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
      <AppHeader />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col pt-3 pb-[max(12px,env(safe-area-inset-bottom))] outline-none min-[641px]:pt-4 min-[641px]:pb-[max(32px,env(safe-area-inset-bottom))]"
      >
        <Outlet />
      </main>
    </div>
  );
}
