import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { UserLanguage } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { previewSummary } from './api';

/**
 * The email as a recipient in the chosen language gets it, in a sandboxed `srcdoc` iframe (no
 * scripts, no same origin; only our own logo image), like the bulk email preview (ADR 0044).
 */
export function PreviewDialog({
  summaryId,
  version,
  initial,
  onClose,
}: {
  summaryId: string;
  version: number;
  initial: UserLanguage;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<UserLanguage>(initial);
  const preview = useQuery({
    queryKey: ['weekly-summaries', 'preview', summaryId, version, language],
    queryFn: () => previewSummary(summaryId, language),
  });
  return (
    <SheetDialog onEscape={onClose} testId="weekly-preview">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <SheetDialogTitle className="mr-auto text-body font-semibold">
          {t('weeklySummary.preview.title')}
        </SheetDialogTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('weeklySummary.preview.close')}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
        <label className="flex flex-col gap-1 text-micro font-semibold">
          {t('weeklySummary.preview.language')}
          <Select
            value={language}
            onChange={(e) => setLanguage(e.target.value as UserLanguage)}
            containerClassName="self-start"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </label>
        {preview.data && (
          <p className="text-button font-semibold break-words">{preview.data.subject}</p>
        )}
        {preview.isError && (
          <p role="alert" className="text-button text-error-ink">
            {t('errors.generic')}
          </p>
        )}
        {preview.data && (
          <iframe
            title={t('weeklySummary.preview.title')}
            sandbox=""
            srcDoc={preview.data.html}
            className="min-h-[480px] w-full flex-1 rounded-md border-2 border-border bg-card"
          />
        )}
      </div>
    </SheetDialog>
  );
}
