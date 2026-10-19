import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button-variants';
import { navCountsQuery } from './api';

/** Friday to Monday in Bratislava, when the week's drafts wait (spec §12.1). */
export function isReviewDay(at: Date): boolean {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/Bratislava' })
    .format(at)
    .toLowerCase();
  return ['fri', 'sat', 'sun', 'mon'].includes(day);
}

/**
 * The home's "Týždenné prehľady" card (2026-10-19): the week's drafts in the admin's groups,
 * from the header counts (no extra request), shown Friday to Monday while there are any.
 */
export function WeeklySummariesCard({ now = new Date() }: { now?: Date }) {
  const { t } = useTranslation();
  const { data } = useQuery(navCountsQuery);
  const count = data?.weeklySummaries ?? 0;
  if (count === 0 || !isReviewDay(now)) return null;
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl bg-card px-5 py-4">
      <h2 className="text-body font-semibold">{t('adminHome.weeklySummaries.title')}</h2>
      <span className="text-button tabular-nums">
        {t('adminHome.weeklySummaries.toReview', { count })}
      </span>
      <Link to="/weekly-summaries" className={`${buttonVariants({ size: 'sm' })} ml-auto`}>
        {t('adminHome.weeklySummaries.review')}
      </Link>
    </section>
  );
}
