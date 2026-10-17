import { useQuery } from '@tanstack/react-query';
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BULK_LIMITS, type BulkBlock } from '@spolu/shared';
import { cn } from '@/lib/utils';
import { BULK_KEY, previewCampaign } from './api';
import { useDebounced } from './parts';
import type { EditMode } from './phone-version';
import { useWorkspaceLink } from './builder-workspace';
import { blockIdAt, stripMarkers } from './preview-highlight';

/**
 * The window the email is shown in: Computer is wider than the widest card (680 px + 2 × 12 px
 * of outer padding) so no phone rule applies; Phone is a 375 px phone. The frame is scaled down
 * to fit its pane, never up, so the email's media rules see the real width.
 */
export const FRAME_WIDTHS = { computer: 720, phone: 375 } as const;

/** The size of the HTML in bytes, as Gmail counts it before clipping (~102 kB). */
const htmlBytes = (html: string) => new TextEncoder().encode(stripMarkers(html)).length;

type Content = {
  subject: string;
  preheader: string;
  blocks: BulkBlock[];
  phoneBlocks: BulkBlock[] | null;
};

/**
 * Writes the email into the frame. The first time through `srcdoc`; afterwards the new document
 * replaces the old one in place (no reload): no flash, and the preview keeps its scroll position
 * while the admin types. Parsed by `DOMParser`, which never runs scripts (the email has none, and
 * the sandbox forbids them anyway).
 */
function writeEmail(frame: HTMLIFrameElement, html: string, loaded: boolean): boolean {
  const doc = frame.contentDocument;
  if (!loaded || !doc?.documentElement) {
    frame.srcdoc = html;
    return false;
  }
  const win = frame.contentWindow;
  const y = win?.scrollY ?? 0;
  const next = new DOMParser().parseFromString(html, 'text/html');
  doc.replaceChild(doc.importNode(next.documentElement, true), doc.documentElement);
  if (win && win.scrollY !== y) win.scrollTo({ top: y });
  return true;
}

/** The pane's inner size, followed as it changes. */
function usePaneSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      // A hidden pane (the other tab on a phone) measures 0: keep the last size.
      if (box && box.width > 0) setSize({ width: box.width, height: box.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * The email as the server renders it (the only renderer, so the preview is what is sent), for
 * the signed-in admin, refreshed 500 ms after the last edit (one request and one in-place
 * document swap per pause in typing, not per keystroke). `device` is the editor's edit mode:
 * Computer or Phone, where the email's own media rules show the phone version. The block the
 * admin hovers or edits is outlined and a click on a block selects it (`useWorkspaceLink`). Warns
 * when the HTML gets close to Gmail's clipping.
 *
 * Sandbox: `allow-same-origin` without `allow-scripts`. Nothing in the frame can run (no script,
 * no handler, no popup, no form), and the editor can reach the document to outline blocks and
 * hear clicks. The email is the server's output, every text escaped.
 */
export const PreviewFrame = forwardRef<
  HTMLElement,
  Content & {
    campaignId: string;
    device: EditMode;
    /** Fill the pane's height (the sticky preview beside the builder). */
    className?: string;
  }
>(function PreviewFrame(
  { campaignId, device, subject, preheader, blocks, phoneBlocks, className },
  ref,
) {
  const { t } = useTranslation();
  const { highlighter, select: onSelect } = useWorkspaceLink();
  // Debounced as text: a new object on every render must not restart the wait.
  const serialized = useDebounced(JSON.stringify({ subject, preheader, blocks, phoneBlocks }), 500);
  const content = useMemo(() => JSON.parse(serialized) as Content, [serialized]);
  const preview = useQuery({
    queryKey: [...BULK_KEY, 'preview', campaignId, serialized],
    queryFn: () => previewCampaign(campaignId, content),
    placeholderData: (previous) => previous,
    staleTime: Infinity,
  });
  const html = preview.data;
  const bytes = useMemo(() => (html === undefined ? 0 : htmlBytes(html)), [html]);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  });

  // A new document (the first `srcdoc`): listen to it and outline the current block.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onLoad = () => {
      const doc = frame.contentDocument;
      // The empty frame's own `about:blank` load is not the email.
      if (!doc || !frame.getAttribute('srcdoc')) return;
      loaded.current = true;
      doc.addEventListener('pointerover', (e) => highlighter.hover(blockIdAt(e.target)));
      doc.addEventListener('pointerout', (e) => {
        if (!e.relatedTarget) highlighter.hover(null);
      });
      doc.addEventListener('click', (e) => {
        // A preview never follows its links; a click picks the block to edit.
        e.preventDefault();
        const id = blockIdAt(e.target);
        if (id) select.current(id);
      });
      highlighter.attachPreview(doc);
    };
    frame.addEventListener('load', onLoad);
    return () => {
      frame.removeEventListener('load', onLoad);
      highlighter.attachPreview(null);
    };
  }, [highlighter]);

  // Every later version replaces the document in place; the outline is put back on it.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || html === undefined) return;
    if (writeEmail(frame, html, loaded.current)) highlighter.refreshPreview();
  }, [html, highlighter]);

  const paneRef = useRef<HTMLDivElement>(null);
  const pane = usePaneSize(paneRef);
  const width = FRAME_WIDTHS[device];
  // 12 px of breathing room on each side of the frame inside the pane.
  const scale = pane.width > 0 ? Math.min(1, (pane.width - 24) / width) : 1;
  const height = pane.height > 0 ? Math.max(320, (pane.height - 24) / scale) : 640;

  return (
    <section
      ref={ref}
      aria-labelledby="preview-title"
      className={cn('flex min-w-0 scroll-mt-4 flex-col gap-3', className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="preview-title" className="text-button font-semibold">
          {t(device === 'phone' ? 'bulkEmail.preview.titlePhone' : 'bulkEmail.preview.title')}
        </h3>
        {scale < 1 && (
          <p className="text-micro text-muted-foreground" data-testid="preview-scale">
            {t('bulkEmail.preview.scaled', { percent: Math.round(scale * 100) })}
          </p>
        )}
      </div>
      <div
        ref={paneRef}
        className="relative min-h-[320px] flex-1 overflow-hidden rounded-xl bg-muted"
      >
        <div
          className={cn('mx-auto mt-3', html === undefined && 'invisible')}
          style={{ width: width * scale, height: height * scale }}
        >
          <iframe
            ref={frameRef}
            title={t('bulkEmail.preview.frame')}
            sandbox="allow-same-origin"
            width={width}
            height={Math.round(height)}
            style={{
              width,
              height,
              transform: scale < 1 ? `scale(${scale})` : undefined,
              transformOrigin: 'top left',
            }}
            className="block max-w-none rounded-md border-0 bg-background"
          />
        </div>
        {html === undefined && (
          <p className="absolute inset-x-0 top-0 px-2 py-10 text-center text-button text-muted-foreground">
            {preview.isError ? t('bulkEmail.preview.failed') : t('bulkEmail.preview.loading')}
          </p>
        )}
      </div>
      {preview.isError && html !== undefined && (
        <p className="text-micro text-error-ink">{t('bulkEmail.preview.failed')}</p>
      )}
      {bytes > BULK_LIMITS.htmlWarnBytes && (
        <p role="status" className="rounded-md bg-attention/30 px-3 py-2 text-micro">
          {t('bulkEmail.preview.tooBig', { kb: Math.round(bytes / 1000) })}
        </p>
      )}
      <p className="text-micro text-muted-foreground">
        {t('bulkEmail.preview.note')} {t('bulkEmail.preview.clickHint')}
      </p>
    </section>
  );
});
