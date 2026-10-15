import { lazy, Suspense } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

// The switcher pulls in the Radix dropdown, so it loads as its own chunk instead of weighing on first paint.
const LanguageSwitcher = lazy(() =>
  import('@/components/language-switcher').then((m) => ({ default: m.LanguageSwitcher })),
);

// Placeholder shell; Task 13 replaces it with the real header and layout.
export function RootLayout() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-5xl px-[clamp(20px,4vw,40px)] py-8">
      <nav className="mb-8 flex items-center gap-6 text-button font-semibold">
        <Link to="/" activeOptions={{ exact: true }} className="[&.active]:text-neutral">
          {t('app.name')}
        </Link>
        <Link to="/settings" className="[&.active]:text-neutral">
          {t('nav.settings')}
        </Link>
        <div className="ml-auto">
          <Suspense fallback={<div className="h-[38px] w-[52px]" aria-hidden />}>
            <LanguageSwitcher />
          </Suspense>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
