import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button-variants';

/** Shown when a route fails to load (for example `/api/me` is down). A retry runs the guards again. */
export function RootError({ reset }: { reset: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <div role="alert" className="mx-auto flex max-w-[552px] flex-col items-start gap-6 px-5 py-16">
      <p className="text-medium font-semibold">{t('errors.generic')}</p>
      {/* A plain button with the Button classes: `Button` would bring `cn` into the initial JS. */}
      <button
        type="button"
        className={buttonVariants()}
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        {t('errors.retry')}
      </button>
    </div>
  );
}
