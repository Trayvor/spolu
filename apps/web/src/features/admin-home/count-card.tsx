import { useId, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Where a row or "Show all" goes: a route path with its params and search. */
export type CardTarget = {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
};

export type CardRow = { key: string; to: CardTarget; content: ReactNode; tall?: boolean };

export type CountCardProps = {
  title: string;
  count: number;
  caption: string;
  subline?: ReactNode;
  rows: CardRow[];
  empty: string;
  showAll?: { label: string; to: CardTarget };
  state: 'loading' | 'error' | 'ready';
  onRetry: () => void;
};

const capped = (count: number) => (count > 99 ? '99+' : String(count));

/** A route link from a `CardTarget` (paths are checked where the targets are built). */
export function TargetLink({
  target,
  className,
  children,
}: {
  target: CardTarget;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={target.to as never}
      params={target.params as never}
      search={target.search as never}
      className={className}
    >
      {children}
    </Link>
  );
}

/** Three static grey rows (no shimmer). */
function Placeholder() {
  return (
    <div aria-hidden="true" data-testid="card-placeholder" className="flex flex-col">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex h-11 items-center border-b border-border last:border-b-0">
          <span className="h-3 w-2/3 animate-skeleton rounded-full bg-secondary" />
        </div>
      ))}
    </div>
  );
}

/** The list half of a card, also the body of a phone tile's sheet. */
export function CardList({
  rows,
  empty,
  showAll,
  state,
  onRetry,
}: Pick<CountCardProps, 'rows' | 'empty' | 'showAll' | 'state' | 'onRetry'>) {
  const { t } = useTranslation();
  if (state === 'loading') return <Placeholder />;
  if (state === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 py-2">
        <p className="text-button text-muted-foreground">{t('adminHome.shell.loadError')}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('adminHome.shell.retry')}
        </Button>
      </div>
    );
  }
  if (rows.length === 0) return <p className="py-2 text-button text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.key} className="border-b border-border last:border-b-0">
            <TargetLink
              target={row.to}
              className={cn(
                '-mx-2 flex items-center gap-3 rounded-lg px-2 hover:bg-accent hover:text-foreground',
                row.tall ? 'min-h-14 py-2' : 'h-11',
              )}
            >
              {row.content}
            </TargetLink>
          </li>
        ))}
      </ul>
      {showAll && (
        <TargetLink
          target={showAll.to}
          className="mt-2 self-start text-tiny font-semibold underline underline-offset-4"
        >
          {showAll.label}
        </TargetLink>
      )}
    </div>
  );
}

/** The count column: the one bold element of the dashboard. */
export function CountFigure({
  count,
  caption,
  subline,
}: Pick<CountCardProps, 'count' | 'caption' | 'subline'>) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-large leading-none font-semibold tabular-nums">{capped(count)}</span>
      <span className="text-micro text-muted-foreground">{caption}</span>
      {subline}
    </div>
  );
}

/**
 * A dashboard card: the title, then the count (a 112 px left column at `text-large`) beside the
 * list, whose every row is one link to its item. Loading shows three grey rows; an error shows
 * "Could not load this. Try again." in this card only.
 */
export function CountCard({ title, count, caption, subline, state, ...list }: CountCardProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-xl bg-card p-5">
      <h2 id={titleId} className="text-body font-semibold">
        {title}
      </h2>
      <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-4">
        {state === 'ready' ? (
          <CountFigure count={count} caption={caption} subline={subline} />
        ) : (
          <span aria-hidden="true" className="h-9 w-12 animate-skeleton rounded-lg bg-secondary" />
        )}
        <CardList state={state} {...list} />
      </div>
    </section>
  );
}
