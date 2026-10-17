import { useQuery } from '@tanstack/react-query';
import { forwardRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BULK_LIMITS, type BulkBlock } from '@spolu/shared';
import { BULK_KEY, previewCampaign } from './api';
import { useDebounced } from './parts';
import type { EditMode } from './phone-version';

const WIDTHS = { computer: 600, phone: 375 } as const;

/** The size of the HTML in bytes, as Gmail counts it before clipping (~102 kB). */
const htmlBytes = (html: string) => new TextEncoder().encode(html).length;

type Content = {
  subject: string;
  preheader: string;
  blocks: BulkBlock[];
  phoneBlocks: BulkBlock[] | null;
};

/**
 * The email as the server renders it (the only renderer, so the preview is what is sent), for
 * the signed-in admin, refreshed 500 ms after the last edit. Shown in an `<iframe sandbox>`
 * without any allowance: no scripts, no same-origin access. `device` is the editor's edit mode
 * (Phase 31): Computer = 600 px, Phone = 375 px, where the email's own media rules show the
 * phone version. Warns when the HTML gets close to Gmail's clipping.
 */
export const PreviewFrame = forwardRef<
  HTMLElement,
  Content & { campaignId: string; device: EditMode }
>(function PreviewFrame({ campaignId, device, subject, preheader, blocks, phoneBlocks }, ref) {
  const { t } = useTranslation();
  // Debounced as text: a new object on every render must not restart the wait.
  const serialized = useDebounced(JSON.stringify({ subject, preheader, blocks, phoneBlocks }), 500);
  const content = useMemo(() => JSON.parse(serialized) as Content, [serialized]);
  const preview = useQuery({
    queryKey: [...BULK_KEY, 'preview', campaignId, serialized],
    queryFn: () => previewCampaign(campaignId, content),
    placeholderData: (previous) => previous,
    staleTime: Infinity,
  });

  const bytes = preview.data === undefined ? 0 : htmlBytes(preview.data);

  return (
    <section
      ref={ref}
      aria-labelledby="preview-title"
      className="flex min-w-0 scroll-mt-4 flex-col gap-3"
    >
      <h3 id="preview-title" className="text-button font-semibold">
        {t(device === 'phone' ? 'bulkEmail.preview.titlePhone' : 'bulkEmail.preview.title')}
      </h3>
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
      {bytes > BULK_LIMITS.htmlWarnBytes && (
        <p role="status" className="rounded-md bg-attention/30 px-3 py-2 text-micro">
          {t('bulkEmail.preview.tooBig', { kb: Math.round(bytes / 1000) })}
        </p>
      )}
      <p className="text-micro text-muted-foreground">{t('bulkEmail.preview.note')}</p>
    </section>
  );
});
