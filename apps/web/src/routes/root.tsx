import { Outlet } from '@tanstack/react-router';
import { AppHeader } from '@/components/app-header';
import { useSwNavigate } from '@/lib/use-sw-navigate';

export function RootLayout() {
  useSwNavigate();
  return (
    // A column at least as tall as the window: a screen that fills the window (the chat) takes
    // the room left under the header. The bottom gap is the side gutter on phones. The app runs
    // edge to edge (`viewport-fit=cover`): the gutters grow to clear the notch in landscape and
    // the home bar at the bottom.
    <div className="flex min-h-dvh flex-col pr-[max(12px,env(safe-area-inset-right))] pl-[max(12px,env(safe-area-inset-left))] min-[641px]:pr-[max(clamp(20px,4vw,40px),env(safe-area-inset-right))] min-[641px]:pl-[max(clamp(20px,4vw,40px),env(safe-area-inset-left))]">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1152px] flex-1 flex-col in-data-[wide-page]:max-w-[1600px] pt-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:pt-4 min-[641px]:pb-[max(32px,env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
    </div>
  );
}
