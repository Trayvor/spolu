import { useTranslation } from 'react-i18next';
import type { WeeklySummarySkipReason, WeeklySummaryStatus } from '@spolu/shared';
import { Badge } from '@/components/ui/badge';

/** The six chips of spec §12.2: a skipped week says whether a manager or no activity skipped it. */
export function StatusChip({
  status,
  skipReason,
}: {
  status: WeeklySummaryStatus;
  skipReason: WeeklySummarySkipReason | null;
}) {
  const { t } = useTranslation();
  const key = status === 'skipped' && skipReason === 'no_activity' ? 'noActivity' : status;
  const variant =
    status === 'sent'
      ? 'success'
      : status === 'draft'
        ? 'default'
        : status === 'skipped'
          ? 'outline'
          : 'secondary';
  return <Badge variant={variant}>{t(`weeklySummary.status.${key}`)}</Badge>;
}
