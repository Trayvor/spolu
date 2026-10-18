import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/use-session';
import { useMediaQuery } from '@/lib/use-media-query';
import { SegmentedControl } from './segmented-control';

export const FINANCE_SEGMENTS = ['overview', 'documents', 'workLog', 'rankings'] as const;
export type FinanceSegment = (typeof FINANCE_SEGMENTS)[number];

const storageKey = (userId: string, screen: string) => `spolu.finance.${userId}.${screen}.segment`;

/** The phone's remembered segment (per person and screen); blocked storage just forgets. */
function useRememberedSegment(screen: string): [FinanceSegment, (next: FinanceSegment) => void] {
  const userId = useSession()?.id ?? 'anon';
  const key = storageKey(userId, screen);
  const [segment, setSegment] = useState<FinanceSegment>(() => {
    try {
      const saved = localStorage.getItem(key);
      return (FINANCE_SEGMENTS as readonly string[]).includes(saved ?? '')
        ? (saved as FinanceSegment)
        : 'overview';
    } catch {
      return 'overview';
    }
  });
  const choose = (next: FinanceSegment) => {
    setSegment(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Private mode: the choice lasts until the screen closes.
    }
  };
  return [segment, choose];
}

/**
 * The three-card grid of a Finance screen (Phase 32, spec §6.1 and §9). Part A1 owns it; the
 * cards are the parts' own components, passed in as slots.
 *
 * - From 1024 px: `7fr 3fr` columns, at least the window's height under the header. Overview top
 *   left at the full height of its charts (never scrolled), Documents under it with the rest (at
 *   least 360 px), Work log the whole right column. Documents and Work log scroll inside
 *   themselves: `contain: size` keeps their content from stretching the rows.
 * - 641–1023 px: Overview across the top, Documents and Work log side by side under it.
 * - Phones: a segmented control "Overview · Documents · Work log" (remembered; `/finance` adds
 *   "Rankings") shows one card at a time at its natural height; the others are not mounted, so
 *   they fetch nothing.
 */
export function FinanceGrid({
  screen,
  overview,
  documents,
  workLog,
  rankings,
  labels,
}: {
  /** `tab` or `page`: the remembered segment is per screen. */
  screen: string;
  overview: ReactNode;
  documents: ReactNode;
  workLog: ReactNode;
  /** `/finance` only: the rankings row under the grid, a fourth segment on phones. */
  rankings?: ReactNode;
  /** The segment names; the page names its documents card "Contracts". */
  labels?: Partial<Record<FinanceSegment, string>>;
}) {
  const { t } = useTranslation();
  const phone = useMediaQuery('(max-width: 640px)');
  const [segment, setSegment] = useRememberedSegment(screen);
  const slots: Record<FinanceSegment, ReactNode> = { overview, documents, workLog, rankings };
  const segments = FINANCE_SEGMENTS.filter((s) => s !== 'rankings' || rankings !== undefined);
  const shown = segments.includes(segment) ? segment : 'overview';

  if (phone) {
    return (
      <div className="flex flex-col gap-3" data-testid="finance-grid" data-layout="phone">
        <SegmentedControl
          label={t('finance.segments.label')}
          value={shown}
          onChange={setSegment}
          options={segments.map((value) => ({
            value,
            label: labels?.[value] ?? t(`finance.segments.${value}`),
          }))}
        />
        <div className="flex flex-col" data-slot={shown}>
          {slots[shown]}
        </div>
      </div>
    );
  }
  const grid = (
    <div
      data-testid="finance-grid"
      data-layout="grid"
      className="grid grid-cols-2 gap-4 min-[1024px]:min-h-[max(640px,calc(100dvh-15rem))] min-[1024px]:grid-cols-[7fr_3fr] min-[1024px]:grid-rows-[auto_minmax(360px,1fr)]"
    >
      <div
        data-slot="overview"
        className="col-span-2 flex min-h-[280px] flex-col min-[1024px]:col-span-1"
      >
        {overview}
      </div>
      <div
        data-slot="documents"
        className="flex min-h-[420px] flex-col min-[1024px]:col-start-1 min-[1024px]:row-start-2 min-[1024px]:min-h-0 min-[1024px]:contain-size"
      >
        {documents}
      </div>
      <div
        data-slot="workLog"
        className="flex min-h-[420px] flex-col min-[1024px]:col-start-2 min-[1024px]:row-span-2 min-[1024px]:row-start-1 min-[1024px]:min-h-0 min-[1024px]:contain-size"
      >
        {workLog}
      </div>
    </div>
  );
  if (rankings === undefined) return grid;
  return (
    <div className="flex flex-col gap-4">
      {grid}
      <div data-slot="rankings">{rankings}</div>
    </div>
  );
}
