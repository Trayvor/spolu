import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The frame of every finance card: a title row (with the card's own controls on the right) and a
 * body that scrolls inside the card from 1024 px, so the page itself never scrolls there. Parts
 * B, C and D render their cards in it.
 */
export function FinanceCard({
  title,
  titleId,
  actions,
  children,
  className,
}: {
  title: string;
  /** The heading's id: the grid labels the card's region with it. */
  titleId: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className={cn('flex min-h-0 min-w-0 flex-col rounded-xl bg-card', className)}
    >
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-4 pb-3">
        <h2 id={titleId} className="text-medium leading-tight font-semibold">
          {title}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 min-[1024px]:overflow-y-auto">
        {children}
      </div>
    </section>
  );
}

/** What an empty (or not yet built) card says: one quiet line, centred in the card. */
export function FinanceCardEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="m-auto max-w-[44ch] py-8 text-center text-button text-muted-foreground">
      {children}
    </p>
  );
}
