import { Outlet } from '@tanstack/react-router';
import { AppHeader } from '@/components/app-header';

export function RootLayout() {
  return (
    <div className="px-3 min-[641px]:px-[clamp(20px,4vw,40px)]">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1152px] py-8">
        <Outlet />
      </main>
    </div>
  );
}
