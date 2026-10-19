import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { WeeklySummaryArchiveSchema } from '@spolu/shared';
import { apiGet } from '@/lib/api';
import { groupSettingQuery } from './api';
import { isoWeek } from './format';

/**
 * The group Prehľad tab's line for admins (spec §12.4): this week's summary and its status
 * ("Koncept · Skontrolovať", or "Vypnutý"), and the group's archive. Clients never render it.
 */
export function WeeklySummaryOverviewLine({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const week = isoWeek(new Date());
  const setting = useQuery(groupSettingQuery(groupId));
  // The group's newest report (one indexed row): this week's when it is there.
  const list = useQuery({
    queryKey: ['weekly-summaries', 'archive', 'overview', groupId],
    queryFn: () =>
      apiGet(
        `/weekly-summaries/archive?groupId=${encodeURIComponent(groupId)}&limit=1`,
        WeeklySummaryArchiveSchema,
      ),
    select: (page) => page.items.find((item) => item.week === week) ?? null,
  });
  if (!setting.data || list.isPending) return null;
  const summary = list.data ?? null;
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-card px-5 py-3 text-button">
      <span className="font-semibold">{t('projects.weeklySummary.label')}</span>
      {!setting.data.enabled ? (
        <span className="text-muted-foreground">{t('projects.weeklySummary.off')}</span>
      ) : summary ? (
        <>
          <span>
            {t(
              `weeklySummary.status.${summary.status === 'skipped' && summary.skipReason === 'no_activity' ? 'noActivity' : summary.status}`,
            )}
          </span>
          <Link
            to="/weekly-summaries/$summaryId"
            params={{ summaryId: summary.id }}
            className="font-semibold underline underline-offset-4"
          >
            {t('projects.weeklySummary.review')}
          </Link>
        </>
      ) : (
        <span className="text-muted-foreground">{t('projects.weeklySummary.none')}</span>
      )}
      <Link
        to="/weekly-summaries/archive"
        search={{ groupId } as never}
        className="ml-auto font-semibold underline-offset-4 hover:underline"
      >
        {t('projects.weeklySummary.archive')}
      </Link>
    </p>
  );
}
