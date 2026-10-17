import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button-variants';

/** Shown inside the root layout for any client route that does not exist. */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section className="flex max-w-[552px] flex-col items-start gap-4">
      <h1 className="text-large leading-none">{t('notFound.title')}</h1>
      <p className="text-body">{t('notFound.body')}</p>
      <Link to="/" className={buttonVariants()}>
        {t('notFound.home')}
      </Link>
    </section>
  );
}
