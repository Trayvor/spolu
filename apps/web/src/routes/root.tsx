import { Outlet } from '@tanstack/react-router';
import { AppHeader } from '@/components/app-header';
import { useSwNavigate } from '@/lib/use-sw-navigate';

export function RootLayout() {
  useSwNavigate();
  return (
    // A column at least as tall as the window: a screen that fills the window (the chat) takes
    // the room left under the header. The bottom gap is the side gutter on phones.
    <div className="flex min-h-dvh flex-col px-3 min-[641px]:px-[clamp(20px,4vw,40px)]">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1152px] flex-1 flex-col pt-8 pb-3 min-[641px]:pb-8">
        <Outlet />
      </main>
    </div>
  );
}
