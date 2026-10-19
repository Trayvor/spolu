import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { WeeklySummaryRevision } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { revisionsQuery } from './api';
import { dateTimeLabel } from './format';
import { ContentView } from './content-view';

/**
 * "Predchádzajúce verzie": the texts a regeneration or a restore replaced, newest first, read
 * only; the manager of a draft brings one back (the text it replaces becomes a revision too).
 */
export function RevisionsDialog({
  summaryId,
  canRestore,
  busy,
  onRestore,
  onClose,
}: {
  summaryId: string;
  canRestore: boolean;
  busy: boolean;
  onRestore: (revision: WeeklySummaryRevision) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const list = useQuery(revisionsQuery(summaryId));
  return (
    <SheetDialog onEscape={onClose} testId="weekly-revisions">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <SheetDialogTitle className="mr-auto text-body font-semibold">
          {t('weeklySummary.revisions.title')}
        </SheetDialogTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('weeklySummary.preview.close')}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
        {list.isError && (
          <p role="alert" className="text-button text-error-ink">
            {t('errors.generic')}
          </p>
        )}
        {list.data?.items.map((revision) => (
          <article key={revision.id} className="flex flex-col gap-3 border-b border-border pb-6">
            <p className="text-micro text-muted-foreground tabular-nums">
              {t('weeklySummary.revisions.line', {
                version: revision.version,
                source: t(
                  revision.source === 'ai'
                    ? 'weeklySummary.list.ai'
                    : 'weeklySummary.list.factsOnly',
                ),
                date: dateTimeLabel(i18n.language, revision.createdAt),
                name: revision.createdBy?.name ?? '–',
              })}
            </p>
            <ContentView content={revision.content} />
            {canRestore && (
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                disabled={busy}
                onClick={() => onRestore(revision)}
              >
                {t('weeklySummary.revisions.restore')}
              </Button>
            )}
          </article>
        ))}
      </div>
    </SheetDialog>
  );
}
