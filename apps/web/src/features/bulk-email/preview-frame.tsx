import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BulkBlock } from '@spolu/shared';
import { cn } from '@/lib/utils';
import { BULK_KEY, previewCampaign } from './api';
import { useDebounced } from './parts';

const WIDTHS = { computer: 600, phone: 375 } as const;
type Device = keyof typeof WIDTHS;

/**
 * The email as the server renders it (the only renderer, so the preview is what is sent), for
 * the signed-in admin, refreshed 500 ms after the last edit. Shown in an `<iframe sandbox>`
 * without any allowance: no scripts, no same-origin access. Computer = 600 px, Phone = 375 px.
 */
export function PreviewFrame({
  campaignId,
  subject,
  preheader,
  blocks,
}: {
  campaignId: string;
  subject: string;
  preheader: string;
  blocks: BulkBlock[];
}) {
  const { t } = useTranslation();
  const [device, setDevice] = useState<Device>('computer');
  // Debounced as text: a new object on every render must not restart the wait.
  const serialized = useDebounced(JSON.stringify({ subject, preheader, blocks }), 500);
  const content = useMemo(
    () => JSON.parse(serialized) as { subject: string; preheader: string; blocks: BulkBlock[] },
    [serialized],
  );
  const preview = useQuery({
    queryKey: [...BULK_KEY, 'preview', campaignId, serialized],
    queryFn: () => previewCampaign(campaignId, content),
    placeholderData: (previous) => previous,
    staleTime: Infinity,
  });

  return (
    <section aria-labelledby="preview-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="preview-title" className="text-button font-semibold">
          {t('bulkEmail.preview.title')}
        </h3>
        <div
          role="group"
          aria-label={t('bulkEmail.preview.device')}
          className="flex rounded-full bg-secondary p-1"
        >
          {(Object.keys(WIDTHS) as Device[]).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={cn(
                'h-8 rounded-full px-4 text-tiny font-semibold transition-colors duration-(--duration-fast)',
                device === d ? 'bg-card shadow-lift' : 'hover:bg-surface-3',
              )}
            >
              {t(`bulkEmail.preview.${d}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl bg-muted p-3">
        {preview.data !== undefined ? (
          <iframe
            title={t('bulkEmail.preview.frame')}
            sandbox=""
            srcDoc={preview.data}
            width={WIDTHS[device]}
            height={640}
            style={{ width: WIDTHS[device] }}
            className="mx-auto block max-w-none rounded-md border-0 bg-background"
          />
        ) : (
          <p className="px-2 py-10 text-center text-button text-muted-foreground">
            {preview.isError ? t('bulkEmail.preview.failed') : t('bulkEmail.preview.loading')}
          </p>
        )}
      </div>
      {preview.isError && preview.data !== undefined && (
        <p className="text-micro text-error-ink">{t('bulkEmail.preview.failed')}</p>
      )}
      <p className="text-micro text-muted-foreground">{t('bulkEmail.preview.note')}</p>
    </section>
  );
}
