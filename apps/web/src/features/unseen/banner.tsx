import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { UnseenSummary } from '@spolu/shared';
import { todayInBratislava } from '@/features/tasks/dates';
import { unseenSummaryQuery, type UnseenTarget } from './api';
import { unseenSummaryTexts } from './lines';

export type OpenSummary = {
  /** What changed before this open, kept while the item stays open; null when nothing. */
  summary: UnseenSummary | null;
  /** The summary has been asked for (or failed): the item may be marked seen now. */
  ready: boolean;
  dismiss: () => void;
};

/**
 * What changed in the task or ticket the viewer just opened (2026-10-18): fetched once on open,
 * before `useMarkSeen` marks it seen (pass `ready` to it), and kept as it was while the item
 * stays open, so marking it seen or a later refetch never empties the banner. `dismiss` hides it.
 */
export function useOpenSummary(target: UnseenTarget | null): OpenSummary {
  const query = useQuery({
    ...unseenSummaryQuery(target ?? { kind: 'task', id: '' }),
    enabled: target !== null,
    // Fresh on every open: a summary cached by a marker's tooltip may be older.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const key = target ? `${target.kind}:${target.id}` : null;
  const [kept, setKept] = useState<{ key: string; summary: UnseenSummary } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const fetched = query.isFetchedAfterMount && query.data !== undefined;
  // Adjusting state while rendering (React's documented pattern): once per opened item.
  if (key && fetched && kept?.key !== key) setKept({ key, summary: query.data });
  const summary = key && kept?.key === key && dismissed !== key ? kept.summary : null;
  return {
    summary: summary && summary.lines.length > 0 ? summary : null,
    ready: target === null || fetched || (query.isError && !query.isFetching),
    dismiss: () => setDismissed(key),
  };
}

/**
 * The small yellow banner at the top of an opened task or ticket (2026-10-18): what changed since
 * the viewer last opened it, the same lines as the marker's tooltip, until they dismiss it or
 * close the item. Nothing when nothing changed. Needs the `unseen` namespace.
 */
export function UnseenBanner({ open }: { open: OpenSummary }) {
  const { t, i18n } = useTranslation();
  if (!open.summary) return null;
  const texts = unseenSummaryTexts(t, open.summary, i18n.language, todayInBratislava());
  return (
    <section
      role="status"
      aria-label={t('unseen.heading')}
      data-testid="unseen-banner"
      className="flex items-start gap-3 rounded-lg bg-attention px-3 py-2 text-attention-foreground"
    >
      <div className="min-w-0 flex-1 text-micro">
        <p className="font-semibold">{t('unseen.heading')}</p>
        <ul role="list">
          {texts.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={open.dismiss}
        className="-mr-1 shrink-0 rounded-full px-2 py-0.5 text-micro font-semibold underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-attention-foreground max-[640px]:min-h-11"
      >
        {t('unseen.dismiss')}
      </button>
    </section>
  );
}
